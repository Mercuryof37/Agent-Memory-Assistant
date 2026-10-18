import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { JournalEntry, JournalIssue } from '../model/types.ts';

/**
 * The single append-only journal: accounting, deletions, decisions and audit
 * notes live in one place (plan v1.3 D31).
 *
 * One JSON object per line. `hash` is the SHA-256 of that line's bytes without
 * the newline; `prev` is the previous line's hash (64 zeros for the first).
 * Segments roll at 5 MiB and are never rotated away or deleted. `op_id` makes a
 * retried append idempotent.
 */

export const SEGMENT_BYTES = 5 * 1024 * 1024;
export const ZERO_HASH = '0'.repeat(64);

export type JournalOp = JournalEntry['op'];

export function hashLine(line: string): string {
  return createHash('sha256').update(line, 'utf8').digest('hex');
}

export interface JournalHead {
  readonly seq: number;
  readonly hash: string;
}

export interface JournalStats {
  readonly segments: number;
  readonly lines: number;
  readonly bytes: number;
  readonly first_seq: number | null;
  readonly last_seq: number | null;
  readonly largest_segment_bytes: number;
}

export interface JournalReadResult {
  readonly entries: readonly JournalEntry[];
  readonly hashes: readonly string[];
  readonly issues: readonly JournalIssue[];
  readonly head: JournalHead | null;
}

export interface AppendInput {
  readonly op: JournalOp;
  readonly data: Readonly<Record<string, unknown>>;
  readonly opId?: string;
  readonly at?: string;
}

export class Journal {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  segments(): string[] {
    try {
      return readdirSync(this.dir)
        .filter((name) => /^\d{4}\.jsonl$/.test(name))
        .sort();
    } catch {
      return [];
    }
  }

  /** Last accepted entry, without verifying the whole log. */
  head(): JournalHead | null {
    const segments = this.segments();
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const file = join(this.dir, segments[index] as string);
      const lines = readFileSync(file, 'utf8').split('\n').filter((line) => line !== '');
      if (lines.length === 0) continue;
      const last = lines[lines.length - 1] as string;
      try {
        const entry = JSON.parse(last) as JournalEntry;
        return { seq: entry.seq, hash: hashLine(last) };
      } catch {
        return null;
      }
    }
    return null;
  }

  readAll(): JournalReadResult {
    const entries: JournalEntry[] = [];
    const hashes: string[] = [];
    const issues: JournalIssue[] = [];
    const opIds = new Set<string>();
    let expectedSeq = 1;
    let prev = ZERO_HASH;

    for (const name of this.segments()) {
      const file = join(this.dir, name);
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch (error) {
        issues.push({ kind: 'parse', message: `cannot read ${name}: ${String(error)}` });
        continue;
      }
      const lines = text.split('\n');
      // A trailing newline is expected; a final non-empty line without one is a
      // torn append and must not be trusted.
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      for (const line of lines) {
        if (line === '') continue;
        let entry: JournalEntry;
        try {
          entry = JSON.parse(line) as JournalEntry;
        } catch {
          issues.push({ kind: 'parse', message: `${name}: line is not valid JSON`, seq: expectedSeq });
          return { entries, hashes, issues, head: entries.length === 0 ? null : { seq: entries.length, hash: prev } };
        }
        const hash = hashLine(line);
        if (entry.seq !== expectedSeq) {
          issues.push({
            kind: 'seq',
            message: `${name}: expected seq ${expectedSeq}, found ${entry.seq}`,
            seq: entry.seq,
          });
        }
        if (entry.prev !== prev) {
          issues.push({
            kind: 'chain',
            message: `${name}: seq ${entry.seq} prev does not match the previous line hash`,
            seq: entry.seq,
          });
        }
        if (opIds.has(entry.op_id)) {
          issues.push({ kind: 'duplicate-op', message: `${name}: duplicate op_id ${entry.op_id}`, seq: entry.seq });
        }
        opIds.add(entry.op_id);
        entries.push(entry);
        hashes.push(hash);
        expectedSeq = entry.seq + 1;
        prev = hash;
      }
    }

    const head = entries.length === 0 ? null : { seq: entries[entries.length - 1]?.seq ?? 0, hash: prev };
    return { entries, hashes, issues, head };
  }

  /** Cheap operational summary for `mem doctor` / metrics. */
  stats(): JournalStats {
    const segments = this.segments();
    let lines = 0;
    let bytes = 0;
    let largest = 0;
    let firstSeq: number | null = null;
    let lastSeq: number | null = null;
    for (const name of segments) {
      const text = readFileSync(join(this.dir, name), 'utf8');
      const size = Buffer.byteLength(text);
      bytes += size;
      largest = Math.max(largest, size);
      const rows = text.split('\n').filter((line) => line !== '');
      lines += rows.length;
      if (firstSeq === null && rows.length > 0) {
        try {
          firstSeq = (JSON.parse(rows[0] as string) as { seq?: number }).seq ?? null;
        } catch {
          firstSeq = null;
        }
      }
      if (rows.length > 0) {
        try {
          lastSeq = (JSON.parse(rows[rows.length - 1] as string) as { seq?: number }).seq ?? lastSeq;
        } catch {
          // doctor reports parse issues separately
        }
      }
    }
    return { segments: segments.length, lines, bytes, first_seq: firstSeq, last_seq: lastSeq, largest_segment_bytes: largest };
  }

  findByOpId(opId: string): JournalEntry | undefined {
    return this.readAll().entries.find((entry) => entry.op_id === opId);
  }

  /**
   * Append one entry. The caller must hold the store lock: `head()` and the
   * write are not atomic on their own. A repeated `opId` returns the existing
   * entry instead of appending a second one.
   */
  append(input: AppendInput): JournalEntry {
    mkdirSync(this.dir, { recursive: true });
    if (input.opId !== undefined) {
      const existing = this.findByOpId(input.opId);
      if (existing !== undefined) return existing;
    }

    const segments = this.segments();
    const lastSegment = segments[segments.length - 1] ?? '0001.jsonl';
    const head = this.head();
    const seq = head === null ? 1 : head.seq + 1;
    const prev = head === null ? ZERO_HASH : head.hash;
    const entry: JournalEntry = {
      seq,
      prev,
      at: input.at ?? new Date().toISOString(),
      op: input.op,
      op_id: input.opId ?? `op-${seq}-${hashLine(`${seq}:${input.op}:${JSON.stringify(input.data)}`).slice(0, 8)}`,
      data: input.data,
    };
    const line = JSON.stringify(entry);

    let segmentPath = join(this.dir, lastSegment);
    let size = 0;
    try {
      size = statSync(segmentPath).size;
    } catch {
      size = 0;
    }
    if (size > 0 && size + Buffer.byteLength(line) + 1 > SEGMENT_BYTES) {
      const nextNumber = Number(lastSegment.slice(0, 4)) + 1;
      segmentPath = join(this.dir, `${String(nextNumber).padStart(4, '0')}.jsonl`);
    }

    const fd = openSync(segmentPath, 'a');
    try {
      writeSync(fd, `${line}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return entry;
  }
}

/** One human-readable line for `mem inspect --audit`. */
export function formatJournalEntry(entry: JournalEntry): string {
  const summary = JSON.stringify(entry.data);
  return `${entry.at} #${entry.seq} ${entry.op.padEnd(6)} ${entry.op_id} ${summary}`;
}
