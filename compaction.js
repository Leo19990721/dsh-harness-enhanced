import { inputBudget, trimToolContent, choosePrefix, estimatedInput, SUMMARY_CAP } from './compaction-policy.js';

const REBUILD = 'HARNESS_ENHANCED_REBUILD_REQUEST';
const TOO_LARGE = 'HARNESS_ENHANCED_INPUT_TOO_LARGE';
const OVERFLOW = 'CONTEXT_WINDOW_EXCEEDED';
const sameRoute = (a, b) => a?.provider === b.provider && a?.model === b.model;
const fail = (code, message) => ({ type: 'finish', reason: { kind: 'error', failure: { code, message } } });
const toolTokens = tools => tools?.length ? Math.ceil(JSON.stringify(tools).length / 4) + 4 : 0;
// The installed Google subscription CLI owns its transcript and only receives the newest user text.
const externalHistory = provider => provider === 'antigravity';

/** Price the actual outbound transcript, before any replacement; use the native message estimator. */
function price(ctx, llmApi, request, info, session) {
  const { toolHistory } = request;
  const projected = llmApi.projectToolUpdates(request.messages, request.tools, info?.toolUpdate, toolHistory);
  const messages = info?.inputModalities && !info.inputModalities.includes('image')
    ? llmApi.projectImagesForTextModel(projected.messages) : projected.messages;
  const images = messages.flatMap(message => message.content.filter(block => block.type === 'image'));
  const pricing = images.length ? ctx.llm.imageRequestPricing(request.provider, request.model) : undefined;
  const imagePrices = pricing?.priceImages(images);
  if (imagePrices && imagePrices.length !== images.length) throw new Error('image price count mismatch');

  let imageIndex = 0;
  const prices = new Map();
  for (const message of messages) {
    let visualTokens = 0;
    const content = message.content.map(block => {
      if (block.type === 'file') return { type: 'text', text: ctx.llm.fileRequestText(block.attachment) };
      if (block.type !== 'image') return block;
      const priced = imagePrices?.[imageIndex++];
      if (!priced) {
        if (!block.offloaded) {
          // The route did not declare an image calculator. Leave a coarse visual allowance.
          const { width, height } = block.attachment;
          visualTokens += Math.max(128, Math.ceil(width / 512) * Math.ceil(height / 512) * 256);
        }
        return block;
      }
      visualTokens += priced.visualTokens;
      return { type: 'text', text: priced.text };
    });
    prices.set(message.id, ctx.tokenMeter.estimateMessage({ ...message, content }) + visualTokens);
  }
  const rows = session.surface.nodes.map(seq => {
    const event = session.eventAt(seq);
    const message = session.deriveEventMessage(event);
    return { seq, event, message, tokens: prices.get(message?.id) ?? 0 };
  });
  const tools = toolTokens(projected.tools);
  const system = rows.reduce((total, row) => total + (row.event.type === 'system/message' ? row.tokens : 0), 0);
  const updates = new Set(info?.toolUpdate ? toolHistory?.updates.map(update => update.messageId) : []);
  const warmThrough = rows.findLastIndex(row => updates.has(row.message?.id));
  return { rows, tools, system, warmThrough, heuristic: tools + rows.reduce((sum, row) => sum + row.tokens, 0) };
}

function planPrunes(ctx, rows, { turn, step }) {
  const proposals = [];
  for (const { seq, event, message } of rows) {
    if (event.type !== 'tool/result' || !message || (event.data.turn === turn && event.data.step >= step - 1)) continue;
    const content = trimToolContent(message.content);
    if (!content) continue;
    const replacement = { ...message, content };
    const before = ctx.tokenMeter.estimateMessage(message);
    const saved = before - ctx.tokenMeter.estimateMessage(replacement);
    if (saved > 0) proposals.push({ seq, event, replacement, before, saved });
  }
  return proposals;
}

function commitPrunes(session, proposals) {
  session.append(proposals.flatMap(({ seq, event, replacement, before }) => [
    ['compaction/prune', { shadowedRange: { start: seq, end: seq }, shadowedSeqs: [seq], shadowedTokenCount: before }],
    ['tool/result', { ...event.data, message: replacement }, {
      surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq],
    }],
  ]));
}

const budgetOf = ({ provider, model, maxTokens }, window) => inputBudget({ provider, model, window, maxTokens });
function isFresh(row, { openTurnStartSeq, lastStepStartSeq }) {
  const source = row.message?.source?.kind;
  if (row.event.type === 'user/message' && source === 'user' && openTurnStartSeq !== null && row.seq > openTurnStartSeq) return true;
  return lastStepStartSeq !== null && row.seq > lastStepStartSeq && (row.event.type === 'system/message'
    || row.event.type === 'user/message' && source !== 'compact-checkpoint');
}

/** One policy per preset scope. This only acts on this scope's own loop-built requests. */
export function installCompaction(ctx, { engine, llmApi, sessionApi, compactionApi }) {
  if (typeof llmApi.isAgentLoopRequest !== 'function' || typeof llmApi.projectToolUpdates !== 'function'
    || typeof sessionApi.headerEquals !== 'function' || typeof compactionApi.toolPairingBalancedAfter !== 'function') {
    throw new Error('unsupported compaction hooks');
  }
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort());
  const active = new WeakMap();
  const samples = new WeakMap();
  const diagnostics = new Set();
  const warn = text => ctx.logger.warn(`harness-enhanced-compaction: ${text}`);

  async function snapshot(record, request, { info, window, calibrate = true } = {}) {
    const session = record.agent.session;
    const hasToolUpdates = request.provider !== 'codex'
      && (request.toolHistory?.updates.length || request.tools?.some(tool => tool.deferLoading));
    if (!info && (hasToolUpdates || request.messages.some(message => message.content.some(block => block.type === 'image')))) {
      info = await ctx.llm.resolveModelInfo(request.provider, request.model, request.signal);
    }
    request.signal.throwIfAborted();
    const budget = budgetOf(request, window);
    const view = price(ctx, llmApi, request, info, session);
    const header = session.requestHeader();
    const sample = samples.get(session);
    const previous = calibrate && sample && sample.window === window && sample.generation === session.surface.contentGeneration
      && header && sessionApi.headerEquals(sample.header, header) ? sample : undefined;
    return { ...view, ...budget, window, header, total: estimatedInput(view.heuristic, previous) };
  }

  async function reduce(record, view, { overflow = false, switchSource, checkOnly = false } = {}) {
    const { agent, request } = record;
    const { session } = agent;
    const signal = AbortSignal.any([record.signal, lifetime.signal]);
    const { rows, total, budget, threshold, pruneTarget, target } = view;
    if (view.problem) {
      const key = `${request.provider}/${request.model}: ${view.problem}`;
      if (!diagnostics.has(key)) { diagnostics.add(key); warn(key); }
      if (overflow || !switchSource && Number.isSafeInteger(view.window)) return view.problem;
      return;
    }
    // Before admitting a switch, only trigger if the old conversation alone
    // crosses the destination line. Later we'll see the assembled envelope.
    if (!overflow && total - (switchSource ? view.tools + view.system : 0) < threshold) return;
    const boundary = ctx.agents.turnBoundaryOf(session);
    const start = rows[0]?.event.type === 'system/message' ? 1 : 0;
    const freshAt = rows.findIndex((row, i) => i >= start && isFresh(row, boundary));
    const stop = freshAt < 0 ? rows.length : freshAt;
    const protectedTokens = view.tools + rows.reduce((n, row, i) => n + (i >= stop || i < start ? row.tokens : 0), 0);
    const explanation = `预计输入 ${total} token，可用 ${budget}；系统提示、工具定义和新增内容中至少 ${protectedTokens} token 要保留。可缩短本次输入、减少工具，或选上下文更大的模型。`;
    if (!switchSource && protectedTokens > budget) return explanation;
    if (checkOnly) return total > budget ? explanation : undefined;

    const minimumGain = overflow ? Math.max(128, Math.floor(total * 0.05)) : 0;
    const pruneLimit = overflow ? Math.min(pruneTarget, Math.floor(total * 0.75)) : pruneTarget;
    const candidates = planPrunes(ctx, rows, record);
    const saved = candidates.reduce((sum, item) => sum + item.saved, 0);
    signal.throwIfAborted();
    if (saved > minimumGain && total - saved <= pruneLimit) {
      commitPrunes(session, candidates);
      ctx.logger.info(`harness-enhanced-compaction: tool result trim, ${total} → ~${total - saved} input tokens`);
      return 'changed';
    }

    const summaryRoute = switchSource ? { ...request, ...switchSource } : request;
    const warm = switchSource ? await snapshot(record, summaryRoute, {
      window: session.requestContext()?.contextWindow, calibrate: false,
    }) : view;
    const summaryBudget = budgetOf({ ...summaryRoute, maxTokens: SUMMARY_CAP }, warm.window).budget ?? 0;
    const range = start < stop && compactionApi.toolPairingBalancedBefore(session, rows[start].seq)
      ? choosePrefix(rows, {
        start, stop, total, target: overflow ? Math.min(target, Math.floor(total * 0.60)) : target,
        ceiling: overflow ? budget : threshold - 1, minimumGain, summaryBudget,
        auxiliaryBase: Math.max(warm.tools, toolTokens(summaryRoute.tools)) + (start ? warm.rows[0].tokens : 0)
          + warm.total - warm.heuristic,
        warmRows: warm.rows, warmThrough: warm.warmThrough,
        balancedAfter: seq => compactionApi.toolPairingBalancedAfter(session, seq),
      }) : undefined;
    if (!range) {
      warn(`没有能安全缩短请求的历史段。${explanation}`);
      if (overflow || !switchSource && total > budget) return explanation;
      return;
    }
    signal.throwIfAborted();
    // Reuse the native transaction; don't send the now-stale ordinary request.
    await engine.compactRegion(range.start, range.end, agent, signal);
    return 'changed';
  }

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision.kind === 'enter') {
      const { agent, turn, step, signal } = payload;
      const previous = active.get(signal);
      active.set(signal, { agent, turn, step, signal, overflowTried: previous?.turn === turn && previous.overflowTried });
    }
    return decision;
  });

  // rc.5 retains this seam for the existing native model-switch behavior. Only
  // use it before admission, so the original failed-message proof still works.
  ctx.on('agent/request', async ({ signal }, next) => {
    const config = await next();
    const record = active.get(signal);
    const session = record?.agent.session;
    const previous = session?.requestHeader();
    if (!previous || sameRoute(previous.config, config) || signal.aborted || lifetime.signal.aborted
      || externalHistory(config.provider) || externalHistory(previous.config.provider)) return config;
    let generation;
    try {
      const request = { ...config, signal, tools: previous.tools, messages: session.deriveMessages(), toolHistory: session.toolHistory() };
      record.request = request;
      const info = await ctx.llm.resolveModelInfo(config.provider, config.model, signal);
      request.maxTokens ??= info.defaultMaxTokens;
      const view = await snapshot(record, request, { info, window: info.context?.contextWindow, calibrate: false });
      generation = session.seq;
      if (await reduce(record, view, { switchSource: previous.config }) === 'changed') record.checked = true;
    } catch (error) {
      signal.throwIfAborted();
      // Keep the recovery route unchanged: only a genuine, closed native
      // compaction attempt before input admission can produce this failure code.
      const opened = generation === undefined ? undefined : session.eventAt(generation);
      const closed = session.eventAt(session.seq - 1);
      if (opened?.type === 'compaction/start' && closed?.type === 'compaction/end'
        && opened.data.compactionId === closed.data.compactionId && closed.data.error !== undefined) {
        throw new llmApi.LlmError('切换模型前的上下文摘要失败。可取回尚未发送的文字后重试。', 'MODEL_SWITCH_COMPACTION_FAILED', { cause: error });
      }
      warn('切换模型预检未完成，将按实际请求检查。');
    }
    return config;
  }, { prepend: true });

  ctx.on('llm/stream', async function* (request, next) {
    const record = request.signal && active.get(request.signal);
    if (!record || lifetime.signal.aborted || externalHistory(request.provider)
      || record.agent.session.id !== request.sessionId || !llmApi.isAgentLoopRequest(request)) {
      yield* next();
      return;
    }
    const session = record.agent.session;
    const context = session.requestContext();
    const window = sameRoute(context, request) ? context.contextWindow : undefined;
    const generation = session.surface.contentGeneration;
    record.request = request;
    record.dispatched = false;
    record.view = undefined;
    let outcome;
    try {
      record.view = await snapshot(record, request, { window });
      const checkOnly = record.checked;
      record.checked = true;
      outcome = await reduce(record, record.view, { checkOnly });
    } catch {
      if (!request.signal.aborted) warn('自动压缩未完成，将沿用现有会话。');
    }
    request.signal.throwIfAborted();
    if (session.surface.contentGeneration > generation) {
      record.localCode = REBUILD;
      yield fail(REBUILD, 'Rebuild the request from the committed compaction surface.');
      return;
    }
    if (outcome && outcome !== 'changed') {
      record.localCode = TOO_LARGE;
      yield fail(TOO_LARGE, outcome);
      return;
    }
    record.dispatched = true;
    let usage;
    for await (const chunk of next()) {
      if (chunk.type === 'usage') usage = chunk.usage;
      if (chunk.type === 'finish' && usage && record.view?.header
        && !['error', 'aborted'].includes(chunk.reason.kind)) {
        samples.set(session, { usage, heuristic: record.view.heuristic, header: record.view.header, window, generation });
      }
      yield chunk;
    }
  });

  ctx.on('agent/request-error', async ({ signal, failure }, next) => {
    const record = active.get(signal);
    if (!record || signal.aborted) return next();
    if (record.localCode === failure.code) {
      record.localCode = undefined;
      return failure.code === REBUILD ? { kind: 'retry' } : undefined;
    }
    if (failure.code !== OVERFLOW || !record.dispatched || lifetime.signal.aborted) return next();
    // Own this one exact failure to keep an 'always retry' provider policy
    // from resending the oversized request unchanged.
    if (record.overflowTried || !record.view) return;
    record.overflowTried = true;
    record.checked = true;
    const session = record.agent.session;
    const before = session.surface.replaceGeneration;
    let outcome;
    try {
      outcome = await reduce(record, record.view, { overflow: true });
    } catch {
      if (!signal.aborted) warn('服务端拒绝了请求，单次压缩恢复未完成；保留原始错误。');
    }
    if (signal.aborted) return;
    if (session.surface.replaceGeneration > before) return { kind: 'retry' };
    if (outcome && outcome !== 'changed') {
      throw llmApi.LlmError.fromFailure({ ...failure, message: `${failure.message}\n${outcome}` });
    }
  }, { prepend: true });
}
