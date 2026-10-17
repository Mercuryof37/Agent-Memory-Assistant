import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from '../packages/cli/src/main.ts';
import { assemble, MemoryStore, startup } from '../packages/core/src/index.ts';

/**
 * Success path that must actually run before anyone says "done" (R4).
 *
 * This is the stage's executable specification: init, doctor, seal, and the S2a
 * journey (add -> read -> recall -> rebuild). Failure cases live in unit tests;
 * everything here must succeed.
 */

const root = resolve(import.meta.dirname, '..');
const cli = join(root, 'packages', 'cli', 'bin', 'mem.mjs');
const home = mkdtempSync(join(tmpdir(), 'agent-memory-smoke-'));

function fail(message) {
  console.error(`smoke failed: ${message}`);
  process.exit(1);
}

function mem(args) {
  console.log(`\n$ mem ${args.join(' ')}`);
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit' });
  if (result.error !== undefined) fail(`failed to run mem: ${result.error.message}`);
  if (result.status !== 0) fail(`mem ${args.join(' ')} exited with ${result.status ?? 'signal'}`);
}

async function runCli(args) {
  const out = [];
  const err = [];
  const code = await run(args, {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    env: {},
    cwd: root,
  });
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}

function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok && detail) console.error(detail);
  if (!ok) fail(name);
}

try {
  mem(['init', '--home', home]);
  mem(['doctor', '--home', home, '--json']);
  mem(['doctor', '--home', home]);
  mem(['policy', 'seal', '--home', home, '--accept']);

  console.log('\n== S2a journey ==');
  const added = await runCli(['add', '--home', home, '--abstract', 'smoke journey alpha', '--body', 'smoke body']);
  check('mem add writes one memory', added.code === 0, added.stderr);
  const id = /added (mem-\d{8}-[0-9a-f]{8})/.exec(added.stdout)?.[1];
  check('mem add prints the new id', id !== undefined, added.stdout);

  const read = await runCli(['read', id, '--home', home]);
  check('mem read returns the body', read.code === 0 && read.stdout.includes('smoke body'), read.stderr);

  const recall = await runCli(['recall', 'journey', '--home', home]);
  check('mem recall finds it', recall.code === 0 && recall.stdout.includes(id), recall.stderr);

  const rebuild = await runCli(['rebuild', '--home', home, '--json']);
  check('mem rebuild reports one record', rebuild.code === 0, rebuild.stderr);
  const report = JSON.parse(rebuild.stdout);
  check('rebuild report has records=1', report.records === 1, rebuild.stdout);

  const again = await runCli(['recall', 'journey', '--home', home]);
  check('recall still works after rebuild', again.code === 0 && again.stdout.includes(id), again.stderr);

  console.log('\n== S2b journey ==');
  const deleted = await runCli(['delete', id, '--reason', 'smoke cleanup', '--home', home]);
  check('mem delete ends validity', deleted.code === 0, deleted.stderr);

  const readAfterDelete = await runCli(['read', id, '--home', home]);
  check(
    'deleted memory is still readable',
    readAfterDelete.code === 0 && readAfterDelete.stdout.includes('smoke body'),
    readAfterDelete.stderr,
  );

  const recallAfterDelete = await runCli(['recall', 'journey', '--home', home]);
  check('deleted memory leaves recall', recallAfterDelete.stdout.includes('no matches'), recallAfterDelete.stderr);

  console.log('\n== S3 journey ==');
  const injected = await runCli(['add', '--home', home, '--abstract', 'smoke inject fact', '--body', 'inject body']);
  check('mem add writes the inject fact', injected.code === 0, injected.stderr);

  const runtime = startup({ home, env: {} });
  const store = new MemoryStore({ home, config: runtime.config });
  const first = assemble({
    home,
    config: runtime.config,
    policy: runtime.policy,
    source: store,
    sessionId: 'smoke-s3',
  });
  check('inject includes the active memory', first.text.includes('smoke inject fact'), first.text);
  check('deleted memory is not injected', !first.text.includes('smoke journey alpha'), first.text);

  const second = assemble({
    home,
    config: runtime.config,
    policy: runtime.policy,
    source: store,
    sessionId: 'smoke-s3',
  });
  check('same-session injection is byte-identical', second.text === first.text);

  console.log('\nsmoke ok');
} finally {
  rmSync(home, { recursive: true, force: true });
}
