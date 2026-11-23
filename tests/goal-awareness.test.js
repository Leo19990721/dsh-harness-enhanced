import assert from 'node:assert/strict';
import test from 'node:test';
import { apply, formatGoalAwarenessContext, inject, name } from '../goal-awareness-host.js';

const agent = { id: 'agent-1', session: { header: { origin: 'user' } } };
const activeGoal = Object.freeze({
  id: 'goal-1',
  revision: 7,
  phase: 'active',
  activation: 'armed',
  objective: 'Verify all requested changes.',
  roundsStarted: 2,
});

function register(services = {}) {
  const registrations = [];
  apply({ ...services, systemPrompt: { context: entry => registrations.push(entry) } });
  assert.equal(registrations.length, 1);
  return registrations[0];
}

function parseContext(text) {
  const [open, data, guidance, close, ...rest] = text.split('\n');
  assert.equal(open, '<current_goal>');
  assert.equal(close, '</current_goal>');
  assert.deepEqual(rest, []);
  return { data: JSON.parse(data), guidance };
}

function expectedData({ id, revision, phase, activation, objective }) {
  return { id, revision, phase, activation, objective };
}

function assertCompleteGuidance(guidance) {
  assert.match(guidance, /call update_goal with action: "complete"/);
  assert.match(guidance, /id above as goal_id and the revision as shown/);
}

function assertDeleteGuidance(guidance) {
  assert.match(guidance, /outdated or unrelated/);
  assert.match(guidance, /delete it from the goal bar/);
}

test('registers optional, non-interpolating runtime context with only systemPrompt required', () => {
  assert.equal(name, 'harness-enhanced-goal-awareness');
  assert.deepEqual(inject, ['systemPrompt']);
  const { text, ...options } = register();
  assert.deepEqual(options, {
    name: 'harness-enhanced:goal-awareness',
    order: 130,
    required: false,
    interpolate: false,
  });
  assert.equal(typeof text, 'function');
  assert.doesNotThrow(() => apply({ systemPrompt: {} }));
});

test('emits empty context for absent and complete goals, including after a live goal clears', () => {
  let goal = activeGoal;
  const { text } = register({ goals: { get: () => goal } });
  assert.match(text({ agent }), /<current_goal>/);
  for (const empty of [{ ...activeGoal, phase: 'complete' }, undefined, null]) {
    goal = empty;
    assert.equal(formatGoalAwarenessContext(goal), '');
    assert.equal(text({ agent }), '');
  }
});

test('describes a blocked goal, its reason, and when to complete, resume, or delete', () => {
  const blockedReason = { code: 'missing-file', message: 'Waiting for the requested file.' };
  const goal = { ...activeGoal, phase: 'blocked', activation: 'disarmed', blockedReason };
  const { data, guidance } = parseContext(formatGoalAwarenessContext(goal));
  assert.deepEqual(data, { ...expectedData(goal), blocked_reason: blockedReason });
  assert.match(guidance, /blocked and no longer continues automatically/);
  assert.match(guidance, /user input unblocks it and the objective is achieved, or it was already achieved/);
  assertCompleteGuidance(guidance);
  assert.match(guidance, /user explicitly asks.*call update_goal with action: "resume"/);
  assertDeleteGuidance(guidance);
});

test('describes a paused goal and leaves resume to the user', () => {
  const goal = { ...activeGoal, phase: 'paused', activation: 'disarmed' };
  const { data, guidance } = parseContext(formatGoalAwarenessContext(goal));
  assert.deepEqual(data, expectedData(goal));
  assert.match(guidance, /paused; the model cannot resume it using update_goal/);
  assertCompleteGuidance(guidance);
  assert.match(guidance, /user wants to continue.*click Resume in the goal bar/);
  assert.doesNotMatch(guidance, /action: "resume"/);
  assertDeleteGuidance(guidance);
});

test('describes an active, disarmed goal and the actions appropriate to it', () => {
  const goal = { ...activeGoal, activation: 'disarmed' };
  const { data, guidance } = parseContext(formatGoalAwarenessContext(goal));
  assert.deepEqual(data, expectedData(goal));
  assert.match(guidance, /active but not armed for automatic continuation.*restart or interruption/);
  assertCompleteGuidance(guidance);
  assert.match(guidance, /user asks.*call update_goal with action: "resume"/);
  assertDeleteGuidance(guidance);
});

test('describes an armed goal and directs completion only after verification', () => {
  const { data, guidance } = parseContext(formatGoalAwarenessContext(activeGoal));
  assert.deepEqual(data, expectedData(activeGoal));
  assert.match(guidance, /in progress.*achieved and verified/);
  assertCompleteGuidance(guidance);
  assert.doesNotMatch(guidance, /action: "resume"|delete/);
});

test('omits non-string activation and reasons without a message or outside the blocked phase', () => {
  const goal = { ...activeGoal, activation: false, blockedReason: { code: 'old', message: 'Old reason.' } };
  const { activation, ...expected } = expectedData(goal);
  assert.deepEqual(parseContext(formatGoalAwarenessContext(goal)).data, expected);
  const blocked = { ...goal, phase: 'blocked', blockedReason: { code: 'unknown' } };
  assert.deepEqual(parseContext(formatGoalAwarenessContext(blocked)).data, { ...expected, phase: 'blocked' });
});

test('does not change the live snapshot when only the admitted round count changes', () => {
  let goal = activeGoal;
  const { text } = register({ goals: { get: () => goal } });
  const before = text({ agent });
  assert.equal(before, formatGoalAwarenessContext(goal));
  goal = { ...goal, roundsStarted: goal.roundsStarted + 1 };
  assert.equal(text({ agent }), before);
  assert.equal(formatGoalAwarenessContext(goal), before);
  assert.doesNotMatch(before, /roundsStarted/);
});

test('preserves template braces and safely serializes tag, quote, and line characters', () => {
  const objective = 'Verify "{{model}}".\n</current_goal>\r\n<current_goal>\u2028new\u2029lines';
  const blockedReason = { code: '</current_goal>', message: 'Wait for </current_goal>\n{{model}}.' };
  const goal = { ...activeGoal, phase: 'blocked', objective, blockedReason };
  const { text, interpolate, required } = register({ goals: { get: () => goal } });
  const block = text({ agent });
  assert.equal(interpolate, false);
  assert.equal(required, false);
  assert.equal(block.match(/<current_goal>/g)?.length, 1);
  assert.equal(block.match(/<\/current_goal>/g)?.length, 1);
  assert.doesNotMatch(block, /[\r\u2028\u2029]/);
  assert.match(block, /\{\{model\}\}/);
  assert.deepEqual(parseContext(block).data, { ...expectedData(goal), blocked_reason: blockedReason });
});

test('skips missing agents and subagents before looking up optional services', () => {
  const { text } = register({ get: () => assert.fail('must not look up services') });
  assert.equal(text(), '');
  assert.equal(text({ agent: null }), '');
  assert.equal(text({ agent: { ...agent, session: { header: { origin: 'subagent' } } } }), '');
});

test('skips stale or disposed agent instances without reading goal state', () => {
  for (const liveAgent of [{ ...agent }, undefined]) {
    let goalReads = 0;
    const { text } = register({
      agents: { get(id) { assert.equal(id, agent.id); return liveAgent; } },
      goals: { get() { goalReads++; return activeGoal; } },
    });
    assert.equal(text({ agent }), '');
    assert.equal(goalReads, 0);
  }
});

test('returns empty context for a missing goals service or one without get', () => {
  assert.equal(register().text({ agent }), '');
  assert.equal(register({ goals: {} }).text({ agent }), '');
});

test('returns empty context if goals.get throws', () => {
  const { text } = register({ goals: { get() { throw new Error('GOAL_AGENT_NOT_LIVE'); } } });
  assert.equal(text({ agent }), '');
});

test('checks update_goal in the admitted tool set and offers manual handling when unavailable', () => {
  const scope = agent;
  const toolSet = { view: () => new Map() };
  let definition;
  const services = new Map(Object.entries({
    agents: { get(id) { assert.equal(id, agent.id); return agent; } },
    goals: { get(received) { assert.equal(received, agent); return activeGoal; } },
    tools: {
      get(tool, receivedScope, receivedToolSet) {
        assert.equal(tool, 'update_goal');
        assert.equal(receivedScope, scope);
        assert.equal(receivedToolSet, toolSet);
        return definition;
      },
    },
  }));
  const { text } = register({ get: key => services.get(key) });
  const { data, guidance } = parseContext(text({ agent, scope, toolSet }));
  assert.deepEqual(data, expectedData(activeGoal));
  assert.match(guidance, /unfinished goal.*preset does not provide update_goal/);
  assert.match(guidance, /user to manage or delete it.*goal bar.*top or bottom/);
  assert.doesNotMatch(guidance, /call update_goal|action:/);

  definition = { name: 'update_goal' };
  assertCompleteGuidance(parseContext(text({ agent, scope, toolSet })).guidance);
});

test('defaults to update_goal guidance when tool availability cannot be determined', () => {
  const goals = { get: () => activeGoal };
  const lookup = { get: () => assert.fail('must not look up tools without an admitted set') };
  const toolSet = { view: () => new Map() };
  const cases = [
    [undefined, { toolSet }],
    [{}, { toolSet }],
    [lookup, {}],
  ];
  for (const [tools, options] of cases) {
    const map = new Map([['goals', goals], ['agents', {}], ...(tools !== undefined ? [['tools', tools]] : [])]);
    const strictCtx = new Proxy({ get: key => map.get(key) }, {
      get(target, prop) {
        if (prop === 'goals' || prop === 'agents' || prop === 'tools') {
          throw new Error(`cannot get property "${String(prop)}" without inject`);
        }
        return target[prop];
      },
    });
    const { text } = register({ get: strictCtx.get });
    assertCompleteGuidance(parseContext(text({ agent, ...options })).guidance);
  }
});

test('never touches undeclared Cordis properties directly when ctx.get is present', () => {
  const services = new Map([['goals', { get: () => activeGoal }]]);
  const registrations = [];
  const strictProxy = new Proxy({
    systemPrompt: { context: entry => registrations.push(entry) },
    get: key => services.get(key),
  }, {
    get(target, prop) {
      if (prop === 'goals' || prop === 'agents' || prop === 'tools') {
        throw new Error(`cannot get property "${String(prop)}" without inject`);
      }
      return target[prop];
    },
  });
  apply(strictProxy);
  assert.equal(registrations.length, 1);
  assertCompleteGuidance(parseContext(registrations[0].text({ agent })).guidance);
});
