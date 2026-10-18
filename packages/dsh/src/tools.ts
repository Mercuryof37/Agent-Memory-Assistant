import { SessionQuota } from '../../core/src/service/quota.ts';

/**
 * Tool surface (plan v1.3 §5.2, §5.4; ADR-0012). Strict schemas, no field names
 * that could smuggle a path or a session; `decide` is never a tool.
 *
 * `memory_review` shows a human button card and then runs the `/mem decide …`
 * command; the verdict comes from the card, never from the model.
 *
 * `registerTools` takes a service object so the adapter stays free of file I/O;
 * the real DSH wiring passes the core-backed service in.
 */

export const TOOL_NAMES = [
  'memory_recall',
  'memory_read',
  'memory_record',
  'memory_propose',
  'memory_review',
  'memory_context',
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
      project: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      error_signatures: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    },
    ['kind', 'abstract', 'body', 'evidence'],
  ),
  memory_propose: objectSchema(
    {
      op: { type: 'string', enum: ['create', 'supersede', 'delete'] },
      ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
      base_hashes: { type: 'array', items: { type: 'string' } },
      replacements: {
        type: 'array',
        minItems: 1,
        items: objectSchema(
          {
            kind: { type: 'string', enum: ['fact', 'pitfall', 'exp'] },
            abstract: { type: 'string', minLength: 1 },
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
            project: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' }, maxItems: 8 },
            error_signatures: { type: 'array', items: { type: 'string' }, maxItems: 3 },
          },
          ['kind', 'abstract', 'body', 'evidence'],
        ),
      },
      reason: { type: 'string' },
    },
    ['op'],
  ),
  memory_review: objectSchema({ id: { type: 'string' } }),
  memory_context: objectSchema({ limit: { type: 'integer', minimum: 1, maximum: 50 } }, []),
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
  if (name === 'memory_review') {
    if (record.id !== undefined && (typeof record.id !== 'string' || !/^prop-mem-\d{8}-[0-9a-f]{8}$/.test(record.id))) {
      problems.push('id must be a proposal id');
    }
  }
  if (name === 'memory_propose') {
    if (record.op === 'delete' && (typeof record.reason !== 'string' || record.reason.trim() === '')) {
      problems.push('a delete proposal needs reason');
    }
    if (record.op === 'create' || record.op === 'supersede') {
      const replacements = record.replacements;
      if (!Array.isArray(replacements) || replacements.length === 0) {
        problems.push(`a ${record.op} proposal needs replacements`);
      } else {
        replacements.forEach((replacement, index) => {
          problems.push(...replacementProblems(replacement, `replacements[${index}]`));
        });
      }
    }
    if (record.op !== 'create') {
      if (!Array.isArray(record.ids) || record.ids.length === 0) problems.push('ids are required');
      if (!Array.isArray(record.base_hashes) || record.base_hashes.length === 0) {
        problems.push('base_hashes are required');
      }
    }
    if (Array.isArray(record.base_hashes) && Array.isArray(record.ids)) {
      if (record.base_hashes.length !== record.ids.length) problems.push('one base_hash per id is required');
    }
  }
  return problems;
}

const KINDS = new Set(['fact', 'pitfall', 'exp']);

function replacementProblems(replacement: unknown, path: string): string[] {
  if (typeof replacement !== 'object' || replacement === null || Array.isArray(replacement)) {
    return [`${path} must be an object`];
  }
  const item = replacement as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof item.kind !== 'string' || !KINDS.has(item.kind)) problems.push(`${path}.kind must be fact|pitfall|exp`);
  if (typeof item.abstract !== 'string' || item.abstract.trim() === '') problems.push(`${path}.abstract is required`);
  if (typeof item.body !== 'string') problems.push(`${path}.body is required`);
  if (item.kind === 'pitfall') {
    const signatures = item.error_signatures;
    if (!Array.isArray(signatures) || signatures.length === 0) problems.push(`${path} pitfall needs error_signatures`);
  }
  const evidence = item.evidence;
  if (!Array.isArray(evidence) || evidence.length === 0) {
    problems.push(`${path}.evidence is required`);
    return problems;
  }
  evidence.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      problems.push(`${path}.evidence[${index}] must be an object`);
      return;
    }
    const evidenceItem = entry as Record<string, unknown>;
    if (!Number.isInteger(evidenceItem.event_seq) || (evidenceItem.event_seq as number) < 0) {
      problems.push(`${path}.evidence[${index}].event_seq must be a non-negative integer`);
    }
    if (typeof evidenceItem.quote !== 'string' || evidenceItem.quote === '') {
      problems.push(`${path}.evidence[${index}].quote is required`);
    }
  });
  return problems;
}

export interface ToolService {
  readonly config: { readonly quota: { readonly t0_per_session: number } };
  /** Assistant write mode from `personalization.mode`. */
  readonly mode: 'confirm' | 'direct' | 'readonly';
  recall(input: { query: string; limit?: number; kind?: string }): unknown;
  read(id: string): unknown;
  record(input: unknown, actor: TrustedActor, exec?: unknown): unknown;
  propose(input: unknown, actor: TrustedActor, exec?: unknown): unknown;
  context(exec?: unknown, limit?: number): unknown;
  rules(): unknown;
}

/**
 * Host-side review card hooks (ADR-0012). `memory_review` opens the card for a
 * pending proposal; `memory_propose` only stores a proposal and leaves approval
 * to the human (ADR-0048).
 */
export interface ToolHooks {
  readonly reviewProposal?: (proposal: unknown, exec?: unknown) => Promise<unknown>;
  readonly reviewPending?: (proposalId: string | undefined, exec?: unknown) => Promise<unknown>;
}

export function proposalPendingReminder(proposalId: string): string {
  return `提案已创建（${proposalId}），等待人工审批。请到【记忆 → 提案】查看并点击「采纳」或「驳回」。`;
}

export interface TrustedActor {
  readonly sessionId: string;
  readonly delegationDepth: number;
}

/** Capability groups (architecture v2 P0.5): preset/GUI/MCP compose these. */
export type CapabilityGroup = 'facts.read' | 'facts.write' | 'proposals.review' | 'rules.read';

export function capabilitiesFor(
  mode: 'confirm' | 'direct' | 'readonly',
  delegationDepth: number,
): readonly CapabilityGroup[] {
  const capabilities: CapabilityGroup[] = ['facts.read', 'rules.read'];
  if (delegationDepth === 0) {
    capabilities.push('proposals.review');
    if (mode !== 'readonly') capabilities.push('facts.write');
  }
  return capabilities;
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
  hooks: ToolHooks = {},
): RegisteredTool {
  const capabilities = new Set(capabilitiesFor(service.mode, actor.delegationDepth));
  const names: ToolName[] = ['memory_recall', 'memory_read', 'memory_context', 'rules_list'];
  if (capabilities.has('proposals.review')) names.push('memory_review');
  if (capabilities.has('facts.write')) names.push('memory_record', 'memory_propose');

/** Tool copy is human-facing; Chinese is the project's default (user preference). */
const TOOL_DESCRIPTIONS: Readonly<Record<ToolName, string>> = {
  memory_recall: '检索长期记忆：按查询返回相关摘要与记忆编号',
  memory_read: '读取一条记忆的全文、出处与状态',
  memory_record: '写入一条新记忆（必须给出真实事件出处）',
  memory_propose: '提出记忆修订或删除提案；只创建待审提案，创建后必须提醒用户去【记忆 → 提案】审批，不自动审批',
  memory_review: '为待审提案弹出中文审批卡片',
  memory_context: '查看当前会话最近事件，取得可用于出处的 event_seq',
  rules_list: '列出当前生效的规则',
};

  const execute = (name: ToolName, handler: (args: Record<string, unknown>, exec?: unknown) => unknown) => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
    parameters: TOOL_SCHEMAS[name],
    output: {
      schema: { type: 'object' },
      render: (_args: unknown, value: unknown) => {
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        // Point the human at the review paths; `decide` itself stays out of the
        // tool surface (ADR-0011/0012).
        const candidate = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
        const proposal = (candidate.proposal as { id?: unknown } | undefined) ?? candidate;
        const review = candidate.review as { decision?: unknown } | undefined;
        const proposalId = name === 'memory_propose' && review === undefined ? proposal.id : undefined;
        const reminder =
          typeof candidate.reminder === 'string'
            ? candidate.reminder
            : typeof proposalId === 'string'
              ? proposalPendingReminder(proposalId)
              : '';
        const hint = reminder === '' ? '' : `\n\n${reminder}`;
        return [{ type: 'text', text: text + hint }];
      },
    },
    execute: async (args: unknown, exec?: unknown) => {
      const problems = validateToolArgs(name, args);
      if (problems.length > 0) throw new ToolInputError(problems.join('; '));
      return handler(args as Record<string, unknown>, exec);
    },
  });

  const handlers: Record<string, (args: Record<string, unknown>, exec?: unknown) => unknown> = {
    memory_recall: (args) =>
      service.recall({
        query: String(args.query),
        ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
        ...(typeof args.kind === 'string' ? { kind: args.kind } : {}),
      }),
    memory_read: (args) => service.read(String(args.id)),
    memory_record: (args, exec) => {
      if (service.mode === 'readonly') {
        throw new ToolInputError('当前为 readonly 模式：只能读取记忆，不能写入');
      }
      if (!quota.consume(actor.sessionId)) {
        throw new ToolInputError('T0 write quota is exhausted for this session; use memory_propose instead');
      }
      const { evidence, ...rest } = args;
      return service.record({ ...rest, evidence }, actor, exec);
    },
    memory_propose: async (args, exec) => {
      if (service.mode === 'readonly') {
        throw new ToolInputError('当前为 readonly 模式：只能读取记忆，不能提出修改');
      }
      // Deliberately do NOT open a review card here. Approval is a separate
      // human action (proposal page or memory_review); creating a proposal must
      // never be able to select an option on the human's behalf.
      const proposal = (await service.propose(args, actor, exec)) as { id?: unknown };
      const proposalId = typeof proposal.id === 'string' ? proposal.id : '';
      return {
        ...proposal,
        status: 'pending',
        reminder: proposalPendingReminder(proposalId),
      };
    },
    memory_review: async (args, exec) => {
      if (hooks.reviewPending === undefined) {
        throw new ToolInputError('proposal review is unavailable in this host');
      }
      return hooks.reviewPending(typeof args.id === 'string' ? args.id : undefined, exec);
    },
    memory_context: (args, exec) =>
      service.context(exec, typeof args.limit === 'number' ? args.limit : undefined),
    rules_list: () => service.rules(),
  };

  for (const name of names) {
    ctx.tools.register(execute(name, handlers[name] as (args: Record<string, unknown>, exec?: unknown) => unknown));
  }
  return { names };
}
