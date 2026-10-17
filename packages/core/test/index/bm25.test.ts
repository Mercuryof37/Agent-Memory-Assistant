import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, search } from '../../src/index/bm25.ts';
import type { MemoryDoc } from '../../src/model/types.ts';

function doc(overrides: Partial<MemoryDoc> & { id: string }): MemoryDoc {
  return {
    mem_schema: 1,
    kind: 'fact',
    scope: 'local',
    abstract: `abstract ${overrides.id}`,
    created_at: '2026-10-17T00:00:00+00:00',
    valid_from: '2026-10-17',
    valid_until: null,
    supersedes: [],
    author: 'human',
    evidence_level: 'user_explicit',
    error_signatures: [],
    provenance: [],
    body: '',
    file_path: `${overrides.id}.md`,
    content_hash: '0'.repeat(64),
    ...overrides,
  };
}

const docs = [
  doc({
    id: 'mem-20261017-00000001',
    abstract: 'Windows 安装原生模块前先确认工具链',
    body: 'Build Tools 与 Python 版本要匹配。',
    error_signatures: ['MSB8020'],
    kind: 'pitfall',
  }),
  doc({
    id: 'mem-20261017-00000002',
    abstract: '部署使用蓝绿切换',
    body: 'Windows 上的代理负责切流。',
    valid_from: '2026-01-01',
  }),
  doc({
    id: 'mem-20261017-00000003',
    abstract: '笔记：整理磁盘',
    body: '无关内容。',
  }),
];

test('S3.2 abstract and signature fields outrank body-only matches', () => {
  const index = buildIndex(docs);
  const hits = search(index, 'Windows', { limit: 5, minScorePermille: 0 });
  assert.equal(hits[0]?.id, 'mem-20261017-00000001');
  assert.ok(hits.length >= 2);
});

test('S3.2 a pitfall error signature is findable by its code', () => {
  const index = buildIndex(docs);
  const hits = search(index, 'MSB8020', { limit: 3, minScorePermille: 500 });
  assert.equal(hits[0]?.id, 'mem-20261017-00000001');
});

test('S3.2 no-answer queries return nothing', () => {
  const index = buildIndex(docs);
  assert.deepEqual(search(index, '量子纠缠', { limit: 5, minScorePermille: 0 }), []);
  assert.deepEqual(search(index, '', { limit: 5, minScorePermille: 0 }), []);
});

test('S3.2 min_score is per-mille and filters weak hits', () => {
  const index = buildIndex(docs);
  const weak = search(index, 'Windows', { limit: 5, minScorePermille: 0 });
  const strong = search(index, 'Windows', { limit: 5, minScorePermille: 900 });
  assert.ok(strong.length <= weak.length);
  assert.ok(strong.every((hit) => hit.score >= 0.9));
});

test('S3.2 kind filtering happens before scoring', () => {
  const index = buildIndex(docs);
  const hits = search(index, 'Windows', { limit: 5, minScorePermille: 0, kinds: ['pitfall'] });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.id, 'mem-20261017-00000001');
});
