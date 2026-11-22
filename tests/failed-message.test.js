import assert from 'node:assert/strict';
import test from 'node:test';
import { failureProof, failureProofFromWindow, sameFailureProof, MAX_RECOVERY_EVENTS, MAX_RECOVERY_TEXT_LENGTH } from '../failure-proof.js';
import { recoverFailedText } from '../failed-message.js';
import { admit, attempt, checkpoint, claim, end, entry, events, failed, inbox, input, row, start, stepEnd, TEXT, turnRows, UUID, OTHER_UUID } from './fixtures/recovery.js';

const recover = (log, inherited = 0, seq = log.at(-1).seq) => recoverFailedText(log, seq, inherited);
const proof = log => failureProof(seq => log[seq], log.at(-1).seq);

test('matches the exact pure claim and preserves text including newlines and whitespace', () => {
  const log = failed();
  assert.equal(recover(log), TEXT);
  assert.equal(recover(log, 0, log.at(-1).seq - 1), null);
});

test('queue replay follows stable identity through old turns, cancellation, and editing', () => {
  const log = events([
    inbox([input('older'), input('discard')]),
    start(), claim(), admit(input('older')), end(1, { kind: 'completed' }),
    claim({ outcome: 'canceled' }), inbox([input('candidate', 'before edit')]),
    inbox([input('candidate')], { removedCount: 1, outcome: 'canceled' }),
    ...turnRows({ turn: 2 }),
  ]);
  assert.equal(recover(log), TEXT);
});

test('a real summary checkpoint before or within the step is not a prompt admission', () => {
  const history = admit(input('past', 'previous session text'));
  for (const checkpointPosition of ['beforeStep', 'inStep']) {
    const log = events([history, inbox([input()]), ...turnRows({
      [checkpointPosition]: checkpoint(UUID, 1, 0, 0),
      ...checkpointPosition === 'beforeStep' ? { inStep: attempt(OTHER_UUID) } : {},
    })]);
    assert.equal(recover(log), TEXT);
    assert.equal(proof(log)?.compactionId, checkpointPosition === 'beforeStep' ? OTHER_UUID : UUID);
  }
});

test('last successfully written summary can still precede a switch failure', () => {
  const log = events([admit(input('past')), inbox([input()]), ...turnRows({ inStep: checkpoint(UUID, 1, 0, 0) })]);
  assert.equal(recover(log), TEXT);
  assert.equal(proof(log)?.compactionId, UUID);
});

test('unknown replace and any actual admission fail closed', () => {
  for (const message of [admit(input()), admit(input('other')), admit(input('other'), { op: 'replace', startSeq: 0, endSeq: 0 })]) {
    assert.equal(recover(failed({ inStep: [...attempt(), message] })), null);
  }
  const cp = checkpoint(UUID, 1, 0, 0);
  cp[2].data.id = input().id;
  assert.equal(recover(events([admit(input('old')), inbox([input()]), ...turnRows({ inStep: cp })])), null);
});

test('already admitted or later requeued by id or rpcId cannot be recovered', () => {
  const otherId = { ...input(), id: 'changed-id' };
  const log = failed();
  for (const later of [admit(otherId), inbox([otherId]), inbox([input()])]) {
    assert.equal(recover(events([...log, later]), 0, log.at(-1).seq), null);
  }
  assert.equal(recover(events([admit(otherId), inbox([input()]), ...turnRows()])), null);
});

test('fork boundary excludes inherited failures and inherited inputs, including entries edited in the child', () => {
  const log = failed();
  assert.equal(recover(log, log.length), null);
  assert.equal(recover(log, 1), null);
  assert.equal(recover(events([
    inbox([input()]), row('session/end-seed', { inherited: true }),
    inbox([input()], { removedCount: 1, outcome: 'canceled' }), ...turnRows(),
  ]), 1), null);
  assert.equal(recover(events([row('session/end-seed', { inherited: true }), ...log]), 1), TEXT);
});

test('attachments, multiple blocks, whitespace, invalid provenance and overlong messages remain untouched', () => {
  for (const contents of [
    [], [{ type: 'file', path: 'fixture.txt' }], [{ type: 'image', attachment: {} }],
    [...input().content, { type: 'file', path: 'fixture.txt' }], [{ type: 'text', text: ' \n\t' }],
    [{ type: 'text', text: 'x'.repeat(MAX_RECOVERY_TEXT_LENGTH + 1) }],
  ]) assert.equal(recover(events([inbox([{ ...input(), content: contents }]), ...turnRows()])), null);
  for (const source of [{ kind: 'user' }, { kind: 'retry', rpcId: 'rpc' }, { kind: 'user', rpcId: 'rpc', principal: { kind: 'guest' } }]) {
    assert.equal(recover(events([inbox([{ ...input(), source }]), ...turnRows()])), null);
  }
});

test('batch, cancellation, malformed queue, two claims and wrong terminal cause remain native', () => {
  assert.equal(recover(failed({ claimRow: claim({ outcome: 'canceled' }) })), null);
  assert.equal(recover(failed({ claimRow: claim({ removedCount: 2 }) })), null);
  assert.equal(recover(failed({ claimRow: claim({ target: 'next-step' }) })), null);
  assert.equal(recover(failed({ reason: { kind: 'aborted', reason: { kind: 'user' } } })), null);
  assert.equal(recover(failed({ reason: { kind: 'error', error: { code: 'OTHER_FAILURE' } } })), null);
  assert.equal(recover(events([inbox([input()], { start: 5 }), ...turnRows()])), null);
  assert.equal(recover(events([inbox([input()], { target: 'next-step' }), inbox([input('second')]), ...turnRows({ beforeStep: [claim({ target: 'next-step' })] })])), null);
  assert.equal(recover(events([inbox([input()], { target: 'next-step' }), inbox([input('second')]), ...turnRows()])), null);
  assert.equal(recover(events([inbox([input(), input()]), ...turnRows()])), null);
});

test('rejects missing prefix, in-turn gap, wrong step and over-limit log', () => {
  const log = failed();
  assert.equal(recover(log.slice(1)), null);
  assert.equal(recover(log.toSpliced(3, 1, { ...log[3], seq: 12 })), null);
  assert.equal(recover(log.toSpliced(-2, 1, { ...stepEnd(1, 2), seq: log.length - 2 })), null);
  const huge = log.slice();
  huge.length = MAX_RECOVERY_EVENTS + 1;
  assert.equal(recover(huge, 0, log.at(-1).seq), null);
});

test('browser proof uses the exact first-step bracket even in a paged window', () => {
  const log = failed();
  const ending = log.at(-1);
  const expected = { endSeq: 7, endTime: 1007, turn: 1, compactionSeq: 4, compactionId: UUID };
  assert.deepEqual(proof(log), expected);
  assert.deepEqual(failureProofFromWindow(log.slice(3).map(entry), ending), expected);
  assert.equal(failureProofFromWindow(log.slice(4).map(entry), ending), null);
  assert.equal(failureProofFromWindow(log.map(entry), { ...ending, time: 99 }), null);
  assert.equal(failureProofFromWindow(log.filter(event => event.seq !== 4).map(entry), ending), null);
  assert.equal(failureProofFromWindow(log.map(entry), { ...ending, data: end(2).data }), null);
});

test('the same raw session id, end seq, time and turn on another Host do not identify the same failure', () => {
  const a = proof(failed()), b = proof(failed({ uuid: OTHER_UUID }));
  assert.deepEqual({ ...a, compactionId: OTHER_UUID }, b);
  assert.equal(sameFailureProof(a, b), false);
  assert.equal(sameFailureProof(a, { ...a, endTime: a.endTime + 1 }), false);
  assert.equal(sameFailureProof(a, { ...a }), true);
});

test('a failure before any usable in-step compaction proof is deliberately not requested', () => {
  const log = failed({ beforeStep: attempt(), inStep: [] });
  assert.equal(recover(log), TEXT);
  assert.equal(proof(log), null);
  assert.equal(proof(failed({ inStep: attempt().slice(0, 1) })), null);
  assert.equal(proof(failed({ inStep: [attempt()[0], attempt(OTHER_UUID)[1]] })), null);
  assert.equal(proof(failed({ inStep: attempt(UUID, 2) })), null);
});
