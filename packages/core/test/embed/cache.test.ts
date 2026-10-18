import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initStore } from '../../src/init.ts';
import { loadConfig } from '../../src/config/load.ts';
import { MemoryStore } from '../../src/store/store.ts';
import { embedTexts, writeEmbeddingCache } from '../../src/embed/cache.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

test('S20.4 sidecar vectorizer fills the cache and recallAsync fuses it', async (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const script = join(home, 'fake-vectorizer.mjs');
  writeFileSync(
    script,
    [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      'const input = JSON.parse(readFileSync(process.argv[2], "utf8"));',
      'const vectors = input.texts.map((text) => [1, text.length > 0 ? 1 : 0, 0.5, 0.25]);',
      'writeFileSync(process.argv[3], JSON.stringify({ vectors }));',
    ].join('\n'),
  );
  const command = `"${process.execPath}" "${script}"`;
  const previous = process.env.AGENT_MEMORY_VECTORIZER;
  process.env.AGENT_MEMORY_VECTORIZER = command;
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_MEMORY_VECTORIZER;
    else process.env.AGENT_MEMORY_VECTORIZER = previous;
  });

  const base = loadConfig({ home }).config;
  const store = new MemoryStore({
    home,
    config: { ...base, recall: { ...base.recall, hybrid: true, embedding_weight: 600 } },
  });
  const written = store.add(
    { kind: 'fact', abstract: 'sidecar vectors are cached', body: 'query uses the same command', evidence_level: 'observed' },
    { author: 'human' },
  );
  const vectors = await embedTexts(command, [`${written.id} text`]);
  assert.equal(vectors.dimensions, 4);
  writeEmbeddingCache(home, {
    schema: 1,
    provider: command,
    dimensions: 4,
    generated_at: new Date().toISOString(),
    docs: { [written.id]: vectors.vectors[0] ?? [] },
  });

  const result = await store.recallAsync('sidecar vectors');
  assert.equal(result.hits[0]?.id, written.id);
  assert.equal(result.warnings.some((warning) => warning.includes('hybrid')), false);
});
