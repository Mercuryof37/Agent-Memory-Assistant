import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Stage gate: one command that answers "is this stage actually done?".
 *
 *   node scripts/stage.mjs S2a
 *
 * It runs the repository CI, the success-path smoke, and then checks the two
 * paperwork promises that are easy to forget: the stage ADR exists, and every
 * acceptance id (S2a.1 ... S2a.6) appears in a test name or assertion.
 */

const root = resolve(import.meta.dirname, '..');
const stage = process.argv[2] ?? 'S2a';

const ADR_NUMBER = {
  S2a: '0005',
  S2b: '0006',
  S3: '0007',
  S4: '0008',
  S6: '0009',
  S7: '0010',
};
const ACCEPTANCE_COUNT = { S2a: 6, S2b: 5, S3: 6, S4: 6, S6: 5, S7: 6 };

function fail(message) {
  console.error(`stage gate failed: ${message}`);
  process.exit(1);
}

function run(script, args = []) {
  console.log(`\n== ${script} ${args.join(' ')} ==`);
  const result = spawnSync(process.execPath, [join(root, 'scripts', script), ...args], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error !== undefined) fail(`cannot run ${script}: ${result.error.message}`);
  if (result.status !== 0) fail(`${script} exited with ${result.status}`);
}

run('ci.mjs');
run('smoke.mjs');

const adrNumber = ADR_NUMBER[stage];
if (adrNumber === undefined) fail(`unknown stage ${stage}`);

const adrDir = join(root, 'docs', 'adr');
const adr = readdirSync(adrDir).find((name) => name.startsWith(adrNumber));
if (adr === undefined) fail(`docs/adr/${adrNumber}-*.md is missing`);
console.log(`PASS  ADR exists: docs/adr/${adr}`);

function testFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...testFiles(full));
    else if (entry.isFile() && full.endsWith('.test.ts')) files.push(full);
  }
  return files;
}

const testText = ['packages/core/test', 'packages/dsh/test', 'packages/cli/test']
  .map((dir) => (existsSync(join(root, dir)) ? testFiles(join(root, dir)) : []))
  .flat()
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

const expected = ACCEPTANCE_COUNT[stage] ?? 1;
const missing = [];
for (let index = 1; index <= expected; index += 1) {
  const id = `${stage}.${index}`;
  if (!testText.includes(id)) missing.push(id);
}
if (missing.length > 0) fail(`acceptance ids missing from tests: ${missing.join(', ')}`);
console.log(`PASS  acceptance ids present: ${stage}.1 .. ${stage}.${expected}`);

run('closure.mjs', [stage]);
console.log(`\nstage ${stage} is green`);
