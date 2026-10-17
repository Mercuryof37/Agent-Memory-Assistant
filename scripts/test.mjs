import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Test entry point.
 *
 * `--test-isolation=none` keeps the runner in one process. Two reasons: the
 * suite is small, and sandboxed sessions cannot spawn piped children, so the
 * default per-file child would fail with EPERM. Set
 * AGENT_MEMORY_TEST_ISOLATED=1 to use Node's default file isolation.
 */

const root = resolve(import.meta.dirname, '..');
const packagesDir = join(root, 'packages');

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

const files = [];
for (const pkg of readdirSync(packagesDir)) {
  const testDir = join(packagesDir, pkg, 'test');
  if (!existsSync(testDir) || !statSync(testDir).isDirectory()) continue;
  for (const file of walk(testDir)) {
    if (file.endsWith('.test.ts')) files.push(file);
  }
}
if (files.length === 0) {
  console.error('no *.test.ts files found under packages/*/test');
  process.exit(1);
}
files.sort();

const isolation = process.env.AGENT_MEMORY_TEST_ISOLATED === '1' ? [] : ['--test-isolation=none'];
const args = ['--test', ...isolation, ...files.map((file) => relative(root, file))];
const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
if (result.error !== undefined) {
  console.error(`failed to start the test runner: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
