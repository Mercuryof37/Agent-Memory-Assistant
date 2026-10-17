import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initStore } from '../../src/init.ts';
import { loadConfig } from '../../src/config/load.ts';
import { MemoryStore, MemoryStoreError } from '../../src/store/store.ts';
import { serializeMemory } from '../../src/model/frontmatter.ts';
import { StartupError } from '../../src/errors.ts';
import { assertSafeHome } from '../../src/paths.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

function fixture(t: { after: (fn: () => void) => void }): { home: string; store: MemoryStore; open: () => MemoryStore } {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const { config } = loadConfig({ home });
  const open = () => new MemoryStore({ home, config });
  return { home, store: open(), open };
}

function plantFile(home: string, id: string, abstract: string): string {
  const dir = join(home, 'memories', 'fact');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.md`);
  writeFileSync(
    file,
    serializeMemory({
      id,
      mem_schema: 1,
      kind: 'fact',
      scope: 'local',
      abstract,
      created_at: '2026-10-17T00:00:00+00:00',
      valid_from: '2026-10-17',
      valid_until: null,
      supersedes: [],
      author: 'human',
      evidence_level: 'user_explicit',
      error_signatures: [],
      provenance: [],
      body: `${abstract} body\n`,
    }),
  );
  return file;
}

test('S2b.1 a planted file is quarantined until adopted', (t) => {
  const { home, open } = fixture(t);
  const id = 'mem-20261017-0000beef';
  plantFile(home, id, 'hand planted');

  const before = open();
  assert.equal(before.stats().quarantined, 1);
  assert.equal(before.recall('planted').hits.length, 0);
  assert.throws(() => before.read(id), (error: unknown) => error instanceof MemoryStoreError && error.code === 'NOT_FOUND');

  before.adopt(id);
  const after = open();
  assert.equal(after.stats().quarantined, 0);
  assert.equal(after.stats().active, 1);
  assert.equal(after.recall('planted').hits[0]?.id, id);
});

test('S2b.1 adopting a hand-edited accounted file re-accounts its new hash', (t) => {
  const { home, store, open } = fixture(t);
  const written = store.add(
    { kind: 'fact', abstract: 'original abstract', body: 'original body', evidence_level: 'observed' },
    { author: 'human' },
  );
  const file = join(home, 'memories', 'fact', `${written.id}.md`);
  writeFileSync(file, readFileSync(file, 'utf8').replace('original abstract', 'edited abstract'));

  const broken = open();
  assert.equal(broken.stats().quarantined, 1);
  broken.adopt(written.id);
  assert.equal(broken.recall('edited').hits[0]?.abstract, 'edited abstract');
});

test('S2b.1 adopting an unparseable file fails loudly and stays quarantined', (t) => {
  const { home, open } = fixture(t);
  const id = 'mem-20261017-0000dead';
  const dir = join(home, 'memories', 'fact');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.md`), 'not a memory file\n');

  const store = open();
  assert.throws(() => store.adopt(id), (error: unknown) => error instanceof MemoryStoreError && error.code === 'INVALID');
  assert.equal(store.stats().quarantined, 1);
});

test('S2b.2 one corrupt file does not hide the others and recall warns', (t) => {
  const { home, store, open } = fixture(t);
  const first = store.add(
    { kind: 'fact', abstract: 'alpha survives', body: 'alpha body', evidence_level: 'observed' },
    { author: 'human' },
  );
  store.add({ kind: 'fact', abstract: 'beta corrupt', body: 'beta body', evidence_level: 'observed' }, { author: 'human' });
  const beta = store.active().find((doc) => doc.abstract === 'beta corrupt');
  assert.ok(beta);
  const betaFile = join(home, 'memories', 'fact', `${beta.id}.md`);
  writeFileSync(betaFile, '---\nid: broken\n---\n');

  const reopened = open();
  assert.equal(reopened.stats().quarantined, 1);
  const result = reopened.recall('alpha');
  assert.deepEqual(result.hits.map((hit) => hit.id), [first.id]);
  assert.ok(result.warnings.length > 0);
});

test('S2b.4 a delete ends validity but keeps the file readable', (t) => {
  const { store, open } = fixture(t);
  const written = store.add(
    { kind: 'fact', abstract: 'to be deleted', body: 'still here', evidence_level: 'observed' },
    { author: 'human' },
  );

  store.remove(written.id, { reason: 'superseded by a plan rewrite' });
  const reopened = open();
  assert.equal(reopened.stats().active, 0);
  assert.equal(reopened.recall('deleted').hits.length, 0);
  assert.equal(reopened.read(written.id).abstract, 'to be deleted');
  assert.equal(reopened.rebuild().journal_consistent, true);

  assert.throws(
    () => reopened.remove(written.id, { reason: 'again' }),
    (error: unknown) => error instanceof MemoryStoreError && error.code === 'CONFLICT',
  );
  assert.throws(
    () => reopened.remove('mem-20260101-00000000', { reason: 'missing' }),
    (error: unknown) => error instanceof MemoryStoreError && error.code === 'NOT_FOUND',
  );
});

test('S2b.5 a copied store rebuilds to the same active set', (t) => {
  const { home, store } = fixture(t);
  const a = store.add({ kind: 'fact', abstract: 'backup alpha', body: '', evidence_level: 'observed' }, { author: 'human' });
  const b = store.add({ kind: 'fact', abstract: 'backup beta', body: '', evidence_level: 'observed' }, { author: 'human' });
  const copy = mkdtempSync(join(tmpdir(), 'agent-memory-backup-'));
  t.after(() => rmSync(copy, { recursive: true, force: true }));
  cpSync(home, copy, { recursive: true });

  const { config } = loadConfig({ home: copy });
  const restored = new MemoryStore({ home: copy, config });
  const report = restored.rebuild();
  assert.equal(report.journal_consistent, true);
  assert.deepEqual(
    restored.active().map((doc) => doc.id).sort(),
    [a.id, b.id].sort(),
  );
  assert.equal(report.journal_head?.seq, 2);
});

test('S2b.3 reserved device names and bad segments are refused', () => {
  const base = mkdtempSync(join(tmpdir(), 'agent-memory-paths-'));
  try {
    assert.throws(
      () => assertSafeHome(join(base, 'CON')),
      (error: unknown) => error instanceof StartupError && error.code === 'HOME_INVALID',
    );
    assert.throws(
      () => assertSafeHome(join(base, 'nul.txt')),
      (error: unknown) => error instanceof StartupError && error.code === 'HOME_INVALID',
    );
    assert.throws(
      () => assertSafeHome(join(base, 'bad:name')),
      (error: unknown) => error instanceof StartupError && error.code === 'HOME_INVALID',
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('S2b.3 spaces, Chinese and long paths work end to end', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'agent-memory-paths-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const long = 'a'.repeat(150);
  const home = join(base, '记忆 空间', long.slice(0, 120), long.slice(0, 60), 'memory');
  initStore({ home });
  const { config } = loadConfig({ home });
  const store = new MemoryStore({ home, config });
  const written = store.add(
    { kind: 'fact', abstract: 'unicode path works', body: 'ok', evidence_level: 'observed' },
    { author: 'human' },
  );
  assert.equal(new MemoryStore({ home, config }).read(written.id).abstract, 'unicode path works');
});

test('S2b.3 a traversal-shaped id is never a path', (t) => {
  const { store } = fixture(t);
  assert.throws(
    () => store.read('../../SOUL.md'),
    (error: unknown) => error instanceof MemoryStoreError && error.code === 'NOT_FOUND',
  );
});
