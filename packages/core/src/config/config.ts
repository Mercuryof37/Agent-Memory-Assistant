/**
 * config.toml: every user-tunable number, with no security-relevant switch.
 *
 * The split with policy.json is deliberate and checked at startup:
 * policy.json (sealed, human-only) sets the outermost bounds; config.toml may
 * tighten them but can never widen them. See docs/config.md.
 */

import { ConfigError, type ConfigProblem } from '../errors.ts';
import type { RawTable } from './toml.ts';
import { isRawTable, parseRestrictedToml, TomlSyntaxError } from './toml.ts';
import { schemaKeys, validateAgainstSchema, type TableSpec } from './schema.ts';

export interface Config {
  readonly schema_version: number;
  readonly storage: {
    readonly max_records: number;
    readonly max_record_chars: number;
  };
  readonly inject: {
    readonly persona_max_chars: number;
    readonly user_max_chars: number;
    readonly rules_max_chars: number;
    readonly index_max_chars: number;
    readonly total_max_chars: number;
    readonly protect: boolean;
    readonly counter: 'chars' | 'tokens';
  };
  readonly recall: {
    readonly limit: number;
    readonly min_score: number;
    readonly max_limit: number;
  };
  readonly distill: {
    readonly max_proposals: number;
    readonly require_quote: boolean;
  };
  readonly lock: {
    readonly heartbeat_ms: number;
    readonly stale_ms: number;
    readonly timeout_ms: number;
  };
  readonly limits: {
    readonly abstract_chars: number;
    readonly body_chars: number;
  };
  readonly quota: {
    readonly t0_per_session: number;
  };
  readonly proposals: {
    readonly max_pending: number;
  };
}

/**
 * Limits copied from the V1.0 plan (06 §6.1 budgets, 08 §sub-budgets, v1.3 §8).
 *
 * `recall.min_score` is an integer per-mille score (500 = 0.5) because the
 * restricted TOML subset deliberately has no floats. S3 interprets it as a
 * normalized BM25 threshold; S2a's substring recall ignores it.
 */
export const configSchema: TableSpec = {
  schema_version: { type: 'int', default: 2, min: 2, max: 2 },
  storage: {
    max_records: { type: 'int', default: 1000, min: 1, max: 100_000 },
    max_record_chars: { type: 'int', default: 10_000, min: 100, max: 200_000 },
  },
  inject: {
    persona_max_chars: { type: 'int', default: 200, min: 0, max: 5_000 },
    user_max_chars: { type: 'int', default: 1_500, min: 0, max: 20_000 },
    rules_max_chars: { type: 'int', default: 800, min: 0, max: 10_000 },
    index_max_chars: { type: 'int', default: 1_200, min: 0, max: 20_000 },
    total_max_chars: { type: 'int', default: 3_700, min: 0, max: 40_000 },
    protect: { type: 'bool', default: true },
    counter: { type: 'enum', values: ['chars', 'tokens'], default: 'chars' },
  },
  recall: {
    limit: { type: 'int', default: 5, min: 1, max: 100 },
    min_score: { type: 'int', default: 500, min: 0, max: 1_000 },
    max_limit: { type: 'int', default: 20, min: 1, max: 100 },
  },
  distill: {
    max_proposals: { type: 'int', default: 5, min: 1, max: 5 },
    require_quote: { type: 'bool', default: true },
  },
  lock: {
    heartbeat_ms: { type: 'int', default: 15_000, min: 1_000, max: 60_000 },
    stale_ms: { type: 'int', default: 300_000, min: 5_000, max: 3_600_000 },
    timeout_ms: { type: 'int', default: 60_000, min: 1_000, max: 600_000 },
  },
  limits: {
    abstract_chars: { type: 'int', default: 120, min: 20, max: 1_000 },
    body_chars: { type: 'int', default: 4_000, min: 100, max: 200_000 },
  },
  quota: {
    t0_per_session: { type: 'int', default: 20, min: 1, max: 1_000 },
  },
  proposals: {
    max_pending: { type: 'int', default: 50, min: 1, max: 1_000 },
  },
};

/**
 * The config file written by `mem init`. Every key is present so a human can see
 * what is tunable without reading the schema.
 */
export const CONFIG_TEMPLATE = `# Agent Memory V1.0 - 用户配置（人可改；agent 不需要改）
# 每个键都在启动时校验：未知键、类型错误、超范围都会让启动响亮失败，并点名出错键。
# 说明见 docs/config.md。安全边界不在这个文件里，而在 policy.json（哈希封存）。

schema_version = 2

[storage]
# 记忆条目上限；超过后写入被拒绝（不自动淘汰）。
max_records = 1000
# 单条记忆文件字符上限（含 frontmatter）。
max_record_chars = 10000

[inject]
# 常驻注入的四个分区预算（字符数）与合计上限。
persona_max_chars = 200
user_max_chars = 1500
rules_max_chars = 800
index_max_chars = 1200
total_max_chars = 3700
# 注入段打 protected 标记：压缩不得触及。
protect = true
# 预算计量方式：chars（字符，保守）或 tokens（S3 起用 tokenMeter）。
counter = "chars"

[recall]
# 单次检索默认返回条数，以及上限。
limit = 5
max_limit = 20
# 千分制阈值（500 = 0.5）；S2a 子串召回不使用，S3 BM25 使用。
min_score = 500

[distill]
# 每次收尾蒸馏最多几条提案（V1.0 规格硬上限 5）。
max_proposals = 5
# 提案必须带原文引用。
require_quote = true

[lock]
# 写锁：心跳间隔、陈旧阈值、获取超时（毫秒）。
heartbeat_ms = 15000
stale_ms = 300000
timeout_ms = 60000

[limits]
# 单条记忆的摘要与正文字符上限。
abstract_chars = 120
body_chars = 4000

[quota]
# 每个会话允许的 T0 写入条数（S4 起强制执行）。
t0_per_session = 20

[proposals]
# 待审提案上限。
max_pending = 50
`;

export function defaultConfig(): Config {
  return validateConfigTable({}).config;
}

export function configKeys(): string[] {
  return schemaKeys(configSchema);
}

export function validateConfigTable(
  raw: RawTable,
  options: { lineOf?: (key: string) => number | undefined } = {},
): { config: Config; problems: ConfigProblem[] } {
  const { values, problems: schemaProblems } = validateAgainstSchema(configSchema, raw, options);
  const problems = [...schemaProblems];
  const config = values as unknown as Config;
  const inject = values.inject;
  if (isRawTable(inject)) {
    const parts = [
      inject.persona_max_chars,
      inject.user_max_chars,
      inject.rules_max_chars,
      inject.index_max_chars,
    ];
    const total = inject.total_max_chars;
    if (parts.every((part): part is number => typeof part === 'number') && typeof total === 'number') {
      const sum = parts.reduce((acc, part) => acc + part, 0);
      if (sum > total) {
        problems.push({
          key: 'inject.total_max_chars',
          message: `the four injection sections add up to ${sum} chars, more than inject.total_max_chars (${total})`,
        });
      }
    }
  }
  const recall = values.recall;
  if (isRawTable(recall)) {
    const limit = recall.limit;
    const max = recall.max_limit;
    if (typeof limit === 'number' && typeof max === 'number' && limit > max) {
      problems.push({
        key: 'recall.limit',
        message: `"recall.limit" (${limit}) must not exceed recall.max_limit (${max})`,
      });
    }
  }
  return { config, problems };
}

/** Parse config text strictly. Throws ConfigError (which names every bad key). */
export function parseConfig(text: string, sourcePath: string): Config {
  return parseConfigDocument(text, sourcePath).config;
}

export function parseConfigDocument(
  text: string,
  sourcePath: string,
): { config: Config; problems: ConfigProblem[]; lineOf: (key: string) => number | undefined } {
  let parsed: ReturnType<typeof parseRestrictedToml>;
  try {
    parsed = parseRestrictedToml(text, { sourcePath });
  } catch (error) {
    if (error instanceof TomlSyntaxError) {
      throw new ConfigError(sourcePath, [
        { key: '<syntax>', message: `${error.message.replace(`${sourcePath}:`, '').trim()}` },
      ]);
    }
    throw error;
  }
  const { config, problems } = validateConfigTable(parsed.root, { lineOf: parsed.lineOf });
  if (problems.length > 0) {
    throw new ConfigError(sourcePath, problems, 'fix the named keys; unknown keys are refused, never ignored');
  }
  return { config, problems, lineOf: parsed.lineOf };
}
