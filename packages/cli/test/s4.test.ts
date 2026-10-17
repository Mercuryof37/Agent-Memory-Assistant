import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/main.ts';
import { initStore } from '../../core/src/init.ts';
import { loadConfig } from '../../core/src/config/load.ts';
import { MemoryStore } from '../../core/src/store/store.ts';
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

test('S4.6 CLI recall and the store return the same ids for the same query', async (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const config = loadConfig({ home }).config;
  const store = new MemoryStore({ home, config });
  store.add({ kind: 'fact', abstract: 'CLI parity fact about windows', body: '', evidence_level: 'observed' }, { author: 'human' });

  const cli = await mem(['recall', 'windows', '--home', home, '--json']);
  assert.equal(cli.code, 0, cli.stderr);
  const cliIds = (JSON.parse(cli.stdout) as { hits: { id: string }[] }).hits.map((hit) => hit.id).sort();
  const storeIds = store.recall('windows').hits.map((hit) => hit.id).sort();
  assert.deepEqual(cliIds, storeIds);
});

test('S4.5 adopt runs the same scanner as add', async (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const config = loadConfig({ home }).config;
  const store = new MemoryStore({ home, config });

  const id = 'mem-20261017-0000f00d';
  const dir = join(home, 'memories', 'fact');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.md`),
    [
      '---',
      `id: "${id}"`,
      'mem_schema: 1',
      'kind: "fact"',
      'scope: "local"',
      'abstract: "token sk-abcdefghijklmnop1234"',
      'created_at: "2026-10-17T00:00:00+00:00"',
      'valid_from: "2026-10-17"',
      'valid_until: null',
      'supersedes: []',
      'author: "human"',
      'evidence_level: "observed"',
      'error_signatures: []',
      'provenance: []',
      '---',
      'body',
    ].join('\n'),
  );
  assert.throws(() => store.adopt(id), /adopt rejected by scan: credentials@abstract/);
});
