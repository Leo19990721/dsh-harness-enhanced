import assert from 'node:assert/strict';
import test from 'node:test';
import { canRestoreText, restoreDraft } from '../restore-draft.js';
import { TEXT } from './fixtures/recovery.js';

function setup({ initial, duringCapture, insertion } = {}) {
  let state = { phase: 'plain', draft: '', attachmentIds: [], occurrences: [], draftRev: 9, ...initial };
  let eligibility = true;
  const calls = [];
  const set = changes => { state = { ...state, ...changes }; };
  const leave = () => { eligibility = false; };
  const input = { getSnapshot: () => state };
  const actions = {
    captureInsertion() {
      const span = { start: 0, end: 0, draftRev: 9, ...insertion };
      duringCapture?.({ set, leave });
      return span;
    },
    insertText(text, span) {
      calls.push({ text, span });
      set({ draft: text, draftRev: state.draftRev + 1 });
      return true;
    },
    setDraft() { assert.fail('must not use an unconditional draft write'); },
    submit() { assert.fail('must never submit'); },
  };
  return { input, actions, calls, restore: (text = TEXT) => restoreDraft(text, input, actions, () => eligibility), set, leave };
}

test('restore uses only the native revision-guarded insertion with the exact original text', () => {
  const h = setup();
  assert.equal(h.restore(), true);
  assert.deepEqual(h.calls, [{ text: TEXT, span: { start: 0, end: 0, draftRev: 9 } }]);
  assert.equal(h.input.getSnapshot().draft, TEXT);
  assert.equal(h.restore(), false);
  assert.equal(h.calls.length, 1);
});

test('nonempty draft, including whitespace, and attachments or chips are preserved', () => {
  for (const initial of [{ draft: 'typed' }, { draft: ' \n' }, { attachmentIds: ['upload'] }, { occurrences: [{}] }, { claim: {} }]) {
    const h = setup({ initial });
    assert.equal(h.restore(), false);
    assert.deepEqual(h.calls, []);
    for (const [key, value] of Object.entries(initial)) assert.equal(h.input.getSnapshot()[key], value);
  }
});

test('sending, claimed, submitting, unavailable and unidentified draft states refuse', () => {
  for (const phase of ['sending', 'claimed', 'submitting', 'inert', 'adjudicating', undefined]) {
    const h = setup({ initial: { phase } });
    assert.equal(h.restore(), false);
    assert.equal(h.calls.length, 0);
  }
});

test('does not insert if the draft or current session changes while capture runs', () => {
  for (const duringCapture of [({ set }) => set({ draft: 'typed while checking' }), ({ set }) => set({ draftRev: 10 }),
    ({ set }) => set({ attachmentIds: ['file'] }), ({ leave }) => leave()]) {
    const h = setup({ duringCapture });
    assert.equal(h.restore(), false);
    assert.equal(h.calls.length, 0);
  }
  for (const insertion of [{ end: 1 }, { start: 1 }, { draftRev: 8 }]) {
    const h = setup({ insertion });
    assert.equal(h.restore(), false);
    assert.equal(h.calls.length, 0);
  }
});

test('reserved native reference characters may be copied but not silently changed in a draft', () => {
  for (const char of ['\uE100', '\uE11D', '\uFFFC']) {
    const text = `start ${char} end`;
    const h = setup();
    assert.equal(canRestoreText(text), false);
    assert.equal(h.restore(text), false);
    assert.deepEqual(h.calls, []);
  }
});

test('propagates the native editor rejection without fallback', () => {
  const h = setup();
  h.actions.insertText = () => false;
  assert.equal(h.restore(), false);
  assert.equal(h.input.getSnapshot().draft, '');
});
