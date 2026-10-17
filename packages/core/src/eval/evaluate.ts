import { activeDocs } from '../model/validity.ts';
import { buildIndex, search } from '../index/bm25.ts';
import type { Kind, MemoryDoc } from '../model/types.ts';

/**
 * Recall evaluation used by S3 (plan v1.3 §6.3).
 *
 * 60 memories / 16 queries (12 dev + 4 held-out) with a fixed date basis, so the
 * numbers are reproducible. Thresholds live in `docs/eval/s3-thresholds.json`
 * and the current run is written to `docs/eval/s3-baseline.json` by
 * `scripts/eval.mjs`; the test only compares against the stored floor.
 */

export interface EvalQuery {
  readonly id: string;
  readonly split: 'dev' | 'heldout';
  readonly query: string;
  readonly expected: string | null;
  readonly asOf?: string;
  readonly kind?: Kind;
}

export interface EvalReport {
  readonly memories: number;
  readonly queries: number;
  readonly recallAt5: number;
  readonly devRecall: number;
  readonly heldoutRecall: number;
  readonly falsePositiveRate: number;
  readonly perKind: Readonly<Record<string, number>>;
  readonly p95Ms: number;
  readonly coldStartMs: number;
  readonly heapBytes: number;
  readonly limit: number;
  readonly minScorePermille: number;
}

export const EVAL_DATE = '2026-10-17';

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return Number((sorted[index] as number).toFixed(3));
}

export function evaluate(
  memories: readonly MemoryDoc[],
  queries: readonly EvalQuery[],
  options: { limit?: number; minScorePermille?: number } = {},
): EvalReport {
  const limit = options.limit ?? 5;
  const minScorePermille = options.minScorePermille ?? 500;

  const coldStart = performance.now();
  buildIndex(activeDocs(memories, EVAL_DATE), 1);
  const coldStartMs = Number((performance.now() - coldStart).toFixed(3));

  let expected = 0;
  let found = 0;
  let noAnswer = 0;
  let falsePositives = 0;
  const split = { dev: { expected: 0, found: 0 }, heldout: { expected: 0, found: 0 } };
  const kind = { fact: { expected: 0, found: 0 }, pitfall: { expected: 0, found: 0 }, exp: { expected: 0, found: 0 } };
  const latencies: number[] = [];

  for (const query of queries) {
    const start = performance.now();
    const docs = activeDocs(memories, query.asOf ?? EVAL_DATE);
    const index = buildIndex(docs, 1);
    const hits = search(index, query.query, {
      limit,
      minScorePermille,
      ...(query.kind === undefined ? {} : { kinds: [query.kind] }),
    });
    latencies.push(performance.now() - start);

    if (query.expected === null) {
      noAnswer += 1;
      if (hits.length > 0) falsePositives += 1;
      continue;
    }
    expected += 1;
    split[query.split].expected += 1;
    const hit = hits.some((entry) => entry.id === query.expected);
    if (hit) {
      found += 1;
      split[query.split].found += 1;
    }
    if (query.kind !== undefined) {
      kind[query.kind].expected += 1;
      if (hit) kind[query.kind].found += 1;
    }
  }

  const perKind: Record<string, number> = {};
  for (const [name, counts] of Object.entries(kind)) {
    perKind[name] = counts.expected === 0 ? 1 : Number((counts.found / counts.expected).toFixed(4));
  }

  return {
    memories: memories.length,
    queries: queries.length,
    recallAt5: expected === 0 ? 1 : Number((found / expected).toFixed(4)),
    devRecall: split.dev.expected === 0 ? 1 : Number((split.dev.found / split.dev.expected).toFixed(4)),
    heldoutRecall:
      split.heldout.expected === 0 ? 1 : Number((split.heldout.found / split.heldout.expected).toFixed(4)),
    falsePositiveRate: noAnswer === 0 ? 0 : Number((falsePositives / noAnswer).toFixed(4)),
    perKind,
    p95Ms: percentile(latencies, 0.95),
    coldStartMs,
    heapBytes: process.memoryUsage().heapUsed,
    limit,
    minScorePermille,
  };
}
