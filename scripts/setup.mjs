#!/usr/bin/env node
/**
 * One-click installer for the Agent Memory DSH plugin.
 *
 *   node scripts/setup.mjs                 # dry run: show the plan
 *   node scripts/setup.mjs --apply         # install the newest release tgz
 *   node scripts/setup.mjs --tgz <file> --apply
 *   node scripts/setup.mjs --revert <backupDir>
 *
 * The desktop profile is owned by the Electron app, so this script does what
 * the plugin page does: back up the profile, add the tarball with pnpm, append
 * the bundle to `dsh.profile.bundles`, and verify the installed package.
 * Run it in a normal shell; the DSH sandbox cannot write outside the workspace.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

const apply = has('--apply');
const revertDir = valueOf('--revert');
const profile = resolve(valueOf('--profile') ?? join(homedir(), '.dsh', 'profiles', 'desktop'));
const bundleName = '@agent-memory/dsh';

function fail(message) {
  console.error(`setup: ${message}`);
  process.exit(1);
}

function pnpmBinary() {
  const candidates = [
    process.env.DSH_PNPM,
    'D:\\DeepSeekHarness\\resources\\runtime\\primary-runtime\\dependencies\\pnpm\\bin\\pnpm.cjs',
    'pnpm',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes('\\') || candidate.includes('/')) {
      if (existsSync(candidate)) return candidate;
    } else {
      return candidate;
    }
  }
  return undefined;
}

function runPnpm(cwd, pnpmArgs) {
  const binary = pnpmBinary();
  if (binary === undefined) fail('pnpm not found; set DSH_PNPM to the pnpm entry point');
  const result = spawnSync(process.execPath, [binary, ...pnpmArgs], { cwd, stdio: 'inherit' });
  if (result.error) fail(`pnpm failed: ${result.error.message}`);
  if (result.status !== 0) fail(`pnpm ${pnpmArgs.join(' ')} failed with code ${result.status}`);
}

function newestTarball() {
  const releaseDir = join(root, 'release');
  if (!existsSync(releaseDir)) return undefined;
  const candidates = readdirSync(releaseDir)
    .filter((name) => name.startsWith('agent-memory-dsh-') && name.endsWith('.tgz'))
    .sort();
  return candidates.length === 0 ? undefined : join(releaseDir, candidates.at(-1));
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function main() {
  const pkgPath = join(profile, 'package.json');
  if (!existsSync(pkgPath)) fail(`profile not found: ${pkgPath} (set --profile)`);

  if (revertDir !== undefined) {
    const backup = resolve(revertDir);
    for (const name of ['package.json', 'cordis.patch.yml', 'pnpm-lock.yaml']) {
      const source = join(backup, name);
      if (existsSync(source)) copyFileSync(source, join(profile, name));
    }
    console.log(`setup: restored profile files from ${backup}`);
    runPnpm(profile, ['install']);
    console.log('setup: restart DSH to load the previous state');
    return;
  }

  const tgz = resolve(valueOf('--tgz') ?? newestTarball() ?? join(root, 'release', 'missing.tgz'));
  if (!existsSync(tgz)) fail(`tarball not found: ${tgz} (run "npm run pack" first)`);

  const pkg = readJson(pkgPath);
  pkg.dependencies ??= {};
  pkg.dsh ??= {};
  pkg.dsh.profile ??= {};
  pkg.dsh.profile.bundles ??= [];
  const hadDependency = pkg.dependencies[bundleName];
  const hasBundle = pkg.dsh.profile.bundles.includes(bundleName);

  console.log(`setup: profile   ${profile}`);
  console.log(`setup: tarball   ${tgz}`);
  console.log(`setup: dependency ${hadDependency ? `(replace ${hadDependency})` : '(add)'} -> file:${basename(tgz)}`);
  console.log(`setup: bundle     ${hasBundle ? '(already present)' : '(append)'} -> ${bundleName}`);

  if (!apply) {
    console.log('\nsetup: dry run; re-run with --apply to install');
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(profile, '.backups', `agent-memory-${stamp}`);
  mkdirSync(backupDir, { recursive: true });
  for (const name of ['package.json', 'cordis.patch.yml', 'pnpm-lock.yaml']) {
    const source = join(profile, name);
    if (existsSync(source)) copyFileSync(source, join(backupDir, name));
  }
  console.log(`setup: backup    ${backupDir}`);

  runPnpm(profile, ['add', tgz]);
  const installedPkg = join(profile, 'node_modules', bundleName, 'package.json');
  if (!existsSync(installedPkg)) fail(`installed package missing at ${installedPkg}`);

  const nextPkg = readJson(pkgPath);
  nextPkg.dependencies ??= {};
  nextPkg.dsh ??= {};
  nextPkg.dsh.profile ??= {};
  nextPkg.dsh.profile.bundles ??= [];
  nextPkg.dependencies[bundleName] = `file:${tgz.replace(/\\/g, '/')}`;
  if (!nextPkg.dsh.profile.bundles.includes(bundleName)) {
    nextPkg.dsh.profile.bundles.push(bundleName);
  }
  writeFileSync(pkgPath, `${JSON.stringify(nextPkg, null, 2)}\n`, 'utf8');

  const installed = readJson(installedPkg);
  console.log(`setup: installed ${installed.name}@${installed.version}`);
  console.log('setup: restart DSH completely (not just close the window)');
  console.log(`setup: rollback  node scripts/setup.mjs --revert "${backupDir}"`);
}

main();
