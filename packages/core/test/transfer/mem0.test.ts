import test from 'node:test';
import assert from 'node:assert/strict';
import { initStore } from '../../src/init.ts';
import { loadConfig } from '../../src/config/load.ts';
import { MemoryStore } from '../../src/store/store.ts';
import { importMem0, previewMem0 } from '../../src/transfer/mem0.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const store = new MemoryStore({ home, config: loadConfig({ home }).config });
  return { home, store };
}

const BUNDLE = {
  results: [
    {
      id: 'mem0-1',
      memory: '用户偏好使用 pnpm',
      metadata: { project: 'Agent Memory', tags: ['preference'] },
      created_at: '2026-10-01T09:00:00Z',
    },
    {
      id: 'mem0-2',
      memory: 'ONNX 运行时太大，sidecar 更合适',
      metadata: { kind: 'exp', project: 'Agent Memory' },
      created_at: '2026-10-02T09:00:00Z',
    },
  ],
};

test('S22.1 Mem0 preview validates rows without writing', (t) => {
  const { store } = fixture(t);
  const preview = previewMem0(BUNDLE);
  assert.equal(preview.total, 2);
  assert.equal(preview.valid, 2);
  assert.deepEqual(preview.byKind, { fact: 1, exp: 1 });
  assert.deepEqual(preview.byProject, { 'Agent Memory': 2 });
  assert.equal(store.active().length, 0);
});

test('S22.2 Mem0 import keeps source, project, tags and deduplicates on re-import', (t) => {
  const { store } = fixture(t);
  const report = importMem0(store, BUNDLE);
  assert.equal(report.imported, 2);
  assert.equal(report.skipped, 0);
  const docs = store.active();
  assert.equal(docs.length, 2);
  const first = docs.find((doc) => doc.abstract.includes('pnpm'));
  assert.equal(first?.project, 'Agent Memory');
  assert.deepEqual(first?.tags, ['preference']);
  assert.deepEqual(first?.source, { type: 'mem0', id: 'mem0-1' });

  const again = importMem0(store, BUNDLE);
  assert.equal(again.imported, 0);
  assert.equal(again.skipped, 2);
});

test('S22.3 invalid Mem0 rows are reported, not silently dropped', (t) => {
  const { store } = fixture(t);
  const preview = previewMem0({ results: [{ id: 'x' }, { memory: '' }] });
  assert.equal(preview.valid, 0);
  assert.equal(preview.invalid, 2);
  const report = importMem0(store, { results: [{ id: 'x' }, { memory: 'ok', metadata: { kind: 'bad' } }] });
  assert.equal(report.imported, 0);
  assert.equal(report.failed.length, 2);
});
