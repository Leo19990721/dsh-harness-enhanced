import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { apply } from '../index.js';
import { failureProof } from '../failure-proof.js';
import { lookupFailedMessage } from '../failed-message-ui.js';
import { end, failed, HEADER, OTHER_UUID, SESSION, TEXT } from './fixtures/recovery.js';

const log = failed();
const proof = failureProof(seq => log[seq], log.at(-1).seq);

function fixtureView(fetch) {
  return { document: { baseURI: 'http://fixture.invalid/mount/' }, location: { origin: 'http://fixture.invalid' }, fetch };
}

test('the request carries exact failure identity, uses the mounted origin and grants no caching', async () => {
  let called;
  const view = fixtureView((url, init) => {
    called = { url, init };
    return Response.json({ text: TEXT });
  });
  const signal = new AbortController().signal;
  assert.equal(await lookupFailedMessage(view, SESSION, proof, signal), TEXT);
  assert.equal(called.url.pathname, '/mount/api/harness-enhanced.failed-message');
  assert.deepEqual(Object.fromEntries(called.url.searchParams), {
    sessionId: SESSION, ...Object.fromEntries(Object.entries(proof).map(([key, value]) => [key, String(value)])),
  });
  assert.deepEqual(called.init, { signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  view.document.baseURI = 'http://other.invalid/';
  assert.equal(await lookupFailedMessage(view, SESSION, proof, signal), null);
  assert.equal(called.url.origin, view.location.origin);
});

test('empty, unauthorized, unavailable and unrelated replies do not produce recovery text', async () => {
  for (const response of [204, 400, 401, 403, 404, 503].map(status => new Response(null, { status })).concat([
    new Response('{"text":"foreign"}'), Response.json({ text: '' }), Response.json({ text: ' '.repeat(30) }),
    Response.json({ text: 'x'.repeat(256 * 1024 + 1) }), Response.json({ detail: TEXT }),
  ])) {
    assert.equal(await lookupFailedMessage(fixtureView(() => response), SESSION, proof, new AbortController().signal), null);
  }
});

test('a response settled after abort is discarded', async () => {
  const stop = new AbortController();
  const barrier = Promise.withResolvers();
  const read = lookupFailedMessage(fixtureView(() => barrier.promise), SESSION, proof, stop.signal);
  stop.abort();
  barrier.resolve(Response.json({ text: TEXT }));
  await assert.rejects(read, { name: 'AbortError' });
});

test('client and Host agree on the failure record, even when the Remote base uses unprefixed ids', async () => {
  let route;
  apply({ inject(_keys, mount) { mount({
    effect() {}, sessions: { get: () => true }, connection: { fetch: { register: spec => { route = spec; } } },
    sessionQuery: { async observeSession() {
      return { source: 'live', header: HEADER, cursor: log.at(-1).seq, inheritedEventCount: 0, events: log, [Symbol.dispose]() {} };
    } },
  }); } });
  const view = fixtureView((url, options) => route.fetch(new Request(url, options)));
  const same = new AbortController().signal;
  const remote = failed({ uuid: OTHER_UUID });
  const remoteProof = failureProof(seq => remote[seq], remote.at(-1).seq);
  assert.equal(await lookupFailedMessage(view, SESSION, remoteProof, same), null);
  assert.equal(await lookupFailedMessage(view, SESSION, proof, same), TEXT);
});

test('the generated module registers only the known turn-tail extension and keeps non-target turns empty', async () => {
  const compiled = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  let loaded, recoveryRenderer, slotOptions;
  const window = { __ModuleLoader__: { load: mod => { loaded = mod; } } };
  runInNewContext(compiled, { window, AbortController });
  const registered = [];
  const slots = {
    inject(name, mount) { registered.push(name); if (name === 'conversation.chat.turnTail') mount(); },
    register(options, render) { slotOptions = options; recoveryRenderer = render; },
  };
  // Inspects the registration contract only; does not render React or emulate a page.
  const react = { createElement(component, props) { return { component, props }; } };
  const effect = () => {};
  loaded.factory(name => { assert.equal(name, 'react'); return react; }).apply({
    slots, effect,
    inject(keys, mount) {
      if (keys.includes('contextMenus') || keys.includes('uiWorkspace')) return;
      assert.deepEqual([...keys], ['slots', 'locale', 'layout', 'sessions', 'conversation', 'connection']);
      mount({ slots, effect, connection: { isLoopback: true } });
    },
  });
  assert.deepEqual(registered, ['sidebar.panellist.actions', 'conversation.chat.turnTail']);
  assert.equal(slotOptions.id, 'harness-enhanced.failed-message');
  const ending = log.at(-1);
  const target = { sessionId: SESSION, seq: ending.seq, turn: { end: ending } };
  for (const name of ['useSession', 'useAccess', 'usePanelInfo', 'useSessionRetainInfo', 'useInput']) target[name] = () => {};
  assert.equal(recoveryRenderer(target)?.props.sessionId, SESSION);
  assert.equal(recoveryRenderer({ ...target, seq: target.seq - 1 }), null);
  assert.equal(recoveryRenderer({ ...target, sessionId: 'dsh-peer:example' }), null);
  assert.equal(recoveryRenderer({ ...target, turn: { end: end(1, { kind: 'completed' }) } }), null);
  assert.equal(recoveryRenderer({ ...target, useAccess: undefined }), null);
});
