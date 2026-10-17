/**
 * Session-history tools (architecture v2, P2). These are thin, read-only
 * wrappers over the host's native `sessionQuery` service (SQLite FTS5 index
 * included), so the model can search prior conversations without a second
 * index of our own.
 */

export const SESSION_TOOL_NAMES = [
  'session_search',
  'session_event_search',
  'session_event_read',
  'session_event_trace',
  'session_trace',
] as const;
export type SessionToolName = (typeof SESSION_TOOL_NAMES)[number];

export interface SessionQueryLike {
  searchSessions?(request: { query: string; limit?: number }): Promise<{ items: readonly unknown[] }>;
  searchEvents?(request: { sessionId: string; query: string; limit?: number }): Promise<{ items: readonly unknown[] }>;
  readEvent?(request: {
    sessionId: string;
    seq: number;
    before?: number;
    after?: number;
  }): Promise<Record<string, unknown>>;
  traceEvent?(request: { sessionId: string; seq: number }): Promise<Record<string, unknown>>;
  traceSession?(sessionId: string): Promise<Record<string, unknown>>;
}

export interface SessionToolDeps {
  readonly resolveQuery: () => SessionQueryLike | undefined;
  readonly sessionId: string;
}

interface ExecLike {
  readonly agent?: { readonly session?: { readonly id?: string } };
}

const SNIPPET_MAX = 500;
const TEXT_MAX = 4000;

function clip(text: string, max: number): string {
  const points = [...text];
  return points.length <= max ? text : `${points.slice(0, max).join('')}…`;
}

function textOf(data: unknown): string {
  if (typeof data !== 'object' || data === null) return '';
  const record = data as { content?: unknown; text?: unknown; message?: unknown };
  if (typeof record.content === 'string') return record.content;
  if (Array.isArray(record.content)) {
    return record.content
      .map((block) =>
        typeof block === 'object' && block !== null && typeof (block as { text?: unknown }).text === 'string'
          ? (block as { text: string }).text
          : '',
      )
      .filter((text) => text !== '')
      .join('\n');
  }
  if (typeof record.text === 'string') return record.text;
  if (typeof record.message === 'object' && record.message !== null) return textOf(record.message);
  return '';
}

function sessionIdOf(deps: SessionToolDeps, exec: unknown): string {
  const execLike = exec as ExecLike | undefined;
  return execLike?.agent?.session?.id ?? deps.sessionId;
}

function serviceOrFail(deps: SessionToolDeps): SessionQueryLike {
  const query = deps.resolveQuery();
  if (query === undefined) {
    throw new Error('host session query service is unavailable in this composition');
  }
  return query;
}

function limitOf(value: unknown, fallback = 5): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? Math.min(value, 10) : fallback;
}

function integerOf(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function summarizeEvent(item: unknown): Record<string, unknown> {
  const record = (item ?? {}) as Record<string, unknown>;
  const sessionId = (record.sessionId ?? record.session_id ?? '') as string;
  return {
    session_id: sessionId,
    seq: record.seq,
    type: record.type,
    snippet: typeof record.snippet === 'string' ? clip(record.snippet, SNIPPET_MAX) : undefined,
  };
}

export interface RegisteredSessionTool {
  readonly name: SessionToolName;
  readonly description: string;
  readonly parameters: unknown;
  readonly output: unknown;
  execute(args: unknown, exec?: unknown): Promise<unknown>;
}

function definition(
  name: SessionToolName,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  handler: (args: Record<string, unknown>, exec?: unknown) => Promise<unknown>,
): RegisteredSessionTool {
  return {
    name,
    description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
    output: {
      schema: { type: 'object' },
      render: (_args: unknown, value: unknown) => [
        { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
      ],
    },
    execute: async (args: unknown, exec?: unknown) => {
      if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('arguments must be an object');
      const record = args as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (!(key in properties)) throw new Error(`unknown field: ${key}`);
      }
      for (const key of required) {
        if (!(key in record)) throw new Error(`missing field: ${key}`);
      }
      return handler(record, exec);
    },
  };
}

export function sessionToolDefinitions(deps: SessionToolDeps): RegisteredSessionTool[] {
  return [
    definition(
      'session_search',
      'Agent Memory：跨会话全文检索，每个会话返回最匹配的一条',
      {
        query: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
      ['query'],
      async (args) => {
        const query = serviceOrFail(deps);
        const page = await query.searchSessions?.({
          query: String(args.query),
          limit: limitOf(args.limit),
        });
        return {
          results: (page?.items ?? []).map((item) => {
            const hit = item as { bestMatch?: unknown; header?: { id?: string; title?: string } };
            const best = summarizeEvent(hit.bestMatch);
            return {
              session_id: hit.header?.id ?? best.session_id,
              title: hit.header?.title,
              seq: best.seq,
              snippet: best.snippet,
            };
          }),
        };
      },
    ),
    definition(
      'session_event_search',
      'Agent Memory：在单个会话内全文检索事件（默认当前会话）',
      {
        query: { type: 'string', minLength: 1 },
        session_id: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
      ['query'],
      async (args, exec) => {
        const query = serviceOrFail(deps);
        const page = await query.searchEvents?.({
          sessionId: typeof args.session_id === 'string' ? args.session_id : sessionIdOf(deps, exec),
          query: String(args.query),
          limit: limitOf(args.limit),
        });
        return { results: (page?.items ?? []).map(summarizeEvent) };
      },
    ),
    definition(
      'session_event_read',
      'Agent Memory：读取一条事件的完整原文与前后若干条窗口',
      {
        seq: { type: 'integer', minimum: 0 },
        session_id: { type: 'string' },
        before: { type: 'integer', minimum: 0, maximum: 5 },
        after: { type: 'integer', minimum: 0, maximum: 5 },
      },
      ['seq'],
      async (args, exec) => {
        const query = serviceOrFail(deps);
        const seq = integerOf(args.seq, 'seq');
        const window = await query.readEvent?.({
          sessionId: typeof args.session_id === 'string' ? args.session_id : sessionIdOf(deps, exec),
          seq,
          before: typeof args.before === 'number' ? args.before : 1,
          after: typeof args.after === 'number' ? args.after : 1,
        });
        const target = (window?.target ?? {}) as Record<string, unknown>;
        return {
          session_id: typeof args.session_id === 'string' ? args.session_id : sessionIdOf(deps, exec),
          seq: target.seq,
          type: target.type,
          text: clip(textOf(target.data), TEXT_MAX),
          start_seq: window?.startSeq,
          end_seq: window?.endSeq,
        };
      },
    ),
    definition(
      'session_event_trace',
      'Agent Memory：查看一条事件的替换链与引用来源',
      {
        seq: { type: 'integer', minimum: 0 },
        session_id: { type: 'string' },
      },
      ['seq'],
      async (args, exec) => {
        const query = serviceOrFail(deps);
        const seq = integerOf(args.seq, 'seq');
        const trace = await query.traceEvent?.({
          sessionId: typeof args.session_id === 'string' ? args.session_id : sessionIdOf(deps, exec),
          seq,
        });
        return {
          target: trace?.target,
          replaced_by: trace?.replacedBy,
          replacement_chain: trace?.replacementChain,
          replaced_event_seqs: trace?.replacedEventSeqs,
          cited_source_seqs: trace?.citedSourceSeqs,
        };
      },
    ),
    definition(
      'session_trace',
      'Agent Memory：查看会话谱系（祖先与后代，默认当前会话）',
      { session_id: { type: 'string' } },
      [],
      async (args, exec) => {
        const query = serviceOrFail(deps);
        const target = typeof args.session_id === 'string' ? args.session_id : sessionIdOf(deps, exec);
        const trace = await query.traceSession?.(target);
        return { session_id: target, ...(trace ?? {}) };
      },
    ),
  ];
}

export function registerSessionTools(
  ctx: { readonly tools: { register(definition: unknown): unknown } },
  deps: SessionToolDeps,
): void {
  for (const tool of sessionToolDefinitions(deps)) ctx.tools.register(tool);
}
