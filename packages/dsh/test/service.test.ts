import test from 'node:test';
import assert from 'node:assert/strict';
import { decideProposal, initStore } from '../../core/src/index.ts';
import { cleanupHome, tempHome } from '../../core/test/helpers.ts';
import { openHostService, type SessionEventLike } from '../src/service.ts';

/**
 * S4.4 follow-up (S7.5 walkthrough): a proposal made by the model carries
 * provenance bound at propose time, and accepting it writes that provenance
 * into the replacement record instead of dropping it at the pending-file
 * boundary.
 */

const EVENTS = new Map<number, SessionEventLike>([
  [
    1,
    {
      type: 'user/message',
      seq: 1,
      data: { content: [{ type: 'text', text: 'the new path is B, remember it' }] },
    },
  ],
]);

test('S4.4 propose binds evidence and the accepted replacement keeps it', async (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const host = openHostService(home, {
    sessionId: 'session-1',
    sessions: {
      get: (id) =>
        id === 'session-1' ? { seq: 2, eventAt: (seq) => EVENTS.get(seq) } : undefined,
    },
  });
  assert.ok(host);

  const id = host.store.add(
    { kind: 'fact', abstract: 'old path is A', body: 'body', evidence_level: 'observed' },
    { author: 'human' },
  ).id;
  const proposal = (await host.propose(
    {
      op: 'supersede',
      ids: [id],
      base_hashes: [host.store.read(id).content_hash],
      replacements: [
        {
          kind: 'fact',
          abstract: 'new path is B',
          body: 'body',
          evidence_level: 'observed',
          evidence: [{ event_seq: 1, quote: 'new path is B' }],
        },
      ],
      reason: 'correction',
    },
    { sessionId: 'session-1', delegationDepth: 0 },
  )) as { id: string };

  decideProposal({ store: host.store, config: host.runtime.config }, { id: proposal.id, decision: 'accept' });
  const replacement = host.store.active().find((doc) => doc.abstract === 'new path is B');
  assert.ok(replacement);
  assert.equal(replacement.author, 'human');
  assert.equal(replacement.provenance.length, 1);
  assert.equal(replacement.provenance[0]?.session_id, 'session-1');
  assert.equal(replacement.provenance[0]?.speaker, 'user');
  assert.equal(replacement.provenance[0]?.quote, 'new path is B');
  assert.match(replacement.provenance[0]?.event_sha256 ?? '', /^[0-9a-f]{64}$/);
});

test('S4.4 a proposal whose evidence is not in this session is refused at propose time', async (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const host = openHostService(home, {
    sessionId: 'session-1',
    sessions: {
      get: (id) => (id === 'session-1' ? { seq: 2, eventAt: (seq) => EVENTS.get(seq) } : undefined),
    },
  });
  assert.ok(host);
  const id = host.store.add(
    { kind: 'fact', abstract: 'old path is A', body: 'body', evidence_level: 'observed' },
    { author: 'human' },
  ).id;
  await assert.rejects(
    async () =>
      host.propose(
        {
          op: 'supersede',
          ids: [id],
          base_hashes: [host.store.read(id).content_hash],
          replacements: [
            {
              kind: 'fact',
              abstract: 'fabricated',
              body: 'body',
              evidence_level: 'observed',
              evidence: [{ event_seq: 9, quote: 'never said' }],
            },
          ],
        },
        { sessionId: 'session-1', delegationDepth: 0 },
      ),
    /event 9 does not exist/,
  );
});
