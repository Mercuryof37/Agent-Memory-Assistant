import test from 'node:test';
import assert from 'node:assert/strict';
import { initStore } from '../../src/init.ts';
import { loadConfig } from '../../src/config/load.ts';
import { MemoryStore } from '../../src/store/store.ts';
import { createProposal, decideProposal, listProposals } from '../../src/proposals/proposals.ts';
import {
  buildCloseoutPrompt,
  CloseoutRound,
  collectL0,
  downgradeRule,
  parseCloseout,
  summaryHash,
} from '../../src/distill/closeout.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

const EVENTS = [
  { seq: 1, speaker: 'user' as const, text: 'the flag is --release; please remember it' },
  { seq: 2, speaker: 'assistant' as const, text: 'I will remember it' },
];
const ACTIVE_ID = 'mem-20261017-00000001';
const BASE = {
  events: EVENTS,
  activeIds: [ACTIVE_ID],
  activeAbstracts: ['old fact'],
  maxProposals: 5,
};

function answer(proposals: unknown[], message?: string): string {
  return JSON.stringify(message === undefined ? { proposals } : { proposals, message });
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    op: 'supersede',
    targets: [ACTIVE_ID],
    reason: 'correct the flag',
    replacements: [
      {
        kind: 'fact',
        abstract: 'release flag is --release',
        body: 'verified in the session',
        evidence: [{ event_seq: 1, quote: '--release' }],
      },
    ],
    ...overrides,
  };
}

test('S6.1 evidence is verified against real events; assistant messages never count', () => {
  const assistantEvidence = parseCloseout(
    answer([proposal({ replacements: [{ kind: 'fact', abstract: 'x', body: 'y', evidence: [{ event_seq: 2, quote: 'remember' }] }] })]),
    BASE,
  );
  assert.equal(assistantEvidence.candidates.length, 0);
  assert.ok(assistantEvidence.dropped.some((reason) => /assistant message cannot be evidence/.test(reason)));

  const missing = parseCloseout(
    answer([proposal({ replacements: [{ kind: 'fact', abstract: 'x', body: 'y', evidence: [{ event_seq: 99, quote: 'x' }] }] })]),
    BASE,
  );
  assert.equal(missing.candidates.length, 0);

  const mismatch = parseCloseout(
    answer([proposal({ replacements: [{ kind: 'fact', abstract: 'x', body: 'y', evidence: [{ event_seq: 1, quote: 'nope' }] }] })]),
    BASE,
  );
  assert.equal(mismatch.candidates.length, 0);

  const valid = parseCloseout(answer([proposal()]), BASE);
  assert.equal(valid.candidates.length, 1);
  assert.equal(valid.candidates[0]?.replacements[0]?.evidence[0]?.event_seq, 1);
});

test('S6.1 an evidence quote longer than 160 characters is dropped, not truncated', () => {
  const long = 'x'.repeat(161);
  const events = [{ seq: 1, speaker: 'user' as const, text: `prefix ${long} suffix` }, ...EVENTS.slice(1)];
  const parsed = parseCloseout(
    answer([
      proposal({
        replacements: [{ kind: 'fact', abstract: 'x', body: 'y', evidence: [{ event_seq: 1, quote: long }] }],
      }),
    ]),
    { ...BASE, events },
  );
  assert.equal(parsed.candidates.length, 0);
  assert.ok(parsed.dropped.some((reason) => /longer than 160/.test(reason)));
});

test('S6.2 a rule without machine-check design is downgraded to a pitfall', () => {
  assert.deepEqual(downgradeRule({ kind: 'rule' }), { action: 'downgrade', to: 'pitfall' });
  assert.deepEqual(
    downgradeRule({ kind: 'rule', machine_gate: { check: 'a#b', test: 'x.test.ts' } }),
    { action: 'keep' },
  );
  assert.equal(collectL0(EVENTS).length, 0);
});

test('S6.3 more than five proposals are truncated, no-content is explicit, rejected summaries never return', () => {
  const many = Array.from({ length: 7 }, (_, index) =>
    proposal({
      targets: [ACTIVE_ID],
      replacements: [
        {
          kind: 'fact',
          abstract: `new fact ${index}`,
          body: 'b',
          evidence: [{ event_seq: 1, quote: '--release' }],
        },
      ],
    }),
  );
  const truncated = parseCloseout(answer(many), BASE);
  assert.equal(truncated.candidates.length, 5);
  assert.equal(truncated.truncated, 2);

  const none = parseCloseout(JSON.stringify({ proposals: [], message: '本次无新提案' }), BASE);
  assert.equal(none.message, '本次无新提案');

  const candidate = parseCloseout(answer([proposal()]), BASE).candidates[0];
  assert.ok(candidate);
  const hash = summaryHash(candidate);
  const rejected = parseCloseout(answer([proposal()]), { ...BASE, rejectedHashes: new Set([hash]) });
  assert.equal(rejected.candidates.length, 0);
  assert.ok(rejected.dropped.some((reason) => /already rejected/.test(reason)));
});

test('S6.4 a closeout round accepts exactly one submit and disposes on timeout', () => {
  let now = 1_000;
  const round = new CloseoutRound({ timeoutMs: 100, now: () => now });
  assert.deepEqual(round.submit(), { ok: true });
  const second = round.submit();
  assert.equal(second.ok, false);

  const timed = new CloseoutRound({ timeoutMs: 50, now: () => now });
  now += 60;
  assert.equal(timed.status, 'disposed');
  assert.equal(timed.submit().ok, false);
});

test('S6.5 a rejected proposal is recorded in the journal and the store stays consistent', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const config = loadConfig({ home }).config;
  const store = new MemoryStore({ home, config });
  const written = store.add(
    { kind: 'fact', abstract: 'keep me', body: 'body', evidence_level: 'observed' },
    { author: 'human' },
  );
  const proposal = createProposal(
    { store, config },
    { op: 'delete', target: written.id, base_hash: store.read(written.id).content_hash, reason: 'no' },
  );
  decideProposal({ store, config }, { id: proposal.id, decision: 'reject' });
  assert.equal(listProposals(store).length, 0);
  assert.equal(store.recall('keep me').hits.length, 1);
  const journal = store.journal.readAll().entries;
  assert.ok(journal.some((entry) => entry.op === 'decide' && entry.data.decision === 'reject'));
  assert.equal(store.rebuild().journal_consistent, true);
});

test('S6.1 buildCloseoutPrompt includes L0, catalog and the JSON contract', () => {
  const prompt = buildCloseoutPrompt({
    l0: collectL0([
      { seq: 1, speaker: 'user', text: '不对，应该是 --release' },
      { seq: 2, speaker: 'tool', text: 'Error: boom' },
    ]),
    active: [{ id: ACTIVE_ID, kind: 'fact', abstract: 'old fact' }],
    maxProposals: 5,
  });
  assert.match(prompt, /本次无新提案/);
  assert.match(prompt, /correct|不对/);
  assert.match(prompt, new RegExp(ACTIVE_ID));
});
