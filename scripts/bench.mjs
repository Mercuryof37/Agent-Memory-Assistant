import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { initStore, MemoryStore, loadConfig } from '../packages/core/src/index.ts';

/**
 * V5.0-S1 baseline benchmark. Not part of CI: `add` fsyncs each record, so
 * 10k+ records take minutes by design. Run:
 *
 *   node scripts/bench.mjs --count 1000
 *   node scripts/bench.mjs --count 10000
 */

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const countIndex = args.indexOf('--count');
const count = countIndex >= 0 ? Number(args[countIndex + 1]) : 1000;
const batchIndex = args.indexOf('--batch');
const batchSize = batchIndex >= 0 ? Number(args[batchIndex + 1]) : 1;
const group = args.includes('--group');
if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(batchSize) || batchSize < 1) {
  console.error('usage: node scripts/bench.mjs --count <n> [--batch <n>]');
  process.exit(1);
}

const home = mkdtempSync(join(tmpdir(), 'agent-memory-bench-'));
try {
  initStore({ home });
  const base = loadConfig({ home }).config;
  const config = { ...base, storage: { ...base.storage, max_records: Math.max(count, base.storage.max_records) } };
  const store = new MemoryStore({ home, config });

  const addStart = performance.now();
  const makeInput = (index) => ({
    kind: index % 7 === 0 ? 'pitfall' : index % 5 === 0 ? 'exp' : 'fact',
    abstract: `bench record ${index} deployservice token${index % 50}`,
    body: `benchmark body ${index} keyword${index % 100} project${index % 20}`,
    project: `P${index % 20}`,
    tags: [`t${index % 10}`],
    ...(index % 7 === 0 ? { error_signatures: [`E${index % 50}`] } : {}),
    evidence_level: 'observed',
  });
  if (group) {
    await Promise.all(
      Array.from({ length: count }, (_, index) => store.addAsync(makeInput(index), { author: 'human' })),
    );
  } else {
    for (let start = 0; start < count; start += batchSize) {
      const end = Math.min(count, start + batchSize);
      const inputs = [];
      for (let index = start; index < end; index += 1) inputs.push(makeInput(index));
      if (inputs.length === 1) store.add(inputs[0], { author: 'human' });
      else store.addMany(inputs, { author: 'human' });
    }
  }
  const addMs = performance.now() - addStart;

  const reopened = new MemoryStore({ home, config });
  const diagnostics = reopened.diagnostics();
  const recall = [];
  for (let index = 0; index < 50; index += 1) {
    const start = performance.now();
    reopened.recall(`token${index % 50}`);
    recall.push(performance.now() - start);
  }
  recall.sort((left, right) => left - right);
  const p95 = recall[Math.min(recall.length - 1, Math.ceil(recall.length * 0.95) - 1)] ?? 0;

  console.log(
    JSON.stringify(
      {
        count,
        add_ms: Number(addMs.toFixed(1)),
        add_ms_per_record: Number((addMs / count).toFixed(2)),
        reload_ms: diagnostics.reload_ms,
        recall_p95_ms: Number(p95.toFixed(2)),
        journal: diagnostics.journal,
        store_root: home,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(home, { recursive: true, force: true });
}
