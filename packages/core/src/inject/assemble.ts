import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { Config } from '../config/config.ts';
import type { Policy } from '../policy/policy.ts';
import { verifySealedFiles } from '../policy/policy.ts';
import { memoryPaths } from '../paths.ts';
import { parseRules, renderRules, validateRules, type Rule } from '../rules/rules.ts';
import { today } from '../model/validity.ts';
import type { MemoryDoc } from '../model/types.ts';
import { renderGuidance } from '../personalization/guidance.ts';
import { readSnapshot, writeSnapshot, PROMPT_SCHEMA_VERSION } from './snapshot.ts';

/**
 * Injection assembly (plan v1.3 §6.1).
 *
 * Four fixed sections (SOUL, USER, RULES, memory catalog) are rendered with
 * per-section budgets, then wrapped in a random 16-hex delimiter so fenced code
 * or `</memory>` inside a memory cannot escape its block. The text is frozen per
 * session in `.state/snapshots/`; a new session captures the current revision.
 *
 * `RULES.md` over budget is a hard failure, never truncated. The catalog is
 * trimmed deterministically (evidence rank -> valid_from -> id) and always
 * reports how many entries it left out.
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
  /** Per-source text, one entry per human/maintained source (empty when absent). */
  readonly parts: Readonly<Record<'SOUL' | 'GUIDANCE' | 'RULES' | 'USER' | 'MEMORY', string>>;
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

/** Templates ship as HTML comments; they must not reach the prompt or parser. */
function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

function truncate(text: string, budget: number): string {
  const points = [...text];
  if (points.length <= budget) return text;
  if (budget <= 1) return '…';
  return `${points.slice(0, budget - 1).join('')}…`;
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
  const paths = memoryPaths(input.home);

  // T2: re-check the sealed human files right before reading them, so an edit
  // after startup cannot slip into the prompt.
  verifySealedFiles({ home: input.home, policy: input.policy });

  const active = input.source.active(date);
  const revision = memoryRevision(active);

  const existing = readSnapshot(input.home, input.sessionId);
  if (
    existing !== null &&
    existing.prompt_schema_version === PROMPT_SCHEMA_VERSION &&
    existing.parts !== undefined
  ) {
    return {
      text: existing.text,
      memory_revision: existing.memory_revision,
      captured: false,
      budget: { counter: input.config.inject.counter, estimated: input.measure === undefined, sections: {}, total: 0 },
      sections: [],
      rules: [],
      parts: existing.parts,
    };
  }

  const readIfExists = (file: string): string =>
    existsSync(file) ? stripHtmlComments(readFileSync(file, 'utf8')).trim() : '';

  const soul = readIfExists(paths.soulFile);
  const user = readIfExists(paths.userFile);
  const rulesText = readIfExists(paths.rulesFile);
  const parsed = parseRules(rulesText);
  const ruleErrors = [...parsed.errors, ...validateRules(parsed.rules, { rootDir: input.home })];
  if (ruleErrors.length > 0) {
    throw new InjectionError('RULES_INVALID', `RULES.md rejected: ${ruleErrors.join('; ')}`);
  }
  const rules = parsed.rules;
  const renderedRules = renderRules(rules, { includeRevoked: false });

  const parts: Record<'SOUL' | 'GUIDANCE' | 'RULES' | 'USER' | 'MEMORY', string> = {
    SOUL: soul === '' ? '' : truncate(soul, input.config.inject.persona_max_chars),
    GUIDANCE: truncate(renderGuidance(input.config.personalization.mode), input.config.inject.guidance_max_chars),
    USER: user === '' ? '' : truncate(user, input.config.inject.user_max_chars),
    RULES: renderedRules,
    MEMORY: '',
  };
  const sections: Array<{ title: string; text: string }> = [];
  for (const title of ['SOUL', 'GUIDANCE', 'RULES', 'USER'] as const) {
    if (parts[title] !== '') sections.push({ title, text: parts[title] });
  }
  if (renderedRules !== '' && charCount(renderedRules) > input.config.inject.rules_max_chars) {
    throw new InjectionError(
      'RULES_OVER_BUDGET',
      `RULES.md renders to ${charCount(renderedRules)} chars, over inject.rules_max_chars (${input.config.inject.rules_max_chars}); trim the rules instead of relying on truncation`,
    );
  }
  const catalog = fitCatalog(active, input.config.inject.index_max_chars);
  if (catalog !== '') {
    parts.MEMORY = catalog;
    sections.push({ title: 'MEMORY', text: catalog });
  }

  let body = sections.map((section) => `## ${section.title}\n${section.text}`).join('\n\n');
  const counter = input.config.inject.counter;
  let total = counted(body, counter, input.measure);
  if (total > input.config.inject.total_max_chars) {
    // Only the catalog may be trimmed further; rules were already checked.
    const indexSection = sections.find((section) => section.title === 'MEMORY');
    if (indexSection === undefined) {
      throw new InjectionError('OVER_BUDGET', `injection is over inject.total_max_chars (${input.config.inject.total_max_chars})`);
    }
    const excess = total - input.config.inject.total_max_chars;
    indexSection.text = fitCatalog(active, Math.max(0, input.config.inject.index_max_chars - excess - 8));
    body = sections.map((section) => `## ${section.title}\n${section.text}`).join('\n\n');
    total = counted(body, counter, input.measure);
    if (total > input.config.inject.total_max_chars) {
      throw new InjectionError('OVER_BUDGET', `injection is over inject.total_max_chars (${input.config.inject.total_max_chars})`);
    }
  }

  const delimiter = input.delimiter ?? randomBytes(8).toString('hex');
  const escaped = body.split(delimiter).join('<escaped>');
  const text = `<<AM-${delimiter}>>\n${escaped}\n<<AM-${delimiter}>>`;

  const sectionBudgets: Record<string, number> = {};
  for (const section of sections) sectionBudgets[section.title] = counted(section.text, counter, input.measure);

  const record = {
    session_id: input.sessionId,
    memory_revision: revision,
    prompt_schema_version: PROMPT_SCHEMA_VERSION,
    created_at: now().toISOString(),
    text,
    parts,
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
    sections: sections.map((section) => section.title),
    rules,
    parts,
  };
}

/** DSH adapter shape: one protected section, no interpolation. */
export function sectionPayload(result: AssembleResult, order = 100) {
  return { name: 'agent-memory', order, text: result.text, interpolate: false as const };
}
