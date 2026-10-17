import { existsSync } from 'node:fs';
import { writeFileAtomic } from '../fs/atomic.ts';
import { memoryPaths } from '../paths.ts';
import { sealPolicy } from '../policy/policy.ts';

/**
 * Personalization scaffold (architecture v2, P0). Creates the three human-owned
 * files with comment-only templates, then seals SOUL/RULES (USER stays unsealed
 * by default so the agent may propose edits through a confirmation card).
 *
 * Existing files are never overwritten; templates are comments so an untouched
 * file injects nothing (assemble strips HTML comments from these files).
 */

export const SOUL_TEMPLATE = `<!--
人格摘要：注入时只取前 200 字。用散文写「你是谁、怎么说话、边界在哪」，不要写事实条目。
示例：你的角色是……，以……的身份与用户交流；语气……；不确定时先问，不替用户做决定。
-->
`;

export const USER_TEMPLATE = `<!--
用户偏好：一条一段，用单独一行 § 分隔；单条必须非空且完整，单文件上限 10000 字。
只写用户明确说过的长期背景、偏好与协作预期；不写临时要求，不写世界事实（事实进记忆库）。
示例：
用户希望被称为「……」。
§
用户是……，习惯……。
-->
`;

export const RULES_TEMPLATE = `<!--
规则：一条一个编号；[硬] 规则必须能被代码或测试检查，[软] 规则只写建议。
示例：
R1 [硬] 记忆写入必须走 memory 工具，禁止直接改 MEMORY.md；check: <符号>；test: <测试文件>
R2 [软] 回答前先确认关键事实。
-->
`;

export interface ScaffoldResult {
  readonly created: readonly string[];
  readonly kept: readonly string[];
  readonly sealSha256: string;
  readonly sealedFiles: { readonly soul: string; readonly user: string; readonly rules: string };
}

export function scaffoldPersonalization(options: { home: string; now?: Date }): ScaffoldResult {
  const paths = memoryPaths(options.home);
  const targets: ReadonlyArray<readonly [string, string]> = [
    [paths.soulFile, SOUL_TEMPLATE],
    [paths.userFile, USER_TEMPLATE],
    [paths.rulesFile, RULES_TEMPLATE],
  ];
  const created: string[] = [];
  const kept: string[] = [];
  for (const [file, template] of targets) {
    if (existsSync(file)) {
      kept.push(file);
      continue;
    }
    writeFileAtomic(file, template);
    created.push(file);
  }
  // Human-invoked command: sealing here is intentional and scoped to SOUL/RULES.
  const seal = sealPolicy({
    home: options.home,
    accept: true,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return { created, kept, sealSha256: seal.sha256, sealedFiles: seal.sealedFiles };
}
