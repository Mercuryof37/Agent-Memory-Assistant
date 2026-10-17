import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/main.ts';
import { initStore } from '../../core/src/init.ts';
import { loadConfig } from '../../core/src/config/load.ts';
import { MemoryStore } from '../../core/src/store/store.ts';
import { createProposal } from '../../core/src/proposals/proposals.ts';
import { verifyExport } from '../../core/src/ops/ops.ts';
import { cleanupHome, tempHome } from '../../core/test/helpers.ts';

async function mem(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    env: {},
    cwd: process.cwd(),
  });
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}

function fixture(t: { after: (fn: () => void) => void }): { home: string; config: ReturnType<typeof loadConfig>['config']; store: MemoryStore } {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const config = loadConfig({ home }).config;
  return { home, config, store: new MemoryStore({ home, config }) };
}

test('S7.1 export -> rebuild in the exported directory keeps the active set identical', async (t) => {
  const { home, config, store } = fixture(t);
  const first = store.add({ kind: 'fact', abstract: 'export alpha', body: 'a', evidence_level: 'observed' }, { author: 'human' });
  store.add({ kind: 'pitfall', abstract: 'export beta', body: 'b', evidence_level: 'observed', error_signatures: ['ERR1'] }, { author: 'human' });
  const out = join(home, '..', `${home.split(/[\\/]/).pop()}-export`);
  t.after(() => cleanupHome(out));

  const exported = await mem(['export', out, '--home', home]);
  assert.equal(exported.code, 0, exported.stderr);
  assert.equal(verifyExport(out).ok, true);

  const restored = new MemoryStore({ home: out, config });
  assert.equal(restored.rebuild().journal_consistent, true);
  assert.deepEqual(
    restored.active().map((doc) => doc.id).sort(),
    store.active().map((doc) => doc.id).sort(),
  );
  assert.ok(restored.read(first.id));
});

test('S7.2 purge removes file/manifest/catalog, leaves a tombstone, invalidates proposals', async (t) => {
  const { home, config, store } = fixture(t);
  const written = store.add({ kind: 'fact', abstract: 'purge me', body: 'b', evidence_level: 'observed' }, { author: 'human' });
  createProposal(
    { store, config },
    { op: 'delete', target: written.id, base_hash: store.read(written.id).content_hash, reason: 'old' },
  );

  const purged = await mem(['purge', written.id, '--accept', '--reason', 'test', '--home', home]);
  assert.equal(purged.code, 0, purged.stderr);

  const file = join(home, 'memories', 'fact', `${written.id}.md`);
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(join(home, 'proposals', 'pending')), true);
  assert.equal(listPending(home), 0);

  const manifest = JSON.parse(readFileSync(join(home, '.index', 'manifest.json'), 'utf8')) as { entries: { id: string }[] };
  assert.ok(!manifest.entries.some((entry) => entry.id === written.id));
  assert.doesNotMatch(readFileSync(join(home, 'MEMORY.md'), 'utf8'), /purge me/);

  const reopened = new MemoryStore({ home, config });
  const journal = reopened.journal.readAll().entries;
  assert.ok(journal.some((entry) => entry.op === 'delete' && entry.data.purged === true && entry.data.id === written.id));
  assert.throws(() => reopened.read(written.id));
});

function listPending(home: string): number {
  try {
    return readdirSync(join(home, 'proposals', 'pending')).filter((name) => name.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

test('S7.3 inspect is read-only and reports kinds, rules, journal and budget', async (t) => {
  const { home, store } = fixture(t);
  store.add({ kind: 'fact', abstract: 'inspect me', body: 'b', evidence_level: 'observed' }, { author: 'human' });

  const inspected = await mem(['inspect', '--home', home, '--json']);
  assert.equal(inspected.code, 0, inspected.stderr);
  const report = JSON.parse(inspected.stdout) as {
    active: number;
    byKind: Record<string, number>;
    journal: unknown[];
    budget: { totalChars: number };
  };
  assert.equal(report.active, 1);
  assert.equal(report.byKind.fact, 1);
  assert.ok(report.journal.length >= 1);
  assert.ok(report.budget.totalChars > 0);
});

test('S7.4 the clean-environment command surface exists', () => {
  const root = join(import.meta.dirname, '..', '..', '..');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  for (const name of ['ci', 'build', 'smoke', 'test', 'typecheck']) {
    assert.ok(typeof pkg.scripts[name] === 'string', `missing npm script ${name}`);
  }
  assert.ok(existsSync(join(root, 'scripts', 'smoke.mjs')));
});

test('S7.5 real DSH full flow (manual desktop run)', { skip: 'requires a desktop session and human steps' }, () => {});

test('S7.6 backup checksums detect a changed file and a restore passes again', async (t) => {
  const { home, store } = fixture(t);
  store.add({ kind: 'fact', abstract: 'backup me', body: 'b', evidence_level: 'observed' }, { author: 'human' });
  const out = join(home, '..', `${home.split(/[\\/]/).pop()}-backup`);
  t.after(() => cleanupHome(out));

  const exported = await mem(['pack', out, '--home', home]);
  assert.equal(exported.code, 0, exported.stderr);
  assert.equal(verifyExport(out).ok, true);

  const target = join(out, 'config.toml');
  const original = readFileSync(target);
  writeFileSync(target, `${original.toString('utf8')}\n# tampered\n`);
  assert.equal(verifyExport(out).ok, false);
  writeFileSync(target, original);
  assert.equal(verifyExport(out).ok, true);
});
