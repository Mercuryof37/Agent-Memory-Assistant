import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { sleepSync } from './wait.ts';

/**
 * Single-writer lock with a lease.
 *
 * Acquired before the first read and held across read → validate → write →
 * journal → derived files (plan v1.3 §6.2). A lease only becomes stale when its
 * heartbeat is older than `stale_ms` **and** the recorded PID is gone; a live
 * process keeps the lock even if its heartbeat is late, so a slow operation is
 * never silently overwritten.
 */

export interface LockConfig {
  readonly heartbeatMs: number;
  readonly staleMs: number;
  readonly timeoutMs: number;
}

export interface LockFileInfo {
  readonly pid: number;
  readonly token: string;
  readonly acquired_at: number;
  readonly heartbeat_at: number;
}

export type LockErrorCode = 'LOCK_TIMEOUT' | 'LOCK_LOST';

export class LockError extends Error {
  readonly code: LockErrorCode;
  constructor(code: LockErrorCode, message: string) {
    super(message);
    this.name = 'LockError';
    this.code = code;
  }
}

export function readLock(file: string): LockFileInfo | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<LockFileInfo>;
    if (
      typeof raw.pid === 'number' &&
      typeof raw.token === 'string' &&
      typeof raw.acquired_at === 'number' &&
      typeof raw.heartbeat_at === 'number'
    ) {
      return { pid: raw.pid, token: raw.token, acquired_at: raw.acquired_at, heartbeat_at: raw.heartbeat_at };
    }
    return null;
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lockIsStale(file: string, info: LockFileInfo | null, config: LockConfig, now: number): boolean {
  if (info === null) {
    // Unreadable lock file: only a crashed writer can leave one; age it by mtime.
    try {
      return now - statSync(file).mtimeMs > config.staleMs;
    } catch {
      return false;
    }
  }
  return now - info.heartbeat_at > config.staleMs && !processAlive(info.pid);
}

export interface AcquireOptions {
  readonly file: string;
  readonly config: LockConfig;
  readonly now?: () => number;
}

export class FileLock {
  readonly file: string;
  readonly token: string;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(file: string, token: string, config: LockConfig, now: () => number) {
    this.file = file;
    this.token = token;
    this.now = now;
    this.timer = setInterval(() => this.touch(), config.heartbeatMs);
    this.timer.unref();
  }

  touch(): void {
    if (this.closed) return;
    const current = readLock(this.file);
    if (current === null || current.token !== this.token) return;
    this.write({ ...current, heartbeat_at: this.now() });
  }

  assertHeld(): void {
    const current = readLock(this.file);
    if (current === null || current.token !== this.token) {
      throw new LockError('LOCK_LOST', `lock ${this.file} is no longer held by this process`);
    }
  }

  release(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    const current = readLock(this.file);
    if (current !== null && current.token === this.token) {
      try {
        unlinkSync(this.file);
      } catch {
        // A vanished lock file is already released.
      }
    }
  }

  private write(info: LockFileInfo): void {
    const fd = openSync(this.file, 'w');
    try {
      writeSync(fd, JSON.stringify(info));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
}

export function acquireLock(options: AcquireOptions): FileLock {
  const now = options.now ?? Date.now;
  const deadline = now() + options.config.timeoutMs;
  const token = randomBytes(8).toString('hex');

  for (;;) {
    const info: LockFileInfo = {
      pid: process.pid,
      token,
      acquired_at: now(),
      heartbeat_at: now(),
    };
    try {
      const fd = openSync(options.file, 'wx');
      try {
        writeSync(fd, JSON.stringify(info));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      return new FileLock(options.file, token, options.config, now);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
    }

    const existing = readLock(options.file);
    if (lockIsStale(options.file, existing, options.config, now())) {
      try {
        unlinkSync(options.file);
      } catch {
        // Someone else cleared it first; the retry loop handles either outcome.
      }
      continue;
    }

    if (now() >= deadline) {
      throw new LockError(
        'LOCK_TIMEOUT',
        `timed out after ${options.config.timeoutMs}ms waiting for ${options.file}`,
      );
    }
    sleepSync(Math.min(50, Math.max(1, deadline - now())));
  }
}

/** Test helper: overwrite the heartbeat so a fake writer looks abandoned. */
export function forceHeartbeat(file: string, at: number): void {
  const info = readLock(file);
  if (info === null) return;
  writeFileSync(file, JSON.stringify({ ...info, heartbeat_at: at }));
}
