import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseAndValidateRules } from '../packages/core/src/rules/rules.ts';

/**
 * CI gate for the repository RULES.md: every `[机器门禁]` needs a check symbol,
 * an existing test file, and a `[neg]` case in it (plan v1.3 §9.2).
 */

const root = resolve(import.meta.dirname, '..');
const text = readFileSync(join(root, 'RULES.md'), 'utf8');
const { rules, errors } = parseAndValidateRules(text, { rootDir: root });

if (rules.length === 0) {
  console.error('rules gate: RULES.md has no entries');
  process.exit(1);
}
if (errors.length > 0) {
  console.error('rules gate failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
const machine = rules.filter((rule) => rule.category === 'machine').length;
const guide = rules.filter((rule) => rule.category === 'guide').length;
const revoked = rules.filter((rule) => rule.category === 'revoked').length;
console.log(`PASS  rules-file: ${machine} machine / ${guide} guide / ${revoked} revoked, all gates have [neg]`);
