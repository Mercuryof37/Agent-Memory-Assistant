import type { Kind, MemoryDoc, MemoryId } from '../model/types.ts';
import { tokenize } from './tokenizer.ts';

/**
 * Field-weighted BM25 over the active set (plan v1.3 §6.3).
 *
 * weights: error_signatures ×4, abstract ×3, body ×1; k1=1.2, b=0.75.
 * A literal hit adds a bonus, so error codes and quoted strings still rank well
 * when tokenization is ambiguous. Scores are normalized to 0..1 (top hit = 1)
 * before `recall.min_score` (per-mille) is applied.
 */

const K1 = 1.2;
const B = 0.75;
const WEIGHTS = { abstract: 3, body: 1, signatures: 4 } as const;
const LITERAL_BONUS = { abstract: 3, body: 1, signatures: 2 } as const;

interface FieldStats {
  readonly length: number;
  readonly frequencies: ReadonlyMap<string, number>;
}

export interface IndexedDoc {
  readonly id: MemoryId;
  readonly kind: Kind;
  readonly abstract: string;
  readonly body: string;
  readonly error_signatures: readonly string[];
  readonly valid_from: string;
  readonly valid_until: string | null;
  readonly fields: {
    readonly abstract: FieldStats;
    readonly body: FieldStats;
    readonly signatures: FieldStats;
  };
}

export interface SearchIndex {
  readonly tokenizer_version: number;
  readonly size: number;
  readonly docs: readonly IndexedDoc[];
  readonly df: ReadonlyMap<string, number>;
  readonly averages: { readonly abstract: number; readonly body: number; readonly signatures: number };
}

function frequencies(tokens: readonly string[]): FieldStats {
  const map = new Map<string, number>();
  for (const token of tokens) map.set(token, (map.get(token) ?? 0) + 1);
  return { length: tokens.length, frequencies: map };
}

export function buildIndex(docs: Iterable<MemoryDoc>, tokenizerVersion = 1): SearchIndex {
  const indexed: IndexedDoc[] = [];
  const df = new Map<string, number>();
  let abstractLength = 0;
  let bodyLength = 0;
  let signatureLength = 0;

  for (const doc of docs) {
    const abstractTokens = tokenize(doc.abstract);
    const bodyTokens = tokenize(doc.body);
    const signatureTokens = doc.error_signatures.flatMap((signature) => tokenize(signature));
    abstractLength += abstractTokens.length;
    bodyLength += bodyTokens.length;
    signatureLength += signatureTokens.length;

    const seen = new Set<string>();
    for (const token of [...abstractTokens, ...bodyTokens, ...signatureTokens]) {
      if (seen.has(token)) continue;
      seen.add(token);
      df.set(token, (df.get(token) ?? 0) + 1);
    }

    indexed.push({
      id: doc.id,
      kind: doc.kind,
      abstract: doc.abstract,
      body: doc.body,
      error_signatures: doc.error_signatures,
      valid_from: doc.valid_from,
      valid_until: doc.valid_until,
      fields: {
        abstract: frequencies(abstractTokens),
        body: frequencies(bodyTokens),
        signatures: frequencies(signatureTokens),
      },
    });
  }

  const size = indexed.length;
  return {
    tokenizer_version: tokenizerVersion,
    size,
    docs: indexed,
    df,
    averages: {
      abstract: size === 0 ? 0 : abstractLength / size,
      body: size === 0 ? 0 : bodyLength / size,
      signatures: size === 0 ? 0 : signatureLength / size,
    },
  };
}

function idf(index: SearchIndex, term: string): number {
  const df = index.df.get(term) ?? 0;
  return Math.log(1 + (index.size - df + 0.5) / (df + 0.5));
}

function fieldScore(
  frequencies: ReadonlyMap<string, number>,
  length: number,
  average: number,
  term: string,
): number {
  const tf = frequencies.get(term) ?? 0;
  if (tf === 0 || average === 0) return 0;
  return (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * length) / average));
}

export interface SearchOptions {
  readonly limit: number;
  readonly minScorePermille: number;
  readonly kinds?: readonly Kind[];
}

export interface SearchHit {
  readonly id: MemoryId;
  readonly score: number;
}

export function search(index: SearchIndex, query: string, options: SearchOptions): SearchHit[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0 || index.size === 0) return [];
  const literal = query.normalize('NFKC').toLowerCase().trim();
  const kindFilter = options.kinds === undefined ? undefined : new Set(options.kinds);

  const scored: Array<{ doc: IndexedDoc; score: number }> = [];
  for (const doc of index.docs) {
    if (kindFilter !== undefined && !kindFilter.has(doc.kind)) continue;
    let score = 0;
    for (const term of terms) {
      const weight = idf(index, term);
      score +=
        weight *
        (WEIGHTS.abstract *
          fieldScore(doc.fields.abstract.frequencies, doc.fields.abstract.length, index.averages.abstract, term) +
          WEIGHTS.body *
            fieldScore(doc.fields.body.frequencies, doc.fields.body.length, index.averages.body, term) +
          WEIGHTS.signatures *
            fieldScore(
              doc.fields.signatures.frequencies,
              doc.fields.signatures.length,
              index.averages.signatures,
              term,
            ));
    }
    if (score === 0) continue;
    if (literal !== '') {
      const normalizedAbstract = doc.abstract.normalize('NFKC').toLowerCase();
      const normalizedBody = doc.body.normalize('NFKC').toLowerCase();
      const signatureText = doc.error_signatures.join('\n').normalize('NFKC').toLowerCase();
      if (normalizedAbstract.includes(literal)) score += LITERAL_BONUS.abstract * (idf(index, literal) + 1);
      if (normalizedBody.includes(literal)) score += LITERAL_BONUS.body;
      if (signatureText.includes(literal)) score += LITERAL_BONUS.signatures;
    }
    scored.push({ doc, score });
  }
  if (scored.length === 0) return [];

  const max = Math.max(...scored.map((entry) => entry.score));
  const minimum = options.minScorePermille / 1000;
  return scored
    .map((entry) => ({ doc: entry.doc, normalized: entry.score / max }))
    .filter((entry) => entry.normalized >= minimum)
    .sort((left, right) => {
      if (right.normalized !== left.normalized) return right.normalized - left.normalized;
      if (right.doc.valid_from !== left.doc.valid_from) return right.doc.valid_from.localeCompare(left.doc.valid_from);
      return left.doc.id.localeCompare(right.doc.id);
    })
    .slice(0, options.limit)
    .map((entry) => ({ id: entry.doc.id, score: Number(entry.normalized.toFixed(6)) }));
}
