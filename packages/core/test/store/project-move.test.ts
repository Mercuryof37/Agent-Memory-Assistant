import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initStore } from '../../src/init.ts';
import { loadConfig } from '../../src/config/load.ts';
import { MemoryStore } from '../../src/store/store.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

test('S19.11 moveProjects rewrites project labels without changing ids', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const store = new MemoryStore({ home, config: loadConfig({ home }).config });
  const written = store.add(
    { kind: 'fact', abstract: 'movable', body: 'b', project: 'A', evidence_level: 'observed' },
    { author: 'human' },
  );

  const result = store.moveProjects([written.id], 'B');
  assert.deepEqual(result.moved, [written.id]);
  assert.deepEqual(result.failed, []);
  const doc = store.read(written.id);
  assert.equal(doc.project, 'B');
  assert.match(readFileSync(`${home}/memories/fact/${written.id}.md`, 'utf8'), /^project: "B"$/m);

  const missing = store.moveProjects(['mem-20261018-deadbeef'], null);
  assert.equal(missing.failed[0]?.reason, 'not found');
});
