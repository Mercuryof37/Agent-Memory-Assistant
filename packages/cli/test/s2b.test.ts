import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/main.ts';
import { initStore } from '../../core/src/init.ts';
import { serializeMemory } from '../../core/src/model/frontmatter.ts';
import { cleanupHome, tempHome } from '../../core/test/helpers.ts';

interface Captured {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function mem(argv: string[]): Promise<Captured> {
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

function homeFor(t: { after: (fn: () => void) => void }): string {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  return home;
}

async function addFact(home: string, abstract: string, body = ''): Promise<string> {
  const result = await mem(['add', '--home', home, '--abstract', abstract, '--body', body]);
  assert.equal(result.code, 0, result.stderr);
  const id = /added (mem-\d{8}-[0-9a-f]{8})/.exec(result.stdout)?.[1];
  assert.ok(id);
  return id;
}

test('S2b.1 doctor returns 4 on a planted file and adopt fixes it', async (t) => {
  const home = homeFor(t);
  const id = 'mem-20261017-0000cafe';
  const dir = join(home, 'memories', 'fact');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.md`),
    serializeMemory({
      id,
      mem_schema: 1,
      kind: 'fact',
      scope: 'local',
      abstract: 'planted via cli',
      created_at: '2026-10-17T00:00:00+00:00',
      valid_from: '2026-10-17',
      valid_until: null,
      supersedes: [],
      author: 'human',
      evidence_level: 'user_explicit',
      error_signatures: [],
      provenance: [],
      body: 'planted\n',
    }),
  );

  const before = await mem(['doctor', '--home', home]);
  assert.equal(before.code, 4);
  assert.match(before.stdout, new RegExp(id));
  assert.match(before.stderr, /parsed|quarantined|adopt/i);

  const adopted = await mem(['adopt', id, '--home', home]);
  assert.equal(adopted.code, 0, adopted.stderr);
  assert.match(adopted.stdout, new RegExp(id));

  const after = await mem(['doctor', '--home', home]);
  assert.equal(after.code, 0);
  assert.equal((await mem(['recall', 'planted', '--home', home])).stdout.includes(id), true);
});

test('S2b.4 delete via CLI keeps read working and hides the memory from recall', async (t) => {
  const home = homeFor(t);
  const id = await addFact(home, 'cli delete target', 'delete body');

  const deleted = await mem(['delete', id, '--reason', 'smoke cleanup', '--home', home]);
  assert.equal(deleted.code, 0, deleted.stderr);

  assert.equal((await mem(['recall', 'delete', '--home', home])).stdout.includes('no matches'), true);
  const read = await mem(['read', id, '--home', home]);
  assert.equal(read.code, 0);
  assert.match(read.stdout, /cli delete target/);

  const again = await mem(['delete', id, '--reason', 'again', '--home', home]);
  assert.equal(again.code, 2);
  assert.match(again.stderr, /already deleted/);

  const missing = await mem(['delete', 'mem-20260101-00000000', '--reason', 'x', '--home', home]);
  assert.equal(missing.code, 2);
});

test('S2b.3 init refuses a reserved Windows name and traversal ids', async (t) => {
  const home = homeFor(t);
  const reserved = await mem(['init', '--home', join(home, 'CON')]);
  assert.equal(reserved.code, 2);
  assert.match(reserved.stderr, /reserved Windows name/);

  const traversal = await mem(['read', '../../SOUL.md', '--home', home]);
  assert.equal(traversal.code, 2);
  assert.match(traversal.stderr, /no memory with id/);
});
