import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  parseAndValidateRules,
  parseRules,
  renderRules,
  validateRules,
} from '../../src/rules/rules.ts';

const ROOT = resolve(import.meta.dirname, '../../../..');

const SAMPLE = `# rules
1. [机器门禁] writes go through mem add only.
   check: packages/cli/src/main.ts#commandAdd
   test: packages/core/test/rules/rules.test.ts
2. [模型指引] prefer naming error codes.
3. [废止] old auto-merge rule.
`;

test('[neg] S3.6 a machine gate missing check/test is rejected', () => {
  const parsed = parseRules('1. [机器门禁] no evidence\n');
  assert.ok(parsed.errors.some((error) => /needs "check:"/.test(error)));
  assert.ok(parsed.errors.some((error) => /needs "test:"/.test(error)));
});

test('S3.6 rules render with numbers and categories, revoked excluded by default', () => {
  const { rules, errors } = parseRules(SAMPLE);
  assert.deepEqual(errors, []);
  const rendered = renderRules(rules);
  assert.match(rendered, /^1\. \[机器门禁\] writes go through mem add only\./m);
  assert.match(rendered, /^2\. \[模型指引\] prefer naming error codes\./m);
  assert.doesNotMatch(rendered, /废止/);
  assert.match(renderRules(rules, { includeRevoked: true }), /3\. \[废止\]/);
});

test('S3.6 [模型指引] must not claim to be a guarantee', () => {
  const parsed = parseRules('1. [模型指引] 这条保证不会泄漏。\n');
  assert.ok(parsed.errors.some((error) => /must not be described as a guarantee/.test(error)));
});

test('S3.6 duplicate rule numbers are rejected', () => {
  const parsed = parseRules('1. [模型指引] a\n1. [模型指引] b\n');
  assert.ok(parsed.errors.some((error) => /duplicate number/.test(error)));
});

test('S3.6 a machine gate needs an existing symbol, an existing test file and a [neg] case', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-memory-rules-'));
  try {
    writeFileSync(join(dir, 'no-neg.test.ts'), "test('positive only', () => {});\n");
    const parsed = parseRules(`1. [机器门禁] x
   check: missing.ts#thing
   test: no-neg.test.ts
`);
    const errors = validateRules(parsed.rules, { rootDir: dir });
    assert.ok(errors.some((error) => /does not name an existing symbol/.test(error)));
    assert.ok(errors.some((error) => /has no \[neg\] case/.test(error)));

    const missingTest = validateRules(parseRules('1. [机器门禁] x\n   check: a.ts#b\n   test: nope.test.ts\n').rules, {
      rootDir: dir,
    });
    assert.ok(missingTest.some((error) => /does not exist/.test(error)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('S3.6 the repository RULES.md is valid', () => {
  const text = readFileSync(join(ROOT, 'RULES.md'), 'utf8');
  const result = parseAndValidateRules(text, { rootDir: ROOT });
  assert.deepEqual(result.errors, []);
  assert.ok(result.rules.some((rule) => rule.category === 'machine'));
  assert.ok(result.rules.some((rule) => rule.category === 'guide'));
});
