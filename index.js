import { FAILED_MESSAGE_PATH, MAX_RECOVERY_EVENTS, failureProof, isCompactionId, isSessionId, sameFailureProof } from './failure-proof.js';
import { recoverFailedText } from './failed-message.js';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const MAX_STORED_BYTES = 8 * 1024 * 1024;
const absent = () => new Response(null, { status: 204, headers: HEADERS });

function ordinary(header, id) {
  return header?.id === id && header.origin === undefined && header.version === 4
    && typeof header.cwd === 'string' && header.cwd !== '';
}

function numberParam(params, name) {
  const value = params.get(name);
  if (value === null || !/^(0|[1-9][0-9]{0,15})$/.test(value)) return NaN;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : NaN;
}

export function apply(ctx) {
  // The Host read is optional. Both sidebar enhancements remain client-only.
  ctx.inject(['connection', 'sessions', 'sessionQuery'], scope => {
    const lifetime = new AbortController();
    scope.effect(() => () => lifetime.abort(), 'harness-enhanced: cancel recovery reads');
    let inFlight = 0;
    // Connection admits authenticated owner Peers only on this exact Fetch route.
    scope.connection.fetch.register({
      path: FAILED_MESSAGE_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      async fetch(request) {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('sessionId');
        const endSeq = numberParam(searchParams, 'endSeq');
        const endTime = numberParam(searchParams, 'endTime');
        const turn = numberParam(searchParams, 'turn');
        const compactionSeq = numberParam(searchParams, 'compactionSeq');
        const compactionId = searchParams.get('compactionId');
        if (searchParams.size !== 6 || !isSessionId(id) || !isCompactionId(compactionId)
          || !Number.isSafeInteger(endSeq) || !Number.isSafeInteger(endTime)
          || !Number.isSafeInteger(turn) || turn < 1 || !Number.isSafeInteger(compactionSeq)
          || compactionSeq >= endSeq || endSeq - compactionSeq > 4096) {
          return new Response(null, { status: 400, headers: HEADERS });
        }
        if (endSeq >= MAX_RECOVERY_EVENTS) return absent();
        if (inFlight >= 2) return new Response(null, { status: 503, headers: HEADERS });

        const signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(10_000)]);
        inFlight++;
        try {
          signal.throwIfAborted();
          let stored;
          if (scope.sessions.get(id) === undefined) {
            // Match native passive history reads, without opening historical
            // formats or arbitrarily large cold artifacts. sizeBytes is on disk,
            // not a bound on the native Zstd decoder's expanded size.
            stored = await scope.get('sessionPersistence')?.stat(id, { signal });
            signal.throwIfAborted();
            if (scope.sessions.get(id) === undefined && (!ordinary(stored?.header, id)
              || stored.formatStatus !== 'current' || !Number.isSafeInteger(stored.sizeBytes)
              || stored.sizeBytes < 1 || stored.sizeBytes > MAX_STORED_BYTES
              || (stored.eventCount !== undefined && (!Number.isSafeInteger(stored.eventCount)
                || stored.eventCount <= endSeq || stored.eventCount > MAX_RECOVERY_EVENTS)))) return absent();
          }
          const observation = await scope.sessionQuery.observeSession(id, { projectionMode: 'none', signal });
          try {
            signal.throwIfAborted();
            const { header, cursor, inheritedEventCount } = observation;
            if (!ordinary(header, id) || !Number.isSafeInteger(cursor) || cursor < endSeq || cursor >= MAX_RECOVERY_EVENTS
              || (observation.source !== 'live' && (observation.source !== 'prepared' || stored === undefined
                || observation.revision !== stored.revision))
              || endSeq < inheritedEventCount) return absent();
            const events = observation.events;
            const expected = { endSeq, endTime, turn, compactionSeq, compactionId };
            if (events.length !== cursor + 1 || !sameFailureProof(expected, failureProof(seq => events[seq], endSeq))) return absent();
            const text = recoverFailedText(events, endSeq, inheritedEventCount);
            signal.throwIfAborted();
            return text === null ? absent() : Response.json({ text }, { headers: HEADERS });
          } finally {
            observation[Symbol.dispose]();
          }
        } catch (error) {
          // No log contents, ids, paths, or upstream error messages in failures.
          return error?.code === 'SESSION_QUERY_SESSION_NOT_FOUND' ? absent() : new Response(null, { status: 503, headers: HEADERS });
        } finally {
          inFlight--;
        }
      },
    });
  });
}
