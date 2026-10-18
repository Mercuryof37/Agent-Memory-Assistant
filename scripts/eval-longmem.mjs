import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { evaluateLongMem } from '../packages/core/src/eval/longmem.ts';
import { LONG_MEM_MEMORIES, LONG_MEM_QUERIES } from '../packages/core/test/fixtures/longmemeval-subset.ts';

const root = resolve(import.meta.dirname, '..');
const report = evaluateLongMem(LONG_MEM_MEMORIES, LONG_MEM_QUERIES, { limit: 5, embeddingWeight: 400 });
const dir = join(root, 'docs', 'eval');
mkdirSync(dir, { recursive: true });
const out = join(dir, 's2c-baseline.json');
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`bm25  recall@5 ${report.bm25.recallAt5}  mrr ${report.bm25.mrr}  abstain-FP ${report.bm25.abstentionFalsePositiveRate}`);
console.log(`hybrid recall@5 ${report.hybrid.recallAt5}  mrr ${report.hybrid.mrr}  abstain-FP ${report.hybrid.abstentionFalsePositiveRate}`);
console.log(`written ${out}`);
