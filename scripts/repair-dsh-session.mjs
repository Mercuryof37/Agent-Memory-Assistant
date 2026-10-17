import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { repairSessionLog, timestamp } from './lib/session-repair.mjs';

/**
 * Repair stored DSH session logs that cannot be re-opened because a
 * `user/message` event has no `id` (or a role other than `user`).
 *
 * The log format is a concatenated Zstandard stream; the fix re-encodes the
 * events and keeps the session header frame byte for byte. It refuses to guess:
 * anything beyond a missing identity or a wrong role is reported, not rewritten.
 *
 *   node scripts/repair-dsh-session.mjs <session-dir>...          # dry run
 *   node scripts/repair-dsh-session.mjs <session-dir>... --apply  # write
 *
 * A directory argument resolves to its `session.v4.jsonl.zstd`. Run it outside
 * the DSH workspace sandbox: the session store lives under `~/.dsh`, which the
 * sandbox does not allow writing. Backups are written next to the log as
 * `session.v4.jsonl.zstd.bak-<YYYYMMDD-HHmmss>`.
 */

const ARTIFACT = 'session.v4.jsonl.zstd';
const apply = process.argv.includes('--apply');
const inputs = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));

if (inputs.length === 0) {
  console.error('usage: node scripts/repair-dsh-session.mjs <session-dir-or-log>... [--apply]');
  process.exit(1);
}

const stamp = timestamp(new Date());
let failures = 0;
let changedFiles = 0;

for (const input of inputs) {
  const path = resolve(input);
  let artifact = path;
  try {
    if (statSync(path).isDirectory()) artifact = join(path, ARTIFACT);
  } catch (error) {
    console.error(`${path}: cannot read: ${String(error)}`);
    failures += 1;
    continue;
  }
  if (!existsSync(artifact)) {
    console.error(`${artifact}: not found`);
    failures += 1;
    continue;
  }
  try {
    const outcome = repairSessionLog(artifact, { apply, stamp });
    if (outcome.changes.length === 0) {
      console.log(`${artifact}: no unidentified messages`);
      continue;
    }
    changedFiles += 1;
    const detail = outcome.changes
      .map((change) => `seq ${String(change.seq)} (${change.fixes.join(', ')})`)
      .join('; ');
    if (outcome.applied) {
      console.log(`${artifact}: repaired ${outcome.changes.length} message(s): ${detail}`);
      console.log(`  backup: ${outcome.backup}`);
    } else {
      console.log(`${artifact}: would repair ${outcome.changes.length} message(s): ${detail}`);
      console.log('  dry run; pass --apply to write');
    }
  } catch (error) {
    console.error(`${artifact}: ${error instanceof Error ? error.message : String(error)}`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`\n${failures} session log(s) could not be repaired`);
  process.exit(1);
}
if (changedFiles === 0) console.log('nothing to repair');
