import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Config } from '../config/config.ts';
import { loadRules } from '../rules/rules.ts';
import type { MemoryStore } from '../store/store.ts';
import { memoryPaths } from '../paths.ts';

/**
 * Operational commands (S7): export/pack, checksums, and the read-only inspect
 * report. Nothing here rewrites a memory file; export copies and hashes,
 * inspect reads.
 */

export interface ExportResult {
  readonly out: string;
  readonly files: number;
  readonly bytes: number;
  readonly sums: string;
}

const INCLUDE = [
  'config.toml',
  'policy.json',
  'SOUL.md',
  'USER.md',
  'RULES.md',
  'memories',
  'proposals',
  '.state/policy.seal.json',
  '.state/journal',
  '.state/distill-rejected.json',
];

export function exportStore(options: { home: string; out: string }): ExportResult {
  const paths = memoryPaths(options.home);
  mkdirSync(options.out, { recursive: true });
  for (const entry of INCLUDE) {
    const source = join(paths.home, entry);
    if (!existsSync(source)) continue;
    const target = join(options.out, entry);
    cpSync(source, target, { recursive: true });
  }
  const lines: string[] = [];
  let files = 0;
  let bytes = 0;
  const walk = (dir: string, base: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full, base);
        continue;
      }
      const rel = relative(base, full).replaceAll('\\', '/');
      const data = readFileSync(full);
      lines.push(`${createHash('sha256').update(data).digest('hex')}  ${rel}`);
      files += 1;
      bytes += data.length;
    }
  };
  walk(options.out, options.out);
  lines.sort();
  const sums = join(options.out, 'SHA256SUMS');
  writeFileSync(sums, `${lines.join('\n')}\n`, 'utf8');
  return { out: options.out, files, bytes, sums };
}

export function verifyExport(dir: string): { ok: boolean; problems: readonly string[] } {
  const sums = join(dir, 'SHA256SUMS');
  if (!existsSync(sums)) return { ok: false, problems: ['SHA256SUMS is missing'] };
  const problems: string[] = [];
  for (const line of readFileSync(sums, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (match === null) {
      problems.push(`malformed line: ${line.slice(0, 80)}`);
      continue;
    }
    const file = join(dir, match[2] as string);
    if (!existsSync(file)) {
      problems.push(`missing file: ${match[2]}`);
      continue;
    }
    const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (actual !== match[1]) problems.push(`hash mismatch: ${match[2]}`);
  }
  return { ok: problems.length === 0, problems };
}

export interface InspectReport {
  readonly active: number;
  readonly byKind: Readonly<Record<string, number>>;
  readonly quarantined: readonly string[];
  readonly pendingProposals: number;
  readonly rules: readonly { number: number; category: string; text: string }[];
  readonly journal: readonly { seq: number; op: string; at: string; op_id: string }[];
  readonly budget: { readonly indexChars: number; readonly totalChars: number };
  readonly journalHead: { readonly seq: number; readonly hash: string } | null;
  /** Character counts of the three human-owned personalization files (0 = absent). */
  readonly personalization: { readonly soul: number; readonly user: number; readonly rules: number };
  /** Injection budgets used to flag truncation in the report. */
  readonly inject: { readonly persona_max_chars: number; readonly user_max_chars: number; readonly rules_max_chars: number };
}

function personalizationChars(home: string): { soul: number; user: number; rules: number } {
  const paths = memoryPaths(home);
  const charsOf = (file: string): number => {
    try {
      if (!existsSync(file)) return 0;
      // Comments are stripped before injection, so they do not count against budgets.
      return [...readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '')].length;
    } catch {
      return 0;
    }
  };
  return { soul: charsOf(paths.soulFile), user: charsOf(paths.userFile), rules: charsOf(paths.rulesFile) };
}

export function inspectStore(options: {
  home: string;
  config: Config;
  store: MemoryStore;
  limit?: number;
}): InspectReport {
  const active = options.store.active();
  const byKind: Record<string, number> = { fact: 0, pitfall: 0, exp: 0 };
  let chars = 0;
  for (const doc of active) {
    byKind[doc.kind] = (byKind[doc.kind] ?? 0) + 1;
    chars += [...doc.abstract].length + [...doc.body].length;
  }
  const journal = options.store.journal.readAll();
  const limit = options.limit ?? 10;
  return {
    active: active.length,
    byKind,
    quarantined: [...options.store.diagnostics().quarantined.keys()],
    pendingProposals: options.store.stats().pending_proposals,
    rules: loadRules(options.home).map((rule) => ({ number: rule.number, category: rule.category, text: rule.text })),
    journal: journal.entries.slice(-limit).map((entry) => ({
      seq: entry.seq,
      op: entry.op,
      at: entry.at,
      op_id: entry.op_id,
    })),
    budget: { indexChars: [...active.map((doc) => doc.abstract).join('\n')].length, totalChars: chars },
    journalHead: journal.head,
    personalization: personalizationChars(options.home),
    inject: {
      persona_max_chars: options.config.inject.persona_max_chars,
      user_max_chars: options.config.inject.user_max_chars,
      rules_max_chars: options.config.inject.rules_max_chars,
    },
  };
}
