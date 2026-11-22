import { FAILED_MESSAGE_PATH, MAX_RECOVERY_TEXT_LENGTH, failureProofFromWindow, isModelSwitchFailure, isSessionId, sameFailureProof } from './failure-proof.js';
import { canRestoreDraft, canRestoreText, restoreDraft } from './restore-draft.js';

function sessionIsReadable(s) {
  return s?.openState === 'open' && s.removed === false && s.subagent === null;
}

function sessionIsEditable(s) {
  return sessionIsReadable(s) && s.running === false && s.pendingSubmissions?.length === 0;
}

/** Check the native textbox in this occurrence, not another mounted conversation. */
export function editableComposer(row, id) {
  const content = row?.closest('[data-conversation-content]');
  if (!content || content.getAttribute('data-conversation-session') !== id) return false;
  const editors = [...content.querySelectorAll('[data-composer-seat] [data-composer-input]')]
    .filter(editor => editor.closest('[data-conversation-content]') === content);
  if (editors.length !== 1) return false;
  const [editor] = editors;
  return editor.isConnected && editor.isContentEditable && editor.getAttribute('aria-disabled') !== 'true'
    && !editor.closest('[hidden], [inert], [aria-hidden="true"]') && editor.getClientRects().length > 0
    && editor.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === true;
}

function proofSource(source, end) {
  let last;
  let proof = null;
  return {
    subscribe: listener => source.subscribe(listener),
    getSnapshot() {
      const next = source.getSnapshot();
      if (next !== last) {
        // A contiguous append cannot change an already proven completed step.
        if (proof === null || last?.revision + 1 !== next.revision || next.change.kind !== 'append') {
          const candidate = failureProofFromWindow(next.entries, end);
          if (!sameFailureProof(proof, candidate)) proof = candidate;
        }
        last = next;
      }
      return proof;
    },
  };
}

export async function lookupFailedMessage(view, sessionId, proof, signal) {
  const url = new URL(FAILED_MESSAGE_PATH.slice(1), view.document.baseURI);
  if (url.origin !== view.location.origin) return null;
  url.search = new URLSearchParams({ sessionId, ...proof }).toString();
  const response = await view.fetch(url, { signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  if (response.status !== 200 || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) return null;
  const payload = await response.json();
  signal.throwIfAborted();
  return typeof payload?.text === 'string' && payload.text.length <= MAX_RECOVERY_TEXT_LENGTH && payload.text.trim() !== ''
    ? payload.text : null;
}

export function registerFailedMessage(ctx, React, view = window) {
  if (view.__DSH_TRANSPORT__ !== undefined || ctx.connection.isLoopback !== true) return;
  const slot = 'conversation.chat.turnTail';
  const ns = 'harnessEnhanced.failedMessage';
  const generationSource = ctx.connection.generation;
  const { createElement: h, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } = React;
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort(), 'harness-enhanced: failed message client lifetime');
  ctx.effect(() => ctx.locale.register(ns, {
    zh: {
      found: '这条消息未发出。',
      copy: '复制原文',
      restore: '放回输入框',
      copied: '原文已复制。',
      copiedFailed: '复制失败，请检查剪贴板权限后重试。',
      restored: '已放回输入框，尚未发送。',
      restoreFailed: '未放回输入框，你仍可以复制原文。',
    },
    en: {
      found: 'This message was not sent.',
      copy: 'Copy original text',
      restore: 'Put back in composer',
      copied: 'Original text copied.',
      copiedFailed: 'Copy failed. Check clipboard permission and try again.',
      restored: 'Restored to the composer. Nothing was sent.',
      restoreFailed: 'Could not restore to the composer. You can still copy the text.',
    },
  }), 'harness-enhanced: failed message translations');

  const css = `
    .harness-enhanced-recovery {
      display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px;
      padding-inline-start: 18px; color: var(--dsw-alias-label-secondary);
      font-size: var(--dsh-content-font-size-secondary, 13px); line-height: 1.5;
    }
    .harness-enhanced-recovery button {
      font: inherit; color: var(--dsw-alias-label-primary); background: transparent;
      min-height: 28px; padding: 2px 8px; cursor: pointer;
      border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm);
    }
    .harness-enhanced-recovery button:hover:not([aria-disabled="true"]) {
      background: var(--dsw-alias-interactive-bg-hover);
    }
    .harness-enhanced-recovery button:focus-visible {
      outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
      outline-offset: 2px;
    }
    .harness-enhanced-recovery button[aria-disabled="true"] { cursor: default; opacity: .55; }
    .harness-enhanced-recovery [role="status"]:empty { position: absolute; }
  `;

  function currentView(binding) {
    return !lifetime.signal.aborted && ctx.sessions.binding(binding.sessionId) === binding
      && (ctx.sessions.retainInfo(binding.sessionId).getSnapshot().retainedBy.mainView ?? 0) > 0
      && ctx.layout.panelInfo.getSnapshot().activePanelId === null
      && sessionIsReadable(binding.session.getSnapshot());
  }

  function Actions({ text, t, binding, isCurrent, useSession, useInput, useAccess, inputActions }) {
    const row = useRef(null);
    const [editable, setEditable] = useState(false);
    const [notice, setNotice] = useState({ kind: null, revision: 0 });
    const [copying, setCopying] = useState(false);
    const copyingNow = useRef(false);
    const canPrompt = useAccess('session/prompt') === true;
    const sessionEditable = useSession(sessionIsEditable);
    const empty = useInput(canRestoreDraft);
    const block = ctx.conversation.blocks.storeFor(binding.sessionId);
    const blocked = useSyncExternalStore(block.subscribe, block.getSnapshot) !== undefined;
    const mayRestore = inputActions !== undefined && canPrompt && sessionEditable && empty && !blocked && canRestoreText(text);

    useLayoutEffect(() => {
      if (!mayRestore) return;
      const content = row.current?.closest('[data-conversation-content]');
      const update = () => setEditable(editableComposer(row.current, binding.sessionId));
      update();
      if (!content) return;
      const observer = new view.MutationObserver(update);
      observer.observe(content, { attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden', 'data-conversation-session'] });
      for (const seat of content.querySelectorAll('[data-composer-seat]')) {
        if (seat.closest('[data-conversation-content]') !== content) continue;
        observer.observe(seat, {
          subtree: true, childList: true, attributes: true,
          attributeFilter: ['hidden', 'inert', 'aria-hidden', 'aria-disabled', 'contenteditable', 'class', 'style'],
        });
      }
      return () => observer.disconnect();
    }, [binding, mayRestore]);

    const eligible = () => row.current !== null && isCurrent() && canPrompt
      && sessionIsEditable(binding.session.getSnapshot()) && block.getSnapshot() === undefined
      && editableComposer(row.current, binding.sessionId);
    const announce = kind => setNotice(value => ({ kind, revision: value.revision + 1 }));

    function restore() {
      if (!eligible()) return;
      let restored = false;
      try {
        const input = ctx.conversation.input.for(binding.ctx);
        restored = restoreDraft(text, input.state, inputActions, eligible);
        if (restored && isCurrent()) input.focus();
      } catch {
        // A concurrent scope disposal leaves the copy action available.
      }
      if (row.current !== null) announce(restored ? 'restored' : 'restoreFailed');
    }

    async function copy() {
      if (row.current === null || !isCurrent() || copyingNow.current) return;
      copyingNow.current = true;
      setCopying(true);
      let outcome = 'copiedFailed';
      try {
        await view.navigator.clipboard.writeText(text);
        outcome = 'copied';
      } catch {
        // Permission failure is visible without using clipboard fallbacks.
      } finally {
        copyingNow.current = false;
        if (row.current !== null) {
          setCopying(false);
          if (isCurrent()) announce(outcome);
        }
      }
    }

    return h('div', { className: 'harness-enhanced-recovery', ref: row },
      h('style', null, css),
      h('span', null, t('found')),
      h('button', { type: 'button', onClick: copy, 'aria-disabled': copying || undefined }, t('copy')),
      mayRestore && editable ? h('button', { type: 'button', onClick: restore }, t('restore')) : null,
      h('span', { role: 'status' }, notice.kind === null ? null : h('span', { key: notice.revision }, t(notice.kind))),
    );
  }

  function Recovery({ binding, ...props }) {
    const end = props.turn.end;
    const source = useMemo(() => proofSource(binding.eventSource, end), [binding, end]);
    const proof = useSyncExternalStore(source.subscribe, source.getSnapshot);
    const generation = useSyncExternalStore(generationSource.subscribe, generationSource.getSnapshot);
    const [result, setResult] = useState(null);
    const call = ctx.connection.rpc.call;
    const isCurrent = () => currentView(binding) && source.getSnapshot() === proof
      && generationSource.getSnapshot() === generation && ctx.connection.rpc.call === call;

    useEffect(() => {
      if (proof === null || generation === undefined || !isCurrent()) return;
      const own = new AbortController();
      const signal = AbortSignal.any([own.signal, lifetime.signal, AbortSignal.timeout(12_000)]);
      void lookupFailedMessage(view, binding.sessionId, proof, signal).then(text => {
        if (!signal.aborted && isCurrent()) setResult({ binding, proof, generation, call, text });
      }).catch(() => {
        // Unconfirmed failures keep only their native error row.
      });
      return () => own.abort();
    }, [binding, source, proof, generation, call]);

    return result?.binding === binding && result.proof === proof && result.generation === generation
      && result.call === call && result.text !== null ? h(Actions, { ...props, binding, isCurrent, text: result.text }) : null;
  }

  function FailedMessage(props) {
    const readable = props.useSession(sessionIsReadable);
    const canRead = props.useAccess('session/events') === true;
    const visible = props.usePanelInfo(info => info.activePanelId === null);
    const mainView = props.useSessionRetainInfo(props.sessionId, info => (info?.retainedBy.mainView ?? 0) > 0);
    if (!readable || !canRead || !visible || !mainView) return null;
    const binding = ctx.sessions.binding(props.sessionId);
    if (binding?.eventSource === undefined) return null;
    return h(Recovery, { ...props, binding });
  }

  return ctx.slots.inject(slot, () => ctx.slots.register({
    name: slot, id: 'harness-enhanced.failed-message', locale: ns,
  }, props => {
    const end = props.turn?.end;
    if (!isModelSwitchFailure(end) || end.seq !== props.seq || !isSessionId(props.sessionId)
      || typeof props.useSession !== 'function' || typeof props.useAccess !== 'function'
      || typeof props.usePanelInfo !== 'function' || typeof props.useSessionRetainInfo !== 'function'
      || typeof props.useInput !== 'function') return null;
    return h(FailedMessage, { ...props, key: `${props.sessionId}:${end.seq}:${end.time}` });
  }));
}
