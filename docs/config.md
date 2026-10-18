# 配置（config.toml）

`config.toml` 由人维护，`mem init` 会在数据目录根部生成一份带注释的模板。启动时整份严格校验：

- **未知键直接失败**，不会被忽略，也不会"看起来生效"；
- 类型不对、超范围、跨字段矛盾同样失败；
- 报错会点名出错键与行号，`mem doctor` 会把同样的信息打到终端。

依据：`06-约束硬化设计.md` §L3（载荷失败必须响亮）、`10-架构决策与v1规格.md` §8、开发方案 v1.3 §8。

## 与 policy.json 的分工

**config.toml 管预算，policy.json 管边界。**

- config.toml 人可随时改，改完重启生效；
- policy.json 被 SHA-256 封存，改了但不重新封存 → **拒绝启动**（见 [policy.md](policy.md)）；
- config.toml 只能把上限**收紧**，不能放宽：`storage.max_records` / `storage.max_record_chars` 超过 policy 的 `capacity` 时启动失败；
- 扫描动作、容量硬上限、agent 能否改 RULES 这些安全设置**不在 config.toml 里**，所以改配置改不出更宽的权限。

## 键表（26 键）

以下键与 `packages/core/src/config/config.ts` 的 schema 一一对应；CI 的门禁会比对这张表与 schema 的键名，任何一边多出键都会让构建失败。

| 键 | 类型 | 默认 | 范围 | 含义 |
|---|---|---|---|---|
| `schema_version` | int | 2 | 2 | 配置格式版本；v2 起删除 `[audit]` 与 `[viewer]`（见下节迁移） |
| `storage.max_records` | int | 1000 | 1–100000 | 活动记忆条目上限；写满后拒绝新增，不自动淘汰 |
| `storage.max_record_chars` | int | 10000 | 100–200000 | 单条记忆文件字符上限（含 frontmatter） |
| `inject.persona_max_chars` | int | 200 | 0–5000 | 人格摘要注入预算 |
| `inject.guidance_max_chars` | int | 300 | 0–2000 | 记忆使用指引注入预算（P3） |
| `inject.user_max_chars` | int | 1100 | 0–20000 | 偏好全文注入预算 |
| `inject.rules_max_chars` | int | 1200 | 0–10000 | 硬约束注入预算 |
| `inject.index_max_chars` | int | 1200 | 0–20000 | 记忆目录注入预算 |
| `inject.total_max_chars` | int | 4000 | 0–40000 | 常驻注入合计上限；五段之和不得超过它 |
| `inject.protect` | bool | true | true/false | 注入段打 protected 标记，压缩不得触及（S3） |
| `inject.counter` | string | "chars" | chars / tokens | 预算计量方式；tokens 走 `ctx.tokenMeter`（S3） |
| `recall.limit` | int | 5 | 1–100 | 单次检索默认返回条数；不得超过 `recall.max_limit` |
| `recall.max_limit` | int | 20 | 1–100 | 单次检索可请求的上限 |
| `recall.min_score` | int | 500 | 0–1000 | 千分制阈值（500 = 0.5）；S2a 子串召回不使用，S3 BM25 使用 |
| `recall.hybrid` | bool | false | true/false | 开启 BM25 + 本地向量的混合检索（S2a） |
| `recall.embedding_weight` | int | 400 | 0–1000 | 向量分数在融合中的权重（千分制） |
| `distill.max_proposals` | int | 5 | 1–5 | 单次收尾蒸馏最多提案数；V1.0 规格硬上限 5 |
| `distill.require_quote` | bool | true | true/false | 提案必须带原文引用（session + seq + quote） |
| `lock.heartbeat_ms` | int | 15000 | 1000–60000 | 写锁心跳间隔（毫秒） |
| `lock.stale_ms` | int | 300000 | 5000–3600000 | 租约陈旧阈值；还需 PID 不存活才判陈旧 |
| `lock.timeout_ms` | int | 60000 | 1000–600000 | 获取写锁的超时（毫秒） |
| `limits.abstract_chars` | int | 120 | 20–1000 | 单条记忆摘要字符上限 |
| `limits.body_chars` | int | 4000 | 100–200000 | 单条记忆正文字符上限 |
| `quota.t0_per_session` | int | 20 | 1–1000 | 每会话允许的 T0 写入条数（S4 强制） |
| `proposals.max_pending` | int | 50 | 1–1000 | 待审提案上限 |
| `personalization.mode` | string | "confirm" | confirm / direct / readonly | 助手写记忆与偏好的权限：每次确认 / 自主写入 / 只读（P3） |

> 不再有审计与 Web 查看器的配置键：审计轨迹并入 `.state/journal/`（S2a 起），Web 查看器延后到 V1.1。`recall.min_score` 用千分制整数是因为受限 TOML 不支持浮点（ADR-0001）。

## 从 v1 迁移到 v2

v2 删掉了两张表，`distill.max_proposals` 由 7 改为 5，`recall.limit` 由 8 改为 5：

1. 编辑 `config.toml`：把 `schema_version` 改成 `2`，删除 `[audit]` 与 `[viewer]` 两整段；
2. 跑 `mem doctor`；旧表还在时会以 `unknown key "audit"` / `"viewer"` 失败并点名——这是刻意的，不会静默忽略；
3. 同步编辑 `policy.json` 并重新封存（见 [policy.md](policy.md) 的迁移一节）。

## 支持的文件语法

TOML 只实现一个**受限子集**（自研解析，见 ADR-0001），超出子集即报错，避免"半解析"：

- `#` 注释（字符串内不算）；
- `[table]` 与 `[nested.table]` 表头；
- `key = value`，键为 `A-Za-z0-9_-`；
- 基础字符串（支持 `\\` `\"` `\n` `\r` `\t`）、字面量字符串 `'...'`；
- 整数与布尔值；
- 单行、同类型的标量数组。

**不支持**：浮点数、日期、内联表 `{...}`、点号键 `a.b = 1`、多行字符串、嵌套数组、`[[table]]`。

## 改配置的正确姿势

1. 编辑数据目录下的 `config.toml`；
2. 跑 `mem doctor` 确认没有被拒的键；
3. 重启宿主。

配置写坏时不会"带病启动"：进程以非零码退出，错误里点名键名与行号——这是刻意的，因为静默降级曾经把一整类记忆系统变成空壳（Hermes 事故）。
