import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { evaluateLongMem } from '../../src/eval/longmem.ts';
import { LONG_MEM_MEMORIES, LONG_MEM_QUERIES } from '../fixtures/longmemeval-subset.ts';

const ROOT = resolve(import.meta.dirname, '../../../..');

interface Floor {
  readonly recallAt5: number;
  readonly mrr: number;
  readonly abstentionFPMax: number;
}
interface Thresholds {
  readonly bm25: Floor;
  readonly hybrid: Floor;
}

const thresholds = JSON.parse(
  readFileSync(join(ROOT, 'docs', 'eval', 's2c-thresholds.json'), 'utf8'),
) as Thresholds;
const baseline = JSON.parse(
  readFileSync(join(ROOT, 'docs', 'eval', 's2c-baseline.json'), 'utf8'),
) as ReturnType<typeof evaluateLongMem>;

test('S21.1 the LongMemEval-style subset is 24 memories / 10 queries across six categories', () => {
  assert.equal(LONG_MEM_MEMORIES.length, 24);
  assert.equal(LONG_MEM_QUERIES.length, 10);
  assert.deepEqual(
    [...new Set(LONG_MEM_QUERIES.map((query) => query.category))].sort(),
    ['abstention', 'knowledge_update', 'multi_session', 'single_session_assistant', 'single_session_user', 'temporal'],
  );
});

test('S21.2 BM25 and hybrid meet the stored floors and the baseline is reproducible', () => {
  const report = evaluateLongMem(LONG_MEM_MEMORIES, LONG_MEM_QUERIES, { limit: 5, embeddingWeight: 400 });
  assert.equal(report.bm25.recallAt5, baseline.bm25.recallAt5);
  assert.equal(report.hybrid.recallAt5, baseline.hybrid.recallAt5);
  for (const mode of ['bm25', 'hybrid'] as const) {
    const actual = report[mode];
    const floor = thresholds[mode];
    assert.ok(actual.recallAt5 >= floor.recallAt5, `${mode} recall@5 ${actual.recallAt5} < ${floor.recallAt5}`);
    assert.ok(actual.mrr >= floor.mrr, `${mode} MRR ${actual.mrr} < ${floor.mrr}`);
    assert.ok(
      actual.abstentionFalsePositiveRate <= floor.abstentionFPMax,
      `${mode} abstention FP ${actual.abstentionFalsePositiveRate} > ${floor.abstentionFPMax}`,
    );
  }
  assert.ok(report.hybrid.recallAt5 + 0.1 >= report.bm25.recallAt5, 'hybrid must not regress recall by more than 0.1');
});
