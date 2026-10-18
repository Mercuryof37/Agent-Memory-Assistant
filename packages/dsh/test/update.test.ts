import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, createUpdateService, PLUGIN_VERSION } from '../src/update.ts';

function registry(version: string): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ version, dist: { tarball: `https://registry.npmjs.org/x/-/x-${version}.tgz` } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
}

test('S29.1 update check compares semver and reports the latest version', async () => {
  assert.equal(compareVersions('0.5.0', '0.4.9'), 1);
  assert.equal(compareVersions('0.5.0', '0.5.0'), 0);
  const service = createUpdateService(undefined, registry('0.6.0'));
  const info = await service.check();
  assert.equal(info.current, PLUGIN_VERSION);
  assert.equal(info.latest, '0.6.0');
  assert.equal(info.update_available, true);
  assert.match(info.tarball ?? '', /0\.6\.0/);
});

test('S29.2 one-click upgrade calls the host manager with an exact package spec', async () => {
  const calls: string[] = [];
  const service = createUpdateService(
    {
      async installBundle(spec: string) {
        calls.push(spec);
        return { applied: 'restart-required' };
      },
    },
    registry('0.6.0'),
  );
  const result = await service.apply('0.6.0');
  assert.equal(result.ok, true);
  assert.equal(result.restart_required, true);
  assert.deepEqual(calls, ['@agent_memory/dsh@0.6.0']);

  const invalid = await service.apply('https://evil.example/x.tgz');
  assert.equal(invalid.ok, false);
  assert.equal(calls.length, 1);
});

test('S29.3 without a host manager, upgrade fails closed with manual guidance', async () => {
  const service = createUpdateService(undefined, registry('0.6.0'));
  const result = await service.apply('0.6.0');
  assert.equal(result.ok, false);
  assert.equal(result.manual, true);
  assert.match(result.error ?? '', /设置/);
});
