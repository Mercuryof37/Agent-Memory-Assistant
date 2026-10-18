import test from 'node:test';
import assert from 'node:assert/strict';
import { initStore, listProposals } from '../../core/src/index.ts';
import { MemoryStore } from '../../core/src/store/store.ts';
import { loadConfig } from '../../core/src/config/load.ts';
import { cleanupHome, tempHome } from '../../core/test/helpers.ts';
import { handleMessage, mcpTools } from '../src/mcp.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const config = loadConfig({ home }).config;
  return { home, config, store: new MemoryStore({ home, config }) };
}

test('S15.1 MCP initialization and tool list expose read tools plus proposals', async (t) => {
  const { store, config } = fixture(t);
  const init = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' }, store, config);
  assert.equal((init?.result as { serverInfo?: { name?: string } }).serverInfo?.name, 'agent-memory');

  const list = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, store, config);
  const tools = (list?.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
  assert.deepEqual(tools, ['memory_search', 'memory_read', 'memory_list', 'memory_propose']);
  assert.ok(!tools.includes('memory_record'));
  assert.ok(!tools.includes('memory_decide'));
  assert.equal(mcpTools().length, 4);
});

test('S15.2 MCP search and propose go through the core store', async (t) => {
  const { store, config } = fixture(t);
  const saved = store.add(
    { kind: 'fact', abstract: '部署前先迁移数据库', body: '迁移脚本', evidence_level: 'observed' },
    { author: 'human' },
  );

  const search = await handleMessage(
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'memory_search', arguments: { query: '迁移' } } },
    store,
    config,
  );
  const text = (search?.result as { content: { text: string }[] }).content[0]?.text ?? '';
  assert.match(text, /部署前先迁移数据库/);

  const propose = await handleMessage(
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'memory_propose',
        arguments: {
          op: 'supersede',
          targets: [saved.id],
          base_hashes: [saved.content_hash],
          replacements: [{ kind: 'fact', abstract: '迁移后再部署', body: '新正文' }],
          reason: 'MCP 测试',
        },
      },
    },
    store,
    config,
  );
  assert.match((propose?.result as { content: { text: string }[] }).content[0]?.text ?? '', /pending_human_review/);
  const pending = listProposals(store);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.replacements[0]?.provenance?.length, 0);
});

test('S15.3 MCP never exposes a decision path', async (t) => {
  const { store, config } = fixture(t);
  const response = await handleMessage(
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'memory_decide', arguments: {} } },
    store,
    config,
  );
  assert.equal(response?.error?.code, -32603);
  assert.match(response?.error?.message ?? '', /unknown tool/);
});

test('S15.4 unknown methods return -32601 and notifications stay silent', async (t) => {
  const { store, config } = fixture(t);
  const unknown = await handleMessage({ jsonrpc: '2.0', id: 6, method: 'nope' }, store, config);
  assert.equal(unknown?.error?.code, -32601);
  const notification = await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, store, config);
  assert.equal(notification, null);
});
