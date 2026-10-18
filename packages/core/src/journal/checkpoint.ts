import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { writeFileAtomic } from '../fs/atomic.ts';
import { memoryPaths } from '../paths.ts';

/**
 * V5.0-S2 checkpoint: a small, HMAC-protected snapshot of the journal head and
 * the accounted document hashes. Startup can trust it, then replay only the
 * journal tail. The journal remains the append-only audit source.
 */

export const CHECKPOINT_SCHEMA = 1;

export interface CheckpointDoc {
  readonly id: string;
  readonly sha256: string;
  readonly deleted: boolean;
}

export interface Checkpoint {
  readonly schema: 1;
  readonly created_at: string;
  readonly journal: { readonly seq: number; readonly hash: string; readonly segment?: string };
  readonly docs: readonly CheckpointDoc[];
  readonly journal_root: string;
  readonly docs_root: string;
  readonly hmac: string;
}

export interface CheckpointRead {
  readonly checkpoint?: Checkpoint;
  readonly error?: string;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Binary Merkle root over hex leaves; odd node is promoted. */
export function merkleRoot(leaves: readonly string[]): string {
  if (leaves.length === 0) return sha256('');
  let level = leaves.map((leaf) => sha256(leaf));
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index] as string;
      const right = level[index + 1];
      next.push(right === undefined ? left : sha256(`${left}${right}`));
    }
    level = next;
  }
  return level[0] as string;
}

function docsRoot(docs: readonly CheckpointDoc[]): string {
  return merkleRoot(docs.map((doc) => `${doc.id}:${doc.sha256}:${doc.deleted ? '1' : '0'}`).sort());
}

function checkpointKey(home: string): Buffer {
  const file = memoryPaths(home).checkpointKeyFile;
  if (existsSync(file)) {
    const key = readFileSync(file);
    if (key.length === 32) return key;
    throw new Error('checkpoint key must be 32 bytes');
  }
  const key = randomBytes(32);
  try {
    writeFileSync(file, key, { flag: 'wx', mode: 0o600 });
    return key;
  } catch {
    const existing = readFileSync(file);
    if (existing.length === 32) return existing;
    throw new Error('checkpoint key is unreadable');
  }
}

function canonical(checkpoint: Omit<Checkpoint, 'hmac'>): string {
  return JSON.stringify({
    schema: checkpoint.schema,
    created_at: checkpoint.created_at,
    journal: checkpoint.journal,
    docs: checkpoint.docs,
    journal_root: checkpoint.journal_root,
    docs_root: checkpoint.docs_root,
  });
}

export function writeCheckpoint(home: string, input: {
  journal: { seq: number; hash: string; segment?: string };
  docs: readonly CheckpointDoc[];
  journalRoot: string;
  now?: Date;
}): Checkpoint {
  const docs = input.docs.slice().sort((left, right) => left.id.localeCompare(right.id));
  const body = {
    schema: CHECKPOINT_SCHEMA as 1,
    created_at: (input.now ?? new Date()).toISOString(),
    journal: input.journal,
    docs,
    journal_root: input.journalRoot,
    docs_root: docsRoot(docs),
  };
  const hmac = createHmac('sha256', checkpointKey(home)).update(canonical(body), 'utf8').digest('hex');
  const checkpoint: Checkpoint = { ...body, hmac };
  writeFileAtomic(memoryPaths(home).checkpointFile, `${JSON.stringify(checkpoint, null, 2)}\n`);
  return checkpoint;
}

export function readCheckpoint(home: string): CheckpointRead {
  const file = memoryPaths(home).checkpointFile;
  if (!existsSync(file)) return {};
  let parsed: Checkpoint;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as Checkpoint;
  } catch {
    return { error: 'checkpoint is not valid JSON' };
  }
  if (parsed.schema !== CHECKPOINT_SCHEMA) return { error: `unsupported checkpoint schema ${String(parsed.schema)}` };
  if (typeof parsed.hmac !== 'string' || parsed.hmac === '') return { error: 'checkpoint has no HMAC' };
  if (docsRoot(parsed.docs) !== parsed.docs_root) return { error: 'checkpoint docs root mismatch' };
  let key: Buffer;
  try {
    key = checkpointKey(home);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  const expected = createHmac('sha256', key).update(canonical({
    schema: parsed.schema,
    created_at: parsed.created_at,
    journal: parsed.journal,
    docs: parsed.docs,
    journal_root: parsed.journal_root,
    docs_root: parsed.docs_root,
  }), 'utf8').digest('hex');
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(parsed.hmac, 'hex');
  if (left.length !== right.length || !timingSafeEqual(left, right)) return { error: 'checkpoint HMAC mismatch' };
  return { checkpoint: parsed };
}

/** Ensure the key exists (backup/restore and diagnostics). */
export function ensureCheckpointKey(home: string): void {
  checkpointKey(home);
}
