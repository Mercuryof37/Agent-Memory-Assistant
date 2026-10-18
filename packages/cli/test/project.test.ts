import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/main.ts';
import { initStore } from '../../core/src/init.ts';
import { listProjects } from '../../core/src/projects/projects.ts';
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

test('S19.9 CLI creates projects and assigns a memory to one', async (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });

  const addProject = await mem(['project', 'add', 'Agent Memory', '--description', 'DSH plugin', '--home', home, '--json']);
  assert.equal(addProject.code, 0, addProject.stderr);
  assert.equal(listProjects(home)[0]?.name, 'Agent Memory');

  const list = await mem(['project', 'list', '--home', home, '--json']);
  assert.equal(list.code, 0, list.stderr);
  assert.deepEqual(JSON.parse(list.stdout).projects.map((project: { name: string }) => project.name), ['Agent Memory']);

  const add = await mem([
    'add',
    '--abstract',
    'worktree groups memories by project',
    '--kind',
    'exp',
    '--project',
    'Agent Memory',
    '--tag',
    'v4,ui',
    '--home',
    home,
    '--json',
  ]);
  assert.equal(add.code, 0, add.stderr);
  const id = (JSON.parse(add.stdout) as { id: string }).id;
  const read = await mem(['read', id, '--home', home, '--json']);
  assert.equal(read.code, 0, read.stderr);
  const doc = JSON.parse(read.stdout);
  assert.equal(doc.project, 'Agent Memory');
  assert.deepEqual(doc.tags, ['v4', 'ui']);
});
