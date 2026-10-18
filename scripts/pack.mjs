#!/usr/bin/env node
/**
 * Build the host/client plugin and produce an installable tarball:
 *   release/agent-memory-dsh-<version>.tgz
 *
 * The tarball is what Settings → Plugins (or `dsh plugin add`) consumes.
 * Publishing to npm is a separate, later step.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const releaseDir = join(root, 'release');

execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });
mkdirSync(releaseDir, { recursive: true });

// Resolve npm portably: `npm run pack` exports npm_execpath; a direct call
// falls back to the npm on PATH (Linux CI) or npm.cmd (Windows).
const npmCli = process.env.npm_execpath;
const packageDir = join(root, 'packages', 'dsh');
const pack = () => {
  if (npmCli !== undefined && existsSync(npmCli)) {
    execFileSync(process.execPath, [npmCli, 'pack', packageDir, '--pack-destination', releaseDir], { stdio: 'inherit' });
    return;
  }
  if (process.platform === 'win32') {
    execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `npm pack "${packageDir}" --pack-destination "${releaseDir}"`], { stdio: 'inherit' });
    return;
  }
  execFileSync('npm', ['pack', packageDir, '--pack-destination', releaseDir], { stdio: 'inherit' });
};
pack();

const tarballs = readdirSync(releaseDir)
  .filter((name) => name.startsWith('agent-memory-dsh-') && name.endsWith('.tgz'))
  .map((name) => join(releaseDir, name))
  .sort();
const tarball = tarballs[tarballs.length - 1];
if (tarball === undefined || !existsSync(tarball)) {
  console.error('pack: no tarball was produced');
  process.exit(1);
}

// The tarball must carry both halves plus the bundle patch; a missing piece
// would install "successfully" and then fail on restart.
const required = ['package/dist/plugin.mjs', 'package/client/client.js', 'package/cordis.patch.yml'];
try {
  const listing = execFileSync('tar', ['-tf', tarball], { encoding: 'utf8' });
  const missing = required.filter((entry) => !listing.includes(entry));
  if (missing.length > 0) {
    console.error(`pack: tarball is missing ${missing.join(', ')}`);
    process.exit(1);
  }
} catch (error) {
  console.warn(`pack: skipped tarball content check (${error instanceof Error ? error.message : String(error)})`);
}

console.log(`pack: ${tarball}`);
console.log('install: Settings → Plugins → Install from file, or `dsh plugin add <tarball>`');
