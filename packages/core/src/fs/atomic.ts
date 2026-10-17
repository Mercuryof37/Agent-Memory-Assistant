import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, renameSync, rmSync, fsyncSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { sleepSync } from './wait.ts';

/**
 * Atomic replace: write a sibling temp file, fsync it, then rename over the
 * target. On Windows, rename can hit `EPERM`/`EBUSY` while an indexer or
 * antivirus holds the target; a short bounded retry is the documented behaviour
 * (plan v1.3 §6.2), and a persistent failure is a loud error, never a half
 * write.
 *
 * Directory entries are not fsynced: Windows cannot flush a directory handle.
 * The store therefore promises "detectable and recoverable after a crash", not
 * zero loss on power failure (plan v1.3 §2.2).
 */
export interface AtomicWriteOptions {
  readonly retries?: number;
  readonly retryDelayMs?: number;
}

export function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  const retries = options.retries ?? 5;
  const delay = options.retryDelayMs ?? 20;

  try {
    const fd = openSync(tempPath, 'w');
    try {
      writeFileSync(fd, typeof data === 'string' ? data : Buffer.from(data));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    for (let attempt = 0; ; attempt += 1) {
      try {
        renameSync(tempPath, filePath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if ((code !== 'EPERM' && code !== 'EBUSY') || attempt >= retries) throw error;
        sleepSync(delay * (attempt + 1));
      }
    }
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
