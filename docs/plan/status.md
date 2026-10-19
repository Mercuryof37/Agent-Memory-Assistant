# 阶段状态（维护者）

> 面向用户的 README 不再记录逐轮开发；状态表与逐轮记录分开维护。
> 逐轮细节见 [开发历程](../history/rounds.md)。

| 阶段 | 目标 | 关键产出 | 验收 | 估时 | 状态 | 记录 |
|---|---|---|---|---|---|---|
| **S0** | 锁定宿主与接口 | 版本/API/沙箱边界实测；最小探针插件 | M1–M4 | 2–3 d | ✅ 完成 | [ADR-0003](../adr/0003-dsh-compat.md) |
| **S1** | 能启动、能拒绝坏配置 | workspaces、受限 TOML、严格 schema、策略封存、门禁、CLI 3 命令 | 未知键拒绝、哈希不符拒绝、core 纯净 | — | ✅ 完成 | [ADR-0001](../adr/0001-skeleton.md)/[0002](../adr/0002-optimized-plan-deltas.md) |
| **S2a** | 写入→读出→重建闭环 | journal、锁、模型、store、子串召回、CLI 4 命令、配置冻结 | S2a.1–S2a.6 | 4–5 d | ✅ 完成 | [ADR-0005](../adr/0005-s2a-store.md) |
| **S2b** | 坏文件不拖垮、可修 | 隔离/adopt、路径红队、journal 一致性、`sealed_files`、备份演练 | S2b.1–S2b.5 | 3–4 d | ✅ 完成 | [ADR-0006](../adr/0006-s2b-integrity.md) |
| **S3** | 每轮看得见该看的 | BM25、section 注入、快照、RULES 解析、token 预算 | S3.1–S3.6 | 4–5 d | ✅ 完成 | [ADR-0007](../adr/0007-s3-recall-inject-rules.md) |
| **S4** | 只能从一个门进出 | 模型工具、可信来源绑定、提案/决定、T0/T1/T2、扫描 | S4.1–S4.6 | 4.5–5.5 d | ✅ 完成 | [ADR-0008](../adr/0008-s4-tools.md) |
| **S6** | 项目收尾有候选可采纳 | L0 打标、`/closeout`、决定界面、去重 | S6.1–S6.5 | 3–3.5 d | ✅ 完成 | [ADR-0009](../adr/0009-s6-closeout.md) |
| **S7** | 可备份、可回滚、可发布 | `inspect`/`export`/`purge`、备份、`mem pack`、真实 DSH smoke | S7.1–S7.6 | 3–4 d | ✅ 完成 | [ADR-0010](../adr/0010-s7-ops.md) |

V1.0 已完成；V2/V3 的功能迭代见 [开发历程](../history/rounds.md) 与各期方案。
阶段门禁：`node scripts/stage.mjs <S>`（ci + smoke + ADR + 验收编号 + 闭环）。

## V4.0（进行中）

| 阶段 | 内容 | 状态 | 记录 |
|---|---|---|---|
| V4.0-S1 | v1.4 数据格式、用户自建项目、Mem0 导入前置 | ✅ 完成（未发布） | [ADR-0033](../adr/0033-v4-data-projects.md) |
| V4.0-S2 | ONNX embedding、hybrid、LongMemEval 子集 | ✅ 完成（sidecar；ONNX 运行时由用户提供） | [ADR-0034](../adr/0034-v4-s2a-hybrid.md) / [0035](../adr/0035-v4-s2b-sidecar.md) / [0036](../adr/0036-v4-s2c-longmem.md) |
| V4.0-S3 | Mem0 导入、Memory API v1、MCP 对齐 | ✅ 完成 | [ADR-0037](../adr/0037-v4-s3-interop.md) |
| V4.0-S4 | 工作树 L0–L2、焦点局部图、冲突提示、项目删除/多选移动 | ✅ 完成 | [ADR-0038](../adr/0038-v4-s4-worktree.md) / [0039](../adr/0039-project-lifecycle.md) |

## V5.0（进行中）

| 阶段 | 内容 | 状态 | 记录 |
|---|---|---|---|
| V5.0-S1 | doctor 指标、压测基线、崩溃点测试 | ✅ 完成 | — |
| V5.0-S2 | checkpoint + 尾部重放 + Merkle/HMAC | ✅ 完成 | [ADR-0040](../adr/0040-v5-checkpoint.md) |
| V5.0-S3 | 归档/保留/自动维护 | ✅ 完成 | [ADR-0041](../adr/0041-v5-archive.md) |
| V5.0-S4 | 读/写路径缓存与增量写入 | ✅ 完成（10k/100k 待 S5 压测） | [ADR-0042](../adr/0042-v5-read-cache.md) / [0043](../adr/0043-v5-write-path.md) |
| V5.0-S5 | verify --deep、HMAC 只读、归档顺序、10k 批量/group commit、0.5.0 | ✅ 完成 | [ADR-0044](../adr/0044-v5-verify.md) / [0045](../adr/0045-v5-batch-wal.md) / [0046](../adr/0046-v5-group-commit.md) |

## V5.1

| 阶段 | 内容 | 状态 | 记录 |
|---|---|---|---|
| V5.1 | 检查更新、一键升级、失败回退 | ✅ 完成（0.5.4，含提案提醒） | [ADR-0047](../adr/0047-v5.1-update.md) / [0048](../adr/0048-approval-gate.md) |

## V1.1（顺延项收口）

| 项 | 内容 | 状态 | 记录 |
|---|---|---|---|
| T9 / Q8 | 存储目录经过 junction/符号链接：默认拒绝，显式放行后使用 canonical 路径 | ✅ 完成 | [ADR-0049](../adr/0049-v1.1-deferred.md) |
| T10 / Q4 | 锁的 PID 复用：接受（Node 无跨进程启动时间 API，沙箱禁止子进程管道） | ✅ 接受 | [ADR-0049](../adr/0049-v1.1-deferred.md) |

## 闭环检查

`scripts/closure.mjs`（已并入阶段门禁）机械确认：

- 状态表里标 ✅ 的阶段都有存在的 ADR 链接与「第 N 轮」记录（记录读 `docs/history/rounds.md`）；
- 到期 `todo.md` 条目不得是「待办」（`顺延` 必须带理由）；
- 到期 open question 必须「已解决/顺延」；
- README 仍链接 todo 与 open-questions。
