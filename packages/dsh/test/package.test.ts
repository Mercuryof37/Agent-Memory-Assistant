import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_VERSION } from '../src/update.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));

test('S18.1 the published package is public, versioned and complete', () => {
  assert.equal(pkg.name, '@agent_memory/dsh');
  assert.equal(pkg.private, false);
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.version, '0.5.4');
  assert.equal(PLUGIN_VERSION, pkg.version);
  assert.equal(pkg.publishConfig?.access, 'public');
  for (const file of ['dist', 'client/client.js', 'cordis.patch.yml', 'README.md', 'LICENSE']) {
    assert.ok(pkg.files?.includes(file), `files must include ${file}`);
  }
  assert.match(pkg.repository?.url ?? '', /Agent-Memory-Assistant/);
});

test('S18.2 release tooling, changelog and one-click setup exist', () => {
  const setup = readFileSync(join(root, 'scripts', 'setup.mjs'), 'utf8');
  assert.match(setup, /--revert/);
  assert.match(setup, /runPnpm\(profile, \['add'/);
  assert.match(setup, /\.backups/);

  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /\[0\.2\.0\]/);

  const workflow = readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(workflow, /npm publish/);
  assert.match(workflow, /--provenance/);
});
