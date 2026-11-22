import assert from 'node:assert/strict';
import test from 'node:test';
import { attachDirectoryLinks } from '../directory-link-client.js';
import { DIRECTORY_LINK_PATH } from '../local-link-path.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({ base = 'dsh-app://app/', transport = { ownsHost: true }, status = 204, session = 'local-session', delay, chat = true } = {}) {
  const calls = [], previews = [], notices = [];
  let click;
  let replays = 0;
  const document = {
    baseURI: base,
    addEventListener(name, listener, capture) { assert.equal(name, 'click'); assert.equal(capture, true); click = listener; },
    removeEventListener(name, listener, capture) { assert.equal(name, 'click'); assert.equal(listener, click); assert.equal(capture, true); click = undefined; },
  };
  const location = new URL(base);
  const view = { document, location, __DSH_TRANSPORT__: transport, async fetch(url, options) {
    calls.push({ url, options });
    await delay?.promise;
    return { status };
  } };
  const binding = { session: { getSnapshot: () => ({ openState: 'open' }) } };
  const ctx = {
    effect(fn) { fn(); },
    locale: { register() {}, bind: () => key => key },
    contextMenus: { notify: text => notices.push(text) },
    connection: { isLoopback: true, generation: { getSnapshot: () => 1 } },
    sessions: { binding: () => binding },
    slots: { entries(slot) {
      assert.equal(slot, 'conversation.view');
      return chat ? [{ options: { id: 'chat', locale: 'chat', children: { 'conversation.chat.flow': { scope: 'session' } },
        inject(id) { return { async openFile(path, options) { previews.push({ id, path, options }); } }; },
      } }] : [];
    } },
  };
  const seat = { getAttribute: () => session };
  const flow = { closest: () => seat };
  const markdown = { closest: () => flow };
  const emit = (tagName, value, modifiers = {}) => {
    const link = {
      isConnected: true, ownerDocument: document, tagName,
      closest(selector) { return selector.startsWith('[class*=') ? markdown : selector.startsWith('[data-conversation') ? seat : null; },
      getAttribute: () => value,
      click() { replays++; dispatch({ isTrusted: false }); },
    };
    function dispatch(extra) {
      const event = {
        target: { closest: () => link }, button: 0, isTrusted: true, cancelable: true, defaultPrevented: false, ...extra,
        preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; },
      };
      click?.(event);
      return event;
    }
    return dispatch(modifiers);
  };
  const remove = attachDirectoryLinks(ctx, view);
  return { calls, previews, notices, remove, emit, get replays() { return replays; } };
}

test('trusted Desktop directory click goes to the exact same-origin Host route', async () => {
  const f = fixture();
  const event = f.emit('BUTTON', 'D:/中文/Space and #');
  await flush();
  assert.equal(event.defaultPrevented && event.stopped, true);
  assert.equal(f.replays, 0);
  const [{ url, options }] = f.calls;
  assert.equal(url.href, `dsh-app://app${DIRECTORY_LINK_PATH}`);
  assert.equal(options.method, 'POST');
  assert.equal(options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(options.body), { path: 'D:\\中文\\Space and #' });
  f.remove();
});

test('native files replay once; unsupported and modified clicks keep their original handlers', async () => {
  const f = fixture({ status: 200 });
  for (const [tag, href, modifiers] of [['A', 'https://example.test/path'], ['BUTTON', './relative.md'],
    ['BUTTON', '\\\\nas\\share'], ['BUTTON', 'D:/file.md', { ctrlKey: true }], ['BUTTON', 'D:/file.md', { isTrusted: false }]]) {
    assert.equal(f.emit(tag, href, modifiers).defaultPrevented, false);
  }
  assert.equal(f.calls.length, 0);
  f.emit('BUTTON', 'D:/file.md');
  await flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.replays, 1);
  f.remove();
});

test('legacy ordinary file preserves session + line; invalid or unavailable links announce failure', async () => {
  const f = fixture({ status: 200 });
  f.emit('A', 'file://D:/a%20file.md#L9');
  await flush();
  assert.deepEqual(f.previews, [{ id: 'local-session', path: 'D:\\a file.md', options: { line: 9 } }]);
  assert.deepEqual(JSON.parse(f.calls[0].options.body), { path: 'D:\\a file.md', inspect: true });
  assert.equal(f.emit('A', 'file://nas/share/file.md').defaultPrevented, true);
  assert.deepEqual(f.notices, ['failed']);
  f.remove();
  const unmatched = fixture({ status: 200, chat: false });
  unmatched.emit('A', 'file:///D:/file.md');
  await flush();
  assert.deepEqual(unmatched.notices, ['failed']);
  unmatched.remove();
});

test('nonlocal and worker views have no hook; unload cancels pending work without replay', async () => {
  for (const config of [{ base: 'https://remote.example/' }, { base: 'http://127.0.0.1/' }, { session: 'remote:session' }]) {
    const f = fixture(config);
    assert.equal(f.emit('A', 'file:///D:/file.md').defaultPrevented, false);
    assert.equal(f.calls.length, 0);
    f.remove();
  }
  const delay = Promise.withResolvers();
  const f = fixture({ status: 200, delay });
  f.emit('BUTTON', 'D:/file.md');
  f.remove();
  assert.equal(f.calls[0].options.signal.aborted, true);
  delay.resolve();
  await flush();
  assert.equal(f.emit('BUTTON', 'D:/file.md').defaultPrevented, false);
  assert.equal(f.replays, 0);
  assert.deepEqual(f.notices, []);
});
