# ADR-0005 · S2a 存储核心

- 状态：已完成
- 日期：2026-10-17
- 阶段：S2a（计划 4–5 人日；实际 1 个工作日，AI 辅助，含测试）
- 依据：[V1.0-开发方案-v1.3.md](../research/V1.0-开发方案-v1.3.md) §4–§6、§8；[ADR-0004](0004-plan-v1.3.md)

## 问题

S1 只有配置与策略骨架。S2a 要把"一条记忆一个不可变文件"落成可写、可读、可重建的最小闭环，并且让"入账 / 删除 / 决定 / 审计"只有一处历史（v1.3 D31），而不是 v1.2 的三文件互相对账。

## 选择

1. **单一 journal**（`.state/journal/NNNN.jsonl`）：append-only、5 MiB 分段、每行 `{seq, prev, at, op, op_id, data}`，行哈希 = 该行字节的 SHA-256；`prev` 指向上行哈希。`op` 为 `record|adopt|delete|decide|audit`。`op_id` 幂等；不轮转、不删段。`mem inspect --audit` 从它渲染人读轨迹（S7）。
2. **文件不可变 + 有效期派生**：`supersedes` 数组；活动区间 = `[valid_from, min(valid_until, 后继 valid_from))`；`as_of` 用同一函数计算。
3. **写事务**：锁（租约 + PID）→ 校验 → 写临时文件并 `fsync` → `rename` → 追加 journal → 重建 `MEMORY.md`/manifest。Windows 目录项不 fsync，README 声明"崩溃可检测可恢复，不承诺断电零丢失"。
4. **入账判据**：文件哈希必须等于 journal 里该 id 的最新 `record`/`adopt` 哈希；没有记录、哈希不符、解析失败、id/kind 与路径不符 → **隔离**，不进索引、召回、目录。
5. **manifest 是 tripwire**：记 `journal_head {seq, hash}`；journal 比 manifest 短/断链 → `doctor` 返回 2 并阻断写入。`rebuild` 是显式修复动作，会重写 manifest。
6. **类型冻结**：`packages/core/src/model/types.ts` 按方案附录 F 落地，`MemDoc` 之外的磁盘格式由 `frontmatter.ts` 单点解析/序列化。
7. **S2a 召回只做子串**：只验证 store → journal → index → recall 链路；BM25、分词与门槛在 S3。
8. **配置一次加满**：新增 10 键（lock 3、limits 2、recall.min_score/max_limit、inject.counter、quota.t0_per_session、proposals.max_pending），`recall.limit` 默认 8 → 5，共 22 键。

## 被否方案

- **保留 audit/ledger/decisions 三文件**：每份都要自己的链、重放与对账；同一事实存三遍，故障面更大。
- **允许原位改写文件**：会让"文件即真相"与并发/崩溃恢复同时复杂化；有效期派生已经够用。
- **S2a 就上 BM25**：会把分词、门槛、fixture 与存储耦合在一起；先用子串把链路跑通，S3 再换。

## 证据

- 97 个测试通过（含 S2a.1–S2a.6 的 journey、恢复、隔离、链校验、锁租约）。
- `npm run ci` 全绿；`npm run smoke` 走完 init → doctor → seal → add → read → recall → rebuild。
- 在 DSH 自带 Node 24.21.0 上跑过 S1 套件（S2a 新增用例仍以 `npm test` 在宿主 Node 上跑；`.node-version` 未变）。

## 偏差与回滚

- `recall.min_score` 是**千分制整数**（500 = 0.5），因为受限 TOML 故意不支持浮点；S3 解释它。
- `doctor` 在存在隔离项时已返回 4（v1.3 把它排在 S2b）；这是提前生效，不影响 S2a 验收。
- 删除、`adopt`、提案与 `decide` 仍留 S2b/S4；S2a 只让 journal 能表达 `delete`，还没有 CLI 入口。
- 回滚：S2a 的代码是新增文件；回滚只需恢复 `paths.ts`/`init.ts`/`config.ts`/CLI 到 S1 版本并删除 `model/`、`journal/`、`store/`、`fs/lock.ts`。数据目录里的 `.state/journal` 与 `memories/` 可保留，S1 代码会忽略它们。
