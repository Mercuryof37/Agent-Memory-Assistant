import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memoryPaths } from '../paths.ts';

/**
 * RULES.md parser and validator (plan v1.3 §4.3, §9.2).
 *
 * Entry shape:
 *
 *   1. [机器门禁] one line of rule text
 *      check: packages/cli/src/main.ts#commandAdd
 *      test: packages/core/test/rules/rules.test.ts
 *   2. [模型指引] advice for the model, never a system guarantee
 *   3. [废止] a retired entry keeps its number and is labelled
 *
 * A `[机器门禁]` entry is valid only when `check` names an existing symbol, the
 * `test` file exists, and that test file contains a `[neg]` case. `[模型指引]`
 * must not claim to be a guarantee.
 */

export type RuleCategory = 'machine' | 'guide' | 'revoked';

export interface Rule {
  readonly number: number;
  readonly category: RuleCategory;
  readonly text: string;
  readonly check?: string;
  readonly test?: string;
}

export interface RulesParseResult {
  readonly rules: readonly Rule[];
  readonly errors: readonly string[];
}

const HEADER = /^(\d+)\.\s*\[(机器门禁|模型指引|废止)\]\s*(.*)$/;
const EXTRA = /^\s+(check|test):\s*(.+)$/;

export function parseRules(text: string): RulesParseResult {
  const normalized = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replaceAll('\r\n', '\n');
  const rules: Rule[] = [];
  const errors: string[] = [];
  const seen = new Set<number>();
  let current: { number: number; category: RuleCategory; text: string; check?: string; test?: string } | undefined;

  const flush = (): void => {
    if (current === undefined) return;
    rules.push({ ...current });
    current = undefined;
  };

  for (const raw of normalized.split('\n')) {
    const line = raw.trimEnd();
    const header = HEADER.exec(line);
    if (header !== null) {
      flush();
      const number = Number(header[1]);
      const label = header[2] as '机器门禁' | '模型指引' | '废止';
      if (seen.has(number)) errors.push(`rule ${number}: duplicate number`);
      seen.add(number);
      current = {
        number,
        category: label === '机器门禁' ? 'machine' : label === '模型指引' ? 'guide' : 'revoked',
        text: (header[3] ?? '').trim(),
      };
      continue;
    }
    if (current === undefined) continue;
    const extra = EXTRA.exec(line);
    if (extra !== null) {
      if (extra[1] === 'check') current.check = (extra[2] ?? '').trim();
      else current.test = (extra[2] ?? '').trim();
      continue;
    }
    if (line.trim() === '') continue;
    current.text = `${current.text} ${line.trim()}`.trim();
  }
  flush();

  for (const rule of rules) {
    if (rule.category === 'machine') {
      if (rule.check === undefined || rule.check === '') errors.push(`rule ${rule.number}: [机器门禁] needs "check:"`);
      if (rule.test === undefined || rule.test === '') errors.push(`rule ${rule.number}: [机器门禁] needs "test:"`);
    }
    if (rule.category === 'guide' && /保证|guarantee/i.test(rule.text)) {
      errors.push(`rule ${rule.number}: [模型指引] must not be described as a guarantee`);
    }
  }
  return { rules, errors };
}

export interface RuleValidationOptions {
  /** Repository root used to resolve `check` and `test` paths. */
  readonly rootDir: string;
}

/** Resolve a `path#symbol` check and confirm the symbol appears in that file. */
function checkSymbolExists(check: string, rootDir: string): boolean {
  const [path, symbol] = check.split('#');
  if (path === undefined || symbol === undefined || path === '' || symbol === '') return false;
  const file = join(rootDir, path);
  if (!existsSync(file)) return false;
  return readFileSync(file, 'utf8').includes(symbol);
}

export function validateRules(rules: readonly Rule[], options: RuleValidationOptions): string[] {
  const errors: string[] = [];
  for (const rule of rules) {
    if (rule.category !== 'machine') continue;
    if (rule.check === undefined || !checkSymbolExists(rule.check, options.rootDir)) {
      errors.push(`rule ${rule.number}: check "${rule.check ?? ''}" does not name an existing symbol`);
    }
    if (rule.test === undefined) continue;
    const testFile = join(options.rootDir, rule.test);
    if (!existsSync(testFile)) {
      errors.push(`rule ${rule.number}: test file "${rule.test}" does not exist`);
      continue;
    }
    if (!/\[neg\]/.test(readFileSync(testFile, 'utf8'))) {
      errors.push(`rule ${rule.number}: test file "${rule.test}" has no [neg] case`);
    }
  }
  return errors;
}

export function parseAndValidateRules(text: string, options: RuleValidationOptions): RulesParseResult {
  const parsed = parseRules(text);
  return { rules: parsed.rules, errors: [...parsed.errors, ...validateRules(parsed.rules, options)] };
}

/** Read and parse the store's RULES.md (used by `rules_list`). */
export function loadRules(home: string): readonly Rule[] {
  const file = memoryPaths(home).rulesFile;
  if (!existsSync(file)) return [];
  return parseRules(readFileSync(file, 'utf8')).rules;
}

/** Numbered rendering for injection; `[废止]` is labelled but not enforceable. */
export function renderRules(rules: readonly Rule[], options: { includeRevoked?: boolean } = {}): string {
  const lines: string[] = [];
  for (const rule of rules) {
    if (rule.category === 'revoked' && options.includeRevoked !== true) continue;
    const label = rule.category === 'machine' ? '机器门禁' : rule.category === 'guide' ? '模型指引' : '废止';
    lines.push(`${rule.number}. [${label}] ${rule.text}`);
  }
  return lines.join('\n');
}
