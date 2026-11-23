import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SUBAGENT_RECENT_LIMIT,
  SUBAGENT_ARCHIVE_STORAGE_KEY,
  createSubagentArchiveStore,
  extractModelSelection,
  partitionSubagentEntries,
  resolveSubagentModelInfo,
} from '../subagent-ui.js';
import { registerSubagentUi } from '../subagent-ui-client.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    dump: map,
  };
}

test('extractModelSelection prefers next over lastUsed and ignores empty selections', () => {
  assert.equal(extractModelSelection(undefined), null);
  assert.equal(extractModelSelection({ lastUsed: null, next: null }), null);
  assert.deepEqual(
    extractModelSelection({
      lastUsed: { provider: 'codex', model: 'gpt-6.2-sol', reasoningEffort: 'medium' },
      next: { provider: 'codex', model: 'gpt-6.2-sol', reasoningEffort: 'high' },
    }),
    { provider: 'codex', model: 'gpt-6.2-sol', reasoningEffort: 'high' },
  );
  assert.deepEqual(
    extractModelSelection({
      lastUsed: { provider: 'antigravity', model: 'gemini-4-neon' },
      next: null,
    }),
    { provider: 'antigravity', model: 'gemini-4-neon' },
  );
});

test('resolveSubagentModelInfo uses friendly catalog names when available and falls back cleanly', () => {
  const catalog = {
    groups: [
      {
        id: 'codex',
        name: 'Codex',
        models: [
          {
            id: 'gpt-6.2-sol',
            name: 'GPT-6.2 Sol',
            reasoning: {
              defaultEffort: 'medium',
              efforts: [
                { effort: 'medium', label: 'Medium' },
                { effort: 'high', label: { zh: '高', en: 'High' } },
              ],
            },
          },
        ],
      },
      {
        id: 'antigravity',
        name: 'Google Antigravity',
        models: [
          {
            id: 'gemini-4-neon',
            name: 'Google Antigravity Gemini 4 Neon',
          },
        ],
      },
    ],
  };

  const withCatalog = resolveSubagentModelInfo(
    { next: { provider: 'codex', model: 'gpt-6.2-sol', reasoningEffort: 'high' } },
    catalog,
    value => value.zh,
  );
  assert.equal(withCatalog.compact, 'GPT-6.2 Sol · 高');
  assert.equal(withCatalog.full, 'Codex · GPT-6.2 Sol · 高');

  // Default effort from catalog when selection omits reasoningEffort
  const defaultEffort = resolveSubagentModelInfo(
    { lastUsed: { provider: 'codex', model: 'gpt-6.2-sol' } },
    catalog,
  );
  assert.equal(defaultEffort.compact, 'GPT-6.2 Sol · Medium');

  // Avoid repeating provider when model name already starts with provider name
  const noDuplicateProvider = resolveSubagentModelInfo(
    { lastUsed: { provider: 'antigravity', model: 'gemini-4-neon' } },
    catalog,
  );
  assert.equal(noDuplicateProvider.compact, 'Google Antigravity Gemini 4 Neon');
  assert.equal(noDuplicateProvider.full, 'Google Antigravity Gemini 4 Neon');

  // Graceful fallback without catalog
  const fallback = resolveSubagentModelInfo(
    { next: { provider: 'codex', model: 'gpt-6.2-sol', reasoningEffort: 'xhigh' } },
    null,
  );
  assert.equal(fallback.compact, 'gpt-6.2-sol · xhigh');
  assert.equal(fallback.full, 'codex · gpt-6.2-sol · xhigh');
});

test('partitionSubagentEntries surfaces running entries first, orders newest first, and folds older completed entries', () => {
  const entries = [
    { id: 's1', name: 'old-1', createdAt: 100, activity: 'inactive' },
    { id: 's2', name: 'old-2', createdAt: 200, activity: 'inactive' },
    { id: 's3', name: 'old-3', createdAt: 300, activity: 'inactive' },
    { id: 's4', name: 'mid-4', createdAt: 400, activity: 'inactive' },
    { id: 's5', name: 'recent-5', createdAt: 500, activity: 'inactive' },
    { id: 's6', name: 'recent-6', createdAt: 600, activity: 'inactive' },
    { id: 's7', name: 'running-7', createdAt: 700, activity: 'running' },
    { id: 's8', name: 'running-8', createdAt: 800, activity: 'running' },
  ];

  const result = partitionSubagentEntries(entries);
  assert.equal(DEFAULT_SUBAGENT_RECENT_LIMIT, 4);
  assert.equal(result.runningCount, 2);
  // Running entries first (newest first), then 4 most recent idle entries (newest first)
  assert.deepEqual(result.active.map(e => e.id), ['s8', 's7', 's6', 's5', 's4', 's3']);
  // Older completed entries folded into history (newest first)
  assert.deepEqual(result.archived.map(e => e.id), ['s2', 's1']);
  assert.deepEqual(result.archivableIdleIds, ['s6', 's5', 's4', 's3']);
});

test('partitionSubagentEntries keeps running, current, pinned, and running-descendant entries visible even if previously archived', () => {
  const entries = [
    { id: 's1', createdAt: 100, activity: 'inactive' },
    { id: 's2', createdAt: 200, activity: 'inactive' },
    { id: 's3', createdAt: 300, activity: 'inactive' },
    { id: 's4', createdAt: 400, activity: 'running' },
    { id: 's5', createdAt: 500, activity: 'inactive' },
  ];

  const result = partitionSubagentEntries(entries, {
    archivedIds: new Set(['s4', 's5']),
    pinnedIds: new Set(['s1']),
    currentSessionId: 's2',
    hasRunningDescendant: id => id === 's3',
    recentLimit: 1,
  });

  // s4 (running) and s3 (running descendant) lift to top; s2 (current) & s1 (pinned) stay visible; s5 (archived) folds
  assert.deepEqual(result.active.map(e => e.id), ['s4', 's3', 's2', 's1']);
  assert.deepEqual(result.archived.map(e => e.id), ['s5']);
  // currentSessionId ('s2') is excluded from batch archivableIdleIds
  assert.deepEqual(result.archivableIdleIds, ['s1']);
});

test('createSubagentArchiveStore persists per-parent archive/unarchive preferences and survives corrupt JSON', () => {
  const storage = createMemoryStorage();
  storage.setItem(SUBAGENT_ARCHIVE_STORAGE_KEY, '{corrupt json');

  let tick = 1000;
  const store1 = createSubagentArchiveStore(storage, { now: () => ++tick });
  let notifications = 0;
  const unsub = store1.subscribe(() => { notifications += 1; });

  store1.archive('parent-a', ['c1', 'c2']);
  assert.equal(notifications, 1);
  assert.deepEqual([...store1.get('parent-a').archivedIds], ['c1', 'c2']);
  assert.deepEqual([...store1.get('parent-a').pinnedIds], []);

  store1.unarchive('parent-a', 'c1');
  assert.equal(notifications, 2);
  assert.deepEqual([...store1.get('parent-a').archivedIds], ['c2']);
  assert.deepEqual([...store1.get('parent-a').pinnedIds], ['c1']);

  unsub();

  // Reloading from storage restores state identically
  const store2 = createSubagentArchiveStore(storage);
  assert.deepEqual([...store2.get('parent-a').archivedIds], ['c2']);
  assert.deepEqual([...store2.get('parent-a').pinnedIds], ['c1']);
  assert.deepEqual([...store2.get('parent-other').archivedIds], []);
});

test('registerSubagentUi registers expected native replacement and model badge slots', () => {
  const registered = [];
  const slots = {
    inject(name, factory) { factory(); },
    register(options, component) {
      registered.push({ options, component });
      return () => {};
    },
    entries() { return []; },
    subscribe() { return () => {}; },
  };
  const ctx = {
    slots,
    sessions: {
      list: { getSnapshot: () => ({ byId: {}, projectionsBySession: {} }) },
      refreshProjections: async () => {},
    },
    uiWorkspace: { openSession() {} },
    sidebarRight: { openResource() {} },
    locale: { register() { return () => {}; }, resolveText: v => String(v) },
    effect() {},
    inject() {},
  };
  const fakeReact = {
    createElement: () => null,
    Fragment: Symbol('Fragment'),
    useEffect() {},
    useId: () => 'id-1',
    useMemo: fn => fn(),
    useRef: v => ({ current: v }),
    useState: v => [typeof v === 'function' ? v() : v, () => {}],
    useSyncExternalStore: (_sub, get) => get(),
  };
  const fakeReactDOM = { createPortal: node => node };
  const fakePrimitives = { MenuSurface: () => null };
  const fakeView = { document: null, localStorage: createMemoryStorage() };

  registerSubagentUi(ctx, fakeReact, fakeReactDOM, fakePrimitives, fakeView);

  const byKey = registered.map(r => `${r.options.name}:${r.options.id ?? ''}:${r.options.priority ?? ''}`);
  assert.deepEqual(byKey, [
    'conversation.session.header.actions:subagent-catalog:-10',
    'conversation.session.header.lineage::-10',
    'conversation.session.header.actions:harness-enhanced.subagent-model:',
    'conversation.input.right:harness-enhanced.subagent-model-composer:',
    'conversation.composer::-20',
  ]);

  // Must NOT re-declare native child slots (SlotCore throws if a child slot is declared twice).
  for (const entry of registered) {
    assert.equal(entry.options.children, undefined);
  }

  const composerEntry = registered.find(r => r.options.name === 'conversation.composer');
  assert.equal(composerEntry.options.select({ session: { subagent: null } }), null);
  assert.deepEqual(composerEntry.options.select({ session: { subagent: { address: { mode: 'one-shot' } } } }), { reason: 'one-shot' });
  assert.deepEqual(composerEntry.options.select({ session: { subagent: { address: { mode: 'unknown' } } } }), { reason: 'unknown' });
  assert.equal(composerEntry.options.select({ session: { subagent: { address: { mode: 'continuable' } } } }), null);
});
