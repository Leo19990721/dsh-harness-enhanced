const DEFAULT_TIMEOUT_MS = 12_000;
const POLICY_EVENT_TYPE = 'subagent/model-selection-policy';

export const name = 'harness-enhanced-subagent-models';
export const inject = ['llm', 'sessions'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function withTimeout(promise, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      fn(value);
    };
    const onAbort = () => finish(reject, signal.reason ?? new Error('aborted'));
    const timer = setTimeout(() => finish(reject, new Error('model discovery timed out')), timeoutMs);
    timer.unref?.();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      value => finish(resolve, value),
      error => finish(reject, error),
    );
  });
}

function hasExistingPolicy(session) {
  if (typeof session?.snapshotEvents === 'function') {
    const events = session.snapshotEvents();
    if (Array.isArray(events)) return events.some(event => event?.type === POLICY_EVENT_TYPE);
  }
  if (typeof session?.eventAt !== 'function') return false;
  const cursor = typeof session.cursor === 'number' && Number.isInteger(session.cursor) ? session.cursor : -1;
  for (let seq = 0; seq <= cursor; seq++) {
    if (session.eventAt(seq)?.type === POLICY_EVENT_TYPE) return true;
  }
  return false;
}

function readConfiguredFallbackRoutes(ctx) {
  try {
    const service = ctx.get?.('subagentModelSelection');
    const configured = service?.config?.allowedModels?.get?.();
    if (!Array.isArray(configured)) return [];
    return configured.filter(route => route && isNonEmptyString(route.provider) && isNonEmptyString(route.model));
  } catch {
    return [];
  }
}

export async function discoverAllowedModelRoutes(ctx, agent, cache = new Map(), options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const signal = options.signal;
  const llm = ctx.get?.('llm') ?? ctx.llm;
  const providers = typeof llm?.listProviders === 'function' ? llm.listProviders() : [];
  const providerIds = [];
  const seenProviders = new Set();

  if (Array.isArray(providers)) {
    for (const provider of providers) {
      const id = provider?.id;
      if (!isNonEmptyString(id) || seenProviders.has(id)) continue;
      seenProviders.add(id);
      providerIds.push(id);
    }
  }

  for (const cachedProvider of [...cache.keys()]) {
    if (!seenProviders.has(cachedProvider)) cache.delete(cachedProvider);
  }

  const routes = [];
  const seenRoutes = new Set();
  const addRoute = (provider, model) => {
    if (!isNonEmptyString(provider) || !isNonEmptyString(model)) return;
    const key = `${provider}\0${model}`;
    if (seenRoutes.has(key)) return;
    seenRoutes.add(key);
    routes.push({ provider, model });
  };

  if (typeof llm?.listModels === 'function' && providerIds.length > 0) {
    const results = await Promise.allSettled(
      providerIds.map(providerId => withTimeout(
        Promise.resolve().then(() => llm.listModels(providerId)),
        timeoutMs,
        signal,
      )),
    );
    for (let i = 0; i < providerIds.length; i++) {
      const providerId = providerIds[i];
      const result = results[i];
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        const discovered = [];
        for (const model of result.value) {
          if (isNonEmptyString(model?.id)) {
            discovered.push(model.id);
            addRoute(providerId, model.id);
          }
        }
        if (discovered.length > 0) cache.set(providerId, discovered);
        else cache.delete(providerId);
      } else {
        const cached = cache.get(providerId);
        if (Array.isArray(cached)) {
          for (const modelId of cached) addRoute(providerId, modelId);
        }
      }
    }
  }

  // Keep any explicitly configured routes for currently registered providers
  // (e.g. custom endpoints whose listModels() is empty or temporarily unreachable).
  for (const route of readConfiguredFallbackRoutes(ctx)) {
    if (seenProviders.size === 0 || seenProviders.has(route.provider)) {
      addRoute(route.provider, route.model);
    }
  }

  // Always preserve the parent session's active model if known.
  const activeProvider = agent?.options?.provider;
  const activeModel = agent?.options?.model;
  if (isNonEmptyString(activeProvider) && isNonEmptyString(activeModel)) {
    addRoute(activeProvider, activeModel);
  }

  return routes;
}

export function apply(ctx, config = {}) {
  const timeoutMs = Number.isFinite(config?.timeoutMs) && config.timeoutMs > 0
    ? config.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const cache = new Map();
  const lifetime = new AbortController();

  const warmCache = () => {
    if (lifetime.signal.aborted) return;
    void discoverAllowedModelRoutes(ctx, undefined, cache, {
      timeoutMs,
      signal: lifetime.signal,
    }).catch(() => {});
  };

  ctx.effect?.(() => () => lifetime.abort(), 'harness-enhanced-subagent-models: abort');

  if (typeof ctx.on === 'function') {
    ctx.on('llm/adapters-updated', warmCache);
    ctx.on('llm/models-updated', warmCache);
    // Run before native SubagentModelSelectionConfig on serial agent/created so
    // fresh and previously-unpolarized top-level sessions receive all live models automatically.
    ctx.on('agent/created', async ({ agent, signal }) => {
      const target = agent?.session;
      if (!target || typeof target.append !== 'function') return;
      if (target.header?.origin === 'subagent') return;
      if (typeof target.eventAt === 'function' && target.eventAt(0)?.type === 'session/end-seed') return;
      if (hasExistingPolicy(target)) return;

      const combinedSignal = signal
        ? AbortSignal.any([lifetime.signal, signal])
        : lifetime.signal;
      const allowedModels = await discoverAllowedModelRoutes(ctx, agent, cache, {
        timeoutMs,
        signal: combinedSignal,
      });
      if (combinedSignal.aborted || ctx.fiber?.active === false) return;
      if (allowedModels.length === 0) return;
      if (hasExistingPolicy(target)) return;
      target.append(POLICY_EVENT_TYPE, { allowedModels });
    }, { prepend: true });
  }

  warmCache();
}
