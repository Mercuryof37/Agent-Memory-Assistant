import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initStore } from '../src/init.ts';
import { startup } from '../src/startup.ts';
import { resolveHome } from '../src/paths.ts';
import { loadDshMemorySettings } from '../../dsh/src/settings.ts';
import { cleanupHome, expectConfigError, expectStartupError, tempHome } from './helpers.ts';

test('a missing store is a loud failure, not default settings', (t) => {
  const home = tempHome();
  rmSync(home, { recursive: true, force: true });
  const error = expectStartupError(() => startup({ home }), 'HOME_INVALID');
  assert.match(error.format(), /mem init/);
  t.after(() => cleanupHome(home));
});

test('a freshly initialised store starts with documented defaults', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });

  const runtime = startup({ home });
  assert.equal(runtime.home, home);
  assert.equal(runtime.config.inject.total_max_chars, 4000);
  assert.equal(runtime.config.storage.max_records, 1000);
  assert.equal(runtime.policy.version, 2);
  assert.equal(runtime.policy.scan.private_tag, 'confirm');
  assert.equal(runtime.configPath, join(home, 'config.toml'));
  assert.equal(runtime.warnings.length, 4);
  assert.ok(runtime.policySha256.length === 64);
});

test('an unknown config key stops startup before anything else runs', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const configPath = join(home, 'config.toml');
  writeFileSync(configPath, readFileSync(configPath, 'utf8').replace('limit = 5', 'limits = 8'));

  const error = expectConfigError(() => startup({ home }));
  assert.deepEqual(error.keys, ['recall.limits']);
  assert.match(error.format(), /recall\.limits/);
});

test('a tampered policy stops startup', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const policyPath = join(home, 'policy.json');
  writeFileSync(
    policyPath,
    readFileSync(policyPath, 'utf8').replace('"injection": "reject"', '"injection": "flag"'),
  );
  expectStartupError(() => startup({ home }), 'POLICY_MISMATCH');
});

test('config may tighten policy but never widen it', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const configPath = join(home, 'config.toml');
  writeFileSync(
    configPath,
    readFileSync(configPath, 'utf8').replace('max_records = 1000', 'max_records = 5000'),
  );

  const error = expectConfigError(() => startup({ home }));
  assert.deepEqual(error.keys, ['storage.max_records']);
  assert.match(error.format(), /never widen it/);
});

test('a missing default config means defaults, with a warning', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  rmSync(join(home, 'config.toml'));

  const runtime = startup({ home });
  assert.equal(runtime.configPath, null);
  assert.match(runtime.warnings.join('\n'), /built-in defaults/);
});

test('a missing explicit config is an error', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  expectStartupError(
    () => startup({ home, configPath: join(home, 'nope.toml') }),
    'CONFIG_UNREADABLE',
  );
});

test('home resolution follows the documented order', () => {
  // The CI runner is Linux while the daily environment is Windows; use
  // platform-appropriate absolute paths instead of assuming drive letters.
  const isWindows = process.platform === 'win32';
  const cwd = isWindows ? 'C:\\work' : '/work';
  const relative = isWindows ? 'C:\\work\\relative\\home' : '/work/relative/home';
  const explicit = isWindows ? 'C:\\explicit' : '/explicit';
  const dshHome = isWindows ? 'C:\\dsh' : '/dsh';
  assert.equal(resolveHome({ home: 'relative/home', env: {}, cwd }), relative);
  assert.equal(resolveHome({ env: { AGENT_MEMORY_HOME: explicit }, cwd }), explicit);
  assert.equal(resolveHome({ env: { DSH_HOME: dshHome }, cwd }), join(dshHome, 'memory'));
  assert.match(resolveHome({ env: {}, cwd }), /\.dsh[\\/]memory$/);
});

test('the DSH adapter exposes settings without touching files itself', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const settings = loadDshMemorySettings({ home });
  assert.equal(settings.home, home);
  assert.equal(settings.config.recall.limit, 5);
  assert.equal(settings.runtime.policy.scan.private_tag, 'confirm');
});

function linkType(): 'junction' | 'dir' {
  return process.platform === 'win32' ? 'junction' : 'dir';
}

test('S30.1 a store behind a junction is refused until --allow-junction', (t) => {
  const root = tempHome();
  t.after(() => cleanupHome(root));
  const target = join(root, 'real-home');
  mkdirSync(target);
  initStore({ home: target });
  const link = join(root, 'linked-home');
  symlinkSync(target, link, linkType());

  const error = expectStartupError(() => startup({ home: link }), 'HOME_INVALID');
  assert.match(error.format(), /junction or symlink/);
  assert.match(error.format(), /--allow-junction/);
  assert.match(error.format(), /linked-home/);

  const runtime = startup({ home: link, allowJunction: true });
  assert.equal(runtime.home.toLowerCase(), realpathSync.native(target).toLowerCase());
});

test('S30.1 init follows an allowed junction to the canonical path', (t) => {
  const root = tempHome();
  t.after(() => cleanupHome(root));
  const target = join(root, 'target');
  mkdirSync(target);
  const link = join(root, 'link');
  symlinkSync(target, link, linkType());

  const result = initStore({ home: link, allowJunction: true });
  assert.equal(result.home.toLowerCase(), realpathSync.native(target).toLowerCase());
  assert.ok(existsSync(join(target, 'config.toml')));
  assert.ok(existsSync(join(target, '.state', 'policy.seal.json')));
});

test('S30.1 AGENT_MEMORY_ALLOW_JUNCTION=1 is the environment form of the flag', (t) => {
  const root = tempHome();
  t.after(() => cleanupHome(root));
  const target = join(root, 'target');
  mkdirSync(target);
  initStore({ home: target });
  const link = join(root, 'link');
  symlinkSync(target, link, linkType());

  const runtime = startup({ home: link, env: { AGENT_MEMORY_ALLOW_JUNCTION: '1' } });
  assert.equal(runtime.home.toLowerCase(), realpathSync.native(target).toLowerCase());
});

test('S30.1 a new store under a linked parent is created at the real path', (t) => {
  const root = tempHome();
  t.after(() => cleanupHome(root));
  const target = join(root, 'target');
  mkdirSync(target);
  const link = join(root, 'link');
  symlinkSync(target, link, linkType());
  const home = join(link, 'store');

  const error = expectStartupError(() => initStore({ home }), 'HOME_INVALID');
  assert.match(error.format(), /--allow-junction/);

  const result = initStore({ home, allowJunction: true });
  assert.equal(result.home.toLowerCase(), join(realpathSync.native(target), 'store').toLowerCase());
  assert.ok(existsSync(join(target, 'store', 'config.toml')));
});
