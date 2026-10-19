# 后续修复待办（偏差评审产物）

> 来源：2026-10-17 的偏差影响评审。每条都标了**阶段**、**落点**（改哪个函数/文件）、**验收**（什么测试或会话现象算完成）与**可行性判断**。
>
> **状态约定**：`待办` / `完成` / `接受`（不修，含理由）/ `顺延（到 Sx）`（必须写理由）。
> 阶段门禁会检查：当前阶段之前（含当前阶段）的条目不得是 `待办`，`顺延` 必须带括号理由。见 `scripts/closure.mjs`。

| # | 阶段 | 修复 | 落点 | 验收 | 可行性 | 状态 |
|---|---|---|---|---|---|---|
| T1 | S3 前 | 在 **rc.2** 上重跑 M1–M4 | 真实桌面会话；结果写 [ADR-0003 §5.5](../adr/0003-dsh-compat.md) | M1 `am_echo`→`echo: hi`；M2 `/compact` 后 section 字节一致；M3 `am_probe_tokens` 两值为正；M4 `/am-closeout` 恰好 `am-closeout-ok` | 可行：探针插件与命令已在 desktop profile 中 | 完成（用户 2026-10-17 确认） |
| T2 | S3 | 注入前重校验 `sealed_files`，消除 TOCTOU | `packages/core/src/inject/*` 读 SOUL/USER/RULES 前调用 `verifySealedFiles({home, policy})` | 启动后手改 SOUL.md，再触发注入 → 拒绝并点名文件；还原后恢复 | 可行：`verifySealedFiles` 已导出，`Runtime` 已带 policy 与 home | 完成（S3） |
| T3 | S3 | 注入与目录只取**活动**记忆 | `inject/` 渲染从 `store.active(asOf)` 取；不遍历全部 docs | 删除一条记忆后，注入文本不含其 abstract/id；单测覆盖 | 可行：`MemoryStore.active()` 已有，S2b 测试已证明删除后 active 为 0 | 完成（S3） |
| T4 | S3 | `recall.min_score` 按千分制落地 | `index/` BM25 阈值 = `config.recall.min_score / 1000` | 499/500/501 三档边界测试；文档与实现一致 | 可行：配置键已存在（0–1000），S3 只用不改 schema | 完成（S3） |
| T5 | S3 | M2：压缩后 section 字节稳定 | 真实会话 + `packages/dsh/test` 的快照重复渲染单测 | 同会话两次 `/compact` 后 `agent-memory:probe` 原文逐字节一致 | 可行：section 已注册；压缩行为属宿主，只能实测 | 完成（S3；ADR-0003 §5.5 M2 复测） |
| T12 | S3 | `doctor` 的 `total_files` 口径 | `store.stats()` / `formatDoctor` | 输出明确区分 active / files / deleted / quarantined，测试断言 | 可行：纯展示层 | 完成（S3） |
| T6 | S4 | agent 的删除只能走 `decide` | `packages/dsh/src/tools.ts` 不注册 delete；提案应用走 `store.remove` / journal `delete` | 工具表无 delete；提交删除提案 → 人工 decide 后记忆失效、`read` 仍可追溯 | 可行：`store.remove` 与 journal `delete` 已在 S2b 实现并测试 | 完成（S4） |
| T7 | S4 | pitfall 的 `error_signatures` 进工具 schema | `tools.ts` 的 JSON Schema：`kind=pitfall` 时 required 1–3 条 | 模型提交无签名的 pitfall 被 schema 拒绝；有签名通过 | 可行：S2a 的 store 已强制同规则，只需 schema 对齐 | 完成（S4） |
| T8 | S7 | 备份生成 `SHA256SUMS` + 恢复演练 | 备份脚本（新增）/ `mem export` | 复制 → 校验清单 → 新目录 `rebuild` → 逐条一致 | 可行：`cpSync` + `hashContent` 已有 | 完成（S7；export/pack + SHA256SUMS + 校验测试） |
| T9 | S7 | home 的 junction/符号链接实路径 | CLI 层对 home 做 `realpathSync`，记录 canonical 路径；可选 `--allow-junction` | 红队：junction home 被明确拒绝或显式允许；备份复制的是真实目录 | 可行：`node:fs.realpathSync` 可用 | 完成（V1.1：默认拒绝并点名链接，`--allow-junction` 显式放行后使用 canonical 路径） |
| T10 | S7 | 锁的 PID 复用（尽力） | `fs/lock.ts` 记录进程创建时间（Windows 需 WMI/WMIC 查询） | 复用 PID 的无关进程不会让锁被误判存活；查不到时降级为现状 | **部分可行**：Node 无跨进程启动时间 API；失败保持"超时失败、绝不覆盖" | 接受（Node 无跨进程启动时间 API；宿主沙箱禁止子进程管道，探测不可行；保持"超时失败、绝不覆盖"，恢复步骤见 ops.md §9） |
| T11 | S7 | journal 断链的人工恢复步骤 | `docs/ops.md` + `doctor` 提示 | 按文档能在断链/截断后恢复或明确放弃；不出现"rebuild 掩盖损坏" | 可行：`rebuild` 已拒绝不一致 journal | 完成（S7；docs/ops.md §8） |
| T13 | 接受 | 目录项 fsync | — | README 与 ADR 保留"崩溃可检测、可恢复、不承诺断电零丢失" | 接受：Windows 无目录 fsync API，备份是唯一兜底 | 接受 |
| T14 | S3 | 探针 followup 消息缺 `id`，写坏会话后历史打不开 | `packages/dsh/src/plugin.ts` 补 `id`；新增 `scripts/repair-dsh-session.mjs` 修数据；M4 验收加"重开会话仍可载入" | 宿主 `validateStoredEvents` 对三份修复日志均为 `VALIDATION: OK`；单测断言 id 为 UUID 且两次调用不同 | 可行：`globalThis.crypto.randomUUID()`，bundle 不引 node 内置 | 完成（ADR-0003 §5.7） |
| T15 | S7.5 | 提案证据在 accept 后丢失：`service.propose` 丢 `evidence`、`store.addMany` 硬编码 `provenance: []` | `service.propose` 用 `bindEvidence` 绑定并随提案落盘；`addMany` 写入替换记录；`memory_propose` 逐项要求 `kind/abstract/body/evidence` | 用例 `S4.4 propose binds evidence and the accepted replacement keeps it`、`S4.4 an accepted supersede keeps proposer provenance on the replacement`；重启后 accept → `memory_read` 有 provenance、`provenance_verifiable:true` | 可行：`bindEvidence` 自 S4 已就绪，格式规则允许 human 记录带 provenance | 完成（第 9 轮，S7.5 走查） |
| T16 | S9 | 快照审计直接写 journal、不刷 manifest，导致下一次写入被误判为截断并拒写；交互服务在 apply 时未激活 | `assemble` 改走 `store.appendAudit`；`reload` 只把“journal 落后于 manifest”当截断；`reviewDeps()` 调用时惰性解析服务 | 用例 `S9.2 snapshot capture goes through the store audit sink and keeps the manifest in sync`、`S9.2 a raw journal append without a manifest refresh does not block writes`；真实桌面点「采纳」成功写入 #27/#28 | 可行：锁内刷新 manifest；陈旧派生物可自愈 | 完成（第 11 轮，卡片实测） |
| T17 | S10 | 人设层只有机制没有内容；USER 无可写入口；会话历史无工具 | `mem scaffold` + `sealPolicy({sealUser})`；注入分段与快照 v2；`profile/` + `user_profile` 工具 + 确认卡片；`sessionQuery` 五工具；inspect/doctor 提示 | 用例 `S10.1`–`S10.4`；真实 store `mem scaffold` 后注入出现四段；USER 修改走卡片 | 可行：全部复用既有封存/卡片/原生检索 | 完成（第 12 轮，架构 v2 P0–P2） |
| T18 | S11 | 助手不知道何时该写、写到哪、要不要先问；权限没有配置面 | `renderGuidance(mode)` + GUIDANCE 注入段；`personalization.mode`（confirm/direct/readonly）；readonly 在工具层拒绝写入；快照 v3 | 用例 `S11.1`–`S11.3`；真实库 doctor 显示五段预算、journal 一致 | 可行：guidance 是固定短文本，按 mode 选段即可 | 完成（第 13 轮，架构 v2 P3–P4） |

## 本轮评审顺带关闭

- **T1 / 宿主漂移**：用户已在桌面 **rc.2** 上确认 M1–M4 通过；ADR-0003 §5.5 已记录。
- **Node 版本风险**：114 个测试在目标运行时 Node **24.21.0** 与开发机 25.2.1 上均通过。
- **Q5（doctor 的 4 是否区分可 adopt/损坏）**：S2b 已实现隔离明细与 `mem adopt`。
