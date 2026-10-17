import test from 'node:test';
import assert from 'node:assert/strict';
import { bindEvidence, EvidenceError } from '../src/actor.ts';

const events = new Map<number, { seq: number; speaker: 'user' | 'assistant'; text: string }>([
  [1, { seq: 1, speaker: 'user', text: 'please remember the build flag' }],
  [2, { seq: 2, speaker: 'assistant', text: 'I will remember that' }],
]);

test('S4.3 binding uses the real event and fills session/speaker/hash', () => {
  const bound = bindEvidence({
    sessionId: 'session-1',
    eventSeq: 1,
    quote: 'build flag',
    lookup: (seq) => events.get(seq),
  });
  assert.equal(bound.session_id, 'session-1');
  assert.equal(bound.speaker, 'user');
  assert.equal(bound.event_seq, 1);
  assert.match(bound.event_sha256, /^[0-9a-f]{64}$/);
});

test('S4.3 a quote that is not in the event is refused', () => {
  assert.throws(
    () => bindEvidence({ sessionId: 's', eventSeq: 1, quote: 'not there', lookup: (seq) => events.get(seq) }),
    (error: unknown) => error instanceof EvidenceError && /not a substring/.test(error.message),
  );
});

test('S4.3 an assistant message cannot be its own evidence', () => {
  assert.throws(
    () => bindEvidence({ sessionId: 's', eventSeq: 2, quote: 'remember', lookup: (seq) => events.get(seq) }),
    (error: unknown) => error instanceof EvidenceError && /cannot be its own evidence/.test(error.message),
  );
});

test('S4.3 a missing event and a mismatched hash are refused', () => {
  assert.throws(
    () => bindEvidence({ sessionId: 's', eventSeq: 9, quote: 'x', lookup: (seq) => events.get(seq) }),
    /does not exist/,
  );
  assert.throws(
    () =>
      bindEvidence({
        sessionId: 's',
        eventSeq: 1,
        quote: 'build flag',
        lookup: (seq) => events.get(seq),
        expectedSha256: '0'.repeat(64),
      }),
    /hash does not match/,
  );
});
