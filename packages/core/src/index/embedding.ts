import { tokenize } from './tokenizer.ts';

/**
 * Local vector provider seam (V4.0-S2a).
 *
 * `HashEmbeddingProvider` is deterministic and dependency-free: it hashes word
 * and character n-gram features into a fixed vector. It is a *fallback* for
 * tests, offline use and CI, not a semantic model. The ONNX provider (S2b) will
 * implement the same interface and replace the backend without changing the
 * fusion code.
 */

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(text: string): Float32Array;
}

const DIMENSIONS = 256;

function hashFeature(feature: string): number {
  let hash = 2166136261;
  for (let index = 0; index < feature.length; index += 1) {
    hash ^= feature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'hash-256';
  readonly dimensions = DIMENSIONS;

  embed(text: string): Float32Array {
    const vector = new Float32Array(DIMENSIONS);
    const tokens = tokenize(text);
    const features = [...tokens, ...tokens.map((token) => `#${token}`)];
    for (const feature of features) {
      const bucket = hashFeature(feature) % DIMENSIONS;
      vector[bucket] = (vector[bucket] ?? 0) + 1;
    }
    let norm = 0;
    for (const value of vector) norm += value * value;
    norm = Math.sqrt(norm);
    if (norm > 0) for (let index = 0; index < vector.length; index += 1) vector[index] = (vector[index] ?? 0) / norm;
    return vector;
  }
}

export function cosine(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) throw new Error('embedding dimensions differ');
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) dot += (left[index] ?? 0) * (right[index] ?? 0);
  return Math.max(0, Math.min(1, dot));
}
