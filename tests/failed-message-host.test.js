import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from '../index.js';
import { FAILED_MESSAGE_PATH, failureProof } from '../failure-proof.js';
import { failed, HEADER, OTHER_UUID, SESSION, TEXT } from './fixtures/recovery.js';

const log = failed();
const proof = failureProof(seq => log[seq], log.at(-1).seq);
const url = (values = {}) => new URL(FAILED_MESSAGE_PATH + '?' + new URLSearchParams({ sessionId: SESSION, ...proof, ...values }), 'http://fixture.invalid');

function setup({ cold = false, meta, revision = 'r1', header = HEADER, getEvents = () => log, observe, hasServices = true } = {}) {
  const counts = { stat: 0, observe: 0, materialize: 0, dispose: 0 };
  let route, stop, requested;
  const scope = {
    sessions: { get: () => cold ? undefined : {} },
    get: name => {
      assert.equal(name, 'sessionPersistence');
      return { async stat(id, { signal }) {
        assert.equal(id, SESSION);
        assert.equal(signal.aborted, false);
        counts.stat++;
        return meta ?? { header: HEADER, formatStatus: 'current', revision: 'r1', sizeBytes: 345 };
      } };
    },
    sessionQuery: { async observeSession(id, options) {
      requested = { id, ...options };
      counts.observe++;
      await observe?.(options.signal);
      return {
        source: cold ? 'prepared' : 'live', header, cursor: log.at(-1).seq, revision,
        inheritedEventCount: 0,
        get events() { counts.materialize++; return getEvents(); },
        [Symbol.dispose]() { counts.dispose++; },
      };
    } },
    connection: { fetch: { register: spec => { route = spec; } } },
    effect(run) { stop = run(); },
  };
  apply({ inject(keys, register) {
    if (keys.includes('webServer')) return;
    assert.deepEqual(keys, ['connection', 'sessions', 'sessionQuery']);
    if (hasServices) register(scope);
  } });
  const read = (params, options) => route.fetch(new Request(url(params), options));
  return { route, stop, read, counts, get requested() { return requested; } };
}

test('mounts an exact read-only Connection route; returns only the matching original text', async () => {
  const h = setup();
  assert.equal(h.route.path, FAILED_MESSAGE_PATH);
  assert.deepEqual(h.route.methods, ['GET']);
  assert.equal(h.route.requestBody, 'buffered');
  const result = await h.read();
  assert.equal(result.status, 200);
  assert.match(result.headers.get('content-type'), /^application\/json/);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await result.json(), { text: TEXT });
  assert.equal(h.requested.id, SESSION);
  assert.equal(h.requested.projectionMode, 'none');
  assert.deepEqual(h.counts, { stat: 0, observe: 1, materialize: 1, dispose: 1 });
});

test('a same-id remote base session with the same end seq and time cannot read local text', async () => {
  const h = setup();
  for (const mismatch of [{ compactionId: OTHER_UUID }, { endTime: proof.endTime + 1 }, { turn: 2 }, { compactionSeq: 3 }]) {
    const result = await h.read(mismatch);
    assert.equal(result.status, 204);
    assert.equal(await result.text(), '');
  }
  assert.equal(h.counts.dispose, 4);
});

test('unknown extra fields, prefixed ids, missing or malformed proof are refused before querying', async () => {
  const h = setup();
  for (const invalid of [{ extra: 1 }, { sessionId: 'dsh-peer:example' }, { sessionId: '../fixture' }, { endSeq: '0007' },
    { compactionId: 'no-proof' }, { compactionSeq: 7 }, { endTime: '9999999999999999' }, { turn: -1 }]) {
    assert.equal((await h.read(invalid)).status, 400);
  }
  const incomplete = url();
  incomplete.searchParams.delete('compactionId');
  incomplete.searchParams.append('endSeq', '7');
  assert.equal((await h.route.fetch(new Request(incomplete))).status, 400);
  assert.equal(h.counts.observe, 0);
});

test('can re-derive the text from an existing current-format cold observation after reload', async () => {
  const cold = setup({ cold: true });
  const result = await cold.read();
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { text: TEXT });
  assert.deepEqual(cold.counts, { stat: 1, observe: 1, materialize: 1, dispose: 1 });
});

test('cold preflight skips historical, oversized, insufficient and unverifiable artifacts', async () => {
  for (const fields of [{ formatStatus: 'migration-required' }, { sizeBytes: 8 * 1024 * 1024 + 1 }, { sizeBytes: undefined },
    { eventCount: 250_001 }, { eventCount: 3 }, { header: { ...HEADER, origin: 'subagent' } }]) {
    const h = setup({ cold: true, meta: { header: HEADER, revision: 'r1', formatStatus: 'current', sizeBytes: 345, ...fields } });
    assert.equal((await h.read()).status, 204);
    assert.equal(h.counts.observe, 0);
  }
});

test('discard a different storage revision, ineligible header, or an incomplete cut', async () => {
  for (const options of [{ cold: true, revision: 'r2' }, { header: { ...HEADER, origin: 'subagent' } }, { getEvents: () => log.slice(1) }]) {
    const h = setup(options);
    assert.equal((await h.read()).status, 204);
    assert.equal(h.counts.dispose, 1);
  }
});

test('client abort and plugin unload cancel a pending read without leaking it or its error', async () => {
  for (const unload of [false, true]) {
    const barrier = Promise.withResolvers();
    const owner = new AbortController();
    const h = setup({ observe: () => barrier.promise });
    const pending = h.read({}, { signal: owner.signal });
    if (unload) h.stop();
    else owner.abort();
    assert.equal(h.requested.signal.aborted, true);
    barrier.resolve();
    const result = await pending;
    assert.equal(result.status, 503);
    assert.equal(await result.text(), '');
    assert.equal(h.counts.materialize, 0);
    assert.equal(h.counts.dispose, 1);
  }
});

test('concurrent read budget is released and upstream errors do not disclose contents', async () => {
  const barrier = Promise.withResolvers();
  const h = setup({ observe: () => barrier.promise });
  const first = h.read(), second = h.read();
  assert.equal((await h.read()).status, 503);
  barrier.reject(new Error('private path must not appear'));
  for (const result of [...await Promise.all([first, second]), await h.read()]) {
    assert.equal(result.status, 503);
    assert.equal(await result.text(), '');
  }
  assert.equal(h.counts.observe, 3);
});

test('absent Host services do not require the feature to mount', () => {
  assert.equal(setup({ hasServices: false }).route, undefined);
});
