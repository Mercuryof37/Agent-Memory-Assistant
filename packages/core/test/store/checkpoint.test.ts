import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { initStore } from '../../src/init.ts';
import { loadConfig } from '../../src/config/load.ts';
import { MemoryStore } from '../../src/store/store.ts';
import { memoryPaths } from '../../src/paths.ts';
import { merkleRoot } from '../../src/journal/checkpoint.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const config = loadConfig({ home }).config;
  return { home, config, open: () => new MemoryStore({ home, config }) };
}

test('S25.1 checkpoint captures the head and startup replays only the tail', (t) => {
  const { home, open } = fixture(t);
  const store = open();
  const first = store.add({ kind: 'fact', abstract: 'checkpoint one', body: 'b', evidence_level: 'observed' }, { author: 'human' });
  assert.equal(store.checkpoint(), true);
  const checkpointFile = memoryPaths(home).checkpointFile;
  assert.equal(existsSync(checkpointFile), true);
  const checkpoint = JSON.parse(readFileSync(checkpointFile, 'utf8')) as { journal: { seq: number }; docs: unknown[]; hmac: string };
  assert.equal(checkpoint.journal.seq, 1);
  assert.equal(checkpoint.docs.length, 1);
  assert.match(checkpoint.hmac, /^[0-9a-f]{64}$/);

  const second = store.add({ kind: 'fact', abstract: 'checkpoint two', body: 'b', evidence_level: 'observed' }, { author: 'human' });
  const reopened = open();
  assert.deepEqual(reopened.active().map((doc) => doc.id).sort(), [first.id, second.id].sort());
  assert.equal(reopened.diagnostics().issues.length, 0);
});

test('S25.2 a tampered checkpoint is surfaced, not silently trusted', (t) => {
  const { home, open } = fixture(t);
  const store = open();
  store.add({ kind: 'fact', abstract: 'tamper target', body: 'b', evidence_level: 'observed' }, { author: 'human' });
  store.checkpoint();
  const file = memoryPaths(home).checkpointFile;
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { hmac: string };
  parsed.hmac = '0'.repeat(64);
  writeFileSync(file, JSON.stringify(parsed));
  const reopened = open();
  assert.match(reopened.diagnostics().issues.join('\n'), /checkpoint/);
});

test('S25.3 Merkle root is deterministic and changes with a leaf', () => {
  const a = merkleRoot(['a', 'b', 'c']);
  assert.equal(a, merkleRoot(['a', 'b', 'c']));
  assert.notEqual(a, merkleRoot(['a', 'b', 'd']));
});
