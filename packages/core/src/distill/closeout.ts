import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memoryPaths } from '../paths.ts';
import { writeFileAtomic } from '../fs/atomic.ts';

/** Persisted set of rejected proposal summary hashes (never re-propose them). */
export function loadRejected(home: string): Set<string> {
  const file = join(memoryPaths(home).stateDir, 'distill-rejected.json');
  if (!existsSync(file)) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { hashes?: unknown };
    return new Set(Array.isArray(parsed.hashes) ? parsed.hashes.filter((value): value is string => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

export function addRejected(home: string, hashes: readonly string[]): void {
  const set = loadRejected(home);
  for (const hash of hashes) set.add(hash);
  writeFileAtomic(
    join(memoryPaths(home).stateDir, 'distill-rejected.json'),
    `${JSON.stringify({ hashes: [...set].sort() }, null, 2)}\n`,
  );
}

/**
 * Closeout distillation core (plan v1.3 §7, S6).
 *
 * L0 is deterministic tagging over the session log; it never writes memory.
 * The model gets the L0 list plus the active catalog and must answer with a
 * strict JSON contract. Everything it returns is re-validated here: evidence is
 * resolved against real events, assistant messages cannot be their own evidence,
 * a `rule` without machine-check design is downgraded, duplicates and rejected
 * summaries disappear, and at most five proposals survive.
 */

export interface DistillEvent {
  readonly seq: number;
  readonly speaker: 'user' | 'assistant' | 'tool' | 'system';
  readonly text: string;
}

export type L0Kind = 'repeated-error' | 'correction' | 'failure-then-success' | 'rollback';

export interface L0Signal {
  readonly kind: L0Kind;
  readonly event_seqs: readonly number[];
  readonly summary: string;
}

const CORRECTION = /不对|错了|不是这样|纠正|actually|correction|rather than|instead/i;
const ROLLBACK = /回滚|撤销|revert|rollback|undo/i;
const FAILURE = /error|failed|失败|报错|exception/i;

export function collectL0(events: readonly DistillEvent[]): L0Signal[] {
  const signals: L0Signal[] = [];
  const failureSeqs = events.filter((event) => event.speaker !== 'user' && FAILURE.test(event.text)).map((event) => event.seq);
  if (failureSeqs.length >= 2) {
    signals.push({
      kind: 'repeated-error',
      event_seqs: failureSeqs.slice(0, 5),
      summary: `${failureSeqs.length} 个工具输出包含错误/失败`,
    });
  }
  const corrections = events.filter((event) => event.speaker === 'user' && CORRECTION.test(event.text));
  if (corrections.length > 0) {
    signals.push({
      kind: 'correction',
      event_seqs: corrections.map((event) => event.seq).slice(0, 5),
      summary: '用户纠正了先前的说法或做法',
    });
  }
  const failures = events.filter((event) => event.speaker === 'tool' && FAILURE.test(event.text));
  const successes = events.filter((event) => event.speaker === 'tool' && !FAILURE.test(event.text));
  if (failures.length > 0 && successes.length > 0) {
    signals.push({
      kind: 'failure-then-success',
      event_seqs: [failures[failures.length - 1]?.seq as number, successes[successes.length - 1]?.seq as number],
      summary: '工具先失败后成功',
    });
  }
  const rollbacks = events.filter((event) => ROLLBACK.test(event.text));
  if (rollbacks.length > 0) {
    signals.push({
      kind: 'rollback',
      event_seqs: rollbacks.map((event) => event.seq).slice(0, 5),
      summary: '出现回滚/撤销',
    });
  }
  return signals;
}

export interface CloseoutPromptInput {
  readonly l0: readonly L0Signal[];
  readonly active: readonly { readonly id: string; readonly kind: string; readonly abstract: string }[];
  readonly maxProposals: number;
}

export function buildCloseoutPrompt(input: CloseoutPromptInput): string {
  const l0 = input.l0.length === 0 ? '（无）' : input.l0.map((signal) => `- ${signal.kind} [${signal.event_seqs.join(',')}] ${signal.summary}`).join('\n');
  const catalog = input.active.map((doc) => `- ${doc.id} [${doc.kind}] ${doc.abstract}`).join('\n');
  return [
    '你正在做 Agent Memory 的收尾蒸馏。只输出一个 JSON 对象，不要输出别的文字。',
    '',
    'L0 确定性线索：',
    l0,
    '',
    '当前活动记忆（targets 只能从这里选）：',
    catalog || '（空）',
    '',
    `最多 ${input.maxProposals} 条提案。JSON 契约：`,
    '{"proposals":[{"op":"supersede","targets":["mem-..."],"reason":"...","replacements":[{"kind":"fact|pitfall|exp","abstract":"...","body":"...","evidence":[{"event_seq":1,"quote":"原文片段"}]}]}]}',
    '或 {"proposals":[],"message":"本次无新提案"}。',
    'evidence 必须引用真实事件：event_seq 是该事件序号，quote 必须是该事件原文的子串；助手消息不能当证据。',
    '没有机器检查设计（check/test/[neg]）的规则不要写成 rule，降级为 pitfall 或 fact。',
    '已否决的摘要、与活动记忆重复的内容不要再提。',
  ].join('\n');
}

export interface CloseoutCandidate {
  readonly op: 'supersede' | 'delete';
  readonly targets: readonly string[];
  readonly reason: string;
  readonly replacements: readonly {
    readonly kind: 'fact' | 'pitfall' | 'exp';
    readonly abstract: string;
    readonly body: string;
    readonly evidence: readonly { readonly event_seq: number; readonly quote: string }[];
  }[];
}

export interface ParseDeps {
  readonly events: readonly DistillEvent[];
  readonly activeAbstracts: readonly string[];
  readonly activeIds: readonly string[];
  readonly rejectedHashes?: ReadonlySet<string>;
  readonly maxProposals?: number;
}

export interface ParseResult {
  readonly candidates: readonly CloseoutCandidate[];
  readonly message: string | null;
  readonly errors: readonly string[];
  readonly dropped: readonly string[];
  readonly truncated: number;
}

function normalizedAbstract(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function summaryHash(candidate: CloseoutCandidate): string {
  const material = [
    candidate.op,
    [...candidate.targets].sort().join(','),
    ...candidate.replacements.map((replacement) => normalizedAbstract(replacement.abstract)),
  ].join('|');
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

function findJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** Validate the model's closeout answer against the real session events. */
export function parseCloseout(text: string, deps: ParseDeps): ParseResult {
  const errors: string[] = [];
  const dropped: string[] = [];
  const parsed = findJson(text);
  if (typeof parsed !== 'object' || parsed === null) {
    return { candidates: [], message: null, errors: ['closeout answer is not a JSON object'], dropped, truncated: 0 };
  }
  const record = parsed as { proposals?: unknown; message?: unknown };
  const emptyMessage =
    typeof record.message === 'string' &&
    record.message.trim() !== '' &&
    (record.proposals === undefined || (Array.isArray(record.proposals) && record.proposals.length === 0));
  if (emptyMessage) {
    return { candidates: [], message: (record.message as string).trim(), errors, dropped, truncated: 0 };
  }
  if (!Array.isArray(record.proposals)) {
    return { candidates: [], message: null, errors: ['proposals must be an array'], dropped, truncated: 0 };
  }
  const limit = deps.maxProposals ?? 5;
  const truncated = Math.max(0, record.proposals.length - limit);
  const candidates: CloseoutCandidate[] = [];
  const activeIds = new Set(deps.activeIds);
  const activeAbstracts = new Set(deps.activeAbstracts.map(normalizedAbstract));
  const rejected = deps.rejectedHashes ?? new Set<string>();
  const events = new Map(deps.events.map((event) => [event.seq, event]));

  for (const raw of record.proposals.slice(0, limit)) {
    if (typeof raw !== 'object' || raw === null) {
      dropped.push('proposal is not an object');
      continue;
    }
    const proposal = raw as {
      op?: unknown;
      targets?: unknown;
      target?: unknown;
      reason?: unknown;
      replacements?: unknown;
    };
    const op = proposal.op === 'delete' ? 'delete' : proposal.op === 'supersede' ? 'supersede' : null;
    if (op === null) {
      dropped.push('unsupported op');
      continue;
    }
    const targets = (op === 'delete' ? [proposal.target] : proposal.targets) as unknown;
    if (!Array.isArray(targets) || targets.length === 0 || !targets.every((target) => typeof target === 'string')) {
      dropped.push('targets must be memory ids');
      continue;
    }
    if (!targets.every((target) => activeIds.has(target as string))) {
      dropped.push('target is not an active memory');
      continue;
    }
    const replacementsRaw = op === 'supersede' ? proposal.replacements : [];
    if (!Array.isArray(replacementsRaw) || (op === 'supersede' && replacementsRaw.length === 0)) {
      dropped.push('supersede needs replacements');
      continue;
    }
    const replacements: CloseoutCandidate['replacements'][number][] = [];
    let failed = false;
    for (const rawReplacement of replacementsRaw) {
      if (typeof rawReplacement !== 'object' || rawReplacement === null) {
        dropped.push('replacement is not an object');
        failed = true;
        break;
      }
      const replacement = rawReplacement as {
        kind?: unknown;
        abstract?: unknown;
        body?: unknown;
        evidence?: unknown;
      };
      if (replacement.kind !== 'fact' && replacement.kind !== 'pitfall' && replacement.kind !== 'exp') {
        dropped.push('replacement kind must be fact/pitfall/exp');
        failed = true;
        break;
      }
      const abstract = typeof replacement.abstract === 'string' ? replacement.abstract : '';
      if (abstract.trim() === '' || !Array.isArray(replacement.evidence) || replacement.evidence.length === 0) {
        dropped.push('replacement needs abstract and evidence');
        failed = true;
        break;
      }
      if (activeAbstracts.has(normalizedAbstract(abstract))) {
        dropped.push(`duplicate of an active memory: ${abstract.slice(0, 24)}`);
        failed = true;
        break;
      }
      const evidence: { event_seq: number; quote: string }[] = [];
      for (const rawEvidence of replacement.evidence) {
        if (typeof rawEvidence !== 'object' || rawEvidence === null) {
          dropped.push('evidence is not an object');
          failed = true;
          break;
        }
        const item = rawEvidence as { event_seq?: unknown; quote?: unknown };
        const event = typeof item.event_seq === 'number' ? events.get(item.event_seq) : undefined;
        const quote = typeof item.quote === 'string' ? item.quote : '';
        if (event === undefined) {
          dropped.push(`evidence event ${String(item.event_seq)} does not exist`);
          failed = true;
          break;
        }
        if (event.speaker === 'assistant') {
          dropped.push('assistant message cannot be evidence');
          failed = true;
          break;
        }
        if (quote === '' || !event.text.includes(quote)) {
          dropped.push('evidence quote is not a substring of the event');
          failed = true;
          break;
        }
        if ([...quote].length > 160) {
          dropped.push('evidence quote is longer than 160 characters');
          failed = true;
          break;
        }
        evidence.push({ event_seq: event.seq, quote });
      }
      if (failed) break;
      replacements.push({
        kind: replacement.kind,
        abstract,
        body: typeof replacement.body === 'string' ? replacement.body : '',
        evidence,
      });
    }
    if (failed) continue;

    const candidate: CloseoutCandidate = {
      op,
      targets: targets as string[],
      reason: typeof proposal.reason === 'string' ? proposal.reason : '',
      replacements,
    };
    const hash = summaryHash(candidate);
    if (rejected.has(hash)) {
      dropped.push('already rejected');
      continue;
    }
    if (candidates.some((existing) => summaryHash(existing) === hash)) {
      dropped.push('duplicate proposal');
      continue;
    }
    candidates.push(candidate);
  }

  return { candidates, message: null, errors, dropped, truncated };
}

/** `rule` without machine-check design is downgraded instead of proposed as a rule. */
export function downgradeRule(candidate: { readonly kind: string; readonly machine_gate?: { check?: string; test?: string } }): {
  readonly action: 'keep' | 'downgrade';
  readonly to?: 'pitfall';
} {
  if (candidate.kind !== 'rule') return { action: 'keep' };
  if (candidate.machine_gate?.check !== undefined && candidate.machine_gate.test !== undefined) {
    return { action: 'keep' };
  }
  return { action: 'downgrade', to: 'pitfall' };
}

export type RoundState = 'open' | 'submitted' | 'disposed';

/** One closeout round: exactly one submit, then dispose (success/failure/timeout). */
export class CloseoutRound {
  readonly id: string;
  private state: RoundState = 'open';
  private readonly expiresAt: number;
  private readonly now: () => number;

  constructor(options: { id?: string; timeoutMs?: number; now?: () => number } = {}) {
    this.id = options.id ?? `closeout-${Date.now().toString(36)}`;
    this.now = options.now ?? Date.now;
    this.expiresAt = this.now() + (options.timeoutMs ?? 300_000);
  }

  get status(): RoundState {
    if (this.state === 'open' && this.now() > this.expiresAt) this.state = 'disposed';
    return this.state;
  }

  submit(): { ok: true } | { ok: false; error: string } {
    if (this.status !== 'open') return { ok: false, error: `round is ${this.status}` };
    this.state = 'submitted';
    return { ok: true };
  }

  dispose(): void {
    this.state = 'disposed';
  }
}
