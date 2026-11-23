export const SUBAGENT_ARCHIVE_STORAGE_KEY = 'dsh.harness-enhanced.subagent-archive.v1';
export const DEFAULT_SUBAGENT_RECENT_LIMIT = 4;
const SUBAGENT_MAX_STORED_PARENTS = 200;

function subagentUiNonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function subagentUiResolveLabel(value, resolveText) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && typeof resolveText === 'function') {
    try {
      const resolved = resolveText(value);
      if (typeof resolved === 'string') return resolved.trim();
    } catch {}
  }
  return '';
}

function subagentUiEffortLabel(effort, modelEntry, resolveText) {
  if (!subagentUiNonEmpty(effort)) return '';
  const efforts = modelEntry?.reasoning?.efforts;
  if (Array.isArray(efforts)) {
    const matched = efforts.find(item => item && item.effort === effort);
    const label = subagentUiResolveLabel(matched?.label, resolveText);
    if (label) return label;
  }
  return effort.trim();
}

export function extractModelSelection(projection) {
  if (!projection || typeof projection !== 'object') return null;
  const candidate = projection.next ?? projection.lastUsed ?? null;
  if (!candidate || typeof candidate !== 'object') return null;
  const model = subagentUiNonEmpty(candidate.model) ? candidate.model.trim() : '';
  if (!model) return null;
  const provider = subagentUiNonEmpty(candidate.provider) ? candidate.provider.trim() : '';
  const reasoningEffort = subagentUiNonEmpty(candidate.reasoningEffort) ? candidate.reasoningEffort.trim() : '';
  return {
    provider,
    model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

export function resolveSubagentModelInfo(projection, catalogSnapshot, resolveText) {
  const selection = extractModelSelection(projection);
  if (!selection) return null;

  const groups = Array.isArray(catalogSnapshot?.groups) ? catalogSnapshot.groups : [];
  const group = selection.provider
    ? groups.find(item => item && item.id === selection.provider)
    : undefined;
  const modelEntry = Array.isArray(group?.models)
    ? group.models.find(item => item && item.id === selection.model)
    : undefined;

  const modelLabel = subagentUiNonEmpty(modelEntry?.name) ? modelEntry.name.trim() : selection.model;
  const providerLabel = subagentUiNonEmpty(group?.name) ? group.name.trim() : selection.provider;
  const effectiveEffort = selection.reasoningEffort || (subagentUiNonEmpty(modelEntry?.reasoning?.defaultEffort)
    ? modelEntry.reasoning.defaultEffort.trim()
    : '');
  const effortLabel = subagentUiEffortLabel(effectiveEffort, modelEntry, resolveText);

  const compactParts = [modelLabel];
  if (effortLabel) compactParts.push(effortLabel);
  const compact = compactParts.join(' · ');

  const fullParts = [];
  if (providerLabel && !modelLabel.toLowerCase().startsWith(providerLabel.toLowerCase())) {
    fullParts.push(providerLabel);
  }
  fullParts.push(modelLabel);
  if (effortLabel) fullParts.push(effortLabel);
  const full = fullParts.join(' · ');

  return {
    provider: selection.provider,
    model: selection.model,
    effort: effectiveEffort,
    providerLabel,
    modelLabel,
    effortLabel,
    compact,
    full,
  };
}

function subagentUiCompareNewest(a, b) {
  const timeA = Number.isFinite(a.entry?.createdAt) ? a.entry.createdAt : 0;
  const timeB = Number.isFinite(b.entry?.createdAt) ? b.entry.createdAt : 0;
  if (timeA !== timeB) return timeB - timeA;
  return b.index - a.index;
}

export function partitionSubagentEntries(entries, options = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const archivedIds = options.archivedIds instanceof Set ? options.archivedIds : new Set(options.archivedIds ?? []);
  const pinnedIds = options.pinnedIds instanceof Set ? options.pinnedIds : new Set(options.pinnedIds ?? []);
  const currentSessionId = options.currentSessionId;
  const recentLimit = Number.isInteger(options.recentLimit) && options.recentLimit >= 0
    ? options.recentLimit
    : DEFAULT_SUBAGENT_RECENT_LIMIT;
  const hasRunningDescendant = typeof options.hasRunningDescendant === 'function'
    ? options.hasRunningDescendant
    : () => false;

  const indexed = list.map((entry, index) => ({ entry, index }));
  const running = [];
  const idle = [];

  for (const item of indexed) {
    const isRunning = item.entry?.activity === 'running' || hasRunningDescendant(item.entry?.id);
    if (isRunning) running.push(item);
    else idle.push(item);
  }

  running.sort(subagentUiCompareNewest);
  idle.sort(subagentUiCompareNewest);

  const visibleIdle = [];
  const archived = [];
  let autoKept = 0;

  for (const item of idle) {
    const id = item.entry?.id;
    const isCurrent = currentSessionId !== undefined && id === currentSessionId;
    const isPinned = pinnedIds.has(id);
    const isManuallyArchived = archivedIds.has(id);

    if (isCurrent || isPinned) {
      visibleIdle.push(item.entry);
    } else if (!isManuallyArchived && autoKept < recentLimit) {
      visibleIdle.push(item.entry);
      autoKept += 1;
    } else {
      archived.push(item.entry);
    }
  }

  const active = [...running.map(item => item.entry), ...visibleIdle];
  const archivableIdleIds = visibleIdle
    .map(entry => entry.id)
    .filter(id => id !== currentSessionId);

  return {
    active,
    archived,
    runningCount: running.length,
    archivableIdleIds,
  };
}

function subagentUiEmptyPrefs() {
  return { archived: [], pinned: [], updatedAt: 0 };
}

function subagentUiSanitizeIds(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (typeof item !== 'string' || item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function createSubagentArchiveStore(storage, options = {}) {
  const key = options.storageKey || SUBAGENT_ARCHIVE_STORAGE_KEY;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const listeners = new Set();

  function loadAll() {
    if (!storage || typeof storage.getItem !== 'function') return {};
    try {
      const raw = storage.getItem(key);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const clean = {};
      for (const [parentId, value] of Object.entries(parsed)) {
        if (!subagentUiNonEmpty(parentId) || !value || typeof value !== 'object') continue;
        clean[parentId] = {
          archived: subagentUiSanitizeIds(value.archived),
          pinned: subagentUiSanitizeIds(value.pinned),
          updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
        };
      }
      return clean;
    } catch {
      return {};
    }
  }

  let data = loadAll();
  let version = 0;

  function persist() {
    const entries = Object.entries(data);
    if (entries.length > SUBAGENT_MAX_STORED_PARENTS) {
      entries.sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0));
      data = Object.fromEntries(entries.slice(0, SUBAGENT_MAX_STORED_PARENTS));
    }
    if (storage && typeof storage.setItem === 'function') {
      try {
        storage.setItem(key, JSON.stringify(data));
      } catch {}
    }
  }

  function emit() {
    version += 1;
    for (const listener of listeners) {
      try { listener(); } catch {}
    }
  }

  function mutate(parentId, updater) {
    if (!subagentUiNonEmpty(parentId)) return;
    const prev = data[parentId] ?? subagentUiEmptyPrefs();
    const next = updater({
      archived: new Set(prev.archived),
      pinned: new Set(prev.pinned),
    });
    const nextArchived = [...next.archived];
    const nextPinned = [...next.pinned];
    if (nextArchived.length === 0 && nextPinned.length === 0) {
      if (!(parentId in data)) return;
      delete data[parentId];
    } else {
      data = {
        ...data,
        [parentId]: {
          archived: nextArchived,
          pinned: nextPinned,
          updatedAt: now(),
        },
      };
    }
    persist();
    emit();
  }

  return {
    getVersion() {
      return version;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get(parentId) {
      const entry = data[parentId];
      return {
        archivedIds: new Set(entry?.archived ?? []),
        pinnedIds: new Set(entry?.pinned ?? []),
      };
    },
    archive(parentId, childIds) {
      const ids = Array.isArray(childIds) ? childIds : [childIds];
      mutate(parentId, state => {
        for (const id of ids) {
          if (!subagentUiNonEmpty(id)) continue;
          state.archived.add(id);
          state.pinned.delete(id);
        }
        return state;
      });
    },
    unarchive(parentId, childIds) {
      const ids = Array.isArray(childIds) ? childIds : [childIds];
      mutate(parentId, state => {
        for (const id of ids) {
          if (!subagentUiNonEmpty(id)) continue;
          state.archived.delete(id);
          state.pinned.add(id);
        }
        return state;
      });
    },
  };
}
