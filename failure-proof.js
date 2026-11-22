export const FAILED_MESSAGE_PATH = '/api/harness-enhanced.failed-message';
export const MAX_RECOVERY_EVENTS = 250_000;
export const MAX_RECOVERY_TEXT_LENGTH = 256 * 1024;
export const MODEL_SWITCH_FAILURE = 'MODEL_SWITCH_COMPACTION_FAILED';

export function isModelSwitchFailure(event) {
  return event?.type === 'turn/end' && event.data?.reason?.kind === 'error'
    && event.data.reason.error?.code === MODEL_SWITCH_FAILURE;
}

export function isSessionId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
}

export function isCompactionId(value) {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
}

/** Prove the exact failed turn, even when another Host uses the same session id. */
export function failureProof(read, endSeq) {
  if (!Number.isSafeInteger(endSeq) || endSeq < 0 || endSeq >= MAX_RECOVERY_EVENTS) return null;
  const end = read(endSeq);
  if (end?.seq !== endSeq || !isModelSwitchFailure(end)
    || !Number.isSafeInteger(end.time) || end.time < 0
    || !Number.isSafeInteger(end.data.turn) || end.data.turn < 1) return null;
  const turn = end.data.turn;
  let inStep = false;
  let closingId;
  let attempt;
  // No need to recover a proof from an incomplete or unusually large step.
  for (let seq = endSeq - 1; seq >= 0 && endSeq - seq <= 4096; seq--) {
    const event = read(seq);
    if (event?.seq !== seq || event.type === 'turn/start' || event.type === 'turn/end') return null;
    const { type, data } = event;
    if (type === 'step/end') {
      if (inStep || data?.turn !== turn || data.step !== 1) return null;
      inStep = true;
    } else if (type === 'step/start') {
      if (!inStep || data?.turn !== turn || data.step !== 1 || closingId !== undefined || attempt === undefined) return null;
      return { endSeq, endTime: end.time, turn, ...attempt };
    } else if (inStep && attempt === undefined && (type === 'compaction/end' || type === 'compaction/start')) {
      if (data?.turn !== turn || !isCompactionId(data.compactionId)) return null;
      if (type === 'compaction/end' && closingId === undefined) closingId = data.compactionId;
      else if (type === 'compaction/start' && closingId === data.compactionId) {
        attempt = { compactionSeq: seq, compactionId: closingId };
        closingId = undefined;
      } else return null;
    }
  }
  return null;
}

/** Read the proof from the already-authorized window; never request older history. */
export function failureProofFromWindow(entries, end) {
  if (!isModelSwitchFailure(end)) return null;
  const index = entries.findLastIndex(row => row.type === 'event' && row.event.seq === end.seq);
  if (index < 0) return null;
  const proof = failureProof(seq => {
    const row = entries[index - (end.seq - seq)];
    return row?.type === 'event' ? row.event : undefined;
  }, end.seq);
  return proof?.endTime === end.time && proof?.turn === end.data.turn ? proof : null;
}

export function sameFailureProof(a, b) {
  return a != null && b != null && a.endSeq === b.endSeq && a.endTime === b.endTime
    && a.turn === b.turn && a.compactionSeq === b.compactionSeq && a.compactionId === b.compactionId;
}
