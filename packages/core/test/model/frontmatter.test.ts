import test from 'node:test';
import assert from 'node:assert/strict';
import { hashContent, parseMemoryFile, serializeMemory } from '../../src/model/frontmatter.ts';
import type { MemoryDoc } from '../../src/model/types.ts';

const LIMITS = { abstractChars: 120, bodyChars: 4000, maxRecordChars: 10000 };

function doc(overrides: Partial<Omit<MemoryDoc, 'file_path' | 'content_hash'>> = {}) {
  return {
    id: 'mem-20261017-a3f9c2d1',
    mem_schema: 1 as const,
    kind: 'fact' as const,
    scope: 'local' as const,
    abstract: 'Windows 安装原生模块前先确认工具链',
    created_at: '2026-10-17T09:00:00+08:00',
    valid_from: '2026-10-17',
    valid_until: null,
    supersedes: [] as readonly string[],
    author: 'agent' as const,
    evidence_level: 'observed' as const,
    error_signatures: [] as readonly string[],
    provenance: [
      {
        session_id: 'session-1',
        event_seq: 412,
        speaker: 'user' as const,
        quote: '先装 Build Tools 再试',
        event_sha256: 'a'.repeat(64),
      },
    ],
    body: 'body line\n',
    ...overrides,
  };
}

test('serialize -> parse round-trips every field', () => {
  const text = serializeMemory(doc());
  const parsed = parseMemoryFile(text, 'C:/tmp/mem.md', LIMITS);
  assert.equal(parsed.id, 'mem-20261017-a3f9c2d1');
  assert.equal(parsed.kind, 'fact');
  assert.equal(parsed.abstract, 'Windows 安装原生模块前先确认工具链');
  assert.equal(parsed.valid_from, '2026-10-17');
  assert.equal(parsed.valid_until, null);
  assert.deepEqual(parsed.supersedes, []);
  assert.equal(parsed.provenance[0]?.event_seq, 412);
  assert.equal(parsed.body, 'body line\n');
  assert.equal(parsed.content_hash, hashContent(text));
});

test('CRLF and a BOM normalize to the same content hash', () => {
  const text = serializeMemory(doc());
  const crlf = `\uFEFF${text.replaceAll('\n', '\r\n')}`;
  const a = parseMemoryFile(text, 'a.md', LIMITS);
  const b = parseMemoryFile(crlf, 'b.md', LIMITS);
  assert.equal(a.content_hash, b.content_hash);
});

test('S2a.4 rejects the parameterized bad-frontmatter matrix', () => {
  const base = serializeMemory(doc());
  const cases: ReadonlyArray<readonly [string, string, RegExp]> = [
    ['unknown key', base.replace('kind: ', 'bogus: 1\nkind: '), /unknown frontmatter key/],
    ['duplicate key', base.replace('abstract: ', 'abstract: "x"\nabstract: '), /duplicate frontmatter key/],
    ['missing fence', base.replace('---\n', ''), /start with a "---" fence/],
    ['invalid json', base.replace('kind: "fact"', 'kind: nope'), /not valid JSON/],
    ['invalid date', base.replace('valid_from: "2026-10-17"', 'valid_from: "2026-13-01"'), /real YYYY-MM-DD/],
    ['missing id', base.replace(/id: "mem-[^"]+"\n/, ''), /missing required field/],
    ['bad kind', base.replace('kind: "fact"', 'kind: "note"'), /must be fact/],
    ['bad scope', base.replace('scope: "local"', 'scope: "global"'), /must be "local"/],
    ['long abstract', base.replace(/"Windows[^"]*"/, `"${'x'.repeat(200)}"`), /exceeds limits.abstract_chars/],
    ['self supersede', base.replace('supersedes: []', 'supersedes: ["mem-20261017-a3f9c2d1"]'), /must not reference itself/],
    ['pitfall without signature', base.replace('kind: "fact"', 'kind: "pitfall"'), /at least one signature/],
    ['agent without provenance', base.replace(/provenance: \[[^\n]*\]/, 'provenance: []'), /at least one provenance entry/],
    ['long signature', base.replace('error_signatures: []', `error_signatures: ["${'y'.repeat(81)}"]`), /at most 80 characters/],
    ['long quote', base.replace('"先装 Build Tools 再试"', `"${'z'.repeat(200)}"`), /at most 160 characters/],
  ];
  for (const [name, text, pattern] of cases) {
    assert.throws(() => parseMemoryFile(text, 'bad.md', LIMITS), pattern, name);
  }
});

test('body limit and whole-file limit are enforced', () => {
  const text = serializeMemory(doc({ body: 'x'.repeat(50) }));
  assert.throws(() => parseMemoryFile(text, 'bad.md', { ...LIMITS, bodyChars: 10 }), /exceeds limits.body_chars/);
  assert.throws(
    () => parseMemoryFile(text, 'bad.md', { ...LIMITS, maxRecordChars: 100 }),
    /exceeds storage.max_record_chars/,
  );
});
