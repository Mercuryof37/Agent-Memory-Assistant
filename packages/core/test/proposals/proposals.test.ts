import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { initStore } from '../../src/init.ts';
import { loadConfig } from '../../src/config/load.ts';
import { MemoryStore } from '../../src/store/store.ts';
import {
  createProposal,
  decideProposal,
  listProposals,
  ProposalError,
} from '../../src/proposals/proposals.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

function fixture(t: { after: (fn: () => void) => void }, options: { beforeStep?: (step: string) => void } = {}) {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const config = loadConfig({ home }).config;
  const open = () =>
    new MemoryStore({
      home,
      config,
      ...(options.beforeStep === undefined ? {} : { beforeStep: options.beforeStep }),
    });
  return { home, config, store: open(), open };
}

function addFact(store: MemoryStore, abstract: string): string {
  return store.add({ kind: 'fact', abstract, body: 'body', evidence_level: 'observed' }, { author: 'human' }).id;
}

function pendingCount(home: string): number {
  try {
    return readdirSync(join(home, 'proposals', 'pending')).filter((name) => name.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

test('S4.4 a delete proposal with a stale base_hash is refused and leaves the memory alone', (t) => {
  const { config, store } = fixture(t);
  const id = addFact(store, 'delete me');
  assert.throws(
    () =>
      createProposal(
        { store, config },
        { op: 'delete', target: id, base_hash: 'deadbeef', reason: 'because' },
      ),
    (error: unknown) => error instanceof ProposalError && error.code === 'CONFLICT',
  );
  assert.equal(store.recall('delete me').hits.length, 1);
});

test('S4.4 accepting a delete ends validity and removes the pending file', (t) => {
  const { home, config, store } = fixture(t);
  const id = addFact(store, 'delete me too');
  const proposal = createProposal(
    { store, config },
    { op: 'delete', target: id, base_hash: store.read(id).content_hash, reason: 'cleanup' },
  );
  decideProposal({ store, config }, { id: proposal.id, decision: 'accept' });
  assert.equal(store.recall('delete me too').hits.length, 0);
  assert.equal(store.read(id).abstract, 'delete me too');
  assert.equal(pendingCount(home), 0);
});

test('S4.4 accepting a supersede activates the replacement and retires the target', (t) => {
  const { home, config, store } = fixture(t);
  const id = addFact(store, 'old fact');
  const proposal = createProposal(
    { store, config },
    {
      op: 'supersede',
      targets: [id],
      base_hashes: [store.read(id).content_hash],
      replacements: [{ kind: 'fact', abstract: 'new fact', body: 'body', evidence_level: 'observed' }],
      reason: 'correction',
    },
  );
  decideProposal({ store, config }, { id: proposal.id, decision: 'accept' });
  const active = store.active();
  assert.equal(active.length, 1);
  assert.equal(active[0]?.abstract, 'new fact');
  assert.deepEqual(active[0]?.supersedes, [id]);
  assert.equal(pendingCount(home), 0);
});

test('S4.4 a mid-accept failure keeps the proposal and leaves no partial write', (t) => {
  const { home } = fixture(t);
  const config = loadConfig({ home }).config;
  const setup = new MemoryStore({ home, config });
  const id = addFact(setup, 'target for partial');
  const proposal = createProposal(
    { store: setup, config },
    {
      op: 'supersede',
      targets: [id],
      base_hashes: [setup.read(id).content_hash],
      replacements: [{ kind: 'fact', abstract: 'replacement', body: 'body', evidence_level: 'observed' }],
      reason: 'partial test',
    },
  );
  const failing = new MemoryStore({
    home,
    config,
    beforeStep: (step) => {
      if (step === 'before-journal') throw new Error('injected failure');
    },
  });
  assert.throws(() => decideProposal({ store: failing, config }, { id: proposal.id, decision: 'accept' }));
  assert.equal(pendingCount(home), 1);
  const reopened = new MemoryStore({ home, config });
  assert.equal(reopened.active().length, 1);
  assert.equal(reopened.active()[0]?.abstract, 'target for partial');
});

test('S4.2 a supersede proposal with a stale base_hash is refused before writing', (t) => {
  const { config, store } = fixture(t);
  const id = addFact(store, 'stale target');
  assert.throws(
    () =>
      createProposal(
        { store, config },
        {
          op: 'supersede',
          targets: [id],
          base_hashes: ['0'.repeat(64)],
          replacements: [{ kind: 'fact', abstract: 'x', body: '', evidence_level: 'observed' }],
        },
      ),
    (error: unknown) => error instanceof ProposalError && error.code === 'CONFLICT',
  );
});

test('S4.2 a proposal containing a credential is rejected by scan', (t) => {
  const { config, store } = fixture(t);
  const id = addFact(store, 'scan target');
  assert.throws(
    () =>
      createProposal(
        { store, config },
        {
          op: 'supersede',
          targets: [id],
          base_hashes: [store.read(id).content_hash],
          replacements: [
            { kind: 'fact', abstract: 'x', body: 'sk-abcdefghijklmnop', evidence_level: 'observed' },
          ],
        },
      ),
    /content rejected by scan/,
  );
});

test('a rejected proposal is recorded and removed', (t) => {
  const { home, config, store } = fixture(t);
  const id = addFact(store, 'keep me');
  const proposal = createProposal(
    { store, config },
    { op: 'delete', target: id, base_hash: store.read(id).content_hash, reason: 'no' },
  );
  decideProposal({ store, config }, { id: proposal.id, decision: 'reject' });
  assert.equal(store.recall('keep me').hits.length, 1);
  assert.equal(pendingCount(home), 0);
  assert.ok(listProposals(store).length === 0);
});

test('the proposal ledger refuses to grow past proposals.max_pending', (t) => {
  const { config, store } = fixture(t);
  const id = addFact(store, 'limit target');
  const base = store.read(id).content_hash;
  for (let index = 0; index < config.proposals.max_pending; index += 1) {
    createProposal({ store, config }, { op: 'delete', target: id, base_hash: base, reason: `r${index}` });
  }
  assert.throws(
    () => createProposal({ store, config }, { op: 'delete', target: id, base_hash: base, reason: 'overflow' }),
    (error: unknown) => error instanceof ProposalError && error.code === 'CONFLICT',
  );
});
