import type { Config } from '../../core/src/config/config.ts';
import type { Proposal } from '../../core/src/proposals/proposals.ts';
import { listProposals } from '../../core/src/proposals/proposals.ts';
import { runHumanCommand, type HumanCommandResult } from '../../core/src/human/command.ts';
import type { MemoryStore } from '../../core/src/store/store.ts';

/**
 * S9 review card: turn a pending memory proposal into a Chinese button card
 * through the host `userQuestions` service, then translate the human's click
 * into the SAME `/mem decide …` command line the chat command plane uses and
 * execute it through the host `commands` service.
 *
 * The model never sees or supplies the verdict: the card's answer comes from a
 * human UI, and `decide` is still not a tool (ADR-0012).
 */

export const REVIEW_LABELS = {
  accept: '采纳',
  reject: '驳回',
  defer: '暂不处理',
} as const;

export type ReviewDecision = 'accept' | 'reject' | 'defer';

export interface ReviewQuestionOption {
  readonly label: string;
  readonly description: string;
}

export interface ReviewQuestion {
  readonly id: string;
  readonly header: string;
  readonly question: string;
  readonly detail: string;
  readonly options: readonly ReviewQuestionOption[];
}

export interface ReviewAnswer {
  readonly answers: readonly {
    readonly id: string;
    readonly selected: readonly string[];
    readonly custom?: string;
  }[];
}

export interface UserQuestionsLike {
  ask(request: unknown): Promise<ReviewAnswer>;
}

export interface CommandsExecutorLike {
  execute?(
    agent: unknown,
    line: string,
    attachments: readonly unknown[],
    signal: AbortSignal,
  ): Promise<{ readonly result: { readonly kind?: string; readonly text?: string } } | undefined>;
}

export interface ReviewExecLike {
  readonly agent?: unknown;
  readonly signal?: AbortSignal;
  readonly callId?: string;
}

export interface ReviewDeps {
  readonly store: MemoryStore;
  readonly config: Config;
  readonly home: string;
  readonly userQuestions?: UserQuestionsLike;
  readonly commands?: CommandsExecutorLike;
}

export interface ReviewOutcome {
  readonly decision: ReviewDecision;
  readonly command?: string;
  readonly result?: HumanCommandResult;
  readonly message: string;
}

/** The card copy: proposal content first, then the three choices. */
export function buildReviewQuestion(proposal: Proposal): ReviewQuestion {
  const lines: string[] = [];
  const verb = proposal.op === 'supersede' ? '替代' : '删除';
  lines.push(`**提案**：\`${proposal.id}\`（${verb}）`);
  lines.push(`**目标**：${proposal.targets.join('、')}`);
  if (proposal.reason.trim() !== '') lines.push(`**理由**：${formatBody(proposal.reason)}`);
  for (const replacement of proposal.replacements) {
    lines.push('', `### [${replacement.kind}] ${replacement.abstract}`);
    if (replacement.body.trim() !== '') lines.push('', formatBody(replacement.body));
    const provenance = replacement.provenance ?? [];
    if (provenance.length > 0) {
      const first = provenance[0] as { session_id: string; event_seq: number; quote: string };
      lines.push(
        '',
        `**出处**：${provenance.length} 条（${first.session_id} #${first.event_seq}「${first.quote}」）`,
      );
    }
  }
  lines.push('', '采纳后写入 journal 并使目标记录失效；驳回保留原记录；暂不处理则提案继续待审。');
  return {
    id: proposal.id,
    header: '记忆提案',
    question: `是否采纳提案 ${proposal.id}？`,
    detail: lines.join('\n'),
    options: [
      { label: REVIEW_LABELS.accept, description: '应用替换，写入 journal，目标记录失效' },
      { label: REVIEW_LABELS.reject, description: '保留原记录，提案作废并记入 journal' },
      { label: REVIEW_LABELS.defer, description: '保留提案，稍后再决定' },
    ],
  };
}

/**
 * Card typography: put enumerations (`1)` `2）` `3、`) on their own lines and
 * render them as an ordered list, so a body that was written inline is readable
 * in the card instead of one long paragraph.
 */
export function formatBody(text: string): string {
  const source = text.trim();
  if (source === '') return '';
  const broken = source.replace(/(?<![\p{L}\p{N}])\s*(?=\d{1,2}[)）]\s?)/gu, '\n');
  return broken
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => line.replace(/^(\d{1,2})[)）]\s*/, '$1. '))
    .join('\n');
}

/** Map the human's answer to a decision; unknown text defers. */
export function decisionFromAnswer(answer: ReviewAnswer): ReviewDecision {
  const item = answer.answers[0];
  if (item === undefined) return 'defer';
  const chosen = item.selected[0] ?? item.custom?.trim() ?? '';
  if (chosen === REVIEW_LABELS.accept) return 'accept';
  if (chosen === REVIEW_LABELS.reject) return 'reject';
  return 'defer';
}

/** The command line the click becomes; `undefined` when the human deferred. */
export function commandForDecision(proposalId: string, decision: ReviewDecision): string | undefined {
  if (decision === 'defer') return undefined;
  return `/mem decide ${proposalId} ${decision}`;
}

async function executeCommandLine(
  deps: ReviewDeps,
  agent: unknown,
  line: string,
  signal: AbortSignal | undefined,
): Promise<HumanCommandResult> {
  if (deps.commands !== undefined && typeof deps.commands.execute === 'function') {
    const execution = await deps.commands.execute(agent, line, [], signal ?? new AbortController().signal);
    if (execution !== undefined) {
      const kind = execution.result.kind === 'success' ? 'success' : 'error';
      return { ok: kind === 'success', text: execution.result.text ?? '' };
    }
  }
  return runHumanCommand({ store: deps.store, config: deps.config, home: deps.home }, line);
}

/** Show one card, then run the corresponding `/mem` command on the human's click. */
export async function reviewProposal(
  deps: ReviewDeps,
  proposal: Proposal,
  exec: ReviewExecLike | undefined,
): Promise<ReviewOutcome> {
  if (deps.userQuestions === undefined) {
    return { decision: 'defer', message: '当前环境没有交互界面，提案保留待决定' };
  }
  if (exec?.agent === undefined) {
    return { decision: 'defer', message: '需要活动会话才能弹出审批卡片，提案保留待决定' };
  }
  const question = buildReviewQuestion(proposal);
  const answer = await deps.userQuestions.ask({
    questions: [question],
    agent: exec.agent,
    ...(exec.signal === undefined ? {} : { signal: exec.signal }),
    ...(exec.callId === undefined ? {} : { wait: { callId: exec.callId } }),
  });
  const decision = decisionFromAnswer(answer);
  if (answer.answers[0]?.id !== proposal.id) {
    return { decision: 'defer', message: '收到的审批答复不属于当前提案，提案保留待审' };
  }
  const line = commandForDecision(proposal.id, decision);
  if (line === undefined) {
    return { decision, message: '已暂缓，提案继续待审' };
  }
  const result = await executeCommandLine(deps, exec.agent, line, exec.signal);
  if (result.ok && listProposals(deps.store).some((entry) => entry.id === proposal.id)) {
    return { decision, command: line, result, message: '审批命令已执行，但提案仍在待审；请刷新后重试' };
  }
  return { decision, command: line, result, message: result.text };
}
