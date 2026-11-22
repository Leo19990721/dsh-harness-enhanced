// Local policy. DSH continues to own request routing and the durable summary transaction.
const percent = (tokens, fraction) => Math.floor(tokens * fraction / 100);
const positive = value => Number.isSafeInteger(value) && value > 0;
export const SUMMARY_CAP = 8192;
// Room for the native summary instruction and, separately, the saved checkpoint framing.
export const SUMMARY_PROMPT_MARGIN = 1024;
export const CHECKPOINT_MARGIN = 128;

/** Context semantics of the named routes; a Gemini model ID on a relay proves nothing. */
export function budgetMode(provider, model) {
  // This profile's Codex adapter and its account/model pools do not send an output cap.
  if (provider === 'codex') return 'codex';
  // Only the known input-limit families of the native Google/Vertex catalog.
  // Gemini 4 Argon uses a combined total; unknown families use the shared rule too.
  if ((provider === 'google' || provider === 'google-vertex')
    && /^gemini-(?:2\.[05]|3(?:\.1)?)-(?:pro|flash)(?:-|$)/.test(model)) return 'input';
  return 'shared';
}

export function inputBudget({ provider, model, window, maxTokens = 0 }) {
  if (!positive(window)) return { problem: '该路由缺少有效的 contextWindow，请在模型设置里核对容量。' };
  const mode = budgetMode(provider, model);
  if (mode === 'shared' && (!Number.isSafeInteger(maxTokens) || maxTokens < 0 || maxTokens >= window)) {
    return { problem: '该路由的输出上限没有留下可用输入空间，请核对 contextWindow 和 maxTokens。' };
  }
  const budget = mode === 'codex' ? percent(window, 95) : mode === 'input' ? window : window - maxTokens;
  const threshold = Math.min(percent(window, 90), percent(budget, 95));
  if (threshold < 1) return { problem: '该路由的输入预算太小，请核对模型的上下文容量。' };
  return { budget, threshold, pruneTarget: percent(budget, 75), target: percent(budget, 60) };
}

const MARKER = '\n\n[... tool result middle pruned; full result remains in session history ...]\n\n';
const HEAD = 4096;
const TAIL = 1024;
const TRIM_THRESHOLD = 8192;
// Read envelopes, spill notices and paths named in ordinary diagnostic lines.
const PATHS = /Full formatted result stored at: ([^\r\n]+?)\. Use |<path>([^\r\n<>]+)<\/path>|["'`]((?:[A-Za-z]:[\\/]|\\\\|\/|\.\.?[\\/])[^\r\n"'`<>]+)["'`]|(?:^|[\s(])((?:[A-Za-z]:[\\/]|\\\\|\/|\.\.?[\\/])[^\s<>"'`|;,()]+)/gm;

/** Preserve rich blocks, the text edges and a small index of paths in the omitted text. */
export function trimToolContent(content) {
  if (content.reduce((n, block) => n + (block.type === 'text' ? block.text.length : 0), 0) <= TRIM_THRESHOLD) return null;
  const points = content.map(block => block.type === 'text' ? Array.from(block.text) : []);
  const size = points.reduce((n, block) => n + block.length, 0);
  if (size <= TRIM_THRESHOLD) return null;
  const keptPaths = new Set();
  const output = [];
  let offset = 0;
  let marker;
  for (const [i, block] of content.entries()) {
    if (block.type !== 'text') { output.push(block); continue; }
    const part = points[i];
    const headEnd = Math.max(0, HEAD - offset);
    const tailStart = Math.max(0, size - TAIL - offset);
    const removed = part.slice(headEnd, tailStart);
    if (removed.length > 0 && keptPaths.size < 6) {
      const middle = removed.join('');
      for (const match of middle.matchAll(PATHS)) {
        const path = match[1] ?? match[2] ?? match[3] ?? match[4];
        if (path.length <= 512) keptPaths.add(path);
        if (keptPaths.size === 6) break;
      }
    }
    const head = part.slice(0, headEnd).join('');
    const tail = part.slice(tailStart).join('');
    if (head) output.push({ ...block, text: head });
    if (removed.length > 0 && marker === undefined) {
      marker = { type: 'text', text: MARKER };
      output.push(marker);
    }
    if (tail) output.push({ ...block, text: tail });
    offset += part.length;
  }
  if (keptPaths.size) marker.text += `Paths mentioned in omitted output:\n${[...keptPaths].join('\n')}\n\n`;
  // Keep the replacement useful even for a result composed mainly of long paths.
  const remaining = output.reduce((n, block) => n + (block.type === 'text' ? Array.from(block.text).length : 0), 0);
  return remaining < size ? output : null;
}

/** Find the shallowest balanced prefix that meets the target, or a useful deeper cut. */
export function choosePrefix(rows, { start, stop, total, target, ceiling, minimumGain, summaryBudget, auxiliaryBase, warmRows, warmThrough, balancedAfter }) {
  let removed = 0;
  let replayed = auxiliaryBase + SUMMARY_PROMPT_MARGIN;
  let best;
  let bestWarm;
  for (let i = start; i < stop; i++) {
    removed += rows[i].tokens;
    replayed += warmRows[i].tokens;
    if (replayed > summaryBudget) break;
    const remaining = total - removed + SUMMARY_CAP + CHECKPOINT_MARGIN;
    if (remaining >= total - minimumGain || remaining > ceiling || !balancedAfter(rows[i].seq)) continue;
    const range = { start: rows[start].seq, end: rows[i].seq };
    // Prefer cuts that keep the route's active declaration series intact.
    if (i >= warmThrough) {
      if (remaining <= target) return range;
      bestWarm = range;
    }
    if (best === undefined || best.remaining > target) best = { range, remaining };
  }
  return bestWarm ?? best?.range;
}

/** Prior usage is only a calibration of the prompt; old generated tokens are not a reserve. */
export function estimatedInput(heuristic, previous) {
  if (!previous) return heuristic;
  const { inputTokens, cacheReadTokens = 0, cacheWriteTokens = 0 } = previous.usage;
  const observed = inputTokens + cacheReadTokens + cacheWriteTokens;
  return positive(observed) ? heuristic + Math.max(0, observed - previous.heuristic) : heuristic;
}
