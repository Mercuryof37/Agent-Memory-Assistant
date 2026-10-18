import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { initStore } from '../../src/init.ts';
import { loadConfig } from '../../src/config/load.ts';
import { MemoryStore } from '../../src/store/store.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const config = loadConfig({ home }).config;
  return { home, config, open: (beforeStep?: (step: string) => void) => new MemoryStore({ home, config, ...(beforeStep === undefined ? {} : { beforeStep }) }) };
}

test('S24.1 a crash before the file write leaves no accounted record', (t) => {
  const { open } = fixture(t);
  const store = open((step) => {
    if (step === 'before-write') throw new Error('simulated crash');
  });
  assert.throws(
    () => store.add({ kind: 'fact', abstract: 'crash before write', body: 'b', evidence_level: 'observed' }, { author: 'human' }),
    /simulated crash/,
  );
  const reopened = open();
  assert.equal(reopened.stats().active, 0);
  assert.equal(reopened.diagnostics().journal.lines, 0);
});

test('S24.2 a crash after the file but before journal is quarantined and adoptable', (t) => {
  const { home, open } = fixture(t);
  const store = open((step) => {
    if (step === 'before-journal') throw new Error('simulated crash');
  });
  assert.throws(
    () => store.add({ kind: 'fact', abstract: 'crash before journal', body: 'b', evidence_level: 'observed' }, { author: 'human' }),
    /simulated crash/,
  );
  const files = readdirSync(join(home, 'memories', 'fact')).filter((name) => name.endsWith('.md'));
  assert.equal(files.length, 1);
  const id = files[0]?.slice(0, -3) as string;
  const reopened = open();
  assert.equal(reopened.stats().active, 0);
  assert.match(reopened.diagnostics().quarantined.get(id) ?? '', /not accounted in journal/);
  reopened.adopt(id);
  assert.equal(reopened.stats().active, 1);
});

test('S24.3 a crash after journal but before derived files recovers on reopen', (t) => {
  const { open } = fixture(t);
  const store = open((step) => {
    if (step === 'before-derived') throw new Error('simulated crash');
  });
  assert.throws(
    () => store.add({ kind: 'fact', abstract: 'crash before derived', body: 'b', evidence_level: 'observed' }, { author: 'human' }),
    /simulated crash/,
  );
  const reopened = open();
  assert.equal(reopened.stats().active, 1);
  assert.equal(reopened.stats().journal_consistent, true);
});
