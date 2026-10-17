import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal } from '../../src/journal/journal.ts';

function journalDir(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-memory-journal-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('append keeps seq, prev and a verifiable chain', (t) => {
  const journal = new Journal(journalDir(t));
  journal.append({ op: 'record', opId: 'op-1', data: { id: 'a' } });
  journal.append({ op: 'record', opId: 'op-2', data: { id: 'b' } });
  journal.append({ op: 'delete', opId: 'op-3', data: { id: 'a' } });

  const read = journal.readAll();
  assert.deepEqual(read.entries.map((entry) => entry.seq), [1, 2, 3]);
  assert.equal(read.issues.length, 0);
  assert.equal(read.entries[0]?.prev, '0'.repeat(64));
  assert.equal(read.entries[1]?.prev, read.hashes[0]);
  assert.equal(read.head?.seq, 3);
  assert.equal(read.head?.hash, read.hashes[2]);
});

test('a repeated op_id is idempotent', (t) => {
  const journal = new Journal(journalDir(t));
  const first = journal.append({ op: 'record', opId: 'op-same', data: { id: 'a' } });
  const second = journal.append({ op: 'record', opId: 'op-same', data: { id: 'b' } });
  assert.equal(first.seq, second.seq);
  assert.equal(journal.readAll().entries.length, 1);
});

test('a torn final line is reported as a parse issue', (t) => {
  const dir = journalDir(t);
  const journal = new Journal(dir);
  journal.append({ op: 'record', opId: 'op-1', data: { id: 'a' } });
  journal.append({ op: 'record', opId: 'op-2', data: { id: 'b' } });

  const file = join(dir, '0001.jsonl');
  writeFileSync(file, `${readFileSync(file, 'utf8').trimEnd()}\n{"seq":3,"prev"`);

  const read = journal.readAll();
  assert.equal(read.entries.length, 2);
  assert.ok(read.issues.some((issue) => issue.kind === 'parse'));
});

test('a broken prev link is reported as a chain issue', (t) => {
  const dir = journalDir(t);
  const journal = new Journal(dir);
  journal.append({ op: 'record', opId: 'op-1', data: { id: 'a' } });
  journal.append({ op: 'record', opId: 'op-2', data: { id: 'b' } });

  const file = join(dir, '0001.jsonl');
  const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
  const second = JSON.parse(lines[1] as string) as { prev: string };
  second.prev = 'f'.repeat(64);
  lines[1] = JSON.stringify(second);
  writeFileSync(file, `${lines.join('\n')}\n`);

  const read = journal.readAll();
  assert.ok(read.issues.some((issue) => issue.kind === 'chain'));
});
