import test from 'node:test';
import assert from 'node:assert/strict';
import { registerSessionTools, type SessionQueryLike } from '../src/session-tools.ts';

interface Registered {
  readonly name: string;
  readonly execute: (args: unknown, exec?: unknown) => Promise<unknown>;
}

function setup(query: SessionQueryLike | undefined, sessionId = 'current-session') {
  const tools: Registered[] = [];
  registerSessionTools(
    { tools: { register: (definition: unknown) => tools.push(definition as Registered) } },
    { resolveQuery: () => query, sessionId },
  );
  return tools;
}

const exec = { agent: { session: { id: 'agent-session' } } };

test('S10.4 all five session tools are registered with strict schemas', () => {
  const tools = setup(undefined);
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    'session_event_read',
    'session_event_search',
    'session_event_trace',
    'session_search',
    'session_trace',
  ]);
});

test('S10.4 session_search maps grouped hits to the model-facing shape', async () => {
  const calls: unknown[] = [];
  const query: SessionQueryLike = {
    searchSessions: async (request) => {
      calls.push(request);
      return {
        items: [
          {
            header: { id: 'sess-1', title: '旧会话' },
            bestMatch: { seq: 7, type: 'user/message', snippet: '记得修改部署脚本' },
          },
        ],
      };
    },
  };
  const tools = setup(query);
  const result = (await tools.find((tool) => tool.name === 'session_search')?.execute(
    { query: '部署', limit: 3 },
    exec,
  )) as { results: Array<Record<string, unknown>> };
  assert.deepEqual(result.results, [
    { session_id: 'sess-1', title: '旧会话', seq: 7, snippet: '记得修改部署脚本' },
  ]);
  assert.deepEqual(calls[0], { query: '部署', limit: 3 });
});

test('S10.4 event tools default to the calling session and clamp limits', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const query: SessionQueryLike = {
    searchEvents: async (request) => {
      calls.push(request as never);
      return { items: [{ seq: 2, type: 'user/message', snippet: 'hit' }] };
    },
    readEvent: async (request) => {
      calls.push(request as never);
      return {
        target: { seq: 2, type: 'user/message', data: { content: [{ type: 'text', text: '正文内容' }] } },
        startSeq: 1,
        endSeq: 3,
      };
    },
    traceEvent: async (request) => {
      calls.push(request as never);
      return { target: { seq: 2, type: 'user/message' }, replacementChain: [2], replacedEventSeqs: [], citedSourceSeqs: [] };
    },
    traceSession: async (sessionId) => {
      calls.push({ sessionId } as never);
      return { ancestors: [], descendants: [] };
    },
  };
  const tools = setup(query);
  const byName = (name: string) => tools.find((tool) => tool.name === name);

  await byName('session_event_search')?.execute({ query: 'x', limit: 99 }, exec);
  assert.equal((calls[0] as { sessionId: string }).sessionId, 'agent-session');

  const read = (await byName('session_event_read')?.execute({ seq: 2 }, exec)) as { text: string };
  assert.equal(read.text, '正文内容');

  await byName('session_event_trace')?.execute({ seq: 2 }, exec);
  assert.equal((calls[2] as { sessionId: string }).sessionId, 'agent-session');

  await byName('session_trace')?.execute({}, exec);
  assert.equal((calls[3] as { sessionId: string }).sessionId, 'agent-session');
});

test('S10.4 a missing session query service fails loudly', async () => {
  const tools = setup(undefined);
  const read = tools.find((tool) => tool.name === 'session_event_read');
  await assert.rejects(
    async () => read?.execute({ seq: 1 }, exec),
    /session query service is unavailable/,
  );
});

test('S10.4 unknown fields and bad seq are rejected before the service call', async () => {
  const tools = setup({});
  await assert.rejects(
    async () => tools.find((tool) => tool.name === 'session_search')?.execute({ query: 'x', path: 'p' }, exec),
    /unknown field: path/,
  );
  await assert.rejects(
    async () => tools.find((tool) => tool.name === 'session_event_read')?.execute({ seq: -1 }, exec),
    /seq must be a non-negative integer/,
  );
});
