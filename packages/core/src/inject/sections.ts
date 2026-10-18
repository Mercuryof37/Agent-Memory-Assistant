import { existsSync, readFileSync } from 'node:fs';
import type { Config } from '../config/config.ts';
import { memoryPaths } from '../paths.ts';
import { renderGuidance } from '../personalization/guidance.ts';
import { parseRules, renderRules, validateRules, type Rule } from '../rules/rules.ts';

/**
 * Section registry (architecture v2, P0.5). Each injected block is one source
 * with its own order, budget and failure mode. A broken optional section only
 * degrades itself (visible notice + health entry); sealed-file and store
 * integrity checks stay outside and remain global.
 *
 * Adding a document layer later means adding one source here (or passing one
 * through `AssembleInput.extraSections`) — assemble() and the GUI do not change.
 */

export interface SectionSource {
  readonly key: string;
  readonly order: number;
  /** Hard character cap; undefined means the source enforces its own budget. */
  readonly maxChars?: number;
  /** Render the raw text (parse/validate). Throw to degrade this section. */
  readonly render?: (text: string) => string;
  readonly load: () => string;
}

export interface SectionContext {
  readonly home: string;
  readonly config: Config;
}

export interface SectionHealth {
  readonly key: string;
  readonly ok: boolean;
  readonly message?: string;
}

export interface BuiltSections {
  readonly entries: readonly { key: string; order: number; text: string }[];
  readonly health: readonly SectionHealth[];
  readonly rules: readonly Rule[];
}

const COMMENT = /<!--[\s\S]*?-->/g;

function charCount(text: string): number {
  return [...text].length;
}

function truncate(text: string, budget: number): string {
  const points = [...text];
  if (points.length <= budget) return text;
  if (budget <= 1) return '…';
  return `${points.slice(0, budget - 1).join('')}…`;
}

function readIfExists(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8').replace(COMMENT, '').trim() : '';
}

export const SECTION_ORDERS = { SOUL: 100, GUIDANCE: 110, RULES: 150, USER: 200, MEMORY: 300 } as const;

export function builtinSectionSources(context: SectionContext): SectionSource[] {
  const paths = memoryPaths(context.home);
  return [
    {
      key: 'SOUL',
      order: SECTION_ORDERS.SOUL,
      maxChars: context.config.inject.persona_max_chars,
      load: () => readIfExists(paths.soulFile),
    },
    {
      key: 'GUIDANCE',
      order: SECTION_ORDERS.GUIDANCE,
      maxChars: context.config.inject.guidance_max_chars,
      load: () => renderGuidance(context.config.personalization.mode),
    },
    {
      key: 'RULES',
      order: SECTION_ORDERS.RULES,
      render: (text) => {
        const parsed = parseRules(text);
        const errors = [...parsed.errors, ...validateRules(parsed.rules, { rootDir: context.home })];
        if (errors.length > 0) throw new Error(`RULES.md rejected: ${errors.join('; ')}`);
        const rendered = renderRules(parsed.rules, { includeRevoked: false });
        if (charCount(rendered) > context.config.inject.rules_max_chars) {
          throw new Error(
            `RULES.md renders to ${charCount(rendered)} chars, over inject.rules_max_chars (${context.config.inject.rules_max_chars})`,
          );
        }
        return rendered;
      },
      load: () => readIfExists(paths.rulesFile),
    },
    {
      key: 'USER',
      order: SECTION_ORDERS.USER,
      maxChars: context.config.inject.user_max_chars,
      load: () => readIfExists(paths.userFile),
    },
  ];
}

/** Render every source, degrading only the failing one. */
export function buildSections(context: SectionContext, extra: readonly SectionSource[] = []): BuiltSections {
  const sources = [...builtinSectionSources(context), ...extra].sort((left, right) => left.order - right.order);
  const entries: { key: string; order: number; text: string }[] = [];
  const health: SectionHealth[] = [];
  const rules: Rule[] = [];

  for (const source of sources) {
    try {
      const loaded = source.load();
      const rendered = source.render === undefined ? loaded : source.render(loaded);
      const text = source.maxChars === undefined ? rendered : truncate(rendered, source.maxChars);
      if (text !== '') entries.push({ key: source.key, order: source.order, text });
      health.push({ key: source.key, ok: true });
      if (source.key === 'RULES') {
        rules.push(...parseRules(loaded).rules);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const notice = `⚠ 本节不可用（${source.key}）：${message}`.slice(0, 200);
      entries.push({ key: source.key, order: source.order, text: notice });
      health.push({ key: source.key, ok: false, message });
    }
  }

  return { entries, health, rules };
}
