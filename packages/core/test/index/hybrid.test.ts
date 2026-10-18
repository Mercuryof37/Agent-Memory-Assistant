import test from 'node:test';
import assert from 'node:assert/strict';
import { cosine, HashEmbeddingProvider } from '../../src/index/embedding.ts';
import { fuseScores } from '../../src/index/hybrid.ts';

test('S20.1 hash embeddings are deterministic and normalized', () => {
  const provider = new HashEmbeddingProvider();
  const left = provider.embed('worktree groups memories by project');
  const right = provider.embed('worktree groups memories by project');
  assert.deepEqual([...left], [...right]);
  assert.ok(Math.abs(cosine(left, left) - 1) < 1e-5);
  assert.ok(cosine(left, provider.embed('unrelated cooking recipe')) < 0.5);
});

test('S20.2 fusion weights lexical and vector scores', () => {
  const lexical = new Map([
    ['a', 1],
    ['b', 0.5],
  ]);
  const vector = new Map([
    ['a', 0],
    ['b', 1],
    ['c', 1],
  ]);
  const fused = fuseScores(lexical, vector, 1000);
  assert.equal(fused.get('c'), 1);
  assert.equal(fused.get('a'), 0);
  assert.equal(fused.get('b'), 1);
});
