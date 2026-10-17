import type { Config } from '../config/config.ts';
import { isMemoryId } from '../model/ids.ts';
import { loadProfile, queryProfile } from '../profile/profile.ts';
import { scaffoldPersonalization } from '../personalization/scaffold.ts';
import { loadRules } from '../rules/rules.ts';
import { exportStore, inspectStore } from '../ops/ops.ts';
import { sealPolicy } from '../policy/policy.ts';
import { decideProposal, listProposals, ProposalError } from '../proposals/proposals.ts';
import type { MemoryStore } from '../store/store.ts';
import type { Kind, MemoryId } from '../model/types.ts';

/**
 * Human command plane (S8): the same operations the `mem` CLI exposes, but
 * callable from a host UI command (`/mem …`) so a human never has to leave the
 * chat box to review, approve, or fix memories.
 *
 * Hard rule this module preserves: nothing here is reachable from a model tool.
 * `decide` stays a human-only verb; the DSH adapter registers `/mem` through
 * the commands service, which runs outside model history (ADR-0011).
 */

export interface HumanCommandDeps {
  readonly store: MemoryStore;
  readonly config: Config;
  readonly home: string;
}

export interface HumanCommandResult {
  readonly ok: boolean;
  readonly text: string;
}

export const HUMAN_COMMAND_HINT =
  'proposals | decide <id> accept|reject | decide --batch accept|reject | add --kind K --abstract "…" --body "…" | read <id> | recall <query> | profile [关键词] | inspect | scaffold | adopt <id> | delete <id> --reason "…" | purge <id> --reason "…" --accept | rebuild | export <dir> | seal --accept [--seal-user]';

export const HUMAN_COMMANDS = [
  'proposals',
  'decide',
  'add',
  'read',
  'recall',
  'profile',
  'inspect',
  'scaffold',
  'adopt',
  'delete',
  'purge',
  'rebuild',
  'export',
  'seal',
  'help',
] as const;

const KINDS: readonly Kind[] = ['fact', 'pitfall', 'exp'];
const EVIDENCE_LEVELS = ['user_explicit', 'user_confirmed', 'observed'] as const;
/** Flags that never take a value; everything else consumes the next token. */
const BOOLEAN_FLAGS = new Set(['accept', 'batch', 'seal-user']);

interface Parsed {
  readonly verb: string;
  readonly positionals: readonly string[];
  readonly flags: ReadonlyMap<string, string | true>;
}

/** A small CLI-shaped tokenizer: quotes group words, `--flag=value` works. */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] as string;
    if (quote !== undefined) {
      if (char === '\\' && index + 1 < line.length) {
        const next = line[index + 1];
        if (next === quote || next === '\\') {
          index += 1;
          current += next as string;
          continue;
        }
      }
      if (char === quote) {
        quote = undefined;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      if (started) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (quote !== undefined) throw new Error('unterminated quote in command input');
  if (started) tokens.push(current);
  return tokens;
}

function parseLine(line: string): Parsed {
  const tokens = tokenize(line);
  const verb = tokens[0] ?? 'help';
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    if (token.startsWith('--') && token.length > 2) {
      const body = token.slice(2);
      const equals = body.indexOf('=');
      const key = equals === -1 ? body : body.slice(0, equals);
      const value = equals === -1 ? true : body.slice(equals + 1);
      flags.set(key, value);
      if (value === true && !BOOLEAN_FLAGS.has(key)) {
        const next = tokens[index + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags.set(key, next);
          index += 1;
        }
      }
      continue;
    }
    positionals.push(token);
  }
  return { verb, positionals, flags };
}

function textFlag(parsed: Parsed, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

function hasFlag(parsed: Parsed, name: string): boolean {
  return parsed.flags.has(name);
}

function fail(text: string): HumanCommandResult {
  return { ok: false, text };
}

function ok(text: string): HumanCommandResult {
  return { ok: true, text };
}

function usage(): string {
  return [
    '用法：/mem ' + HUMAN_COMMAND_HINT,
    '所有动作都由你（人）发起，不进模型上下文；`decide` 不会以工具形式暴露给模型。',
  ].join('\n');
}

function formatProposals(deps: HumanCommandDeps): HumanCommandResult {
  const proposals = listProposals(deps.store);
  if (proposals.length === 0) return ok('没有待审提案。');
  const lines: string[] = [];
  for (const proposal of proposals) {
    lines.push(`${proposal.id}  ${proposal.op}  ${proposal.targets.join(',')}  ${proposal.reason}`);
    for (const replacement of proposal.replacements) {
      lines.push(`  → [${replacement.kind}] ${replacement.abstract}`);
    }
    lines.push(`  决定：/mem decide ${proposal.id} accept | reject`);
  }
  return ok(lines.join('\n'));
}

function formatRead(id: string, deps: HumanCommandDeps): HumanCommandResult {
  const doc = deps.store.read(id as MemoryId);
  const lines = [
    `${doc.kind} ${doc.id} [${doc.valid_from} .. ${doc.valid_until ?? 'open'}] author=${doc.author}`,
    `abstract: ${doc.abstract}`,
  ];
  if (doc.error_signatures.length > 0) lines.push(`signatures: ${doc.error_signatures.join(' | ')}`);
  lines.push('', doc.body.trimEnd());
  if (doc.provenance.length > 0) {
    lines.push('', 'provenance:');
    for (const entry of doc.provenance) {
      lines.push(`  - ${entry.speaker} #${entry.event_seq}: ${entry.quote}`);
    }
  }
  return ok(lines.join('\n'));
}

function decideOne(proposalId: string, decision: 'accept' | 'reject', deps: HumanCommandDeps): string {
  const proposal = listProposals(deps.store).find((entry) => entry.id === proposalId);
  if (proposal === undefined) throw new ProposalError('NOT_FOUND', `no pending proposal ${proposalId}`);
  decideProposal({ store: deps.store, config: deps.config }, { id: proposalId, decision });
  if (decision === 'reject') return `已否决 ${proposalId}`;
  if (proposal.op === 'delete') {
    return `已采纳 ${proposalId}：${proposal.targets[0] ?? ''} 已失效（文件仍可读）`;
  }
  const created = deps.store
    .active()
    .find((doc) => doc.supersedes.includes(proposal.targets[0] as MemoryId));
  return `已采纳 ${proposalId}${created === undefined ? '' : ` → 新记录 ${created.id}`}`;
}

function decide(parsed: Parsed, deps: HumanCommandDeps): HumanCommandResult {
  if (hasFlag(parsed, 'batch')) {
    const decision = parsed.positionals[0];
    if (decision !== 'accept' && decision !== 'reject') {
      return fail('用法：/mem decide --batch accept|reject');
    }
    const pending = listProposals(deps.store);
    if (pending.length === 0) return ok('没有待审提案。');
    const lines: string[] = [];
    let applied = 0;
    for (const proposal of pending) {
      try {
        lines.push(decideOne(proposal.id, decision, deps));
        applied += 1;
      } catch (error) {
        lines.push(`失败 ${proposal.id}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {
      ok: applied === pending.length,
      text: `${decision === 'accept' ? 'accepted' : 'rejected'} ${applied}/${pending.length}\n${lines.join('\n')}`,
    };
  }
  const proposalId = parsed.positionals[0];
  const decision = parsed.positionals[1];
  if (proposalId === undefined || (decision !== 'accept' && decision !== 'reject')) {
    return fail('用法：/mem decide <id> accept|reject');
  }
  return ok(decideOne(proposalId, decision, deps));
}

function add(parsed: Parsed, deps: HumanCommandDeps): HumanCommandResult {
  const abstract = textFlag(parsed, 'abstract');
  if (abstract === undefined || abstract.trim() === '') {
    return fail('用法：/mem add --abstract "…" [--kind fact|pitfall|exp] [--body "…"]');
  }
  const kind = (textFlag(parsed, 'kind') ?? 'fact') as Kind;
  if (!KINDS.includes(kind)) return fail(`--kind 必须是 ${KINDS.join(', ')} 之一`);
  const evidenceLevel = (textFlag(parsed, 'evidence-level') ?? 'user_explicit') as string;
  if (!EVIDENCE_LEVELS.includes(evidenceLevel as (typeof EVIDENCE_LEVELS)[number])) {
    return fail(`--evidence-level 必须是 ${EVIDENCE_LEVELS.join(', ')} 之一`);
  }
  const signatureText = textFlag(parsed, 'signature') ?? textFlag(parsed, 'error-signature');
  const errorSignatures =
    signatureText === undefined ? [] : signatureText.split(',').map((part) => part.trim()).filter((part) => part !== '');
  const validFrom = textFlag(parsed, 'valid-from');
  const result = deps.store.add(
    {
      kind,
      abstract,
      body: textFlag(parsed, 'body') ?? '',
      evidence_level: evidenceLevel as 'user_explicit' | 'user_confirmed' | 'observed',
      error_signatures: errorSignatures,
      ...(validFrom === undefined ? {} : { valid_from: validFrom }),
    },
    { author: 'human' },
  );
  return ok(`${result.deduplicated ? '已有同内容记录' : '已写入'} ${result.id}`);
}

function recall(parsed: Parsed, deps: HumanCommandDeps): HumanCommandResult {
  const query = parsed.positionals.slice(0).join(' ');
  if (query.trim() === '') return fail('用法：/mem recall <query> [--kind fact|pitfall|exp] [--limit N]');
  const kind = textFlag(parsed, 'kind');
  if (kind !== undefined && !KINDS.includes(kind as Kind)) return fail(`--kind 必须是 ${KINDS.join(', ')} 之一`);
  const limitText = textFlag(parsed, 'limit');
  const limit = limitText === undefined ? undefined : Number(limitText);
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) return fail('--limit 必须是正整数');
  const result = deps.store.recall(query, {
    ...(limit === undefined ? {} : { limit }),
    ...(kind === undefined ? {} : { kinds: [kind as Kind] }),
  });
  if (result.hits.length === 0) return ok('没有匹配。');
  return ok(result.hits.map((hit) => `- [${hit.kind}] ${hit.abstract} — ${hit.id}`).join('\n'));
}

function inspect(parsed: Parsed, deps: HumanCommandDeps): HumanCommandResult {
  const limitText = textFlag(parsed, 'limit');
  const limit = limitText === undefined ? 10 : Number(limitText);
  if (!Number.isSafeInteger(limit) || limit < 1) return fail('--limit 必须是正整数');
  const report = inspectStore({ home: deps.home, config: deps.config, store: deps.store, limit });
  const lines = [
    `active ${report.active} (${Object.entries(report.byKind).map(([kind, count]) => `${kind} ${count}`).join(', ')})`,
    `pending proposals ${report.pendingProposals} · quarantined ${report.quarantined.length}`,
    `journal head ${report.journalHead === null ? '(none)' : `#${report.journalHead.seq} ${report.journalHead.hash.slice(0, 12)}`}`,
    `rules ${loadRules(deps.home).length}`,
    `budget index ${report.budget.indexChars} · total ${report.budget.totalChars}`,
    `personalization SOUL ${report.personalization.soul || '0'} · USER ${report.personalization.user || '0'} · RULES ${report.personalization.rules || '0'} chars`,
  ];
  if (report.personalization.soul > report.inject.persona_max_chars) {
    lines.push(`⚠ SOUL.md ${report.personalization.soul} 字，超过注入上限 ${report.inject.persona_max_chars}，注入时会被截断`);
  }
  if (report.personalization.user > report.inject.user_max_chars) {
    lines.push(`⚠ USER.md ${report.personalization.user} 字，超过注入上限 ${report.inject.user_max_chars}，注入时会被截断`);
  }
  if (report.personalization.rules > report.inject.rules_max_chars) {
    lines.push(`⚠ RULES.md ${report.personalization.rules} 字，超过注入上限 ${report.inject.rules_max_chars}，注入会直接报错`);
  }
  return ok(lines.join('\n'));
}

function adopt(parsed: Parsed, deps: HumanCommandDeps): HumanCommandResult {
  const id = parsed.positionals[0];
  if (id === undefined || !isMemoryId(id)) return fail('用法：/mem adopt <mem-YYYYMMDD-xxxxxxxx>');
  const result = deps.store.adopt(id);
  return ok(`已承认 ${result.id}（哈希已记账）`);
}

function remove(parsed: Parsed, deps: HumanCommandDeps): HumanCommandResult {
  const id = parsed.positionals[0];
  const reason = textFlag(parsed, 'reason');
  if (id === undefined || reason === undefined || reason.trim() === '') {
    return fail('用法：/mem delete <id> --reason "…"');
  }
  const result = deps.store.remove(id as MemoryId, { reason });
  return ok(`已删除 ${result.id}（文件保留，可 read 追溯）`);
}

function purge(parsed: Parsed, deps: HumanCommandDeps): HumanCommandResult {
  const id = parsed.positionals[0];
  const reason = textFlag(parsed, 'reason') ?? 'purge';
  if (id === undefined) return fail('用法：/mem purge <id> --reason "…" --accept');
  if (!hasFlag(parsed, 'accept')) return fail('purge 需要 --accept 确认（会删除文件）');
  if (!isMemoryId(id)) return fail(`"${id}" 不是记忆 id`);
  const result = deps.store.purge(id as MemoryId, { reason });
  return ok(`已清除 ${id}（墓碑已写入 journal，作废 ${result.proposals} 个待审提案）`);
}

function rebuild(deps: HumanCommandDeps): HumanCommandResult {
  const report = deps.store.rebuild();
  return ok(`已重建索引：${report.files} 个文件，journal head ${report.journal_head === null ? '(none)' : `#${report.journal_head.seq}`}`);
}

function exportStoreCommand(parsed: Parsed, deps: HumanCommandDeps): HumanCommandResult {
  const out = parsed.positionals[0];
  if (out === undefined) return fail('用法：/mem export <dir>');
  const result = exportStore({ home: deps.home, out });
  return ok(`已导出 ${result.files} 个文件（${result.bytes} bytes）到 ${result.out}\n校验清单：${result.sums}`);
}

function seal(parsed: Parsed, deps: HumanCommandDeps): HumanCommandResult {
  if (!hasFlag(parsed, 'accept')) return fail('seal 需要 --accept 确认（会重写封存哈希）');
  const result = sealPolicy({
    home: deps.home,
    accept: true,
    sealUser: hasFlag(parsed, 'seal-user'),
  });
  const sealed = [result.sealedFiles.soul, result.sealedFiles.user, result.sealedFiles.rules].filter(
    (value) => value !== '',
  ).length;
  return ok(
    `已重新封存：${result.sealPath}\nsha256: ${result.sha256}\n人工文件：${sealed}` +
      (result.sealedFiles.user === '' ? '（USER.md 未封存，允许 agent 提议修改）' : ''),
  );
}

function profile(parsed: Parsed, deps: HumanCommandDeps): HumanCommandResult {
  const snapshot = loadProfile(deps.home);
  const query = parsed.positionals.join(' ');
  const entries = query.trim() === '' ? [...snapshot.entries] : queryProfile(snapshot.entries, query);
  const warning =
    snapshot.chars > deps.config.inject.user_max_chars
      ? `\n⚠ USER.md ${snapshot.chars} 字，超过注入上限 ${deps.config.inject.user_max_chars}，注入时会被截断`
      : '';
  if (entries.length === 0) return ok(`USER.md 没有匹配的条目。${warning}`);
  return ok(
    `USER.md：${snapshot.entries.length} 条 / ${snapshot.chars} 字${warning}\n` +
      entries.map((entry, index) => `${index + 1}. ${entry}`).join('\n\n'),
  );
}

function scaffold(_parsed: Parsed, deps: HumanCommandDeps): HumanCommandResult {
  const result = scaffoldPersonalization({ home: deps.home });
  const lines = [`已重新封存：${result.sealSha256}`];
  if (result.created.length > 0) lines.push(`新建：${result.created.map((file) => file.split(/[\\/]/).pop()).join('、')}`);
  if (result.kept.length > 0) lines.push(`保留：${result.kept.map((file) => file.split(/[\\/]/).pop()).join('、')}`);
  lines.push('编辑后运行 /mem seal --accept 生效；USER.md 默认不封存。');
  return ok(lines.join('\n'));
}

/** Execute one `/mem …` line. Never throws: every failure comes back as text. */
export function runHumanCommand(deps: HumanCommandDeps, line: string): HumanCommandResult {
  try {
    const parsed = parseLine(line.trim());
    switch (parsed.verb) {
      case 'help':
        return ok(usage());
      case 'proposals':
        return formatProposals(deps);
      case 'decide':
        return decide(parsed, deps);
      case 'add':
        return add(parsed, deps);
      case 'read': {
        const id = parsed.positionals[0];
        if (id === undefined) return fail('用法：/mem read <id>');
        return formatRead(id, deps);
      }
      case 'recall':
        return recall(parsed, deps);
      case 'profile':
        return profile(parsed, deps);
      case 'inspect':
        return inspect(parsed, deps);
      case 'scaffold':
        return scaffold(parsed, deps);
      case 'adopt':
        return adopt(parsed, deps);
      case 'delete':
        return remove(parsed, deps);
      case 'purge':
        return purge(parsed, deps);
      case 'rebuild':
        return rebuild(deps);
      case 'export':
        return exportStoreCommand(parsed, deps);
      case 'seal':
        return seal(parsed, deps);
      default:
        return fail(`未知子命令 ${parsed.verb}\n${usage()}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(`失败：${message}`);
  }
}
