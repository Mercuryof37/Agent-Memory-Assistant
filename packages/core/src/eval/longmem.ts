import { activeDocs } from '../model/validity.ts';
import { buildIndex, search } from '../index/bm25.ts';
import { cosine, HashEmbeddingProvider } from '../index/embedding.ts';
import { fuseScores } from '../index/hybrid.ts';
import type { MemoryDoc } from '../model/types.ts';

/** LongMemEval-style offline subset evaluation (V4.0-S2c). */

export type LongMemCategory =
  | 'single_session_user'
  | 'single_session_assistant'
  | 'multi_session'
  | 'temporal'
  | 'knowledge_update'
  | 'abstention';

export interface LongMemQuery {
  readonly id: string;
  readonly category: LongMemCategory;
  readonly query: string;
  readonly expected: string | null;
  readonly asOf?: string;
}

export interface LongMemModeReport {
  readonly recallAt5: number;
  readonly mrr: number;
  readonly abstentionFalsePositiveRate: number;
  readonly perCategory: Readonly<Record<string, number>>;
  readonly p95Ms: number;
}

export interface LongMemReport {
  readonly memories: number;
  readonly queries: number;
  readonly baselineDate: string;
  readonly bm25: LongMemModeReport;
  readonly hybrid: LongMemModeReport;
}

export const LONG_MEM_DATE = '2026-10-17';

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return Number((sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))] as number).toFixed(3));
}

function rankedBm25(
  docs: readonly MemoryDoc[],
  query: string,
  limit: number,
): Array<{ id: string; score: number }> {
  const index = buildIndex(docs, 1);
  return search(index, query, { limit, minScorePermille: 500 });
}

function rankedHybrid(
  docs: readonly MemoryDoc[],
  query: string,
  limit: number,
  weightPermille: number,
): Array<{ id: string; score: number }> {
  const index = buildIndex(docs, 1);
  const lexicalHits = search(index, query, { limit: docs.length, minScorePermille: 0 });
  const provider = new HashEmbeddingProvider();
  const queryVector = provider.embed(query);
  const vector = new Map<string, number>();
  for (const doc of docs) vector.set(doc.id, cosine(provider.embed(`${doc.abstract}\n${doc.body}`), queryVector));
  const lexical = new Map(lexicalHits.map((hit) => [hit.id, hit.score]));
  return [...fuseScores(lexical, vector, weightPermille).entries()]
    .filter(([, score]) => score >= 0.5)
    .map(([id, score]) => ({ id, score }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function evaluateMode(
  memories: readonly MemoryDoc[],
  queries: readonly LongMemQuery[],
  rank: (docs: readonly MemoryDoc[], query: string) => Array<{ id: string; score: number }>,
): LongMemModeReport {
  let expected = 0;
  let found = 0;
  let reciprocal = 0;
  let abstention = 0;
  let abstentionHits = 0;
  const perCategory: Record<string, { expected: number; found: number }> = {};
  const latencies: number[] = [];

  for (const query of queries) {
    const start = performance.now();
    const docs = activeDocs(memories, query.asOf ?? LONG_MEM_DATE);
    const hits = rank(docs, query.query);
    latencies.push(performance.now() - start);

    const category = (perCategory[query.category] ??= { expected: 0, found: 0 });
    if (query.expected === null) {
      abstention += 1;
      if (hits.length > 0) abstentionHits += 1;
      continue;
    }
    expected += 1;
    category.expected += 1;
    const index = hits.findIndex((hit) => hit.id === query.expected);
    if (index >= 0) {
      found += 1;
      category.found += 1;
      reciprocal += 1 / (index + 1);
    }
  }

  const categories: Record<string, number> = {};
  for (const [name, counts] of Object.entries(perCategory)) {
    categories[name] = counts.expected === 0 ? 1 : Number((counts.found / counts.expected).toFixed(4));
  }
  return {
    recallAt5: expected === 0 ? 1 : Number((found / expected).toFixed(4)),
    mrr: expected === 0 ? 1 : Number((reciprocal / expected).toFixed(4)),
    abstentionFalsePositiveRate: abstention === 0 ? 0 : Number((abstentionHits / abstention).toFixed(4)),
    perCategory: categories,
    p95Ms: percentile(latencies, 0.95),
  };
}

export function evaluateLongMem(
  memories: readonly MemoryDoc[],
  queries: readonly LongMemQuery[],
  options: { limit?: number; embeddingWeight?: number } = {},
): LongMemReport {
  const limit = options.limit ?? 5;
  const embeddingWeight = options.embeddingWeight ?? 400;
  return {
    memories: memories.length,
    queries: queries.length,
    baselineDate: LONG_MEM_DATE,
    bm25: evaluateMode(memories, queries, (docs, query) => rankedBm25(docs, query, limit)),
    hybrid: evaluateMode(memories, queries, (docs, query) => rankedHybrid(docs, query, limit, embeddingWeight)),
  };
}
