import test from 'node:test';
import assert from 'node:assert/strict';
import { createProposal, initStore } from '../../core/src/index.ts';
import { MemoryStore } from '../../core/src/store/store.ts';
import { loadConfig } from '../../core/src/config/load.ts';
import { cleanupHome, tempHome } from '../../core/test/helpers.ts';
import {
  buildList,
  buildSearch,
  decideGui,
  deleteGui,
  exportBundle,
  guiRoutes,
  readProfileGui,
  readRulesGui,
  reviseGui,
  saveProfileGui,
  saveRulesGui,
  serialsFor,
} from '../src/gui.ts';
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
  return { home, store: new MemoryStore({ home, config }), config };
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
  const { home, store, config } = fixture(t);
  const routes = guiRoutes({ store, home, mode: 'confirm', modules: [], config }) as Array<{
    path: string;
    methods: string[];
  }>;
  assert.deepEqual(routes.map((route) => route.path).sort(), [
    '/api/agent-memory/delete',
    '/api/agent-memory/export',
    '/api/agent-memory/item',
    '/api/agent-memory/list',
    '/api/agent-memory/profile',
    '/api/agent-memory/proposals',
    '/api/agent-memory/proposals/decide',
    '/api/agent-memory/revise',
    '/api/agent-memory/rules',
    '/api/agent-memory/search',
    '/api/agent-memory/status',
  ]);
  for (const route of routes) {
    assert.ok(route.methods.length >= 1);
    for (const method of route.methods) assert.ok(['GET', 'POST'].includes(method));
  }
});

test('S14.5 GUI decide accepts through the same proposal pipeline', (t) => {
  const { store, config } = fixture(t);
  const old = store.add(
    { kind: 'fact', abstract: '旧事实', body: 'old', evidence_level: 'observed' },
    { author: 'human' },
  );
  const proposal = createProposal(
    { store, config },
    {
      op: 'supersede',
      targets: [old.id],
      base_hashes: [old.content_hash],
      reason: '测试',
      replacements: [
        { kind: 'fact', abstract: '新事实', body: 'new', evidence_level: 'user_confirmed', provenance: [] },
      ],
    },
  );
  decideGui(store, config, proposal.id, 'accept');
  const active = store.active();
  assert.ok(active.some((entry) => entry.abstract === '新事实'));
  assert.ok(!active.some((entry) => entry.id === old.id));
});

test('S14.6 GUI revise and delete write through proposals', (t) => {
  const { store, config } = fixture(t);
  const first = store.add(
    { kind: 'fact', abstract: '原文', body: '第一版', evidence_level: 'observed' },
    { author: 'human' },
  );
  reviseGui(store, config, first.id, { abstract: '修订后', body: '第二版' });
  const active = store.active();
  const revised = active.find((entry) => entry.abstract === '修订后');
  assert.ok(revised !== undefined);
  assert.ok(!active.some((entry) => entry.id === first.id));
  assert.deepEqual(revised?.supersedes, [first.id]);

  deleteGui(store, config, revised.id);
  assert.equal(store.active().length, 0);
});

test('S14.7 GUI profile and rules writes seal the human files', (t) => {
  const { home, store } = fixture(t);
  saveProfileGui(home, store, ['偏好一', '偏好二']);
  assert.deepEqual(readProfileGui(home).entries, ['偏好一', '偏好二']);

  saveRulesGui(home, store, '1. [模型指引] 测试规则\n');
  assert.match(readRulesGui(home).text, /测试规则/);
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
