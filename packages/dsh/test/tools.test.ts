import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionQuota } from '../../core/src/service/quota.ts';
import {
  capabilitiesFor,
  registerTools,
  TOOL_NAMES,
  TOOL_SCHEMAS,
  validateToolArgs,
  type ToolHooks,
  type ToolService,
} from '../src/tools.ts';

interface FakeCall {
  readonly name: string;
  readonly execute: (args: unknown) => unknown;
}

function fakeService(mode: 'confirm' | 'direct' | 'readonly' = 'confirm'): ToolService & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    config: { quota: { t0_per_session: 1 } },
    mode,
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
    context: () => {
      calls.push('context');
      return { events: [] };
    },
    rules: () => {
      calls.push('rules');
      return [];
    },
  };
}

function register(service: ToolService, delegationDepth = 0, quota?: SessionQuota, hooks?: ToolHooks): FakeCall[] {
  const calls: FakeCall[] = [];
  const ctx = { tools: { register: (definition: unknown) => calls.push(definition as FakeCall) } };
  registerTools(ctx, service, { sessionId: 's1', delegationDepth }, quota, hooks);
  return calls;
}

test('S4.1 the tool table is exactly seven names with strict schemas and no forbidden fields', () => {
  const registered = register(fakeService());
  assert.deepEqual(
    registered.map((call) => call.name).sort(),
    [...TOOL_NAMES].sort(),
  );
  assert.equal(registered.length, 7);
  for (const name of TOOL_NAMES) {
    const schema = TOOL_SCHEMAS[name] as { additionalProperties?: boolean };
    assert.equal(schema.additionalProperties, false, `${name} must be strict`);
    const text = JSON.stringify(TOOL_SCHEMAS[name]);
    assert.doesNotMatch(text, /"(path|target|session|session_id|approve)"/);
  }
  assert.equal(new Set(registered.map((call) => call.name)).size, 7);
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
    [
      'memory_propose',
      {
        op: 'supersede',
        ids: ['mem-20261017-00000001'],
        base_hashes: ['x'],
        replacements: [{ kind: 'fact', abstract: 'a', body: 'b' }],
      },
    ],
    [
      'memory_propose',
      {
        op: 'supersede',
        ids: ['mem-20261017-00000001'],
        base_hashes: ['x'],
        replacements: [{ kind: 'fact', abstract: 'a', body: 'b', evidence: [] }],
      },
    ],
    [
      'memory_propose',
      {
        op: 'supersede',
        ids: ['mem-20261017-00000001'],
        base_hashes: ['x'],
        replacements: [{ kind: 'fact', abstract: 'a', body: 'b', evidence: [{ event_seq: -1, quote: 'q' }] }],
      },
    ],
    ['memory_review', { id: 'mem-20261017-00000001' }],
    ['memory_review', { id: 'prop-1' }],
    ['memory_review', { id: 'prop-mem-20261017-00000001', approve: true }],
  ];
  for (const [name, args] of cases) {
    assert.ok(validateToolArgs(name, args).length > 0, `${name} accepted ${JSON.stringify(args)}`);
  }
  assert.deepEqual(
    validateToolArgs('memory_read', { id: 'mem-20261017-00000001' }),
    [],
  );
  assert.deepEqual(validateToolArgs('memory_review', {}), []);
  assert.deepEqual(validateToolArgs('memory_review', { id: 'prop-mem-20261017-00000001' }), []);
  assert.deepEqual(
    validateToolArgs('memory_propose', {
      op: 'supersede',
      ids: ['mem-20261017-00000001'],
      base_hashes: ['x'],
      replacements: [
        { kind: 'fact', abstract: 'a', body: 'b', evidence: [{ event_seq: 3, quote: 'q' }] },
      ],
    }),
    [],
  );
});

test('S9.1 memory_propose only creates a pending proposal; memory_review opens the card', async () => {
  const reviewed: unknown[] = [];
  const calls = register(fakeService(), 0, undefined, {
    reviewProposal: async (proposal) => {
      reviewed.push(proposal);
      return { decision: 'accept' };
    },
    reviewPending: async (id) => ({ reopened: id }),
  });
  const propose = calls.find((call) => call.name === 'memory_propose');
  assert.ok(propose);
  const result = await propose.execute({
    op: 'delete',
    ids: ['mem-20261017-00000001'],
    base_hashes: ['x'],
    reason: 'r',
  });
  assert.deepEqual(result, { id: 'prop-1' });
  assert.equal(reviewed.length, 0);

  const review = calls.find((call) => call.name === 'memory_review');
  assert.ok(review);
  assert.deepEqual(await review.execute({ id: 'prop-mem-20261017-00000001' }), {
    reopened: 'prop-mem-20261017-00000001',
  });
});

test('S12.1 readonly hides write tools from the model', () => {
  const service = fakeService('readonly');
  const calls = register(service);
  const names = calls.map((call) => call.name).sort();
  assert.ok(!names.includes('memory_record' as never));
  assert.ok(!names.includes('memory_propose' as never));
  assert.ok(names.includes('memory_recall' as never));
  assert.ok(names.includes('memory_review' as never));
  assert.equal(service.calls.length, 0);
});

test('S13.5 capability groups follow mode and delegation depth', () => {
  assert.deepEqual(capabilitiesFor('confirm', 0), ['facts.read', 'rules.read', 'proposals.review', 'facts.write']);
  assert.deepEqual(capabilitiesFor('direct', 0), ['facts.read', 'rules.read', 'proposals.review', 'facts.write']);
  assert.deepEqual(capabilitiesFor('readonly', 0), ['facts.read', 'rules.read', 'proposals.review']);
  assert.deepEqual(capabilitiesFor('confirm', 1), ['facts.read', 'rules.read']);
});

test('S4.6 a sub-agent gets read tools only; decide is never a tool', () => {
  const names = register(fakeService(), 1).map((call) => call.name);
  assert.deepEqual(names.sort(), ['memory_context', 'memory_read', 'memory_recall', 'rules_list']);
  assert.ok(!TOOL_NAMES.includes('decide' as never));
  assert.ok(!names.includes('memory_record' as never));
});

test('S4.6 the T0 quota rejects the second write and points at proposals', async () => {
  const service = fakeService();
  const calls = register(service, 0, new SessionQuota(1));
  const record = calls.find((call) => call.name === 'memory_record');
  assert.ok(record);
  await record.execute({ kind: 'fact', abstract: 'a', body: 'b', evidence: [{ event_seq: 1, quote: 'q' }] });
  await assert.rejects(
    async () => record.execute({ kind: 'fact', abstract: 'c', body: 'd', evidence: [{ event_seq: 1, quote: 'q' }] }),
    /quota is exhausted.*memory_propose/,
  );
});

test('S17.2 memory_propose accepts create without ids and requires replacements', () => {
  assert.deepEqual(
    validateToolArgs('memory_propose', {
      op: 'create',
      replacements: [{ kind: 'exp', abstract: '新经验', body: 'b', evidence: [{ event_seq: 1, quote: 'q' }] }],
    }),
    [],
  );
  assert.ok(validateToolArgs('memory_propose', { op: 'create' }).length > 0);
  assert.ok(validateToolArgs('memory_propose', { op: 'delete', reason: 'x' }).length > 0);
});
