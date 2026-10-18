import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Install the local Agent Memory bundle into the desktop profile.
 *
 * The desktop profile is managed by the Electron app, so this script only does
 * what the plugin page would do: declare a `link:` dependency, append the
 * bundle, install, and verify the linked package exists. It always backs up
 * first and restores on failure. Run it in a normal shell (the DSH sandbox
 * cannot write outside the workspace).
 *
 *   node scripts/install-desktop-plugin.mjs            # dry run
 *   node scripts/install-desktop-plugin.mjs --apply    # apply
 *   node scripts/install-desktop-plugin.mjs --revert   # restore backup
 */

const apply = process.argv.includes('--apply');
const revert = process.argv.includes('--revert');
const profile = join(homedir(), '.dsh', 'profiles', 'desktop');
const pkgPath = join(profile, 'package.json');
const backupPath = join(profile, 'package.json.bak-agent-memory');
const patchPath = join(profile, 'cordis.patch.yml');
const patchBackupPath = join(profile, 'cordis.patch.yml.bak-agent-memory');
const pluginRoot = resolve(import.meta.dirname, '..', 'packages', 'dsh');
const dependency = 'link:' + pluginRoot;
const bundleName = '@agent_memory/dsh';
const pnpm = 'D:\\DeepSeekHarness\\resources\\runtime\\primary-runtime\\dependencies\\pnpm\\bin\\pnpm.cjs';

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

if (!existsSync(pkgPath)) fail(`profile package.json not found: ${pkgPath}`);
if (!existsSync(join(pluginRoot, 'dist', 'plugin.mjs'))) {
  fail(`plugin build missing; run "npm run build" first (${join(pluginRoot, 'dist', 'plugin.mjs')})`);
}
if (!existsSync(pnpm)) fail(`pnpm not found at ${pnpm}`);

const original = readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(original);
pkg.dependencies ??= {};
pkg.dsh ??= {};
pkg.dsh.profile ??= {};
pkg.dsh.profile.bundles ??= [];

if (revert) {
  if (!existsSync(backupPath)) fail(`no backup at ${backupPath}`);
  copyFileSync(backupPath, pkgPath);
  if (existsSync(patchBackupPath)) copyFileSync(patchBackupPath, patchPath);
  console.log(`restored ${pkgPath}`);
  install();
  process.exit(0);
}

const hadDependency = pkg.dependencies[bundleName];
const hadBundle = pkg.dsh.profile.bundles.includes(bundleName);

pkg.dependencies[bundleName] = dependency;
if (!hadBundle) pkg.dsh.profile.bundles.push(bundleName);

console.log(`profile   ${profile}`);
console.log(`plugin    ${pluginRoot}`);
console.log(`dependency ${hadDependency ? `(replace ${hadDependency})` : '(add)'} -> ${dependency}`);
console.log(`bundle     ${hadBundle ? '(already present)' : '(append)'} -> ${bundleName}`);
console.log(`bundles    ${JSON.stringify(pkg.dsh.profile.bundles)}`);

if (!apply) {
  console.log('\ndry run; re-run with --apply to write and install');
  process.exit(0);
}

copyFileSync(pkgPath, backupPath);
if (existsSync(patchPath)) copyFileSync(patchPath, patchBackupPath);
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
console.log(`\nwritten ${pkgPath}\nbackup  ${backupPath}`);

function install() {
  console.log(`\n$ pnpm install (cwd=${profile})`);
  const result = spawnSync(process.execPath, [pnpm, 'install'], { cwd: profile, stdio: 'inherit' });
  if (result.error !== undefined) fail(`failed to start pnpm: ${result.error.message}`);
  if (result.status !== 0) fail(`pnpm install exited with ${result.status}`);
  const installed = join(profile, 'node_modules', '@agent-memory', 'dsh', 'package.json');
  if (!existsSync(installed)) fail(`linked package not found after install: ${installed}`);
  console.log(`\nlinked   ${installed}`);
  console.log('restart the DSH desktop app, then run the M1-M4 checks in docs/ops.md §6.2');
}

install();
