import type { MemoryId } from '../model/types.ts';

/** Fuse normalized lexical and vector scores; both inputs are 0..1. */
export function fuseScores(
  lexical: ReadonlyMap<MemoryId, number>,
  vector: ReadonlyMap<MemoryId, number>,
  embeddingWeightPermille: number,
): Map<MemoryId, number> {
  const weight = Math.min(1000, Math.max(0, embeddingWeightPermille)) / 1000;
  const ids = new Set<MemoryId>([...lexical.keys(), ...vector.keys()]);
  const fused = new Map<MemoryId, number>();
  for (const id of ids) {
    const lexicalScore = lexical.get(id) ?? 0;
    const vectorScore = vector.get(id) ?? 0;
    fused.set(id, (1 - weight) * lexicalScore + weight * vectorScore);
  }
  return fused;
}
