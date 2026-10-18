import test from 'node:test';
import assert from 'node:assert/strict';
import { createProposal, createProject, importBundle, initStore } from '../../core/src/index.ts';
import { MemoryStore } from '../../core/src/store/store.ts';
import { loadConfig } from '../../core/src/config/load.ts';
import { cleanupHome, tempHome } from '../../core/test/helpers.ts';
import {
  buildList,
  buildGraph,
  buildProposals,
  buildSearch,
  createGui,
  decideGui,
  deleteGui,
  displayName,
  exportBundle,
  guiRoutes,
  readProfileGui,
  readRulesGui,
  reviseGui,
  saveProfileGui,
  saveRulesGui,
  sealGui,
  serialsFor,
  soulPathGui,
  summarize,
  summarizeGui,
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

test('S23.1 the graph projection groups by project and keeps three edge types', (t) => {
  const { home, store } = fixture(t);
  createProject({ home, name: 'Agent Memory' });
  const first = store.add(
    { kind: 'fact', abstract: 'worktree groups memories', body: 'b', project: 'Agent Memory', tags: ['v4'], evidence_level: 'observed' },
    { author: 'human' },
  );
  const second = store.add(
    {
      kind: 'exp',
      abstract: 'focus graph uses one hop',
      body: 'b',
      project: 'Agent Memory',
      tags: ['v4'],
      relations: [{ type: 'relates_to', target: first.id }],
      evidence_level: 'observed',
    },
    { author: 'human' },
  );
  const graph = buildGraph(store, home);
  assert.equal(graph.schema, 1);
  assert.equal(graph.projects.find((project) => project.name === 'Agent Memory')?.count, 2);
  assert.equal(graph.nodes.length, 2);
  assert.deepEqual(graph.edges, [{ from: second.id, to: first.id, type: 'relates_to' }]);
});

test('S14.4 every GUI route owns its full /api path', (t) => {
  const { home, store, config } = fixture(t);
  const routes = guiRoutes({ store, home, mode: 'confirm', modules: [], config }) as Array<{
    path: string;
    methods: string[];
  }>;
  assert.deepEqual(routes.map((route) => route.path).sort(), [
    '/api/agent-memory/create',
    '/api/agent-memory/delete',
    '/api/agent-memory/export',
    '/api/agent-memory/graph',
    '/api/agent-memory/import',
    '/api/agent-memory/item',
    '/api/agent-memory/list',
    '/api/agent-memory/policy/seal',
    '/api/agent-memory/profile',
    '/api/agent-memory/projects',
    '/api/agent-memory/projects/move',
    '/api/agent-memory/proposals',
    '/api/agent-memory/proposals/decide',
    '/api/agent-memory/revise',
    '/api/agent-memory/rules',
    '/api/agent-memory/search',
    '/api/agent-memory/soul-path',
    '/api/agent-memory/status',
    '/api/agent-memory/summarize',
  ]);
  for (const route of routes) {
    assert.ok(route.methods.length >= 1);
    for (const method of route.methods) assert.ok(['GET', 'POST', 'DELETE'].includes(method));
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

test('S14.9 UI names use serial + 12-char summary, never internal ids', (t) => {
  const { store, config } = fixture(t);
  const saved = store.add(
    { kind: 'fact', abstract: '用户偏好：界面文案与工具描述优先使用中文', body: 'b', evidence_level: 'observed' },
    { author: 'human' },
  );
  const item = buildList(store).groups[0]?.items[0];
  assert.equal(item?.display, `F-01 ${summarize('用户偏好：界面文案与工具描述优先使用中文')}`);
  assert.ok([...summarize('用户偏好：界面文案与工具描述优先使用中文')].length <= 12);
  assert.ok(!item?.display.includes('mem-'));

  createProposal(
    { store, config },
    {
      op: 'supersede',
      targets: [saved.id],
      base_hashes: [saved.content_hash],
      reason: '命名测试',
      replacements: [
        { kind: 'fact', abstract: '新的偏好总结不超过十二个字', body: 'new', evidence_level: 'user_confirmed', provenance: [] },
      ],
    },
  );
  const proposal = buildProposals(store)[0];
  assert.ok(proposal?.targets[0]?.display.startsWith('F-01 '));
  assert.ok(!proposal?.targets[0]?.display.includes('mem-'));
  assert.ok([...(proposal?.replacements[0]?.display ?? '')].length <= 12);
  assert.equal(displayName('', '无编号的新内容'), '无编号的新内容');
});

test('S14.3 search and export read through the store only', async (t) => {
  const { store } = fixture(t);
  store.add({ kind: 'fact', abstract: '部署前先迁移数据库', body: '迁移脚本', evidence_level: 'observed' }, { author: 'human' });
  const search = await buildSearch(store, '迁移');
  assert.equal(search.hits.length, 1);
  assert.equal(search.hits[0]?.serial, 'F-01');
  assert.equal(search.hits[0]?.provenance_verifiable, false);

  const bundle = exportBundle(store);
  assert.equal(bundle.format, 'agent-memory-export-v2');
  assert.equal(bundle.memories.length, 1);
  assert.equal(bundle.memories[0]?.body.trim(), '迁移脚本');
  assert.deepEqual(bundle.proposals, []);
});

test('S14.10 an exported bundle imports back and dedupes', (t) => {
  const source = fixture(t);
  source.store.add(
    { kind: 'fact', abstract: '导入前的事实', body: '正文', evidence_level: 'observed' },
    { author: 'human' },
  );
  const bundle = exportBundle(source.store);

  const target = fixture(t);
  const first = importBundle(target.store, bundle);
  assert.equal(first.imported, 1);
  assert.equal(first.skipped, 0);
  assert.equal(first.failed.length, 0);
  assert.equal(target.store.active().length, 1);

  const second = importBundle(target.store, bundle);
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 1);
  assert.equal(target.store.active().length, 1);

  assert.throws(() => importBundle(target.store, { format: 'nope' }), /format/);
});

test('S14.13 hard delete removes the file so a backup can restore it', (t) => {
  const { store, config } = fixture(t);
  const saved = store.add(
    { kind: 'fact', abstract: '删了还能恢复', body: '正文', evidence_level: 'observed' },
    { author: 'human' },
  );
  const bundle = exportBundle(store);
  deleteGui(store, config, saved.id);
  assert.equal(store.active().length, 0);
  const report = importBundle(store, bundle);
  assert.equal(report.imported, 1);
  assert.equal(report.skipped, 0);
  assert.equal(store.active()[0]?.abstract, '删了还能恢复');
});

test('S14.11 content-only dedupe ignores date and author', (t) => {
  const { store } = fixture(t);
  const first = store.add(
    { kind: 'fact', abstract: '同一条内容', body: '同样正文', valid_from: '2026-10-01', evidence_level: 'observed' },
    { author: 'human' },
  );
  const second = store.add(
    { kind: 'fact', abstract: '同一条内容', body: '同样正文', valid_from: '2026-10-18', evidence_level: 'user_confirmed' },
    { author: 'human' },
  );
  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.equal(store.active().length, 1);
});

test('S14.12 lists sort by valid_from, newest first', (t) => {
  const { store } = fixture(t);
  const older = store.add(
    { kind: 'fact', abstract: '较早的事', body: 'old', valid_from: '2026-10-17', evidence_level: 'observed' },
    { author: 'human' },
  );
  const newer = store.add(
    { kind: 'fact', abstract: '较晚的事', body: 'new', valid_from: '2026-10-18', evidence_level: 'observed' },
    { author: 'human' },
  );
  // Importing now does not reorder by created_at: the date shown wins.
  const serials = serialsFor(store.active());
  assert.equal(serials.get(newer.id as never), 'F-01');
  assert.equal(serials.get(older.id as never), 'F-02');
  assert.equal(buildList(store).groups[0]?.items[0]?.abstract, '较晚的事');
});

test('S14.14 GUI create writes a human entry and dedupes by content', (t) => {
  const { store } = fixture(t);
  const first = createGui(store, {
    kind: 'fact',
    abstract: '手动新增的事实',
    body: '正文',
    valid_from: '2026-10-18',
  });
  assert.ok(first.display.startsWith('F-01 '));
  assert.equal(first.deduplicated, false);

  const second = createGui(store, {
    kind: 'fact',
    abstract: '手动新增的事实',
    body: '正文',
    valid_from: '2026-10-19',
  });
  assert.equal(second.deduplicated, true);
  assert.equal(store.active().length, 1);

  assert.throws(
    () => createGui(store, { kind: 'pitfall', abstract: '没有错误特征的坑', body: 'b' }),
    /error_signatures/,
  );
});

test('S14.15 summarize is read-only and suggests RULES from repeated signatures', (t) => {
  const { home, store } = fixture(t);
  createGui(store, {
    kind: 'pitfall',
    abstract: '迁移时连错库',
    body: 'b',
    error_signatures: ['ECONNREFUSED 5432'],
  });
  createGui(store, {
    kind: 'pitfall',
    abstract: '迁移时又连错库',
    body: 'b',
    error_signatures: ['ECONNREFUSED 5432'],
  });
  const before = readRulesGui(home).text;
  const summary = summarizeGui(store);
  assert.equal(summary.total, 2);
  assert.equal(summary.by_kind.pitfall, 2);
  assert.equal(summary.top_signatures[0]?.signature, 'ECONNREFUSED 5432');
  assert.equal(summary.suggestions[0]?.basis.length, 2);
  assert.match(summary.suggestions[0]?.text ?? '', /ECONNREFUSED 5432/);
  assert.equal(readRulesGui(home).text, before);
});

test('S14.16 SOUL path is returned without touching the file', (t) => {
  const { home } = fixture(t);
  const soul = soulPathGui(home);
  assert.match(soul.path, /SOUL\.md$/);
  assert.match(soul.hint, /不读取、不修改/);
});

test('S14.17 one-click seal re-seals policy from the GUI', (t) => {
  const { home, store } = fixture(t);
  const result = sealGui(home, store);
  assert.equal(result.sealed, true);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
});
