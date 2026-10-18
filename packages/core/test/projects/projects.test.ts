import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initStore } from '../../src/init.ts';
import { createProject, listProjects, ProjectError } from '../../src/projects/projects.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

test('S19.4 projects are user-created, persisted and unique by name', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });

  assert.deepEqual(listProjects(home), []);
  assert.equal(existsSync(join(home, 'projects.json')), true);

  const created = createProject({ home, name: 'Agent Memory', description: 'DSH plugin' });
  assert.equal(created.name, 'Agent Memory');
  assert.equal(created.description, 'DSH plugin');
  assert.deepEqual(listProjects(home).map((project) => project.name), ['Agent Memory']);

  assert.throws(
    () => createProject({ home, name: 'agent memory' }),
    (error: unknown) => error instanceof ProjectError && error.code === 'EXISTS',
  );
  assert.throws(
    () => createProject({ home, name: 'bad/name' }),
    (error: unknown) => error instanceof ProjectError && error.code === 'INVALID',
  );

  const raw = readFileSync(join(home, 'projects.json'), 'utf8');
  assert.match(raw, /"schema": 1/);
  assert.deepEqual(listProjects(home).map((project) => project.name), ['Agent Memory']);
});

test('S19.5 a malformed projects.json refuses rather than guessing', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const file = join(home, 'projects.json');
  writeFileSync(file, '{"schema":2,"projects":[]}');
  assert.throws(
    () => listProjects(home),
    (error: unknown) => error instanceof ProjectError && error.code === 'INVALID',
  );
});
