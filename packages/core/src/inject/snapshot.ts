import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { memoryPaths } from '../paths.ts';
import { writeFileAtomic } from '../fs/atomic.ts';

/**
 * Frozen per-session injection snapshot (plan v1.3 §6.1).
 *
 * Same session + same prompt schema => byte-identical text on every assemble,
 * even after new writes; a new session captures the current revision. At most
 * 20 snapshots are kept (oldest removed on capture).
 */

export const PROMPT_SCHEMA_VERSION = 1;
export const SNAPSHOT_KEEP = 20;

export interface SnapshotRecord {
  readonly session_id: string;
  readonly memory_revision: string;
  readonly prompt_schema_version: number;
  readonly created_at: string;
  readonly text: string;
}

export function snapshotPath(home: string, sessionId: string): string {
  const name = createHash('sha256').update(sessionId, 'utf8').digest('hex').slice(0, 32);
  return join(memoryPaths(home).snapshotsDir, `${name}.json`);
}

export function readSnapshot(home: string, sessionId: string): SnapshotRecord | null {
  const file = snapshotPath(home, sessionId);
  if (!existsSync(file)) return null;
  try {
    const record = JSON.parse(readFileSync(file, 'utf8')) as SnapshotRecord;
    if (
      record.session_id !== sessionId ||
      typeof record.text !== 'string' ||
      typeof record.memory_revision !== 'string' ||
      typeof record.prompt_schema_version !== 'number'
    ) {
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

export function writeSnapshot(home: string, record: SnapshotRecord, keep = SNAPSHOT_KEEP): void {
  writeFileAtomic(snapshotPath(home, record.session_id), `${JSON.stringify(record, null, 2)}\n`);
  pruneSnapshots(home, keep);
}

/** Keep the newest `keep` snapshot files; a snapshot is a cache, not truth. */
export function pruneSnapshots(home: string, keep = SNAPSHOT_KEEP): void {
  const dir = memoryPaths(home).snapshotsDir;
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    return;
  }
  if (names.length <= keep) return;
  const byAge = names
    .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime);
  for (const entry of byAge.slice(keep)) {
    try {
      rmSync(join(dir, entry.name), { force: true });
    } catch {
      // A snapshot that cannot be removed is only wasted disk space.
    }
  }
}
