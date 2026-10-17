import test from 'node:test';
import assert from 'node:assert/strict';
import { initStore } from '../../src/init.ts';
import { loadConfig } from '../../src/config/load.ts';
import { MemoryStore } from '../../src/store/store.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

test('T4 recall honours recall.min_score (per-mille) from config', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const base = loadConfig({ home }).config;
  const store = new MemoryStore({ home, config: base });

  store.add(
    { kind: 'fact', abstract: 'strong alpha signal', body: 'alpha alpha alpha', evidence_level: 'observed' },
    { author: 'human' },
  );
  store.add(
    { kind: 'fact', abstract: 'weak beta note', body: 'alpha mentioned once', evidence_level: 'observed' },
    { author: 'human' },
  );

  const relaxed = new MemoryStore({
    home,
    config: { ...base, recall: { ...base.recall, min_score: 0 } },
  });
  const strict = new MemoryStore({
    home,
    config: { ...base, recall: { ...base.recall, min_score: 900 } },
  });

  const all = relaxed.recall('alpha');
  const strongOnly = strict.recall('alpha');
  assert.equal(all.hits.length, 2);
  assert.ok(strongOnly.hits.length <= 1);
  assert.ok(strongOnly.hits.every((hit) => hit.score >= 0.9));
});
