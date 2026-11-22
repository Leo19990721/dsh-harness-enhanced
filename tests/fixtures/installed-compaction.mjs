// Run through Electron as Node, with the signed installation supplied as the only DSH API source.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { failureProof } from '../../failure-proof.js';
import { recoverFailedText } from '../../failed-message.js';

const root = resolve(process.argv[2]);
const require = createRequire(join(root, 'package.json'));
// Resolve local-bundle imports using the same installation fallback as DSH.
const anchor = pathToFileURL(join(root, 'package.json')).href;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@deepseek-ai/') && context.parentURL?.startsWith(new URL('../../', import.meta.url).href)) {
    return nextResolve(specifier, { ...context, parentURL: anchor });
  }
  return nextResolve(specifier, context);
} });
const fromDsh = name => import(`@deepseek-ai/${name}`);
const [cordis, loader, llm, sessions, projections, prompt, tools, executor, agents, loop, meter,
  commands, presets, retry, boot, include] = await Promise.all([
  'cordis', 'cordis-plugin-loader', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt',
  'dsh-tools', 'dsh-tool-executor-native', 'dsh-agent', 'dsh-agent-loop', 'dsh-token-meter',
  'dsh-commands', 'dsh-agent-preset-registry', 'dsh-llm-retry', 'dsh-app-boot', 'cordis-plugin-include',
].map(fromDsh));
assert.equal(boot.getDshRuntimeVersion(), '0.2.2-rc.5');
const text = value => [{ type: 'text', text: value }];
const user = value => llm.createUserMessage({ source: { kind: 'user', rpcId: randomUUID() }, content: text(value) });
const visible = message => message.content.map(block => block.text ?? '').join('');
const chars = tokens => 'note'.repeat(tokens);
const SYSTEM = 'Fixture system prompt';
const ASTRA = 'gpt-test-astra';
const SOL = 'gpt-test-sol';
const SMALL = 'gpt-test-small';
const W = 272_000;
const LINE = 244_800;
const BAND = 193_800;
const codeOf = session => session.snapshotEvents().at(-1)?.data.reason?.error?.code;
const events = (session, type) => session.snapshotEvents().filter(event => event.type === type);
const append = { surfaceOp: 'append' };
const backendUrl = new URL('../../compaction-backend.js', import.meta.url);
const packUrl = new URL('../../cordis.patch.yml', import.meta.url);
const yaml = require('js-yaml');
const load = async url => yaml.load(await readFile(url, 'utf8'), { schema: include.entryListSchema });

class Adapter extends llm.LlmAdapter {
  ordinary = [];
  summaries = [];
  resolutions = 0;
  overflows = 0;
  failures = 0;
  failSummary = false;
  usage;
  toolUpdate;
  outputCap = 128_000;
  providerRetryPolicy() { return llm.resolveRetryPolicy({ mode: 'always', backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } }, 'fixture'); }
  async resolveModel(provider, id) {
    this.resolutions++;
    return { provider, id, name: id, context: { contextWindow: id === SOL ? 500_000 : id === SMALL ? 100_000 : W },
      defaultMaxTokens: this.outputCap, inputModalities: ['text'], ...(this.toolUpdate ? { toolUpdate: this.toolUpdate } : {}) };
  }
  async *stream(request) {
    const auxiliary = request.purpose === 'compaction';
    (auxiliary ? this.summaries : this.ordinary).push(request);
    if (auxiliary && this.failSummary) throw new llm.LlmError('summary failed in fixture', 'SERVER');
    if (!auxiliary && this.overflows > 0) {
      this.overflows--;
      throw new llm.LlmError('synthetic provider context overflow', 'CONTEXT_WINDOW_EXCEEDED');
    }
    if (!auxiliary && this.failures > 0) {
      this.failures--;
      throw new llm.LlmError('synthetic upstream failure', 'SERVER');
    }
    const block = { type: 'text', text: auxiliary ? 'Fixture checkpoint' : 'OK' };
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'block-end', index: 0, block };
    if (!auxiliary && this.usage) yield { type: 'usage', usage: this.usage };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

const presetOf = ({ stockOnly = false, pruner = true } = {}) => ({
  id: 'fixture', plugins: [{ id: 'compaction', name: 'cordis:group', group: true, isolate: { compaction: true, toolResultPruner: true }, config: [
    { id: 'compaction-basic', name: stockOnly ? '@deepseek-ai/dsh-compaction-basic' : backendUrl.href },
    { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
    ...(pruner ? [{ id: 'tool-result-pruner', name: '@deepseek-ai/dsh-compaction-tool-result-pruner' }] : []),
  ] }],
});

async function harness(t, options = {}) {
  const ctx = new cordis.Context();
  ctx.baseUrl = anchor;
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(loader.default);
  ctx.loader.builtins.group = loader.Group;
  for (const plugin of [llm.default, sessions.default, projections.default, tools.default, executor, agents.default, meter.default, commands.default, retry]) {
    if (plugin === tools.default) await ctx.plugin(prompt.default, { personaPrefix: SYSTEM });
    await ctx.plugin(plugin);
  }
  await ctx.plugin(presets.default, { default: 'fixture' });
  const unregister = await ctx.agentPresets.register(presetOf(options));
  const roster = await ctx.agentPresets.list();
  assert.deepEqual(roster, [{ id: 'fixture' }]);
  const adapter = new Adapter();
  const provider = options.provider ?? 'codex';
  ctx.llm.registerAdapter([provider], adapter);
  await ctx.plugin(loop.default, { agents: [] });
  async function create(turns = [], model = ASTRA) {
    const sessionId = `fixture-${randomUUID()}`;
    const seed = history(sessionId, turns);
    const { agent } = await ctx.agents.create({ sessionId, seed, agentOptions: { provider, model },
      async setup(agentCtx) { await ctx.agentPresets.mount(agentCtx, 'fixture'); } });
    return agent;
  }
  return { ctx, adapter, create, unregister };
}

function history(sessionId, turns) {
  if (!turns.length) return [];
  const session = sessions.Session.create(sessionId);
  session.append('system/message', { turn: 1, step: 1,
    message: llm.createSystemMessage(`You are an AI agent powered by DeepSeek Harness.\n\n${SYSTEM}`) }, append);
  let turn = 0;
  for (const { userTokens = 0, responseTokens = 0, result, tail } of turns) {
    turn++;
    session.append('turn/start', { turn });
    session.append('step/start', { turn, step: 1 });
    session.append('user/message', user(chars(userTokens)), append);
    const callId = llm.ToolCallId(`fixture-${turn}`);
    const reply = llm.createAssistantMessage({ source: { provider: 'codex', model: ASTRA }, content: [
      ...text(chars(responseTokens)), ...(result ? [{ type: 'tool-call', id: callId, name: 'fixture_tool', arguments: '{}' }] : []),
    ] });
    session.append('assistant/message', { turn, step: 1, stream: [], message: reply }, append);
    if (result) {
      session.append('tool/call', { turn, step: 1, callId, name: 'fixture_tool', arguments: '{}' });
      session.append('tool/result', { turn, step: 1, message: llm.createToolResultMessage({ callId, content: text(result), isError: false }) }, append);
    }
    session.append('step/end', { turn, step: 1 });
    if (tail) {
      session.append('step/start', { turn, step: 2 });
      session.append('assistant/message', { turn, step: 2, stream: [], message: llm.createAssistantMessage({
        source: { provider: 'codex', model: ASTRA }, content: text(tail),
      }) }, append);
      session.append('step/end', { turn, step: 2 });
    }
    session.append('turn/end', { turn, reason: { kind: 'completed' } });
  }
  return session.snapshotEvents();
}

async function send(ctx, agent, value) {
  let stop;
  const idle = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error('fixture agent did not return idle')); }, 8_000);
    stop = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle') return;
      clearTimeout(timer);
      stop();
      resolve();
    });
  });
  const message = user(value);
  agent.followup(message);
  await idle;
  return message.id;
}

function ordinaryInput(ctx, req) {
  const schemaTokens = req.tools?.length ? Math.ceil(JSON.stringify(req.tools).length / 4) + 4 : 0;
  return req.messages.reduce((sum, message) => sum + ctx.tokenMeter.estimateMessage(message), schemaTokens);
}

function assertAdmittedOnce(agent, id) {
  assert.equal(events(agent.session, 'user/message').filter(event => event.data.id === id).length, 1);
  assert.equal(agent.session.deriveMessages().filter(message => message.id === id).length, 1);
}

test('installed preset overlay changes only the compaction backend', async () => {
  const patches = await load(packUrl);
  const base = (await Promise.all(['standard', 'ptc', 'cordis', 'minimal'].map(id => load(join(root, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', `${id}.patch.yml`))))).flat();
  const original = boot.composeEntries([base]);
  const enhanced = boot.composeEntries([base, patches]);
  const normalized = enhanced.filter(entry => entry.id.startsWith('preset-')).map(entry => {
    const backend = entry.config.plugins.find(row => row.id === 'compaction').config.find(row => row.id === 'compaction-basic');
    assert.equal(backend.name, '@local/dsh-harness-enhanced/compaction');
    backend.name = '@deepseek-ai/dsh-compaction-basic';
    return entry;
  });
  assert.deepEqual(normalized, original);
});

test('Astra keeps 100k unchanged, with one exact-route preparation', async t => {
  const { ctx, adapter, create } = await harness(t);
  const agent = await create([{ userTokens: 40_000, responseTokens: 60_000 }]);
  assertAdmittedOnce(agent, await send(ctx, agent, 'current question'));
  assert.equal(codeOf(agent.session), undefined);
  assert.equal(adapter.summaries.length, 0);
  assert.equal(adapter.ordinary.length, 1);
  assert.equal(adapter.ordinary[0].maxTokens, 128_000);
  assert.equal(agent.session.requestContext().contextWindow, W);
  assert.equal(adapter.resolutions, 1);
  assert.equal(agent.session.surface.replaceGeneration, 0);
});

test('Astra compares the exact assembled input to the line, then rebuilds after a native summary', async t => {
  const { ctx, adapter, create } = await harness(t);
  const agent = await create([{ userTokens: 60_000, responseTokens: 50_000 }, { userTokens: 66_000, responseTokens: 68_500 }]);
  await send(ctx, agent, 'a short turn below the line');
  assert.equal(adapter.summaries.length, 0);
  const previous = adapter.ordinary[0];
  assert.ok(ordinaryInput(ctx, previous) >= LINE - 300 && ordinaryInput(ctx, previous) < LINE);
  const id = await send(ctx, agent, 'current question ' + chars(500));
  assert.equal(adapter.summaries.length, 1);
  const summary = adapter.summaries[0];
  assert.equal(summary.provider, previous.provider);
  assert.equal(summary.model, previous.model);
  assert.equal(summary.sessionId, previous.sessionId);
  assert.equal(summary.maxTokens, 8192);
  assert.deepEqual(summary.tools, previous.tools);
  assert.deepEqual(summary.messages.slice(0, -1), previous.messages.slice(0, summary.messages.length - 1));
  assert.match(visible(summary.messages.at(-1)), /acting as a compaction engine/);
  assert.equal(adapter.ordinary.length, 2);
  const rebuilt = adapter.ordinary[1];
  assert.ok(ordinaryInput(ctx, rebuilt) <= 155_040);
  assert.deepEqual(rebuilt.messages, agent.session.deriveMessages().slice(0, -1));
  assertAdmittedOnce(agent, id);
  assert.equal(events(agent.session, 'compaction/start').length, 1);
  assert.equal(events(agent.session, 'compaction/prune').length, 0);
  assert.equal(events(agent.session, 'llm/retry').length, 0);
});

test('Astra commits only a successful prune batch; raw results, pair IDs and paths survive', async t => {
  const { ctx, adapter, create } = await harness(t);
  const path = 'D:\\example project\\full result.txt';
  const output = `useful head\n${chars(35_000)}\n"${path}"\n${chars(35_000)}\nuseful tail`;
  const agent = await create([{ userTokens: 90_000, result: output }, { userTokens: 85_000, result: `second\n${chars(8_000)}\nlast` }]);
  const originals = events(agent.session, 'tool/result');
  assertAdmittedOnce(agent, await send(ctx, agent, 'keep this input'));
  assert.equal(adapter.summaries.length, 0);
  assert.equal(adapter.ordinary.length, 1);
  const prunes = events(agent.session, 'compaction/prune');
  assert.equal(prunes.length, 2);
  for (const [i, original] of originals.entries()) {
    const replacement = agent.session.eventAt(prunes[i].seq + 1);
    assert.equal(replacement.type, 'tool/result');
    assert.deepEqual(replacement.sourceEventSeqs, [original.seq]);
    assert.equal(replacement.data.message.toolCallId, original.data.message.toolCallId);
  }
  assert.equal(visible(agent.session.eventAt(originals[0].seq).data.message), output);
  const result = visible(adapter.ordinary[0].messages.find(message => message.role === 'tool'));
  assert.ok(result.includes(path) && result.includes('useful head') && result.includes('useful tail'));
  assert.ok(ordinaryInput(ctx, adapter.ordinary[0]) <= BAND);
});

test('rejected prune proposals leave the summary prefix verbatim and its tool pairs whole', async t => {
  const { ctx, adapter, create } = await harness(t);
  const output = `full cached tool result\n${chars(25_000)}\nTAIL`;
  const agent = await create([{ userTokens: 36_000, responseTokens: 56_000, result: output }, { userTokens: 126_000 }]);
  await send(ctx, agent, 'warm up before the line');
  assert.equal(adapter.summaries.length, 0);
  assertAdmittedOnce(agent, await send(ctx, agent, 'cross the line ' + chars(3_000)));
  assert.equal(events(agent.session, 'compaction/prune').length, 0);
  assert.equal(adapter.summaries.length, 1);
  const replayed = adapter.summaries[0].messages.slice(0, -1);
  assert.ok(JSON.stringify(replayed) === JSON.stringify(adapter.ordinary[0].messages.slice(0, replayed.length)), 'summary changed the cached prefix');
  assert.equal(visible(adapter.summaries[0].messages.at(-2)), output);
});

test('if automatic summarization fails, the unchanged request and native /compact still work', async t => {
  const { ctx, adapter, create } = await harness(t);
  const agent = await create([{ userTokens: 110_000 }, { userTokens: 134_000 }]);
  await send(ctx, agent, 'keep this prefix warm');
  adapter.failSummary = true;
  assertAdmittedOnce(agent, await send(ctx, agent, chars(2_000)));
  assert.equal(adapter.summaries.length, 1);
  assert.equal(adapter.ordinary.length, 2);
  assert.equal(agent.session.surface.replaceGeneration, 0);
  assert.equal(codeOf(agent.session), undefined);
  adapter.failSummary = false;
  const { result } = await ctx.commands.execute(agent, '/compact', [], new AbortController().signal);
  assert.equal(result.kind, 'success');
});

test('upstream overflow gets one reduction and no generic always-retry loop', async t => {
  const { ctx, adapter, create } = await harness(t);
  const agent = await create([{ userTokens: 30_000, responseTokens: 20_000 }, { userTokens: 20_000, responseTokens: 10_000 }]);
  adapter.overflows = 3;
  const id = await send(ctx, agent, 'preserve this question');
  assert.equal(codeOf(agent.session), 'CONTEXT_WINDOW_EXCEEDED');
  assert.equal(adapter.ordinary.length, 2);
  assert.equal(adapter.summaries.length, 1);
  assert.equal(events(agent.session, 'llm/retry').length, 0);
  assertAdmittedOnce(agent, id);
});

test('protected input larger than the window fails with a diagnostic before dispatch', async t => {
  const { ctx, adapter, create } = await harness(t);
  const agent = await create();
  await send(ctx, agent, chars(260_000));
  assert.equal(codeOf(agent.session), 'HARNESS_ENHANCED_INPUT_TOO_LARGE');
  assert.match(agent.session.snapshotEvents().at(-1).data.reason.error.message, /缩短本次输入.*减少工具/);
  assert.equal(adapter.ordinary.length + adapter.summaries.length, 0);
});

test('generic request failures still honor the adapter retry policy', async t => {
  const { ctx, adapter, create } = await harness(t);
  const agent = await create();
  adapter.failures = 1;
  assertAdmittedOnce(agent, await send(ctx, agent, 'try normal retry'));
  assert.equal(adapter.ordinary.length, 2);
  assert.equal(adapter.summaries.length, 0);
  assert.equal(events(agent.session, 'llm/retry').length, 1);
});

test('native /compact still executes via Commands and records a standalone bracket', async t => {
  const { ctx, adapter, create } = await harness(t);
  const agent = await create([{ userTokens: 20_000, responseTokens: 10_000 }]);
  await send(ctx, agent, 'establish the warm route');
  const { result, commandId } = await ctx.commands.execute(agent, '/compact', [], new AbortController().signal);
  assert.equal(result.kind, 'success');
  assert.equal(adapter.summaries.length, 1);
  assert.equal(adapter.summaries[0].maxTokens, 65_536);
  const opened = events(agent.session, 'compaction/start')[0];
  assert.equal(opened.data.turn, null);
  assert.equal(opened.data.sourceCommandId, commandId);
});

test('a failed summary before model-switch admission produces the original recovery proof', async t => {
  const { ctx, adapter, create } = await harness(t);
  const agent = await create([{ userTokens: 55_000, responseTokens: 50_000 }, { userTokens: 10_000, responseTokens: 10_000 }]);
  await send(ctx, agent, 'warm Astra');
  adapter.failSummary = true;
  agent.model.select({ provider: 'codex', model: SMALL });
  const id = await send(ctx, agent, 'recover me from the inbox');
  assert.equal(codeOf(agent.session), 'MODEL_SWITCH_COMPACTION_FAILED');
  assert.equal(events(agent.session, 'user/message').some(event => event.data.id === id), false);
  assert.equal(adapter.ordinary.length, 1);
  assert.equal(adapter.summaries[0].model, ASTRA);
  const endSeq = agent.session.seq - 1;
  assert.ok(failureProof(seq => agent.session.eventAt(seq), endSeq));
  assert.equal(recoverFailedText(agent.session.snapshotEvents(), endSeq, 0), 'recover me from the inbox');
});

test('if the policy cannot import, stock compaction starts without disabling /compact', async t => {
  const broken = registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL === backendUrl.href && specifier === './compaction.js') throw new Error('fixture: policy import unavailable');
    return nextResolve(specifier, context);
  } });
  t.after(() => broken.deregister());
  const { ctx, adapter, create } = await harness(t);
  const agent = await create([{ userTokens: 50_000, responseTokens: 50_000 }, { userTokens: 1_000 }]);
  assert.equal(ctx.agentPresets.serviceFor(agent, 'compaction').config.auto, true);
  assert.ok(ctx.commands.find(agent, 'compact'));
  await send(ctx, agent, 'stock line should compact on the next step');
  await send(ctx, agent, 'trigger now');
  assert.ok(adapter.summaries.length > 0);
});

const fixtureTool = (name, description) => tools.defineTool({
  name, description, parameters: {},
  output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
  async execute() { return 'fixture'; },
});

test('newly assembled tools can cause a crossing without a new long message', async t => {
  const { ctx, adapter, create } = await harness(t);
  const agent = await create([{ userTokens: 110_000 }, { userTokens: 134_000 }]);
  await send(ctx, agent, 'below the line');
  assert.ok(ordinaryInput(ctx, adapter.ordinary[0]) < LINE);
  ctx.tools.register(fixtureTool('new_fixture', 'schema '.repeat(700)));
  const id = await send(ctx, agent, 'short again');
  assert.equal(adapter.summaries.length, 1);
  assert.equal(adapter.ordinary.length, 2);
  assert.equal(adapter.summaries[0].tools[0].name, 'new_fixture');
  assert.deepEqual(adapter.summaries[0].tools, adapter.ordinary[1].tools);
  assertAdmittedOnce(agent, id);
});

test('warm replay preserves an addition-only route’s active tool declarations', async t => {
  const { ctx, adapter, create } = await harness(t, { provider: 'deepseek-official' });
  adapter.outputCap = 16_000;
  adapter.toolUpdate = 'addition-only';
  ctx.tools.register(fixtureTool('first_fixture', 'First tool'));
  const agent = await create([{ userTokens: 104_000 }, { userTokens: 114_000 }]);
  await send(ctx, agent, 'first call');
  ctx.tools.register(fixtureTool('second_fixture', 'Dynamically added tool'));
  await send(ctx, agent, 'warm this tool series');
  const previous = adapter.ordinary[1];
  assert.ok(previous.messages.some(message => message.role === 'developer'));
  assert.ok(previous.tools.some(tool => tool.deferLoading));
  assert.equal(adapter.summaries.length, 0);
  await send(ctx, agent, chars(32_000));
  assert.equal(adapter.summaries.length, 1);
  const summary = adapter.summaries[0];
  assert.deepEqual(summary.tools, previous.tools);
  const prefix = summary.messages.slice(0, -1);
  assert.ok(JSON.stringify(prefix) === JSON.stringify(previous.messages.slice(0, prefix.length)), 'dynamic tools broke the replay prefix');
  assert.equal(adapter.ordinary.length, 3);
});

test('prior output does not trigger compaction; cached input still contributes', async t => {
  const { ctx, adapter, create } = await harness(t);
  const agent = await create([{ userTokens: 90_000 }, { userTokens: 40_000 }]);
  adapter.usage = { inputTokens: 1_000, cacheReadTokens: 129_000, outputTokens: 140_000, totalTokens: 270_000 };
  await send(ctx, agent, 'large previous output counter');
  adapter.usage = { inputTokens: 4_000, cacheReadTokens: 221_000, cacheWriteTokens: 15_000, outputTokens: 1_000 };
  await send(ctx, agent, 'anchor with higher actual input count');
  assert.equal(adapter.summaries.length, 0);
  await send(ctx, agent, chars(5_000));
  assert.equal(adapter.summaries.length, 1);
  assert.equal(adapter.ordinary.length, 3);
});

test('overflow with no history to reduce reports what to change without resending', async t => {
  const { ctx, adapter, create } = await harness(t);
  const agent = await create();
  adapter.overflows = 2;
  await send(ctx, agent, 'provider rejects the protected input in this fixture');
  assert.equal(codeOf(agent.session), 'CONTEXT_WINDOW_EXCEEDED');
  assert.match(agent.session.snapshotEvents().at(-1).data.reason.error.message, /减少工具/);
  assert.equal(adapter.ordinary.length, 1);
  assert.equal(adapter.summaries.length, 0);
});

test('replacing the enhanced preset with stock affects new agents, not retained agents', async t => {
  const { ctx, create, unregister } = await harness(t);
  const resident = await create();
  assert.equal(ctx.agentPresets.serviceFor(resident, 'compaction').config.auto, false);
  await unregister();
  await ctx.agentPresets.register(presetOf({ stockOnly: true }));
  const fresh = await create();
  assert.equal(ctx.agentPresets.serviceFor(fresh, 'compaction').config.auto, true);
  assert.equal(ctx.agentPresets.serviceFor(resident, 'compaction').config.auto, false);
  assert.ok(ctx.commands.find(resident, 'compact'));
  assert.ok(ctx.commands.find(fresh, 'compact'));
});
