import { SessionQuota } from '../../core/src/service/quota.ts';

/**
 * Tool surface (plan v1.3 §5.2, §5.4). Five tools, strict schemas, no field names
 * that could smuggle a path or a session; `decide` is never a tool.
 *
 * `registerTools` takes a service object so the adapter stays free of file I/O;
 * the real DSH wiring passes the core-backed service in.
 */

export const TOOL_NAMES = [
  'memory_recall',
  'memory_read',
  'memory_record',
  'memory_propose',
  'rules_list',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const FORBIDDEN_FIELDS = new Set(['path', 'target', 'session', 'session_id', 'approve']);

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

export const TOOL_SCHEMAS: Readonly<Record<ToolName, unknown>> = {
  memory_recall: objectSchema(
    {
      query: { type: 'string', minLength: 1 },
      limit: { type: 'integer', minimum: 1 },
      kind: { type: 'string', enum: ['fact', 'pitfall', 'exp'] },
    },
    ['query'],
  ),
  memory_read: objectSchema({ id: { type: 'string' } }, ['id']),
  memory_record: objectSchema(
    {
      kind: { type: 'string', enum: ['fact', 'pitfall', 'exp'] },
      abstract: { type: 'string' },
      body: { type: 'string' },
      evidence: {
        type: 'array',
        minItems: 1,
        items: objectSchema(
          { event_seq: { type: 'integer', minimum: 0 }, quote: { type: 'string' } },
          ['event_seq', 'quote'],
        ),
      },
      valid_from: { type: 'string' },
      error_signatures: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    },
    ['kind', 'abstract', 'body', 'evidence'],
  ),
  memory_propose: objectSchema(
    {
      op: { type: 'string', enum: ['supersede', 'delete'] },
      ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
      base_hashes: { type: 'array', items: { type: 'string' } },
      replacements: { type: 'array', items: { type: 'object' } },
      reason: { type: 'string' },
    },
    ['op', 'ids', 'base_hashes'],
  ),
  rules_list: objectSchema({}, []),
};

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

function forbiddenKeys(value: unknown, path = ''): string[] {
  if (typeof value !== 'object' || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((entry, index) => forbiddenKeys(entry, `${path}[${index}]`));
  const hits: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.has(key)) hits.push(`${path}${key}`.replace(/^\./, ''));
    hits.push(...forbiddenKeys(child, `${path}${key}.`));
  }
  return hits;
}

/** Schema check used by tests and execute; returns [] when the args are usable. */
export function validateToolArgs(name: ToolName, args: unknown): string[] {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return ['arguments must be an object'];
  const schema = TOOL_SCHEMAS[name] as { properties: Record<string, unknown>; required: string[] };
  const record = args as Record<string, unknown>;
  const problems: string[] = [];
  const forbidden = forbiddenKeys(record);
  if (forbidden.length > 0) problems.push(`forbidden field: ${forbidden.join(', ')}`);
  for (const key of Object.keys(record)) {
    if (!(key in schema.properties)) problems.push(`unknown field: ${key}`);
  }
  for (const key of schema.required) {
    if (!(key in record)) problems.push(`missing field: ${key}`);
  }
  if (name === 'memory_read') {
    if (typeof record.id !== 'string' || !/^mem-\d{8}-[0-9a-f]{8}$/.test(record.id)) {
      problems.push('id must be a memory id');
    }
  }
  if (name === 'memory_record') {
    if (record.kind === 'pitfall') {
      const signatures = record.error_signatures;
      if (!Array.isArray(signatures) || signatures.length === 0) {
        problems.push('a pitfall needs error_signatures');
      }
    }
    const evidence = record.evidence;
    if (!Array.isArray(evidence) || evidence.length === 0) problems.push('evidence is required');
  }
  if (name === 'memory_propose') {
    if (record.op === 'delete' && (typeof record.reason !== 'string' || record.reason.trim() === '')) {
      problems.push('a delete proposal needs reason');
    }
    if (record.op === 'supersede' && !Array.isArray(record.replacements)) {
      problems.push('a supersede proposal needs replacements');
    }
    if (Array.isArray(record.base_hashes) && Array.isArray(record.ids)) {
      if (record.base_hashes.length !== record.ids.length) problems.push('one base_hash per id is required');
    }
  }
  return problems;
}

export interface ToolService {
  readonly config: { readonly quota: { readonly t0_per_session: number } };
  recall(input: { query: string; limit?: number; kind?: string }): unknown;
  read(id: string): unknown;
  record(input: unknown, actor: TrustedActor): unknown;
  propose(input: unknown, actor: TrustedActor): unknown;
  rules(): unknown;
}

export interface TrustedActor {
  readonly sessionId: string;
  readonly delegationDepth: number;
}

export interface ToolRegistry {
  register(definition: unknown): unknown;
}

export interface RegisteredTool {
  readonly names: readonly ToolName[];
}

/**
 * Register read tools always and write tools only for a top-level agent. The
 * quota (if supplied) rejects the (limit+1)-th T0 write in one session.
 */
export function registerTools(
  ctx: { readonly tools: ToolRegistry },
  service: ToolService,
  actor: TrustedActor,
  quota: SessionQuota = new SessionQuota(service.config.quota.t0_per_session),
): RegisteredTool {
  const names: ToolName[] = ['memory_recall', 'memory_read', 'rules_list'];
  if (actor.delegationDepth === 0) names.push('memory_record', 'memory_propose');

  const execute = (name: ToolName, handler: (args: Record<string, unknown>) => unknown) => ({
    name,
    description: `Agent Memory: ${name}`,
    parameters: TOOL_SCHEMAS[name],
    execute: (args: unknown) => {
      const problems = validateToolArgs(name, args);
      if (problems.length > 0) throw new ToolInputError(problems.join('; '));
      return handler(args as Record<string, unknown>);
    },
  });

  const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
    memory_recall: (args) =>
      service.recall({
        query: String(args.query),
        ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
        ...(typeof args.kind === 'string' ? { kind: args.kind } : {}),
      }),
    memory_read: (args) => service.read(String(args.id)),
    memory_record: (args) => {
      if (!quota.consume(actor.sessionId)) {
        throw new ToolInputError('T0 write quota is exhausted for this session; use memory_propose instead');
      }
      const { evidence, ...rest } = args;
      return service.record({ ...rest, evidence }, actor);
    },
    memory_propose: (args) => service.propose(args, actor),
    rules_list: () => service.rules(),
  };

  for (const name of names) ctx.tools.register(execute(name, handlers[name] as (args: Record<string, unknown>) => unknown));
  return { names };
}
