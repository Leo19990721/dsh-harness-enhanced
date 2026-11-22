import { isModelSwitchFailure, MAX_RECOVERY_EVENTS, MAX_RECOVERY_TEXT_LENGTH } from './failure-proof.js';

const MAX_PENDING_INPUTS = 1_024;

/** A native summary checkpoint replaces context; it does not admit a new input. */
function isCheckpoint(event, previous) {
  const source = event.data?.source;
  return event.surfaceOp?.op === 'replace' && source?.kind === 'compact-checkpoint'
    && previous?.type === 'compaction/summary' && typeof source.compactionId === 'string'
    && source.compactionId === previous.data?.compactionId
    && event.surfaceOp.startSeq === previous.data?.shadowedRange?.start
    && event.surfaceOp.endSeq === previous.data?.shadowedRange?.end;
}

/** Read the one ordinary message claimed for step 1 of this failed native turn. */
export function recoverFailedText(events, endSeq, inheritedEventCount) {
  if (!Number.isSafeInteger(inheritedEventCount) || inheritedEventCount < 0
    || !Number.isSafeInteger(endSeq) || endSeq < inheritedEventCount
    || events.length > MAX_RECOVERY_EVENTS) return null;
  const end = events[endSeq];
  if (end?.seq !== endSeq || !isModelSwitchFailure(end)) return null;
  const turn = end.data.turn;
  if (!Number.isSafeInteger(turn) || turn < 1) return null;

  let start = endSeq - 1;
  for (; start >= inheritedEventCount; start--) {
    const event = events[start];
    if (event?.seq !== start || event.type === 'turn/end') return null;
    if (event.type === 'turn/start') break;
  }
  if (start < inheritedEventCount || events[start].data?.turn !== turn) return null;

  let claim = -1;
  let stepStarted = false;
  let stepEnded = false;
  for (let seq = start + 1; seq < endSeq; seq++) {
    const event = events[seq];
    const data = event.data;
    if (event.type === 'step/start') {
      if (claim < 0 || stepStarted || data?.turn !== turn || data.step !== 1) return null;
      stepStarted = true;
    } else if (event.type === 'step/end') {
      if (!stepStarted || stepEnded || data?.turn !== turn || data.step !== 1) return null;
      stepEnded = true;
    } else if (event.type === 'assistant/message' || event.type === 'assistant/attempt' || event.type === 'tool/call'
      || event.type === 'request/header' || (event.type === 'user/message' && !isCheckpoint(event, events[seq - 1]))) {
      // Native request preparation failed before admitting new input. A compaction
      // checkpoint can replace earlier context here, and is not an admission.
      return null;
    } else if (event.type === 'agent/inbox/spliced' && data?.outcome !== 'canceled' && data?.removedCount !== undefined) {
      // Claim is one pure next-turn removal. Do not recover a multi-input step.
      if (claim >= 0 || stepStarted || data.outcome !== undefined || data.target !== 'next-turn'
        || data.start !== 0 || data.removedCount !== 1 || !Array.isArray(data.inserted)
        || data.inserted.length !== 0) return null;
      claim = seq;
    }
  }
  if (!stepEnded) return null;

  // A submission may have waited across several turns. Replay the complete
  // prefix, including cancellations, edits and moves, to resolve its exact identity.
  const queues = { 'next-turn': [], 'next-step': [] };
  const pendingIds = new Set();
  for (let seq = 0; seq < claim; seq++) {
    const event = events[seq];
    if (event?.seq !== seq) return null;
    if (event.type !== 'agent/inbox/spliced') continue;
    const { target, start, removedCount = 0, inserted, outcome } = event.data ?? {};
    if (target !== 'next-turn' && target !== 'next-step') return null;
    const queue = queues[target];
    if (!Number.isSafeInteger(start) || start < 0 || start > queue.length
      || !Number.isSafeInteger(removedCount) || removedCount < 0 || removedCount > queue.length - start
      || (outcome !== undefined && outcome !== 'canceled') || !Array.isArray(inserted)
      || pendingIds.size - removedCount + inserted.length > MAX_PENDING_INPUTS) return null;
    for (let index = start; index < start + removedCount; index++) pendingIds.delete(queue[index].message.id);
    const added = [];
    for (const message of inserted) {
      if (typeof message?.id !== 'string' || message.id === '' || pendingIds.has(message.id)) return null;
      pendingIds.add(message.id);
      added.push({ message, seq });
    }
    queue.splice(start, removedCount, ...added);
  }

  const entry = queues['next-turn'][0];
  const message = entry?.message;
  if (!message || queues['next-step'].length !== 0 || entry.seq < inheritedEventCount
    || message.role !== 'user' || message.source?.kind !== 'user' || message.source.principal !== undefined
    || typeof message.source.rpcId !== 'string' || !message.source.rpcId
    || !Array.isArray(message.content) || message.content.length !== 1) return null;
  const block = message.content[0];
  if (block?.type !== 'text' || typeof block.text !== 'string'
    || block.text.length > MAX_RECOVERY_TEXT_LENGTH || block.text.trim() === '') return null;

  const matches = candidate => candidate?.id === message.id || candidate?.source?.rpcId === message.source.rpcId;
  if (queues['next-turn'].slice(1).some(row => matches(row.message))) return null;
  for (let seq = 0; seq < events.length; seq++) {
    const event = events[seq];
    if (event?.seq !== seq) return null;
    if (event.type === 'user/message' && matches(event.data)) return null;
    if ((seq < inheritedEventCount || seq > claim) && event.type === 'agent/inbox/spliced') {
      // An edit can reinsert an inherited occurrence under its original id;
      // that does not make it a new submission in the child.
      const inserted = event.data?.inserted;
      if (!Array.isArray(inserted) || inserted.some(matches)) return null;
    }
  }
  return block.text;
}
