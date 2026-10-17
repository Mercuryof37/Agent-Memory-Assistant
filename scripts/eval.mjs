import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { evaluate } from '../packages/core/src/eval/evaluate.ts';
import { EVAL_MEMORIES, EVAL_QUERIES } from '../packages/core/test/fixtures/recall-fixture.ts';

/**
 * S3.1a: measure recall and persist the report. CI compares against the stored
 * floor (`docs/eval/s3-thresholds.json`, ADR-0007) via the eval test.
 */

const root = resolve(import.meta.dirname, '..');
const report = evaluate(EVAL_MEMORIES, EVAL_QUERIES, {
  limit: 5,
  minScorePermille: 500,
});

const dir = join(root, 'docs', 'eval');
mkdirSync(dir, { recursive: true });
const out = join(dir, 's3-baseline.json');
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`recall@5 ${report.recallAt5} (dev ${report.devRecall} / heldout ${report.heldoutRecall})`);
console.log(`false positives ${report.falsePositiveRate} · per-kind ${JSON.stringify(report.perKind)}`);
console.log(`p95 ${report.p95Ms}ms · cold start ${report.coldStartMs}ms · heap ${(report.heapBytes / 1048576).toFixed(1)}MB`);
console.log(`written ${out}`);
