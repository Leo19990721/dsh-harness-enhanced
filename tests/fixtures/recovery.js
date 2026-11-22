import { MODEL_SWITCH_FAILURE } from '../../failure-proof.js';

export const TEXT = '  合成测试：第一行\n\nsecond line。  ';
export const UUID = '00000000-1111-4111-8111-000000000001';
export const OTHER_UUID = '00000000-1111-4111-8111-000000000002';
export const SESSION = 'fixture-recovery';
export const HEADER = { version: 4, id: SESSION, cwd: 'C:\\fixture', isSeeded: false };

export const row = (type, data, extra) => ({ type, data, ...extra });
export const events = rows => rows.map((event, seq) => ({ ...event, seq, time: 1000 + seq }));
export const entry = event => ({ type: 'event', event });
export const input = (id = 'input-a', text = TEXT) => ({
  id, role: 'user', source: { kind: 'user', rpcId: `rpc-${id}` }, content: [{ type: 'text', text }],
});
export const inbox = (inserted, options) => row('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted, ...options });
export const claim = (options) => inbox([], { removedCount: 1, ...options });
export const admit = (message, surfaceOp = 'append') => row('user/message', message, { surfaceOp });
export const start = (turn = 1) => row('turn/start', { turn });
export const stepStart = (turn = 1, step = 1) => row('step/start', { turn, step });
export const stepEnd = (turn = 1, step = 1) => row('step/end', { turn, step });
export const end = (turn = 1, reason = { kind: 'error', error: { code: MODEL_SWITCH_FAILURE, message: 'fixture failure' } }) => row('turn/end', { turn, reason });
export const attempt = (id = UUID, turn = 1) => [
  row('compaction/start', { compactionId: id, turn }),
  row('compaction/end', { compactionId: id, turn, error: 'fixture failure' }),
];
export function checkpoint(id, turn, startSeq, endSeq) {
  const [open, close] = attempt(id, turn);
  delete close.data.error;
  return [open,
    row('compaction/summary', { compactionId: id, shadowedRange: { start: startSeq, end: endSeq } }),
    admit({ ...input('checkpoint', 'fixture history'), source: { kind: 'compact-checkpoint', compactionId: id } }, { op: 'replace', startSeq, endSeq }),
    close];
}
export function turnRows({ turn = 1, uuid = UUID, beforeStep = [], inStep = attempt(uuid, turn), claimRow = claim(), reason } = {}) {
  return [start(turn), claimRow, ...beforeStep, stepStart(turn), ...inStep, stepEnd(turn), end(turn, reason)];
}
export const failed = options => events([inbox([input()]), ...turnRows(options)]);
