import { DIRECTORY_LINK_HEADER, DIRECTORY_LINK_PATH, isLocalIpv4, localWindowsPath, parseLegacyFileLink } from './local-link-path.js';
import { isSessionId } from './failure-proof.js';

const CHAT_FLOW = '[data-chat-flow]';
const CONVERSATION = '[data-conversation-content][data-conversation-session]';
// These class prefixes are the rc.5 Markdown primitive's file<Link> and
// MarkdownText root, not labels, arbitrary buttons, or prose file mentions.
const NATIVE_LINK = 'button[type="button"][title][class*="_fileLink_"]';
const MARKDOWN = '[class*="_markdown_"]';

function localLinkEndpoint(view, connection) {
  const here = view.location;
  const transport = view.__DSH_TRANSPORT__;
  if (connection.isLoopback !== true) return null;
  if (here.protocol === 'dsh-app:') {
    if (here.host !== 'app' || transport?.ownsHost !== true) return null;
  } else if (transport !== undefined || !['http:', 'https:'].includes(here.protocol)
    || !(here.hostname === 'localhost' || here.hostname === '[::1]' || isLocalIpv4(here.hostname))) return null;
  const endpoint = new URL(DIRECTORY_LINK_PATH.slice(1), view.document.baseURI);
  return endpoint.protocol === here.protocol && endpoint.host === here.host && endpoint.username === ''
    && endpoint.password === '' && endpoint.pathname === DIRECTORY_LINK_PATH ? endpoint : null;
}

export function attachDirectoryLinks(ctx, view = window) {
  const endpoint = localLinkEndpoint(view, ctx.connection);
  if (endpoint === null) return () => {};
  const { document } = view;
  const lifetime = new AbortController();
  const pending = new WeakSet();
  const ns = 'harnessEnhanced.directoryLink';
  ctx.effect(() => ctx.locale.register(ns, {
    en: { failed: 'Could not open this local link. Check that the path exists on this computer.' },
    zh: { failed: '无法打开本地链接。请检查路径是否存在于本机。' },
  }), 'harness-enhanced: local link translations');
  const t = ctx.locale.bind(ns);
  const failed = () => ctx.contextMenus.notify(t('failed'));
  // Use Chat's own native dispatcher for legacy files, including its session
  // scoping and line navigation. This reads the rc.5 slot face; does not patch
  // native Link, its delegate, React, or the registration.
  async function previewLegacy(sessionId, { path, line }) {
    const chat = ctx.slots.entries('conversation.view').map(entry => entry.options ?? entry).find(entry => entry.id === 'chat'
      && entry.locale === 'chat' && entry.children?.['conversation.chat.flow']?.scope === 'session');
    const open = chat?.inject?.(sessionId)?.openFile;
    if (typeof open !== 'function') return false;
    await open(path, line === undefined ? undefined : { line });
    return true;
  }

  function onClick(event) {
    if (lifetime.signal.aborted || !event.isTrusted || event.defaultPrevented || !event.cancelable
      || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const link = event.target?.closest?.(`a[href], ${NATIVE_LINK}`);
    if (!link?.isConnected || link.ownerDocument !== document || link.closest('[hidden], [inert], [aria-hidden="true"]')) return;
    const markdown = link.closest(MARKDOWN);
    const flow = markdown?.closest(CHAT_FLOW);
    const seat = flow?.closest(CONVERSATION);
    const sessionId = seat?.getAttribute('data-conversation-session');
    if (!isSessionId(sessionId)) return; // Remote/worker session addresses are not bare local ids.
    const binding = ctx.sessions.binding(sessionId);
    if (!binding || binding.session.getSnapshot().openState !== 'open') return;
    const legacy = link.tagName === 'A';
    const target = legacy ? link.getAttribute('href') : link.getAttribute('title');
    if (legacy && !/^file:/i.test(target ?? '')) return;
    const parsed = legacy ? parseLegacyFileLink(target) : null;
    const path = legacy ? parsed?.path : localWindowsPath(target);
    if (!path) {
      if (legacy) {
        event.preventDefault();
        event.stopImmediatePropagation();
        failed();
      }
      return;
    }
    const generation = ctx.connection.generation.getSnapshot();
    const current = () => !lifetime.signal.aborted && ctx.connection.generation.getSnapshot() === generation
      && link.isConnected && link.closest(CONVERSATION) === seat && seat.getAttribute('data-conversation-session') === sessionId
      && ctx.sessions.binding(sessionId) === binding && binding.session.getSnapshot().openState === 'open'
      && link.getAttribute(legacy ? 'href' : 'title') === target;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (pending.has(link)) return;
    pending.add(link);
    void (async () => {
      try {
        if (legacy && !parsed.windows) {
          if (current() && !await previewLegacy(sessionId, parsed) && current()) failed();
          return;
        }
        const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(7000)]);
        const response = await view.fetch(endpoint, {
          method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
          headers: { 'Content-Type': 'application/json', [DIRECTORY_LINK_HEADER]: '1' },
          body: JSON.stringify({ path, ...(parsed?.line === undefined ? {} : { inspect: true }) }),
        });
        if (!current() || response.status === 204) return;
        if (!legacy) link.click(); // Replay into native Sidebar, never OS file associations.
        else if ((response.status !== 200 || !await previewLegacy(sessionId, parsed)) && current()) failed();
      } catch {
        if (current()) {
          if (!legacy) link.click();
          else failed();
        }
      } finally {
        pending.delete(link);
      }
    })();
  }

  document.addEventListener('click', onClick, true);
  return () => {
    lifetime.abort();
    document.removeEventListener('click', onClick, true);
  };
}
