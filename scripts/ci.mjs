import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * The full pre-commit gate: repository gates, then typecheck, then tests.
 * Sequential on purpose - a failing gate should be read before the next output.
 */

const root = resolve(import.meta.dirname, '..');

function run(script, env = {}) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts', script)], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  return result.status ?? 1;
}

const steps = [
  ['gates', () => run('gates.mjs')],
  ['rules-file', () => run('rules-gate.mjs')],
  ['typecheck', () => run('typecheck.mjs')],
  ['build', () => run('build.mjs')],
  ['test', () => run('test.mjs')],
];

for (const [name, step] of steps) {
  console.log(`\n== ${name} ==`);
  const status = step();
  if (status !== 0) {
    console.error(`\nci failed at: ${name}`);
    process.exit(status);
  }
}
console.log('\nci passed');
