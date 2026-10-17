import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Closure check: does the paperwork still match the code and the plan?
 *
 *   node scripts/closure.mjs S2b
 *
 * Runs after ci + smoke + ADR + acceptance ids (via stage.mjs) and checks the
 * promises that no compiler enforces:
 *   1. every stage marked done in the README roadmap has an existing ADR and a
 *      "第 N 轮" entry in the completed-features log;
 *   2. every todo item whose stage is due (<= the current stage) is no longer
 *      "待办"; carries need a reason;
 *   3. every open question whose latest stage is due is resolved or carried;
 *   4. the README links to the todo/open-questions files and they exist.
 */

const root = resolve(import.meta.dirname, '..');
const stage = process.argv[2] ?? 'S2b';

const STAGE_ORDER = ['S0', 'S1', 'S2a', 'S2b', 'S3', 'S4', 'S6', 'S7'];
const rank = (name) => {
  const normalized = name.replace(/前$/, '');
  return STAGE_ORDER.indexOf(normalized);
};

if (rank(stage) < 0) {
  console.error(`closure: unknown stage ${stage}`);
  process.exit(1);
}

const failures = [];
function check(ok, name, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures.push(detail ?? name);
}

const readme = readFileSync(join(root, 'README.md'), 'utf8');

// 1. Roadmap rows marked done -> ADR exists + completed-features entry exists.
const doneRows = [];
for (const line of readme.split('\n')) {
  const match = /^\|\s*\*\*(S\w+)\*\*\s*\|/.exec(line);
  if (match === null) continue;
  const columns = line.split('|').map((cell) => cell.trim());
  const status = columns[6] ?? '';
  if (!status.startsWith('✅')) continue;
  doneRows.push({ stage: match[1], line });
}
check(doneRows.length > 0, 'roadmap has at least one completed stage');

const completedSection = readme.slice(readme.indexOf('## 已完成功能'));
for (const row of doneRows) {
  const adrLinks = [...row.line.matchAll(/\]\(([^)]+\.md)\)/g)].map((match) => match[1]);
  const adrOk = adrLinks.length > 0 && adrLinks.every((link) => existsSync(join(root, link)));
  check(adrOk, `${row.stage}: ADR link exists`, `${row.stage} is ✅ but its ADR link is missing or broken`);

  const roundOk = new RegExp(`第\\s*\\d+\\s*轮\\s*·\\s*${row.stage}`).test(completedSection);
  check(roundOk, `${row.stage}: completed-features entry exists`, `${row.stage} is ✅ but has no "第 N 轮 · ${row.stage}" entry`);
}

// 2. Todo items due at or before this stage are done/accepted/carried.
const todoPath = join(root, 'docs', 'plan', 'todo.md');
check(existsSync(todoPath), 'docs/plan/todo.md exists');
const todo = readFileSync(todoPath, 'utf8');
const todoRows = [];
for (const line of todo.split('\n')) {
  const match = /^\|\s*(T\d+)\s*\|\s*([^|]+?)\s*\|/.exec(line);
  if (match === null) continue;
  const columns = line.split('|').map((cell) => cell.trim());
  todoRows.push({ id: match[1], stage: match[2], status: columns[7] ?? '' });
}
check(todoRows.length > 0, 'todo list has items');
for (const item of todoRows) {
  if (rank(item.stage) < 0 || rank(item.stage) > rank(stage)) continue;
  const ok = /^(完成|接受)/.test(item.status) || /^顺延（.+）$/.test(item.status);
  check(ok, `${item.id} (${item.stage}) is closed`, `${item.id} is due (<= ${stage}) but status is "${item.status}"`);
}

// 3. Open questions due at or before this stage are resolved or carried.
const questionsPath = join(root, 'docs', 'plan', 'open-questions.md');
check(existsSync(questionsPath), 'docs/plan/open-questions.md exists');
const questions = readFileSync(questionsPath, 'utf8');
const questionRows = [];
for (const line of questions.split('\n')) {
  const match = /^\|\s*(Q\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/.exec(line);
  if (match === null) continue;
  questionRows.push({ id: match[1], latest: match[3].trim(), status: match[4].trim() });
}
check(questionRows.length > 0, 'open-questions has rows');
for (const row of questionRows) {
  if (rank(row.latest) < 0 || rank(row.latest) > rank(stage)) continue;
  const ok = /已解决|顺延/.test(row.status);
  check(ok, `${row.id} (${row.latest}) is resolved or carried`, `${row.id} is due (<= ${stage}) but status is "${row.status}"`);
}

// 4. README points at the planning files.
check(readme.includes('docs/plan/todo.md'), 'README links todo.md');
check(readme.includes('docs/plan/open-questions.md'), 'README links open-questions.md');

if (failures.length > 0) {
  console.error(`\nclosure failed (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\nclosure ok for ${stage}`);
