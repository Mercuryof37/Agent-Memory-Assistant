import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionQuota } from '../../core/src/service/quota.ts';
import {
  registerTools,
  TOOL_NAMES,
  TOOL_SCHEMAS,
  validateToolArgs,
  type ToolService,
} from '../src/tools.ts';

interface FakeCall {
  readonly name: string;
  readonly execute: (args: unknown) => unknown;
}

function fakeService(): ToolService & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    config: { quota: { t0_per_session: 1 } },
    recall: () => {
      calls.push('recall');
      return { hits: [] };
    },
    read: () => {
      calls.push('read');
      return {};
    },
    record: () => {
      calls.push('record');
      return { id: 'mem-20261017-00000001' };
    },
    propose: () => {
      calls.push('propose');
      return { id: 'prop-1' };
    },
    rules: () => {
      calls.push('rules');
      return [];
    },
  };
}

function register(service: ToolService, delegationDepth = 0, quota?: SessionQuota): FakeCall[] {
  const calls: FakeCall[] = [];
  const ctx = { tools: { register: (definition: unknown) => calls.push(definition as FakeCall) } };
  registerTools(ctx, service, { sessionId: 's1', delegationDepth }, quota);
  return calls;
}

test('S4.1 the tool table is exactly five names with strict schemas and no forbidden fields', () => {
  const registered = register(fakeService());
  assert.deepEqual(
    registered.map((call) => call.name).sort(),
    [...TOOL_NAMES].sort(),
  );
  assert.equal(registered.length, 5);
  for (const name of TOOL_NAMES) {
    const schema = TOOL_SCHEMAS[name] as { additionalProperties?: boolean };
    assert.equal(schema.additionalProperties, false, `${name} must be strict`);
    const text = JSON.stringify(TOOL_SCHEMAS[name]);
    assert.doesNotMatch(text, /"(path|target|session|session_id|approve)"/);
  }
  assert.equal(new Set(registered.map((call) => call.name)).size, 5);
});

test('S4.2 the red-team argument table is rejected', () => {
  const cases: Array<[Parameters<typeof validateToolArgs>[0], unknown]> = [
    ['memory_read', { id: '../../SOUL.md' }],
    ['memory_read', { id: 'mem-20261017-00000001', path: 'x' }],
    ['memory_read', { id: 'mem-20261017-00000001', target: 'soul' }],
    ['memory_recall', { query: 'x', session_id: 's' }],
    ['memory_recall', { query: 'x', approve: true }],
    ['memory_record', { kind: 'fact', abstract: 'a', body: 'b', evidence: [] }],
    ['memory_record', { kind: 'pitfall', abstract: 'a', body: 'b', evidence: [{ event_seq: 1, quote: 'q' }] }],
    ['memory_propose', { op: 'delete', ids: ['mem-20261017-00000001'], base_hashes: ['x'] }],
    ['memory_propose', { op: 'supersede', ids: ['mem-20261017-00000001'], base_hashes: ['x'] }],
    ['memory_propose', { op: 'delete', ids: ['mem-20261017-00000001'], base_hashes: ['x', 'y'], reason: 'r' }],
  ];
  for (const [name, args] of cases) {
    assert.ok(validateToolArgs(name, args).length > 0, `${name} accepted ${JSON.stringify(args)}`);
  }
  assert.deepEqual(
    validateToolArgs('memory_read', { id: 'mem-20261017-00000001' }),
    [],
  );
});

test('S4.6 a sub-agent gets read tools only; decide is never a tool', () => {
  const names = register(fakeService(), 1).map((call) => call.name);
  assert.deepEqual(names.sort(), ['memory_read', 'memory_recall', 'rules_list']);
  assert.ok(!TOOL_NAMES.includes('decide' as never));
  assert.ok(!names.includes('memory_record' as never));
});

test('S4.6 the T0 quota rejects the second write and points at proposals', () => {
  const service = fakeService();
  const calls = register(service, 0, new SessionQuota(1));
  const record = calls.find((call) => call.name === 'memory_record');
  assert.ok(record);
  assert.doesNotThrow(() =>
    record.execute({ kind: 'fact', abstract: 'a', body: 'b', evidence: [{ event_seq: 1, quote: 'q' }] }),
  );
  assert.throws(
    () => record.execute({ kind: 'fact', abstract: 'c', body: 'd', evidence: [{ event_seq: 1, quote: 'q' }] }),
    /quota is exhausted.*memory_propose/,
  );
});
