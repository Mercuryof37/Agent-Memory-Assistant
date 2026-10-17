import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initStore } from '../../src/init.ts';
import { loadConfig } from '../../src/config/load.ts';
import { MemoryStore, MemoryStoreError } from '../../src/store/store.ts';
import { serializeMemory } from '../../src/model/frontmatter.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

interface Fixture {
  readonly home: string;
  readonly store: MemoryStore;
  readonly open: (options?: { beforeStep?: (step: string) => void }) => MemoryStore;
}

function fixture(t: { after: (fn: () => void) => void }): Fixture {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const { config } = loadConfig({ home });
  const open = (options: { beforeStep?: (step: string) => void } = {}) =>
    new MemoryStore({ home, config, ...(options.beforeStep === undefined ? {} : { beforeStep: options.beforeStep }) });
  return { home, store: open(), open };
}

test('S2a.1 journey: add -> read -> recall -> rebuild -> recall', (t) => {
  const { home, store, open } = fixture(t);
  const written = store.add(
    { kind: 'fact', abstract: 'alpha deployment uses blue-green', body: 'switch via the proxy', evidence_level: 'observed' },
    { author: 'human' },
  );
  assert.match(written.id, /^mem-\d{8}-[0-9a-f]{8}$/);
  assert.equal(written.deduplicated, false);

  assert.equal(store.read(written.id).abstract, 'alpha deployment uses blue-green');
  assert.equal(store.recall('blue-green').hits[0]?.id, written.id);

  const report = store.rebuild();
  assert.equal(report.files, 1);
  assert.equal(report.journal_head?.seq, 1);

  const reopened = open();
  assert.equal(reopened.recall('blue-green').hits[0]?.id, written.id);
  assert.ok(existsSync(join(home, '.index', 'manifest.json')));
  const catalog = readFileSync(join(home, 'MEMORY.md'), 'utf8');
  assert.match(catalog, new RegExp(`\\[fact\\] alpha deployment uses blue-green — ${written.id}`));
});

test('S2a.6 duplicate content returns the existing id and keeps the file bytes', (t) => {
  const { home, store } = fixture(t);
  const input = { kind: 'fact' as const, abstract: 'same abstract', body: 'same body', evidence_level: 'observed' as const };
  const first = store.add(input, { author: 'human' });
  const file = join(home, 'memories', 'fact', `${first.id}.md`);
  const before = readFileSync(file, 'utf8');
  const second = store.add(input, { author: 'human' });
  assert.equal(second.deduplicated, true);
  assert.equal(second.id, first.id);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('an unaccounted file is quarantined and invisible to recall', (t) => {
  const { home, open } = fixture(t);
  const dir = join(home, 'memories', 'fact');
  mkdirSync(dir, { recursive: true });
  const id = 'mem-20261017-0000beef';
  const text = serializeMemory({
    id,
    mem_schema: 1,
    kind: 'fact',
    scope: 'local',
    abstract: 'planted by hand',
    created_at: '2026-10-17T00:00:00+00:00',
    valid_from: '2026-10-17',
    valid_until: null,
    supersedes: [],
    author: 'human',
    evidence_level: 'user_explicit',
    error_signatures: [],
    provenance: [],
    body: 'hand written\n',
  });
  writeFileSync(join(dir, `${id}.md`), text);

  const reopened = open();
  assert.equal(reopened.stats().quarantined, 1);
  assert.equal(reopened.recall('planted').hits.length, 0);
  assert.throws(() => reopened.read(id), (error: unknown) => error instanceof MemoryStoreError && error.code === 'NOT_FOUND');
});

test('an interruption before the write leaves nothing behind', (t) => {
  const { home, open } = fixture(t);
  const store = open({
    beforeStep: (step) => {
      if (step === 'before-write') throw new Error('boom');
    },
  });
  assert.throws(() =>
    store.add({ kind: 'fact', abstract: 'interrupted', body: '', evidence_level: 'observed' }, { author: 'human' }),
  );
  const reopened = open();
  assert.equal(reopened.stats().active, 0);
  assert.equal(reopened.stats().journal_head, null);
  assert.equal(existsSync(join(home, 'MEMORY.md')), false);
});

test('S2a.3 an interruption after the file but before the journal is quarantined on recovery', (t) => {
  const { open } = fixture(t);
  const store = open({
    beforeStep: (step) => {
      if (step === 'before-journal') throw new Error('boom');
    },
  });
  assert.throws(() =>
    store.add({ kind: 'fact', abstract: 'written not accounted', body: '', evidence_level: 'observed' }, { author: 'human' }),
  );
  const reopened = open();
  assert.equal(reopened.stats().active, 0);
  assert.equal(reopened.stats().quarantined, 1);
});

test('an interruption before the derived files is recovered by rebuild', (t) => {
  const { open } = fixture(t);
  const store = open({
    beforeStep: (step) => {
      if (step === 'before-derived') throw new Error('boom');
    },
  });
  assert.throws(() =>
    store.add({ kind: 'fact', abstract: 'accounted but no manifest', body: '', evidence_level: 'observed' }, { author: 'human' }),
  );
  const reopened = open();
  assert.equal(reopened.stats().active, 1);
  assert.equal(reopened.recall('accounted').hits.length, 1);
});

test('a truncated journal is detected against the manifest and blocks writes', (t) => {
  const { home, store, open } = fixture(t);
  store.add({ kind: 'fact', abstract: 'first', body: '', evidence_level: 'observed' }, { author: 'human' });
  store.add({ kind: 'fact', abstract: 'second', body: '', evidence_level: 'observed' }, { author: 'human' });

  const file = join(home, '.state', 'journal', '0001.jsonl');
  const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
  writeFileSync(file, `${lines.slice(0, -1).join('\n')}\n`);

  const reopened = open();
  const diagnostics = reopened.diagnostics();
  assert.ok(diagnostics.issues.some((issue) => /manifest|truncat/i.test(issue)));
  assert.throws(
    () => reopened.add({ kind: 'fact', abstract: 'third', body: '', evidence_level: 'observed' }, { author: 'human' }),
    (error: unknown) => error instanceof MemoryStoreError && error.code === 'CONFLICT',
  );
  // Rebuild must not paper over the damage by rewriting journal_head.
  assert.throws(
    () => reopened.rebuild(),
    (error: unknown) => error instanceof MemoryStoreError && /repair it before rebuild/.test(error.message),
  );
});

test('valid_from and as-of recall follow the interval', (t) => {
  const { store } = fixture(t);
  const old = store.add(
    { kind: 'fact', abstract: 'old fact about widgets', body: '', valid_from: '2026-01-01', evidence_level: 'observed' },
    { author: 'human' },
  );
  const now = store.add(
    { kind: 'fact', abstract: 'current fact about widgets', body: '', evidence_level: 'observed' },
    { author: 'human' },
  );

  assert.deepEqual(store.recall('widgets', { asOf: '2026-01-05' }).hits.map((hit) => hit.id), [old.id]);
  // The first fact has no `valid_until` and no successor, so it stays active;
  // recall orders the newer valid_from first.
  assert.deepEqual(store.recall('widgets', { asOf: '2026-10-17' }).hits.map((hit) => hit.id), [now.id, old.id]);
});

test('a pitfall needs a signature and inferred content is refused', (t) => {
  const { store } = fixture(t);
  assert.throws(
    () => store.add({ kind: 'pitfall', abstract: 'no signature', body: '', evidence_level: 'observed' }, { author: 'human' }),
    /at least one error_signatures/,
  );
  assert.throws(
    () =>
      store.add(
        { kind: 'fact', abstract: 'inferred', body: '', evidence_level: 'inferred' as never },
        { author: 'human' },
      ),
    /must go through a proposal/,
  );
});

test('a hand-edited accounted file is quarantined', (t) => {
  const { home, store, open } = fixture(t);
  const written = store.add(
    { kind: 'fact', abstract: 'original', body: 'body', evidence_level: 'observed' },
    { author: 'human' },
  );
  const file = join(home, 'memories', 'fact', `${written.id}.md`);
  writeFileSync(file, readFileSync(file, 'utf8').replace('original', 'tampered'));

  const reopened = open();
  assert.equal(reopened.stats().quarantined, 1);
  assert.equal(reopened.recall('tampered').hits.length, 0);
});

test('cleanup helper is safe when the home never existed', (t) => {
  const home = tempHome();
  rmSync(home, { recursive: true, force: true });
  cleanupHome(home);
  t.after(() => cleanupHome(home));
});
