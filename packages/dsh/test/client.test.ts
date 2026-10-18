import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

test('S13.1 the client half is a loader-format bundle with the required registrations', () => {
  const source = readFileSync(join(root, 'client', 'client.js'), 'utf8');
  assert.match(source, /window\.__ModuleLoader__\.load\(\{/);
  assert.match(source, /id: "@agent-memory\/dsh"/);
  assert.match(source, /factory: \(require\) =>/);
  assert.match(source, /ctx\.slots\.inject\("main"/);
  assert.match(source, /ctx\.slots\.inject\("sidebar\.panellist"/);
  for (const endpoint of ['list', 'item', 'search', 'export']) {
    assert.match(source, new RegExp(`/api/agent-memory/${endpoint}`));
  }
  assert.match(source, /命令手册/);
  assert.match(source, /F-01/);
  // The workbench owns a viewport-height scroll container with a styled rail;
  // the host panel does not scroll in windowed mode.
  assert.match(source, /am-memory-scroll/);
  assert.match(source, /::-webkit-scrollbar-thumb/);
  assert.match(source, /overflowY: "auto"/);
});

test('S13.2 package.json declares the client half for the host module graph', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    exports?: Record<string, string>;
    files?: string[];
    dsh?: { client?: { platform?: string; inject?: string[] } };
  };
  assert.equal(pkg.exports?.['./client'], './client/client.js');
  assert.ok(pkg.files?.includes('client'));
  assert.equal(pkg.dsh?.client?.platform, 'web');
  assert.ok(pkg.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-renderer'));
});
