import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodeSessionLog } from './lib/session-repair.mjs';

/**
 * Read-only audit of stored DSH session logs for the replay-breaking defect:
 * a v4 `user/message` without `id` (or with a role other than `user`).
 *
 * v3 logs predate message identity; current DSH migrates them on load, so they
 * are counted as "legacy, skipped" rather than corrupt. Nothing is written.
 *
 *   node scripts/audit-sessions.mjs [session-root ...]
 *
 * Exit code 1 when any v4 log would fail replay.
 */

const ARTIFACT = /^session\.v(\d+)\.jsonl\.zstd$/;

/** @param {string} file @returns {{ version: number, messages: number, defects: Array<{seq: number, fixes: string[]}> }} */
export function auditSessionFile(file) {
  const { headerLine, eventLines } = decodeSessionLog(readFileSync(file));
  const header = JSON.parse(headerLine);
  const version = typeof header.version === 'number' ? header.version : 0;
  const defects = [];
  let messages = 0;
  for (const line of eventLines) {
    const event = JSON.parse(line);
    if (event.type !== 'user/message') continue;
    messages += 1;
    if (version < 4) continue;
    const data = event.data ?? {};
    const fixes = [];
    if (typeof data.id !== 'string' || data.id === '') fixes.push('id');
    if (data.role !== 'user') fixes.push(`role:${String(data.role)}->user`);
    if (fixes.length > 0) defects.push({ seq: event.seq, fixes });
  }
  return { version, messages, defects };
}

function collectArtifacts(input) {
  const path = resolve(input);
  if (!existsSync(path)) return { error: 'not found' };
  if (statSync(path).isFile()) {
    const match = ARTIFACT.exec(path.split(/[\\/]/).pop() ?? '');
    return match === null ? { error: 'not a session artifact' } : { artifacts: [{ file: path, version: Number(match[1]) }] };
  }
  const artifacts = [];
  for (const name of readdirSync(path)) {
    const match = ARTIFACT.exec(name);
    if (match !== null) artifacts.push({ file: join(path, name), version: Number(match[1]) });
  }
  return artifacts.length === 0 ? { error: 'no session.v*.jsonl.zstd' } : { artifacts };
}

const inputs = process.argv.slice(2);
const roots = inputs.length > 0 ? inputs : [join(process.env.USERPROFILE ?? '', '.dsh', 'sessions')];

const summary = { files: 0, v4: 0, v3: 0, defects: 0, errors: 0 };
for (const root of roots) {
  const base = resolve(root);
  if (!existsSync(base)) {
    console.error(`${base}: not found`);
    summary.errors += 1;
    continue;
  }
  const directories = [];
  const walk = (dir, depth) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory() && depth < 4) walk(full, depth + 1);
      else if (ARTIFACT.test(name)) directories.push(dir);
    }
  };
  walk(base, 0);
  for (const dir of new Set(directories)) {
    const result = collectArtifacts(dir);
    if (result.error !== undefined) {
      console.error(`${dir}: ${result.error}`);
      summary.errors += 1;
      continue;
    }
    for (const artifact of result.artifacts) {
      summary.files += 1;
      try {
        const audit = auditSessionFile(artifact.file);
        if (audit.version >= 4) summary.v4 += 1;
        else summary.v3 += 1;
        if (audit.defects.length > 0) {
          summary.defects += audit.defects.length;
          const detail = audit.defects.map((defect) => `seq ${defect.seq} (${defect.fixes.join(', ')})`).join('; ');
          console.log(`${artifact.file}: ${audit.defects.length} defect(s): ${detail}`);
        }
      } catch (error) {
        console.error(`${artifact.file}: ${error instanceof Error ? error.message : String(error)}`);
        summary.errors += 1;
      }
    }
  }
}

console.log(
  `audited ${summary.files} session log(s): ${summary.v4} v4, ${summary.v3} legacy v3, ` +
    `${summary.defects} defect(s), ${summary.errors} error(s)`,
);
if (summary.defects > 0 || summary.errors > 0) process.exit(1);
