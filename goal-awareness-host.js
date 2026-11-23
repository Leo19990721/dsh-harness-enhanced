export const name = 'harness-enhanced-goal-awareness';
export const inject = ['systemPrompt'];

function goalGuidance(phase, activation) {
  const remove = 'If the goal is outdated or unrelated, briefly tell the user they can delete it from the goal bar.';
  if (phase === 'blocked') {
    return 'This goal is blocked and no longer continues automatically. '
      + 'If the current user input unblocks it and the objective is achieved, or it was already achieved, call update_goal with action: "complete". '
      + 'If the user explicitly asks to restart automatic continuation, call update_goal with action: "resume". '
      + remove;
  }
  if (phase === 'paused') {
    return 'This goal is paused; the model cannot resume it using update_goal. '
      + 'If the objective is achieved, call update_goal with action: "complete". '
      + 'If the user wants to continue, tell them to click Resume in the goal bar. '
      + remove;
  }
  if (phase === 'active' && activation === 'disarmed') {
    return 'This goal is active but not armed for automatic continuation (for example, after a restart or interruption). '
      + 'If the objective is achieved, call update_goal with action: "complete". '
      + 'If the user asks to restore automatic continuation, call update_goal with action: "resume". '
      + remove;
  }
  return 'This goal is in progress. Once the objective is achieved and verified, call update_goal with action: "complete".';
}

export function formatGoalAwarenessContext(goal, { hasUpdateGoal = true } = {}) {
  if (!goal || goal.phase === 'complete') return '';

  const { id, revision, phase, activation, objective, blockedReason } = goal;
  // Omit roundsStarted so merely admitting another round does not change the snapshot.
  const snapshot = { id, revision, phase };
  if (typeof activation === 'string') snapshot.activation = activation;
  snapshot.objective = objective;
  if (phase === 'blocked' && blockedReason?.message) {
    snapshot.blocked_reason = { code: blockedReason.code, message: blockedReason.message };
  }

  // Keep the JSON on one line, and never let data introduce a raw prompt tag.
  const data = JSON.stringify(snapshot)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
  const instruction = hasUpdateGoal
    ? `${goalGuidance(phase, activation)} For update_goal, use the id above as goal_id and the revision as shown.`
    : 'This session has an unfinished goal, but this preset does not provide update_goal. '
      + 'If needed, tell the user to manage or delete it in the goal bar at the top or bottom of the session.';
  return `<current_goal>\n${data}\n${instruction}\n</current_goal>`;
}

function readService(ctx, key) {
  if (typeof ctx?.get === 'function') return ctx.get(key);
  return ctx?.[key];
}

export function apply(ctx) {
  if (typeof ctx.systemPrompt?.context !== 'function') return;
  ctx.systemPrompt.context({
    name: 'harness-enhanced:goal-awareness',
    order: 130,
    required: false,
    interpolate: false,
    text: ({ agent, scope, toolSet } = {}) => {
      if (!agent || agent.session?.header?.origin === 'subagent') return '';

      const goals = readService(ctx, 'goals');
      if (typeof goals?.get !== 'function') return '';
      const agents = readService(ctx, 'agents');
      if (typeof agents?.get === 'function' && agents.get(agent.id) !== agent) return '';

      let goal;
      try {
        goal = goals.get(agent);
      } catch {
        return '';
      }
      if (!goal || goal.phase === 'complete') return '';

      const tools = readService(ctx, 'tools');
      const hasUpdateGoal = typeof tools?.get === 'function' && toolSet != null
        ? tools.get('update_goal', scope, toolSet) !== undefined
        : true;
      return formatGoalAwarenessContext(goal, { hasUpdateGoal });
    },
  });
}
