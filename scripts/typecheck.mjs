import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * `tsc --noEmit -p tsconfig.json`, spawned from Node rather than npm so it also
 * runs in sandboxed sessions (`npm run` cannot spawn a shell there).
 */

const root = resolve(import.meta.dirname, '..');
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

if (!existsSync(tsc)) {
  console.error(`typescript is not installed (${tsc} is missing)`);
  console.error('run `npm install` first');
  process.exit(1);
}

const result = spawnSync(process.execPath, [tsc, '--noEmit', '-p', 'tsconfig.json'], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error !== undefined) {
  console.error(`failed to start tsc: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
