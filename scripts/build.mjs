import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Build with esbuild's native binary.
 *
 * The JS API of esbuild talks to the binary over pipes, which sandboxed
 * sessions cannot open; invoking the binary directly with inherited stdio
 * works everywhere and keeps the script dependency-free at build time.
 */

const root = resolve(import.meta.dirname, '..');
const { platform, arch } = process;
const binary = join(
  root,
  'node_modules',
  '@esbuild',
  `${platform}-${arch}`,
  platform === 'win32' ? 'esbuild.exe' : 'esbuild',
);

if (!existsSync(binary)) {
  console.error(`esbuild binary not found at ${binary}`);
  console.error('run `npm install` (dependencies are dev-only; runtime has none)');
  process.exit(1);
}

const targets = [
  ['packages/core/src/index.ts', 'dist/core/index.mjs'],
  ['packages/dsh/src/plugin.ts', 'packages/dsh/dist/plugin.mjs'],
  ['packages/cli/src/main.ts', 'dist/cli/main.mjs'],
];

for (const [entry, outfile] of targets) {
  const result = spawnSync(
    binary,
    [
      entry,
      '--bundle',
      '--format=esm',
      '--platform=node',
      '--target=node24',
      '--sourcemap',
      '--log-level=warning',
      `--outfile=${outfile}`,
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error !== undefined) {
    console.error(`failed to run esbuild: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`build failed for ${entry}`);
    process.exit(result.status ?? 1);
  }
  console.log(`built ${outfile}`);
}
