import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { initStore } from '../../src/init.ts';
import { loadConfig } from '../../src/config/load.ts';
import { MemoryStore } from '../../src/store/store.ts';
import { memoryPaths } from '../../src/paths.ts';
import { verifyStore } from '../../src/ops/verify.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

test('S27.1 verify accepts a checkpointed store and detects a tampered checkpoint', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const store = new MemoryStore({ home, config: loadConfig({ home }).config });
  store.add({ kind: 'fact', abstract: 'verify me', body: 'b', evidence_level: 'observed' }, { author: 'human' });
  store.checkpoint();
  const ok = verifyStore(home, { deep: true });
  assert.equal(ok.ok, true, ok.issues.join('; '));
  assert.equal(ok.checkpoint?.seq, 1);

  const file = memoryPaths(home).checkpointFile;
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { hmac: string };
  parsed.hmac = '0'.repeat(64);
  writeFileSync(file, JSON.stringify(parsed));
  const bad = verifyStore(home, { deep: true });
  assert.equal(bad.ok, false);
  assert.match(bad.issues.join('\n'), /checkpoint/);
});
