import test from 'node:test';
import assert from 'node:assert/strict';
import { initStore } from '../../core/src/index.ts';
import { MemoryStore } from '../../core/src/store/store.ts';
import { loadConfig } from '../../core/src/config/load.ts';
import { cleanupHome, tempHome } from '../../core/test/helpers.ts';
import { buildList, buildSearch, exportBundle, guiRoutes, serialsFor } from '../src/gui.ts';
import type { MemoryDoc } from '../../core/src/model/types.ts';

function doc(id: string, kind: 'fact' | 'pitfall' | 'exp', createdAt: string): MemoryDoc {
  return {
    id,
    mem_schema: 1,
    kind,
    scope: 'local',
    abstract: `摘要 ${id}`,
    created_at: createdAt,
    valid_from: '2026-10-18',
    valid_until: null,
    supersedes: [],
    author: 'human',
    evidence_level: 'observed',
    error_signatures: [],
    provenance: [],
    body: `正文 ${id}`,
    file_path: `${id}.md`,
    content_hash: 'a'.repeat(64),
  } as MemoryDoc;
}

function fixture(t: { after: (fn: () => void) => void }) {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const config = loadConfig({ home }).config;
  return { home, store: new MemoryStore({ home, config }) };
}

test('S14.1 serials are kind-prefixed and newest-first', () => {
  const docs = [
    doc('mem-20261018-00000001', 'fact', '2026-10-16T09:00:00.000Z'),
    doc('mem-20261018-00000002', 'fact', '2026-10-18T09:00:00.000Z'),
    doc('mem-20261018-00000003', 'pitfall', '2026-10-17T09:00:00.000Z'),
    doc('mem-20261018-00000004', 'exp', '2026-10-18T10:00:00.000Z'),
  ];
  const serials = serialsFor(docs);
  assert.equal(serials.get('mem-20261018-00000002' as never), 'F-01');
  assert.equal(serials.get('mem-20261018-00000001' as never), 'F-02');
  assert.equal(serials.get('mem-20261018-00000003' as never), 'P-01');
  assert.equal(serials.get('mem-20261018-00000004' as never), 'E-01');
});

test('S14.2 list groups by kind with counts and serials', (t) => {
  const { store } = fixture(t);
  store.add({ kind: 'fact', abstract: '事实一', body: 'b', evidence_level: 'observed' }, { author: 'human' });
  store.add({ kind: 'pitfall', abstract: '坑一', body: 'b', evidence_level: 'observed', error_signatures: ['boom'] }, { author: 'human' });
  const list = buildList(store);
  assert.equal(list.total, 2);
  assert.deepEqual(list.groups.map((group) => group.kind), ['fact', 'pitfall', 'exp']);
  const fact = list.groups.find((group) => group.kind === 'fact');
  assert.equal(fact?.items[0]?.serial, 'F-01');
  assert.equal(list.groups.find((group) => group.kind === 'pitfall')?.items[0]?.serial, 'P-01');
});

test('S14.4 every GUI route owns its full /api path', (t) => {
  const { home, store } = fixture(t);
  const routes = guiRoutes({ store, home, mode: 'confirm', modules: [] }) as Array<{ path: string; methods: string[] }>;
  assert.deepEqual(routes.map((route) => route.path).sort(), [
    '/api/agent-memory/export',
    '/api/agent-memory/item',
    '/api/agent-memory/list',
    '/api/agent-memory/search',
    '/api/agent-memory/status',
  ]);
  for (const route of routes) assert.deepEqual(route.methods, ['GET']);
});

test('S14.3 search and export read through the store only', (t) => {
  const { store } = fixture(t);
  store.add({ kind: 'fact', abstract: '部署前先迁移数据库', body: '迁移脚本', evidence_level: 'observed' }, { author: 'human' });
  const search = buildSearch(store, '迁移');
  assert.equal(search.hits.length, 1);
  assert.equal(search.hits[0]?.serial, 'F-01');
  assert.equal(search.hits[0]?.provenance_verifiable, false);

  const bundle = exportBundle(store);
  assert.equal(bundle.format, 'agent-memory-export-v1');
  assert.equal(bundle.memories.length, 1);
  assert.equal(bundle.memories[0]?.body.trim(), '迁移脚本');
  assert.deepEqual(bundle.proposals, []);
});
