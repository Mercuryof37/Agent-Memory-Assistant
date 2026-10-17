import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  documentedKeys,
  gateCoreNoDynamicRegex,
  gateCorePurity,
  gateDocsSchemaKeys,
  gateDshLayer,
  gateNoPaidHooks,
} from '../../../scripts/lib/gates.mjs';
import { cleanupHome, tempHome } from './helpers.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');

// Built by concatenation so this test file does not trip the very gate it tests.
const HOST_SCOPE = '@deepseek' + '-ai/';

function fixtureRoot(): string {
  const root = tempHome();
  mkdirSync(join(root, 'packages', 'core', 'src'), { recursive: true });
  mkdirSync(join(root, 'packages', 'dsh', 'src'), { recursive: true });
  return root;
}

test('the core purity gate catches a planted host import', (t) => {
  const root = fixtureRoot();
  t.after(() => cleanupHome(root));
  writeFileSync(
    join(root, 'packages', 'core', 'src', 'leak.ts'),
    `import { assemble } from '${HOST_SCOPE}dsh';\n`,
  );

  const result = gateCorePurity(root);
  assert.equal(result.ok, false);
  assert.match(result.problems.join('\n'), /leak\.ts:1/);
  assert.match(result.problems.join('\n'), /references a host package/);
});

test('the core purity gate also catches a commented mention', (t) => {
  const root = fixtureRoot();
  t.after(() => cleanupHome(root));
  writeFileSync(
    join(root, 'packages', 'core', 'src', 'comment.ts'),
    `// later: import from '${HOST_SCOPE}dsh'\nexport const x = 1;\n`,
  );
  assert.equal(gateCorePurity(root).ok, false);
});

test('the DSH layer gate catches file I/O and accepts a pure adapter', (t) => {
  const root = fixtureRoot();
  t.after(() => cleanupHome(root));

  writeFileSync(
    join(root, 'packages', 'dsh', 'src', 'bad.ts'),
    "import { readFileSync } from 'node:fs';\nexport const x = readFileSync;\n",
  );
  const failing = gateDshLayer(root);
  assert.equal(failing.ok, false);
  assert.match(failing.problems.join('\n'), /performs file I\/O/);

  writeFileSync(join(root, 'packages', 'dsh', 'src', 'bad.ts'), "export const x = 1;\n");
  assert.equal(gateDshLayer(root).ok, true);
});

test('the docs gate compares both directions', async (t) => {
  const root = fixtureRoot();
  t.after(() => cleanupHome(root));
  mkdirSync(join(root, 'packages', 'core', 'src'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(
    join(root, 'packages', 'core', 'src', 'index.ts'),
    [
      "export function configKeys() { return ['a.one', 'a.two']; }",
      "export function policyKeys() { return ['p']; }",
      '',
    ].join('\n'),
  );
  writeFileSync(join(root, 'docs', 'config.md'), '| `a.one` | int | 1 | 1 | x |\n');
  writeFileSync(join(root, 'docs', 'policy.md'), '| `p` | int | 1 | 1 | x |\n| `q` | int | 1 | 1 | x |\n');

  const result = await gateDocsSchemaKeys(root);
  assert.equal(result.ok, false);
  assert.match(result.problems.join('\n'), /does not document config key "a\.two"/);
  assert.match(result.problems.join('\n'), /documents "q", which is not in the policy schema/);
});

test('the commercial-branch gate catches a planted marker', (t) => {
  const root = fixtureRoot();
  t.after(() => cleanupHome(root));
  const marker = 'pa' + 'id';
  writeFileSync(join(root, 'packages', 'core', 'src', 'pricing.ts'), `export const ${marker} = true;\n`);

  const failing = gateNoPaidHooks(root);
  assert.equal(failing.ok, false);
  assert.match(failing.problems.join('\n'), /mentions a .* concept/);

  writeFileSync(join(root, 'packages', 'core', 'src', 'pricing.ts'), 'export const level = 1;\n');
  assert.equal(gateNoPaidHooks(root).ok, true);
});

test('documentedKeys parses the key column only', () => {
  const keys = documentedKeys(
    ['| 键 | 类型 |', '|---|---|', '| `inject.total_max_chars` | int |', '| not a key | x |'].join('\n'),
  );
  assert.deepEqual([...keys], ['inject.total_max_chars']);
});

test('the dynamic RegExp gate catches core code outside scan/', (t) => {
  const root = fixtureRoot();
  t.after(() => cleanupHome(root));
  writeFileSync(join(root, 'packages', 'core', 'src', 'evil.ts'), "export const r = new RegExp('x');\n");
  mkdirSync(join(root, 'packages', 'core', 'src', 'scan'), { recursive: true });
  writeFileSync(join(root, 'packages', 'core', 'src', 'scan', 'allowed.ts'), "export const r = new RegExp('x');\n");

  const result = gateCoreNoDynamicRegex(root);
  assert.equal(result.ok, false);
  assert.match(result.problems.join('\n'), /evil\.ts/);
  assert.doesNotMatch(result.problems.join('\n'), /scan\/allowed\.ts/);
});

test('the real repository passes every gate', async () => {
  assert.equal(gateCorePurity(repoRoot).ok, true, gateCorePurity(repoRoot).problems.join('\n'));
  assert.equal(gateDshLayer(repoRoot).ok, true, gateDshLayer(repoRoot).problems.join('\n'));
  assert.equal(gateNoPaidHooks(repoRoot).ok, true, gateNoPaidHooks(repoRoot).problems.join('\n'));
  assert.equal(gateCoreNoDynamicRegex(repoRoot).ok, true, gateCoreNoDynamicRegex(repoRoot).problems.join('\n'));
  const docs = await gateDocsSchemaKeys(repoRoot);
  assert.equal(docs.ok, true, docs.problems.join('\n'));
});
