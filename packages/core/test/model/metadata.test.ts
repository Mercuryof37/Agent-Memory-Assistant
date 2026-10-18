import test from 'node:test';
import assert from 'node:assert/strict';
import { FrontmatterError, parseMemoryFile, serializeMemory } from '../../src/model/frontmatter.ts';
import type { MemoryDoc } from '../../src/model/types.ts';

const LIMITS = { abstractChars: 120, bodyChars: 4000, maxRecordChars: 10000 };

function doc(overrides: Partial<Omit<MemoryDoc, 'file_path' | 'content_hash'>> = {}) {
  return {
    id: 'mem-20261017-a3f9c2d1',
    mem_schema: 1 as const,
    kind: 'fact' as const,
    scope: 'local' as const,
    project: 'Agent Memory',
    tags: ['v4', 'worktree'],
    relations: [{ type: 'relates_to' as const, target: 'mem-20261017-b4e8d3c2' }],
    abstract: 'V4 检索使用 ONNX 小模型',
    created_at: '2026-10-17T09:00:00+08:00',
    valid_from: '2026-10-17',
    valid_until: null,
    supersedes: [] as readonly string[],
    author: 'human' as const,
    evidence_level: 'observed' as const,
    error_signatures: [] as readonly string[],
    provenance: [] as readonly never[],
    body: 'body line\n',
    ...overrides,
  };
}

test('S19.1 project, tags and relations round-trip through frontmatter', () => {
  const text = serializeMemory(doc());
  const parsed = parseMemoryFile(text, 'C:/tmp/mem.md', LIMITS);
  assert.equal(parsed.project, 'Agent Memory');
  assert.deepEqual(parsed.tags, ['v4', 'worktree']);
  assert.deepEqual(parsed.relations, [{ type: 'relates_to', target: 'mem-20261017-b4e8d3c2' }]);
});

test('S19.2 records written before v1.4 read as unclassified with no tags or relations', () => {
  const text = serializeMemory(doc())
    .split('\n')
    .filter((line) => !line.startsWith('project: ') && !line.startsWith('tags: ') && !line.startsWith('relations: '))
    .join('\n');
  const parsed = parseMemoryFile(text, 'C:/tmp/old.md', LIMITS);
  assert.equal(parsed.project, null);
  assert.deepEqual(parsed.tags, []);
  assert.deepEqual(parsed.relations, []);
});

test('S19.3 invalid metadata is rejected, not silently dropped', () => {
  const cases: [string, Partial<Omit<MemoryDoc, 'file_path' | 'content_hash'>>][] = [
    ['project', { project: 'bad/name' }],
    ['tags', { tags: ['x', 'x'] }],
    ['relations', { relations: [{ type: 'relates_to', target: 'mem-20261017-a3f9c2d1' }] }],
    ['relations', { relations: [{ type: 'bad' as never, target: 'mem-20261017-b4e8d3c2' }] }],
  ];
  for (const [field, override] of cases) {
    const text = serializeMemory(doc(override));
    assert.throws(
      () => parseMemoryFile(text, 'C:/tmp/bad.md', LIMITS),
      (error: unknown) => error instanceof FrontmatterError && error.field === field,
    );
  }
});
