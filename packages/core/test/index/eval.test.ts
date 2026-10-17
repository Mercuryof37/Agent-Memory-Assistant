import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { evaluate } from '../../src/eval/evaluate.ts';
import { EVAL_MEMORIES, EVAL_QUERIES } from '../fixtures/recall-fixture.ts';

const ROOT = resolve(import.meta.dirname, '../../../..');

interface Thresholds {
  readonly recallAt5: number;
  readonly devRecall: number;
  readonly heldoutRecall: number;
  readonly falsePositiveRateMax: number;
  readonly perKind: Record<string, number>;
}

const thresholds = JSON.parse(
  readFileSync(join(ROOT, 'docs', 'eval', 's3-thresholds.json'), 'utf8'),
) as Thresholds;

test('S3.1a the fixture is 60 memories / 16 queries (12 dev / 4 held-out) and metrics are reproducible', () => {
  assert.equal(EVAL_MEMORIES.length, 60);
  assert.equal(EVAL_QUERIES.length, 16);
  assert.equal(EVAL_QUERIES.filter((query) => query.split === 'dev').length, 12);
  assert.equal(EVAL_QUERIES.filter((query) => query.split === 'heldout').length, 4);

  const report = evaluate(EVAL_MEMORIES, EVAL_QUERIES, { limit: 5, minScorePermille: 500 });
  assert.equal(report.memories, 60);
  assert.equal(report.queries, 16);
  assert.ok(report.p95Ms >= 0);
  assert.ok(report.coldStartMs >= 0);
  assert.ok(existsSync(join(ROOT, 'docs', 'eval', 's3-baseline.json')));
  const baseline = JSON.parse(readFileSync(join(ROOT, 'docs', 'eval', 's3-baseline.json'), 'utf8')) as {
    recallAt5: number;
  };
  assert.equal(report.recallAt5, baseline.recallAt5);
});

test('S3.1b recall is at or above the ADR-0007 floor and false positives stay at or below it', () => {
  const report = evaluate(EVAL_MEMORIES, EVAL_QUERIES, { limit: 5, minScorePermille: 500 });
  assert.ok(report.recallAt5 >= thresholds.recallAt5, `recall@5 ${report.recallAt5} < ${thresholds.recallAt5}`);
  assert.ok(report.devRecall >= thresholds.devRecall);
  assert.ok(report.heldoutRecall >= thresholds.heldoutRecall);
  assert.ok(report.falsePositiveRate <= thresholds.falsePositiveRateMax);
  for (const [kind, floor] of Object.entries(thresholds.perKind)) {
    assert.ok((report.perKind[kind] ?? 0) >= floor, `per-kind ${kind} regressed`);
  }
});
