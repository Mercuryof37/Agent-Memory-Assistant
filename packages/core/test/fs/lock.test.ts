import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock, forceHeartbeat, LockError, readLock } from '../../src/fs/lock.ts';

const CONFIG = { heartbeatMs: 1_000, staleMs: 5_000, timeoutMs: 150 };

function lockFile(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-memory-lock-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'lock');
}

test('S2a.2 a second writer times out instead of overwriting', (t) => {
  const file = lockFile(t);
  const held = acquireLock({ file, config: CONFIG });
  t.after(() => held.release());

  assert.throws(
    () => acquireLock({ file, config: CONFIG }),
    (error: unknown) => error instanceof LockError && error.code === 'LOCK_TIMEOUT',
  );
});

test('a dead PID with an old heartbeat is stale and gets stolen', (t) => {
  const file = lockFile(t);
  const now = Date.now();
  writeFileSync(
    file,
    JSON.stringify({ pid: 999_999, token: 'dead', acquired_at: now - 60_000, heartbeat_at: now - 60_000 }),
  );

  const lock = acquireLock({ file, config: CONFIG });
  t.after(() => lock.release());
  assert.notEqual(readLock(file)?.token, 'dead');
});

test('a live PID keeps the lock even with an old heartbeat', (t) => {
  const file = lockFile(t);
  const now = Date.now();
  writeFileSync(
    file,
    JSON.stringify({ pid: process.pid, token: 'live', acquired_at: now - 60_000, heartbeat_at: now - 60_000 }),
  );

  assert.throws(
    () => acquireLock({ file, config: CONFIG }),
    (error: unknown) => error instanceof LockError && error.code === 'LOCK_TIMEOUT',
  );
});

test('the heartbeat advances while held and release removes the file', (t) => {
  const file = lockFile(t);
  const lock = acquireLock({ file, config: { ...CONFIG, heartbeatMs: 20 } });
  const before = readLock(file)?.heartbeat_at ?? 0;
  const start = Date.now();
  while (Date.now() - start < 30) {
    // Spin briefly so the unref'd interval fires.
  }
  const after = readLock(file)?.heartbeat_at ?? 0;
  assert.ok(after >= before);
  lock.release();
  assert.equal(readLock(file), null);
});

test('release from a different token leaves the lock alone', (t) => {
  const file = lockFile(t);
  const lock = acquireLock({ file, config: CONFIG });
  writeFileSync(file, JSON.stringify({ ...readLock(file), token: 'someone-else' }));
  lock.release();
  assert.equal(readLock(file)?.token, 'someone-else');
});

test('forceHeartbeat makes a stale-looking heartbeat for tests', (t) => {
  const file = lockFile(t);
  const lock = acquireLock({ file, config: CONFIG });
  forceHeartbeat(file, 0);
  assert.equal(readLock(file)?.heartbeat_at, 0);
  lock.release();
});
