import test from 'node:test';
import assert from 'node:assert/strict';
import { initStore } from '../../src/init.ts';
import { loadConfig } from '../../src/config/load.ts';
import { MemoryStore } from '../../src/store/store.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

test('S28.1 addAsync coalesces concurrent writers into one durable batch', async (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const config = loadConfig({ home }).config;
  const store = new MemoryStore({ home, config });
  const results = await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      store.addAsync(
        { kind: 'fact', abstract: `group ${index}`, body: `body ${index}`, evidence_level: 'observed' },
        { author: 'human' },
      ),
    ),
  );
  assert.equal(new Set(results.map((result) => result.id)).size, 25);
  assert.equal(store.stats().active, 25);
  const reopened = new MemoryStore({ home, config });
  assert.equal(reopened.stats().active, 25);
  assert.equal(reopened.diagnostics().issues.length, 0);
});
