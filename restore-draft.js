export function canRestoreDraft(state) {
  return state?.phase === 'plain' && state.draft === '' && state.claim === undefined
    && state.attachmentIds?.length === 0 && state.occurrences?.length === 0
    && Number.isSafeInteger(state.draftRev) && state.draftRev >= 0;
}

export function canRestoreText(text) {
  // The native insertion strips its reserved reference markers. Leave such
  // text available to copy, instead of silently altering it in the composer.
  return typeof text === 'string' && text.trim() !== '' && !/[\uE100-\uE11D\uFFFC]/u.test(text);
}

/** Synchronous: recheck the live composer and use the native revision guard. */
export function restoreDraft(text, input, actions, eligible) {
  if (!canRestoreText(text) || !eligible()) return false;
  const before = input.getSnapshot();
  if (!canRestoreDraft(before)) return false;
  const span = actions.captureInsertion();
  if (span?.start !== 0 || span.end !== 0 || span.draftRev !== before.draftRev || !eligible()) return false;
  const after = input.getSnapshot();
  if (!canRestoreDraft(after) || after.draftRev !== span.draftRev) return false;
  return actions.insertText(text, span) === true;
}
