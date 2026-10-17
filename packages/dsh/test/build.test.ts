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

test('S3.6 the built bundle has no imports and exports the Cordis surface', () => {
  assert.ok(existsSync(DIST), 'run `node scripts/build.mjs` first');
  const text = readFileSync(DIST, 'utf8');
  assert.doesNotMatch(text, /^\s*import\s/m, 'bundle must not import at load time');
  assert.doesNotMatch(text, /from\s+["']node:/, 'bundle must not import node builtins');
  assert.match(text, /function apply\(ctx\)/);
  assert.match(text, /export\s*\{[^}]*apply[^}]*\}/s);
  assert.match(text, /export\s*\{[^}]*inject[^}]*\}/s);
});
