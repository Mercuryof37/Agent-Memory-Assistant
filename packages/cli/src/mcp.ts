/**
 * MCP stdio server for Agent Memory (V2 P3).
 *
 * External agents (Codex, Claude Code, …) get the same store through the same
 * core API: read tools plus a proposal tool. Decisions stay human: the MCP
 * surface has no `decide` and no `record`; proposals wait for a human in the
 * DSH GUI or chat. Messages are newline-delimited JSON-RPC 2.0 (MCP stdio).
 */

import { createInterface } from 'node:readline';
import {
  createProposal,
  MemoryStore,
  startup,
  type Config,
  type MemoryDoc,
  type ProposalInput,
  type Runtime,
} from '../../core/src/index.ts';

export const MCP_VERSION = '0.4.0';

interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { code: number; message: string };
}

const TOOLS = [
  {
    name: 'memory_search',
    description: '按关键词检索长期记忆，返回摘要、编号与出处是否可核验',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_read',
    description: '读取一条记忆的全文、出处与状态（id 来自 search/list 结果）',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'memory_list',
    description: '列出当前活动记忆（可按 fact / pitfall / exp 过滤）',
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['fact', 'pitfall', 'exp'] } },
    },
  },
  {
    name: 'memory_propose',
    description: '提出修订或删除提案；需要人在 DSH 界面确认后才生效',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['supersede', 'delete'] },
        targets: { type: 'array', items: { type: 'string' }, minItems: 1 },
        base_hashes: { type: 'array', items: { type: 'string' }, minItems: 1 },
        replacements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['fact', 'pitfall', 'exp'] },
              abstract: { type: 'string' },
              body: { type: 'string' },
              error_signatures: { type: 'array', items: { type: 'string' } },
            },
            required: ['kind', 'abstract', 'body'],
          },
        },
        reason: { type: 'string' },
      },
      required: ['op', 'targets', 'base_hashes'],
    },
  },
] as const;

export function mcpTools(): unknown[] {
  return [...TOOLS];
}

function textResult(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function docView(doc: MemoryDoc) {
  return {
    id: doc.id,
    kind: doc.kind,
    abstract: doc.abstract,
    body: doc.body,
    valid_from: doc.valid_from,
    valid_until: doc.valid_until,
    author: doc.author,
    evidence_level: doc.evidence_level,
    error_signatures: doc.error_signatures,
    provenance: doc.provenance,
    content_hash: doc.content_hash,
  };
}

async function callTool(
  store: MemoryStore,
  config: Config,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (name === 'memory_search') {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (query === '') throw new Error('query is required');
    const limit = typeof args.limit === 'number' ? args.limit : 20;
    return store.recallAsync(query, { limit });
  }
  if (name === 'memory_read') {
    if (typeof args.id !== 'string' || args.id === '') throw new Error('id is required');
    return docView(store.read(args.id as never));
  }
  if (name === 'memory_list') {
    const kind = typeof args.kind === 'string' ? args.kind : undefined;
    return store.active().filter((doc) => kind === undefined || doc.kind === kind).map(docView);
  }
  if (name === 'memory_propose') {
    const op = args.op === 'delete' ? 'delete' : args.op === 'supersede' ? 'supersede' : null;
    if (op === null) throw new Error('op must be supersede or delete');
    const targets = Array.isArray(args.targets) ? args.targets.filter((id): id is string => typeof id === 'string') : [];
    const baseHashes = Array.isArray(args.base_hashes)
      ? args.base_hashes.filter((hash): hash is string => typeof hash === 'string')
      : [];
    if (targets.length === 0 || targets.length !== baseHashes.length) {
      throw new Error('one target and one base_hash are required');
    }
    const replacements = Array.isArray(args.replacements) ? args.replacements : [];
    const input: ProposalInput =
      op === 'delete'
        ? { op: 'delete', target: targets[0] as never, base_hash: baseHashes[0] as string, reason: String(args.reason ?? 'MCP 提案') }
        : {
            op: 'supersede',
            targets: targets as never,
            base_hashes: baseHashes,
            reason: String(args.reason ?? 'MCP 提案'),
            replacements: replacements.map((raw) => {
              const entry = raw as Record<string, unknown>;
              return {
                kind: entry.kind as never,
                abstract: String(entry.abstract ?? ''),
                body: String(entry.body ?? ''),
                evidence_level: 'observed' as const,
                ...(Array.isArray(entry.error_signatures)
                  ? { error_signatures: entry.error_signatures.filter((item): item is string => typeof item === 'string') }
                  : {}),
                // External agents have no DSH event sequence; never fabricate one.
                provenance: [],
              };
            }),
          };
    const proposal = createProposal({ store, config }, input);
    return { id: proposal.id, op: proposal.op, targets: proposal.targets, status: 'pending_human_review' };
  }
  throw new Error(`unknown tool: ${name}`);
}

export async function handleMessage(
  message: JsonRpcRequest,
  store: MemoryStore,
  config: Config,
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;
  if (message.method === undefined) return null;
  if (message.id === undefined) return null; // notification
  try {
    if (message.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'agent-memory', version: MCP_VERSION },
        },
      };
    }
    if (message.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (message.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: mcpTools() } };
    if (message.method === 'tools/call') {
      const params = message.params ?? {};
      const name = typeof params.name === 'string' ? params.name : '';
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const result = await callTool(store, config, name, args);
      return { jsonrpc: '2.0', id, result: textResult(result) };
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${message.method}` } };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
    };
  }
}

export interface McpServerOptions {
  readonly store: MemoryStore;
  readonly config: Config;
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
}

/** Long-running newline-delimited JSON-RPC loop; resolves when stdin closes. */
export function runMcpServer(options: McpServerOptions): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const readline = createInterface({ input, crlfDelay: Infinity });
  return new Promise((resolve) => {
    readline.on('line', (line) => {
      if (line.trim() === '') return;
      let message: JsonRpcRequest;
      try {
        message = JSON.parse(line) as JsonRpcRequest;
      } catch {
        output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`);
        return;
      }
      void handleMessage(message, options.store, options.config).then((response) => {
        if (response !== null) output.write(`${JSON.stringify(response)}\n`);
      });
    });
    readline.on('close', () => resolve());
  });
}

export function openMcpStore(home?: string): { store: MemoryStore; config: Config; runtime: Runtime } {
  const runtime = startup({ ...(home === undefined ? {} : { home }) });
  return {
    store: new MemoryStore({ home: runtime.home, config: runtime.config }),
    config: runtime.config,
    runtime,
  };
}

/** `mem mcp` entry: start the stdio server and block until the client closes. */
export async function commandMcp(options: { home?: string }): Promise<number> {
  const { store, config } = openMcpStore(options.home);
  await runMcpServer({ store, config });
  return 0;
}
