import {
  loadProfile,
  ProfileError,
  queryProfile,
  saveProfile,
  findProfileEntry,
  validateProfileEntries,
  PROFILE_MAX_CHARS,
} from '../../core/src/index.ts';
import type { MemoryStore } from '../../core/src/store/store.ts';
import type { UserQuestionsLike } from './review.ts';

/**
 * `user_profile` tool (architecture v2, P1). The agent may read USER.md freely;
 * a write requires (1) a read earlier in the same session and (2) a human
 * confirmation card. The file stays human-editable; SOUL/RULES stay sealed.
 */

export const USER_PROFILE_TOOL = 'user_profile';

export const PROFILE_LABELS = { confirm: '确认', cancel: '取消' } as const;

export interface ProfileToolDeps {
  readonly home: string;
  readonly store: Pick<MemoryStore, 'appendAudit'>;
  readonly resolveQuestions: () => UserQuestionsLike | undefined;
  /** Assistant write mode from `personalization.mode`. */
  readonly mode: 'confirm' | 'direct' | 'readonly';
  /** Sessions that already read USER.md; writes require an entry here. */
  readonly readSessions: Set<string>;
}

export interface ProfileToolInput {
  readonly op: 'read' | 'add' | 'replace' | 'remove';
  readonly query?: string;
  readonly content?: string;
  readonly old_text?: string;
}

interface ExecLike {
  readonly agent?: { readonly session?: { readonly id?: string }; followup?: unknown };
  readonly signal?: AbortSignal;
  readonly callId?: string;
}

export interface RegisteredProfileTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: unknown;
  readonly output: unknown;
  execute(args: unknown, exec?: unknown): Promise<unknown>;
}

function fail(message: string): never {
  throw new Error(message);
}

function sessionOf(exec: unknown): string {
  const execLike = exec as ExecLike | undefined;
  return execLike?.agent?.session?.id ?? 'unknown-session';
}

function buildQuestion(action: string, current: readonly string[], proposed: readonly string[], content: string) {
  const lines = [
    `**动作**：${action}`,
    '',
    '**当前 USER.md**：',
    current.length === 0 ? '（空）' : current.map((entry, index) => `${index + 1}. ${entry}`).join('\n'),
    '',
    '**修改后**：',
    proposed.map((entry, index) => `${index + 1}. ${entry}`).join('\n'),
    '',
    `（单文件上限 ${PROFILE_MAX_CHARS} 字；确认后写入 USER.md）`,
  ];
  return {
    id: 'user_profile',
    header: '用户偏好更新',
    question: '是否把这条修改写入 USER.md？',
    detail: lines.join('\n'),
    options: [
      { label: '确认', description: '写入 USER.md，立即生效（下一轮注入可见）' },
      { label: '取消', description: '不修改文件' },
    ],
    actions: content,
  };
}

export function profileParameters(): unknown {
  return {
    type: 'object',
    properties: {
      op: { type: 'string', enum: ['read', 'add', 'replace', 'remove'] },
      query: { type: 'string', description: 'read: literal keyword; omit to list every entry' },
      content: { type: 'string', description: 'add/replace: one complete entry' },
      old_text: { type: 'string', description: 'replace/remove: complete old entry or a unique literal substring' },
    },
    required: ['op'],
    additionalProperties: false,
  };
}

export async function executeUserProfile(
  deps: ProfileToolDeps,
  args: unknown,
  exec: unknown,
): Promise<unknown> {
  const input = args as ProfileToolInput;
  const session = sessionOf(exec);
  const snapshot = loadProfile(deps.home);

  if (input.op === 'read') {
    const entries = input.query === undefined || input.query.trim() === ''
      ? [...snapshot.entries]
      : queryProfile(snapshot.entries, input.query);
    deps.readSessions.add(session);
    return { entries, total: snapshot.entries.length, chars: snapshot.chars, limit: PROFILE_MAX_CHARS };
  }

  if (!deps.readSessions.has(session)) {
    fail('先读取 USER.md（user_profile op=read），再修改');
  }
  if (deps.mode === 'readonly') {
    fail('当前为 readonly 模式：只能读取偏好，不能修改');
  }

  let proposed: string[];
  let action: string;
  let content = '';
  if (input.op === 'add') {
    if (typeof input.content !== 'string' || input.content.trim() === '') fail('add 需要 content（完整条目）');
    content = input.content.trim();
    proposed = [...snapshot.entries, content];
    action = '新增一条偏好';
  } else {
    if (typeof input.old_text !== 'string' || input.old_text.trim() === '') fail(`${input.op} 需要 old_text`);
    const index = findProfileEntry(snapshot.entries, input.old_text);
    if (input.op === 'remove') {
      proposed = snapshot.entries.filter((_, position) => position !== index);
      action = '删除一条偏好';
    } else {
      if (typeof input.content !== 'string' || input.content.trim() === '') fail('replace 需要 content（完整新条目）');
      content = input.content.trim();
      proposed = snapshot.entries.map((entry, position) => (position === index ? content : entry));
      action = '替换一条偏好';
    }
  }
  const problems = validateProfileEntries(proposed);
  if (problems.length > 0) fail(problems.join('; '));

  if (deps.mode === 'confirm') {
    const questions = deps.resolveQuestions();
    if (questions === undefined) fail('当前环境没有交互界面，无法确认 USER.md 修改');
    if (session === 'unknown-session') fail('需要活动会话才能确认 USER.md 修改');
    const question = buildQuestion(action, snapshot.entries, proposed, content);
    const answer = await questions.ask({
      questions: [question],
      agent: (exec as ExecLike | undefined)?.agent,
      ...(((exec as ExecLike | undefined)?.signal === undefined)
        ? {}
        : { signal: (exec as ExecLike).signal }),
      ...(((exec as ExecLike | undefined)?.callId === undefined)
        ? {}
        : { wait: { callId: (exec as ExecLike).callId } }),
    });
    const chosen = answer.answers[0]?.selected[0] ?? answer.answers[0]?.custom?.trim() ?? '';
    if (chosen !== PROFILE_LABELS.confirm) {
      return { ok: false, cancelled: true, entries: snapshot.entries };
    }
  }

  const saved = saveProfile(deps.home, proposed);
  deps.store.appendAudit({ event: 'user-profile', action: input.op, entries: saved.entries.length, chars: saved.chars });
  return { ok: true, action: input.op, entries: saved.entries, chars: saved.chars };
}

/** Register `user_profile` on the host tool registry (top-level agents only). */
export function registerUserProfileTool(
  ctx: { readonly tools: { register(definition: unknown): unknown } },
  deps: ProfileToolDeps,
): void {
  ctx.tools.register({
    name: USER_PROFILE_TOOL,
    description: 'Agent Memory：读取或修改 USER.md 偏好条目（修改需人确认）',
    parameters: profileParameters(),
    output: {
      schema: { type: 'object' },
      render: (_args: unknown, value: unknown) => [
        { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
      ],
    },
    execute: async (args: unknown, exec?: unknown) => executeUserProfile(deps, args, exec),
  });
}

export { ProfileError };
