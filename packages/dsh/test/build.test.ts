import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * S3.6 bundle contract: `dist/plugin.mjs` is a self-contained host bundle.
 *
 * The desktop profile links the repo, and the host resolves no node_modules for
 * a linked plugin, so the bundle must not import anything at load time and must
 * export exactly the Cordis surface (`apply`, `inject`, `name`).
 */

const ROOT = resolve(import.meta.dirname, '../../..');
const DIST = join(ROOT, 'packages', 'dsh', 'dist', 'plugin.mjs');

test('S3.6 the built bundle has no third-party imports and exports the Cordis surface', () => {
  assert.ok(existsSync(DIST), 'run `node scripts/build.mjs` first');
  const text = readFileSync(DIST, 'utf8');
  // S4 bundles the core store into the plugin, so node builtins are expected;
  // third-party imports would break the linked plugin (no node_modules lookup).
  assert.doesNotMatch(text, /from\s+["'](?!node:)[^"']+["']/);
  assert.match(text, /function apply\(ctx\)/);
  assert.match(text, /export\s*\{[^}]*apply[^}]*\}/s);
  assert.match(text, /export\s*\{[^}]*inject[^}]*\}/s);
});
