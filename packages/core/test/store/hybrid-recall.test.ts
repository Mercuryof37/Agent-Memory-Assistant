import test from 'node:test';
import assert from 'node:assert/strict';
import { initStore } from '../../src/init.ts';
import { loadConfig } from '../../src/config/load.ts';
import { defaultConfig } from '../../src/config/config.ts';
import { MemoryStore } from '../../src/store/store.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

test('S20.3 hybrid recall returns a fused score from the same active set', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const base = loadConfig({ home }).config;
  const config = {
    ...base,
    recall: { ...base.recall, hybrid: true, embedding_weight: 500 },
  };
  assert.equal(defaultConfig().recall.hybrid, false);

  const store = new MemoryStore({ home, config });
  const written = store.add(
    {
      kind: 'fact',
      abstract: 'worktree keeps project boundaries',
      body: 'tree first, graph on demand',
      project: 'Agent Memory',
      tags: ['v4'],
      evidence_level: 'observed',
    },
    { author: 'human' },
  );
  const result = store.recall('worktree project');
  assert.equal(result.hits[0]?.id, written.id);
  assert.ok((result.hits[0]?.score ?? 0) > 0);
});
