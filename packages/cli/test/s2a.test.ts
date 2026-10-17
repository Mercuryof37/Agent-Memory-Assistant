import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/main.ts';
import { initStore } from '../../core/src/init.ts';
import { cleanupHome, tempHome } from '../../core/test/helpers.ts';

interface Captured {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function mem(argv: string[], env: Record<string, string | undefined> = {}): Promise<Captured> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    env,
    cwd: process.cwd(),
  });
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}

function homeFor(t: { after: (fn: () => void) => void }): string {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  return home;
}

test('S2a.1 CLI journey: add -> read -> recall -> rebuild -> doctor', async (t) => {
  const home = homeFor(t);

  const added = await mem(['add', '--home', home, '--abstract', 'alpha deploy uses blue-green', '--body', 'proxy switch']);
  assert.equal(added.code, 0);
  const id = /added (mem-\d{8}-[0-9a-f]{8})/.exec(added.stdout)?.[1];
  assert.ok(id);

  const read = await mem(['read', id, '--home', home]);
  assert.equal(read.code, 0);
  assert.match(read.stdout, /alpha deploy uses blue-green/);
  assert.match(read.stdout, /proxy switch/);

  const recall = await mem(['recall', 'blue-green', '--home', home]);
  assert.equal(recall.code, 0);
  assert.match(recall.stdout, new RegExp(id));

  const rebuilt = await mem(['rebuild', '--home', home]);
  assert.equal(rebuilt.code, 0);
  assert.match(rebuilt.stdout, /records: 1/);

  const doctor = await mem(['doctor', '--home', home, '--json']);
  assert.equal(doctor.code, 0);
  const summary = JSON.parse(doctor.stdout) as {
    stats: { active: number; deleted: number; journal_head: { seq: number } | null };
  };
  assert.equal(summary.stats.active, 1);
  assert.equal(summary.stats.deleted, 0);
  assert.equal(summary.stats.journal_head?.seq, 1);

  const second = await mem(['add', '--home', home, '--abstract', 'alpha deploy uses blue-green', '--body', 'proxy switch']);
  assert.equal(second.code, 0);
  assert.match(second.stdout, /existing/);
});

test('CLI refuses bad input loudly', async (t) => {
  const home = homeFor(t);

  const missing = await mem(['add', '--home', home]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /--abstract/);

  const kind = await mem(['add', '--home', home, '--abstract', 'x', '--kind', 'note']);
  assert.equal(kind.code, 1);
  assert.match(kind.stderr, /--kind/);

  const pitfall = await mem(['add', '--home', home, '--abstract', 'x', '--kind', 'pitfall']);
  assert.equal(pitfall.code, 2);
  assert.match(pitfall.stderr, /error_signatures/);

  const read = await mem(['read', 'mem-20260101-deadbeef', '--home', home]);
  assert.equal(read.code, 2);
  assert.match(read.stderr, /no memory with id/);
});

test('recall reports no matches and --limit is validated', async (t) => {
  const home = homeFor(t);
  await mem(['add', '--home', home, '--abstract', 'only one fact', '--body', '']);

  const none = await mem(['recall', 'absent', '--home', home]);
  assert.equal(none.code, 0);
  assert.match(none.stdout, /no matches/);

  const badLimit = await mem(['recall', 'one', '--home', home, '--limit', '0']);
  assert.equal(badLimit.code, 1);
  assert.match(badLimit.stderr, /--limit/);
});
