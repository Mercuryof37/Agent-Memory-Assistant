import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initStore } from '../../src/init.ts';
import { loadConfig } from '../../src/config/load.ts';
import { MemoryStore } from '../../src/store/store.ts';
import { importBundle } from '../../src/transfer/import.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

function open(home: string): MemoryStore {
  return new MemoryStore({ home, config: loadConfig({ home }).config });
}

test('S19.6 store persists project, tags and relations and survives reload', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const store = open(home);

  const written = store.add(
    {
      kind: 'exp',
      abstract: 'worktree keeps the project boundary',
      body: 'tree first, graph only on demand',
      project: 'Agent Memory',
      tags: ['v4', 'ui'],
      relations: [{ type: 'relates_to', target: 'mem-20261017-b4e8d3c2' }],
      evidence_level: 'observed',
    },
    { author: 'human' },
  );

  const file = readFileSync(joinStore(home, written.id), 'utf8');
  assert.match(file, /^mem_schema: 2$/m);
  assert.match(file, /^project: "Agent Memory"$/m);
  assert.match(file, /^tags: \["v4","ui"\]$/m);
  assert.match(file, /^relations: \[\{"type":"relates_to","target":"mem-20261017-b4e8d3c2"\}\]$/m);

  const reopened = open(home);
  const doc = reopened.read(written.id);
  assert.equal(doc.project, 'Agent Memory');
  assert.deepEqual(doc.tags, ['v4', 'ui']);
  assert.deepEqual(doc.relations, [{ type: 'relates_to', target: 'mem-20261017-b4e8d3c2' }]);
});

test('S19.7 a v1 bundle without metadata imports as unclassified', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const store = open(home);

  const report = importBundle(store, {
    format: 'agent-memory-export-v1',
    memories: [{ kind: 'fact', abstract: 'legacy bundle', body: 'old', evidence_level: 'observed' }],
  });
  assert.equal(report.imported, 1);
  const [doc] = store.active();
  assert.equal(doc?.project, null);
  assert.deepEqual(doc?.tags, []);
});

test('S19.8 a v2 bundle carries project, tags and relations through import', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const store = open(home);

  const report = importBundle(store, {
    format: 'agent-memory-export-v2',
    memories: [
      {
        kind: 'fact',
        abstract: 'imported project memory',
        body: 'from v2',
        project: 'Agent Memory',
        tags: ['v4'],
        relations: [{ type: 'derived_from', target: 'mem-20261017-b4e8d3c2' }],
        evidence_level: 'observed',
      },
    ],
  });
  assert.equal(report.imported, 1);
  const [doc] = store.active();
  assert.equal(doc?.project, 'Agent Memory');
  assert.deepEqual(doc?.tags, ['v4']);
  assert.deepEqual(doc?.relations, [{ type: 'derived_from', target: 'mem-20261017-b4e8d3c2' }]);
});

function joinStore(home: string, id: string): string {
  return `${home}/memories/exp/${id}.md`;
}
