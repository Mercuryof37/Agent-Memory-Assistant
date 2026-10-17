import test from 'node:test';
import assert from 'node:assert/strict';
import { activeDocs, isActiveOn, supersedeProblems, validFromLookup } from '../../src/model/validity.ts';
import type { MemoryDoc } from '../../src/model/types.ts';

function makeDoc(
  id: string,
  validFrom: string,
  options: { supersedes?: readonly string[]; validUntil?: string | null } = {},
): MemoryDoc {
  return {
    id,
    mem_schema: 1,
    kind: 'fact',
    scope: 'local',
    abstract: `abstract ${id}`,
    created_at: '2026-01-01T00:00:00+00:00',
    valid_from: validFrom,
    valid_until: options.validUntil ?? null,
    supersedes: options.supersedes ?? [],
    author: 'human',
    evidence_level: 'user_explicit',
    error_signatures: [],
    provenance: [],
    body: '',
    file_path: `${id}.md`,
    content_hash: '0'.repeat(64),
  };
}

test('S2a.5 a successor ends its predecessor at the successor valid_from', () => {
  const a = makeDoc('mem-20260101-00000001', '2026-01-01');
  const b = makeDoc('mem-20260201-00000002', '2026-02-01', { supersedes: [a.id] });
  const docs = [a, b];

  assert.deepEqual(activeDocs(docs, '2026-01-01').map((doc) => doc.id), [a.id]);
  assert.deepEqual(activeDocs(docs, '2026-01-31').map((doc) => doc.id), [a.id]);
  assert.deepEqual(activeDocs(docs, '2026-02-01').map((doc) => doc.id), [b.id]);
});

test('valid_until excludes its own date', () => {
  const doc = makeDoc('mem-20260101-00000001', '2026-01-01', { validUntil: '2026-03-01' });
  assert.equal(isActiveOn({ ...doc, successors: [] }, '2026-02-28', validFromLookup([doc])), true);
  assert.equal(isActiveOn({ ...doc, successors: [] }, '2026-03-01', validFromLookup([doc])), false);
});

test('a split (two successors) ends the original at the earliest successor', () => {
  const a = makeDoc('mem-20260101-00000001', '2026-01-01');
  const b = makeDoc('mem-20260201-00000002', '2026-02-01', { supersedes: [a.id] });
  const c = makeDoc('mem-20260301-00000003', '2026-03-01', { supersedes: [a.id] });
  const docs = [a, b, c];

  assert.deepEqual(activeDocs(docs, '2026-01-15').map((doc) => doc.id), [a.id]);
  assert.deepEqual(
    activeDocs(docs, '2026-02-15').map((doc) => doc.id).sort(),
    [b.id].sort(),
  );
  assert.equal(activeDocs(docs, '2026-02-15').some((doc) => doc.id === a.id), false);
});

test('supersede problems name missing targets, late predecessors and cycles', () => {
  const a = makeDoc('mem-20260101-00000001', '2026-01-01');
  const b = makeDoc('mem-20260201-00000002', '2026-02-01', { supersedes: [a.id] });
  const docs = new Map([
    [a.id, a],
    [b.id, b],
  ]);

  const missing = supersedeProblems(
    { id: 'mem-20260301-00000003', supersedes: ['mem-20990101-00000009'], valid_from: '2026-03-01' },
    docs,
  );
  assert.match(missing.join('\n'), /does not exist/);

  const early = supersedeProblems(
    { id: 'mem-20260301-00000003', supersedes: [b.id], valid_from: '2026-01-15' },
    docs,
  );
  assert.match(early.join('\n'), /starts after the successor/);

  const cycle = supersedeProblems({ id: a.id, supersedes: [b.id], valid_from: '2026-03-01' }, docs);
  assert.match(cycle.join('\n'), /cycle/);
});
