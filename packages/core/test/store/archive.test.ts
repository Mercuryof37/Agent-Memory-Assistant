import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initStore } from '../../src/init.ts';
import { loadConfig } from '../../src/config/load.ts';
import { MemoryStore } from '../../src/store/store.ts';
import { hashLine, ZERO_HASH } from '../../src/journal/journal.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

function segment(seqStart: number, count: number, prevStart: string): { lines: string[]; prev: string } {
  const lines: string[] = [];
  let prev = prevStart;
  for (let index = 0; index < count; index += 1) {
    const entry = {
      seq: seqStart + index,
      prev,
      at: '2026-10-18T00:00:00.000Z',
      op: 'audit',
      op_id: `op-${seqStart + index}`,
      data: { event: 'synthetic' },
    };
    const line = JSON.stringify(entry);
    lines.push(line);
    prev = hashLine(line);
  }
  return { lines, prev };
}

test('S26.1 maintain archives segments before the checkpoint and reopens cleanly', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const journalDir = join(home, '.state', 'journal');
  const first = segment(1, 3, ZERO_HASH);
  writeFileSync(join(journalDir, '0001.jsonl'), `${first.lines.join('\n')}\n`);
  const second = segment(4, 3, first.prev);
  writeFileSync(join(journalDir, '0002.jsonl'), `${second.lines.join('\n')}\n`);

  const config = loadConfig({ home }).config;
  const store = new MemoryStore({ home, config });
  assert.equal(store.diagnostics().journal.lines, 6);
  assert.equal(store.checkpoint(), true);
  const report = store.maintain({ force: true, retentionDays: 0 });
  assert.deepEqual(report.archived, ['0001.jsonl']);
  assert.equal(existsSync(join(journalDir, '0001.jsonl')), false);
  assert.equal(existsSync(join(journalDir, 'archive', '0001.jsonl.gz')), true);
  assert.equal(existsSync(join(journalDir, 'archive', '0001.meta.json')), true);
  const index = JSON.parse(readFileSync(join(journalDir, 'archive', 'index.json'), 'utf8')) as {
    through_seq: number;
  };
  assert.equal(index.through_seq, 3);

  const reopened = new MemoryStore({ home, config });
  assert.equal(reopened.diagnostics().issues.length, 0);
  assert.equal(reopened.diagnostics().journal.lines >= 3, true);
});

test('S26.2 retention prunes old archive blobs but keeps metadata', (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const journalDir = join(home, '.state', 'journal');
  const archiveDir = join(journalDir, 'archive');
  mkdirSync(archiveDir, { recursive: true });
  const gz = join(archiveDir, '0001.jsonl.gz');
  writeFileSync(gz, 'x');
  const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
  utimesSync(gz, old, old);
  writeFileSync(join(archiveDir, '0001.meta.json'), '{"schema":1}');

  const config = loadConfig({ home }).config;
  const store = new MemoryStore({ home, config });
  const report = store.maintain({ force: true, retentionDays: 365 });
  assert.deepEqual(report.pruned, ['0001.jsonl.gz']);
  assert.equal(existsSync(gz), false);
  assert.equal(existsSync(join(archiveDir, '0001.meta.json')), true);
});
