import { createHash, randomBytes } from 'node:crypto';
import type { Config } from '../config/config.ts';
import type { Policy } from '../policy/policy.ts';
import { verifySealedFiles } from '../policy/policy.ts';
import type { Rule } from '../rules/rules.ts';
import { today } from '../model/validity.ts';
import type { MemoryDoc } from '../model/types.ts';
import { buildSections, SECTION_ORDERS, type SectionHealth, type SectionSource } from './sections.ts';
import { readSnapshot, writeSnapshot, PROMPT_SCHEMA_VERSION } from './snapshot.ts';

/**
 * Injection assembly (plan v1.3 §6.1; architecture v2 P0.5).
 *
 * Sections come from the registry (`sections.ts`): SOUL, GUIDANCE, RULES, USER,
 * then the memory catalog built here. A broken optional section degrades to a
 * visible notice (health entry) instead of failing the whole injection; sealed
 * files and store integrity remain global failures. The text is frozen per
 * session in `.state/snapshots/` and wrapped in a random delimiter.
 */

export type InjectionErrorCode = 'RULES_INVALID' | 'RULES_OVER_BUDGET' | 'OVER_BUDGET';

export class InjectionError extends Error {
  readonly code: InjectionErrorCode;
  constructor(code: InjectionErrorCode, message: string) {
    super(message);
    this.name = 'InjectionError';
    this.code = code;
  }
}

export interface InjectionSource {
  active(date?: string): readonly MemoryDoc[];
  /** Preferred audit sink: keeps the store manifest head in sync. */
  appendAudit?(data: Record<string, unknown>): void;
  readonly journal?: { append(entry: { op: 'audit'; data: Record<string, unknown> }): unknown };
}

export interface AssembleInput {
  readonly home: string;
  readonly config: Config;
  readonly policy: Policy;
  readonly source: InjectionSource;
  readonly sessionId: string;
  readonly asOf?: string;
  readonly now?: () => Date;
  /** Token counter; when absent, chars/2.5 and `estimated: true`. */
  readonly measure?: (text: string) => number;
  /** Test seam: fixed delimiter instead of a random 16-hex one. */
  readonly delimiter?: string;
  /** Test seam: skip snapshot persistence. */
  readonly persist?: boolean;
  /** Extension seam: extra document layers (P0.5 section registry). */
  readonly extraSections?: readonly SectionSource[];
}

export interface InjectionBudget {
  readonly counter: 'chars' | 'tokens';
  readonly estimated: boolean;
  readonly sections: Readonly<Record<string, number>>;
  readonly total: number;
}

export interface AssembleResult {
  readonly text: string;
  readonly memory_revision: string;
  readonly captured: boolean;
  readonly budget: InjectionBudget;
  readonly sections: readonly string[];
  readonly rules: readonly Rule[];
  /** Per-source text, one entry per source (empty when absent). */
  readonly parts: Readonly<Record<string, string>>;
  /** Rendered section list in order, so the host can register one prompt section per source. */
  readonly sectionList: readonly { readonly key: string; readonly order: number; readonly text: string }[];
  /** Per-section health; a degraded section still appears in `sectionList` as a notice. */
  readonly health: readonly SectionHealth[];
}

const EVIDENCE_RANK: Record<string, number> = {
  user_explicit: 0,
  user_confirmed: 1,
  observed: 2,
  inferred: 3,
};

function charCount(text: string): number {
  return [...text].length;
}

export function memoryRevision(docs: Iterable<MemoryDoc>): string {
  const lines = [...docs]
    .map((doc) => `${doc.id}:${doc.content_hash}`)
    .sort((left, right) => left.localeCompare(right));
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

function catalogLines(docs: readonly MemoryDoc[]): string[] {
  const sorted = [...docs].sort((left, right) => {
    const rank = (EVIDENCE_RANK[left.evidence_level] ?? 9) - (EVIDENCE_RANK[right.evidence_level] ?? 9);
    if (rank !== 0) return rank;
    if (left.valid_from !== right.valid_from) return right.valid_from.localeCompare(left.valid_from);
    return left.id.localeCompare(right.id);
  });
  return sorted.map((doc) => `- [${doc.kind}] ${doc.abstract} — ${doc.id}`);
}

function fitCatalog(docs: readonly MemoryDoc[], budget: number): string {
  const lines = catalogLines(docs);
  if (lines.length === 0) return '';
  let used = 0;
  const kept: string[] = [];
  for (const line of lines) {
    const cost = charCount(line) + 1;
    if (used + cost > budget) break;
    kept.push(line);
    used += cost;
  }
  const remaining = lines.length - kept.length;
  if (remaining > 0) {
    const hint =
      docs.length > 200
        ? `- …${remaining} 条未列出（用 memory_recall 检索）`
        : `- …${remaining} 条未列出`;
    kept.push(hint);
  }
  return kept.join('\n');
}

function counted(text: string, counter: 'chars' | 'tokens', measure?: (text: string) => number): number {
  if (counter === 'chars') return charCount(text);
  return measure === undefined ? Math.ceil(charCount(text) / 2.5) : measure(text);
}

export function assemble(input: AssembleInput): AssembleResult {
  const now = input.now ?? (() => new Date());
  const date = input.asOf ?? today(now());

  // T2: re-check the sealed human files right before reading them, so an edit
  // after startup cannot slip into the prompt.
  verifySealedFiles({ home: input.home, policy: input.policy });

  const active = input.source.active(date);
  const revision = memoryRevision(active);

  const existing = readSnapshot(input.home, input.sessionId);
  if (
    existing !== null &&
    existing.prompt_schema_version === PROMPT_SCHEMA_VERSION &&
    existing.parts !== undefined &&
    existing.sectionList !== undefined
  ) {
    return {
      text: existing.text,
      memory_revision: existing.memory_revision,
      captured: false,
      budget: { counter: input.config.inject.counter, estimated: input.measure === undefined, sections: {}, total: 0 },
      sections: existing.sectionList.map((section) => section.key),
      rules: [],
      parts: existing.parts,
      sectionList: existing.sectionList,
      health: existing.health ?? [],
    };
  }

  const built = buildSections({ home: input.home, config: input.config }, input.extraSections ?? []);
  const sectionList: { key: string; order: number; text: string }[] = [...built.entries];
  const parts: Record<string, string> = {};
  for (const entry of sectionList) parts[entry.key] = entry.text;
  const rules = built.rules;

  const catalog = fitCatalog(active, input.config.inject.index_max_chars);
  if (catalog !== '') {
    parts.MEMORY = catalog;
    sectionList.push({ key: 'MEMORY', order: SECTION_ORDERS.MEMORY, text: catalog });
  }
  sectionList.sort((left, right) => left.order - right.order);

  let body = sectionList.map((section) => `## ${section.key}\n${section.text}`).join('\n\n');
  const counter = input.config.inject.counter;
  let total = counted(body, counter, input.measure);
  if (total > input.config.inject.total_max_chars) {
    // Only the catalog may be trimmed further; all other sections are capped.
    const indexSection = sectionList.find((section) => section.key === 'MEMORY');
    if (indexSection === undefined) {
      throw new InjectionError('OVER_BUDGET', `injection is over inject.total_max_chars (${input.config.inject.total_max_chars})`);
    }
    const excess = total - input.config.inject.total_max_chars;
    indexSection.text = fitCatalog(active, Math.max(0, input.config.inject.index_max_chars - excess - 8));
    parts.MEMORY = indexSection.text;
    body = sectionList.map((section) => `## ${section.key}\n${section.text}`).join('\n\n');
    total = counted(body, counter, input.measure);
    if (total > input.config.inject.total_max_chars) {
      throw new InjectionError('OVER_BUDGET', `injection is over inject.total_max_chars (${input.config.inject.total_max_chars})`);
    }
  }

  const delimiter = input.delimiter ?? randomBytes(8).toString('hex');
  const escaped = body.split(delimiter).join('<escaped>');
  const text = `<<AM-${delimiter}>>\n${escaped}\n<<AM-${delimiter}>>`;

  const sectionBudgets: Record<string, number> = {};
  for (const section of sectionList) {
    sectionBudgets[section.key] = counted(section.text, counter, input.measure);
  }

  const record = {
    session_id: input.sessionId,
    memory_revision: revision,
    prompt_schema_version: PROMPT_SCHEMA_VERSION,
    created_at: now().toISOString(),
    text,
    parts,
    sectionList,
    health: built.health,
  };
  if (input.persist !== false) {
    writeSnapshot(input.home, record);
    try {
      const audit = { event: 'snapshot-capture', session_id: input.sessionId };
      if (input.source.appendAudit !== undefined) {
        input.source.appendAudit(audit);
      } else {
        input.source.journal?.append({ op: 'audit', data: audit });
      }
    } catch {
      // Journal trouble is reported by the store; a snapshot is still usable.
    }
  }

  return {
    text,
    memory_revision: revision,
    captured: true,
    budget: {
      counter,
      estimated: counter === 'tokens' && input.measure === undefined,
      sections: sectionBudgets,
      total,
    },
    sections: sectionList.map((section) => section.key),
    rules,
    parts,
    sectionList,
    health: built.health,
  };
}

/** DSH adapter shape: one protected section, no interpolation. */
export function sectionPayload(result: AssembleResult, order = 100) {
  return { name: 'agent-memory', order, text: result.text, interpolate: false as const };
}
