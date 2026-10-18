import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { memoryPaths } from '../paths.ts';
import { Journal, hashLine } from '../journal/journal.ts';
import { merkleRoot, readCheckpoint } from '../journal/checkpoint.ts';

export interface VerifyArchive {
  readonly segment: string;
  readonly present: boolean;
  readonly ok: boolean;
  readonly error?: string;
}

export interface VerifyReport {
  readonly ok: boolean;
  readonly checkpoint: { seq: number; hash: string } | null;
  readonly journal: { lines: number; bytes: number; head: { seq: number; hash: string } | null };
  readonly archives: readonly VerifyArchive[];
  readonly issues: readonly string[];
  readonly deep: boolean;
}

/**
 * Read-only integrity check for S5. `--deep` decompresses archived segments and
 * checks their sha256 + Merkle root; the default only checks metadata/index.
 */
export function verifyStore(home: string, options: { deep?: boolean } = {}): VerifyReport {
  const deep = options.deep ?? false;
  const paths = memoryPaths(home);
  const issues: string[] = [];
  const checkpointRead = readCheckpoint(home);
  if (checkpointRead.error !== undefined) issues.push(`checkpoint: ${checkpointRead.error}`);
  const checkpoint = checkpointRead.checkpoint;
  const journal = new Journal(paths.journalDir);
  const read = journal.readAll();
  for (const issue of read.issues) issues.push(`journal: ${issue.message}`);
  const stats = journal.stats();
  const head = journal.head();
  if (checkpoint !== undefined) {
    if (head === null || head.seq < checkpoint.journal.seq) {
      issues.push(`checkpoint #${checkpoint.journal.seq} is ahead of journal`);
    }
    if (head !== null && head.seq === checkpoint.journal.seq && head.hash !== checkpoint.journal.hash) {
      issues.push('checkpoint hash differs from journal head');
    }
  }

  const archiveDir = paths.journalArchiveDir;
  const archives: VerifyArchive[] = [];
  if (existsSync(archiveDir)) {
    const metas = readdirSync(archiveDir).filter((name) => name.endsWith('.meta.json')).sort();
    for (const name of metas) {
      const segment = name.replace(/\.meta\.json$/, '');
      const gz = join(archiveDir, `${segment}.jsonl.gz`);
      const metaPath = join(archiveDir, name);
      if (!existsSync(gz)) {
        archives.push({ segment, present: false, ok: true });
        continue;
      }
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
          sha256?: string;
          root?: string;
          first_seq?: number;
          last_seq?: number;
        };
        if (!deep) {
          if (typeof meta.sha256 !== 'string' || typeof meta.root !== 'string') {
            throw new Error('meta lacks sha256/root');
          }
          archives.push({ segment, present: true, ok: true });
          continue;
        }
        const text = gunzipSync(readFileSync(gz)).toString('utf8');
        const sha = createHash('sha256').update(text, 'utf8').digest('hex');
        if (sha !== meta.sha256) throw new Error('sha256 mismatch');
        const lines = text.split('\n').filter((line) => line !== '');
        if (meta.first_seq !== undefined) {
          const first = JSON.parse(lines[0] as string) as { seq?: number };
          const last = JSON.parse(lines[lines.length - 1] as string) as { seq?: number };
          if (first.seq !== meta.first_seq || last.seq !== meta.last_seq) throw new Error('seq range mismatch');
        }
        if (merkleRoot(lines.map((line) => hashLine(line))) !== meta.root) throw new Error('Merkle root mismatch');
        archives.push({ segment, present: true, ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        issues.push(`archive ${segment}: ${message}`);
        archives.push({ segment, present: true, ok: false, error: message });
      }
    }
  }

  return {
    ok: issues.length === 0,
    checkpoint: checkpoint === undefined ? null : checkpoint.journal,
    journal: { lines: stats.lines, bytes: stats.bytes, head },
    archives,
    issues,
    deep,
  };
}
