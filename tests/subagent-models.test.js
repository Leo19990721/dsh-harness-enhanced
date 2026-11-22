import assert from 'node:assert/strict';
import test from 'node:test';
import { apply, discoverAllowedModelRoutes } from '../subagent-models-host.js';

function createFakeContext({ providers = [], modelsByProvider = {}, fallbackAllowed = null } = {}) {
  const listeners = new Map();
  const cleanups = [];
  const llm = {
    listProviders: () => providers,
    async listModels(providerId) {
      const entry = modelsByProvider[providerId];
      if (typeof entry === 'function') return entry();
      return entry ?? [];
    },
  };
  const subagentModelSelection = fallbackAllowed
    ? { config: { allowedModels: { get: () => fallbackAllowed } } }
    : undefined;
  const ctx = {
    llm,
    fiber: { active: true },
    get(key) {
      if (key === 'llm') return llm;
      if (key === 'subagentModelSelection') return subagentModelSelection;
      return undefined;
    },
    effect(fn) {
      const dispose = fn();
      if (typeof dispose === 'function') cleanups.push(dispose);
      return dispose;
    },
    on(event, listener, options) {
      const list = listeners.get(event) ?? [];
      if (options === true || options?.prepend === true) list.unshift(listener);
      else list.push(listener);
      listeners.set(event, list);
      return () => {
        const index = list.indexOf(listener);
        if (index >= 0) list.splice(index, 1);
      };
    },
    async emitSerial(event, payload) {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        await listener(payload);
      }
    },
    dispose() {
      ctx.fiber.active = false;
      while (cleanups.length) cleanups.pop()();
      listeners.clear();
    },
  };
  return ctx;
}

function createFakeSession({ origin = undefined, firstLiveSeq = 0, events = [] } = {}) {
  const log = [...events];
  return {
    header: { origin },
    firstLiveSeq,
    get cursor() { return log.length - 1; },
    eventAt(seq) { return log[seq]; },
    append(type, data) { log.push({ type, data }); },
    log,
  };
}

test('prepends before native listener and discovers newly added future models dynamically', async () => {
  const modelsByProvider = {
    codex: [{ id: 'gpt-6.2-sol' }, { id: 'gpt-6.2-astra' }],
    antigravity: [{ id: 'gemini-4-neon' }],
  };
  const ctx = createFakeContext({
    providers: [{ id: 'codex' }, { id: 'antigravity' }],
    modelsByProvider,
  });

  // Simulate native SubagentModelSelectionConfig registered BEFORE our plugin
  let nativeWrites = 0;
  ctx.on('agent/created', async ({ agent }) => {
    const hasPolicy = agent.session.log.some(e => e.type === 'subagent/model-selection-policy');
    if (hasPolicy) return;
    nativeWrites++;
    agent.session.append('subagent/model-selection-policy', {
      allowedModels: [{ provider: 'codex', model: 'gpt-6.2-sol' }],
    });
  });

  apply(ctx);

  const session1 = createFakeSession();
  await ctx.emitSerial('agent/created', { agent: { session: session1, options: { provider: 'antigravity', model: 'gemini-4-neon' } } });
  assert.equal(nativeWrites, 0);
  assert.equal(session1.log.length, 1);
  assert.deepEqual(session1.log[0].data.allowedModels, [
    { provider: 'codex', model: 'gpt-6.2-sol' },
    { provider: 'codex', model: 'gpt-6.2-astra' },
    { provider: 'antigravity', model: 'gemini-4-neon' },
  ]);

  // Simulate brand-new future models and a brand-new provider arriving later at runtime
  modelsByProvider.codex.push({ id: 'gpt-7.0-nova' });
  modelsByProvider.deepseek = [{ id: 'deepseek-v4' }];
  ctx.llm.listProviders = () => [{ id: 'codex' }, { id: 'antigravity' }, { id: 'deepseek' }];

  const session2 = createFakeSession();
  await ctx.emitSerial('agent/created', { agent: { session: session2 } });
  assert.equal(nativeWrites, 0);
  assert.equal(session2.log.length, 1);
  assert.deepEqual(session2.log[0].data.allowedModels, [
    { provider: 'codex', model: 'gpt-6.2-sol' },
    { provider: 'codex', model: 'gpt-6.2-astra' },
    { provider: 'codex', model: 'gpt-7.0-nova' },
    { provider: 'antigravity', model: 'gemini-4-neon' },
    { provider: 'deepseek', model: 'deepseek-v4' },
  ]);
  ctx.dispose();
});

test('failing or slow provider falls back to cache without blocking other providers', async () => {
  let failCodex = false;
  const ctx = createFakeContext({
    providers: [{ id: 'codex' }, { id: 'antigravity' }, { id: 'slow' }],
    modelsByProvider: {
      codex: () => {
        if (failCodex) throw new Error('temporary network failure');
        return [{ id: 'gpt-6.2-sol' }];
      },
      antigravity: [{ id: 'gemini-4-neon' }],
      slow: () => new Promise(() => {}),
    },
  });
  const cache = new Map();

  const first = await discoverAllowedModelRoutes(ctx, undefined, cache, { timeoutMs: 40 });
  assert.deepEqual(first, [
    { provider: 'codex', model: 'gpt-6.2-sol' },
    { provider: 'antigravity', model: 'gemini-4-neon' },
  ]);

  failCodex = true;
  const second = await discoverAllowedModelRoutes(ctx, undefined, cache, { timeoutMs: 40 });
  assert.deepEqual(second, [
    { provider: 'codex', model: 'gpt-6.2-sol' },
    { provider: 'antigravity', model: 'gemini-4-neon' },
  ]);
  ctx.dispose();
});

test('empty fulfilled model list clears stale cache for logged-out provider', async () => {
  let models = [{ id: 'gemini-4-neon' }];
  const ctx = createFakeContext({
    providers: [{ id: 'antigravity' }],
    modelsByProvider: { antigravity: () => models },
  });
  const cache = new Map();

  const before = await discoverAllowedModelRoutes(ctx, undefined, cache);
  assert.deepEqual(before, [{ provider: 'antigravity', model: 'gemini-4-neon' }]);

  models = [];
  const after = await discoverAllowedModelRoutes(ctx, undefined, cache);
  assert.deepEqual(after, []);
  assert.equal(cache.has('antigravity'), false);
  ctx.dispose();
});

test('skips child subagent sessions, existing sessions, seeded sessions, and already-authorized sessions', async () => {
  const ctx = createFakeContext({
    providers: [{ id: 'codex' }],
    modelsByProvider: { codex: [{ id: 'gpt-6.2-sol' }] },
  });
  apply(ctx);

  const child = createFakeSession({ origin: 'subagent' });
  const existing = createFakeSession({ firstLiveSeq: 3 });
  const seeded = createFakeSession({ events: [{ type: 'session/end-seed', data: {} }] });
  const preAuthorized = createFakeSession({
    events: [{ type: 'subagent/model-selection-policy', data: { allowedModels: [{ provider: 'x', model: 'y' }] } }],
  });

  for (const session of [child, existing, seeded, preAuthorized]) {
    const before = session.log.length;
    await ctx.emitSerial('agent/created', { agent: { session } });
    assert.equal(session.log.length, before);
  }
  ctx.dispose();
});

test('merges configured fallback routes for registered providers and active parent route without duplicates', async () => {
  const ctx = createFakeContext({
    providers: [{ id: 'custom' }, { id: 'codex' }],
    modelsByProvider: { custom: [], codex: [{ id: 'gpt-6.2-sol' }] },
    fallbackAllowed: [
      { provider: 'custom', model: 'my-private-model' },
      { provider: 'removed-provider', model: 'ghost-model' },
    ],
  });
  const routes = await discoverAllowedModelRoutes(ctx, {
    options: { provider: 'codex', model: 'gpt-6.2-sol' },
  });
  assert.deepEqual(routes, [
    { provider: 'codex', model: 'gpt-6.2-sol' },
    { provider: 'custom', model: 'my-private-model' },
  ]);
  ctx.dispose();
});
