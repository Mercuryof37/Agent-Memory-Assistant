# ADR-0013 · 记忆架构 v2 的 P0–P2 落地

- 状态：已实现（P3–P4 待做）
- 日期：2026-10-17
- 阶段：post-V1.0（架构 v2 第一阶段）
- 依据：[架构 v2 技术选型](../plan/memory-architecture-v2.md)、[ADR-0012](0012-review-cards.md)（卡片确认）、[ADR-0008](0008-s4-tools.md)（工具表）

## 问题

架构 v2 评审指出三个缺口：人设层（SOUL/USER/RULES）只有机制没有内容；用户偏好没有可写入口；会话历史没有模型工具。P0–P2 要在不推翻既有记录/审批/审计的前提下补齐。

## 选择

1. **P0 人设层脚手架**：新增 `mem scaffold`（CLI、`/mem scaffold`）。生成三份**纯注释模板**（避免注入噪音），随后封存 SOUL/RULES；USER 默认不封存（`sealPolicy({ sealUser })` 可选开启），因此 agent 可以经确认卡片改 USER，改 SOUL/RULES 仍需人编辑 + 重新封存。
2. **注入分段**：`assemble` 返回 `parts`（SOUL/USER/RULES/MEMORY），宿主按来源注册 4 个 prompt section（order 100/150/200/300）；快照 schema 升到 v2 并在快照里保存 `parts`，旧快照自动重捕。模板里的 HTML 注释在注入与规则解析前剥掉。
3. **P1 USER 条目**：新增 `packages/core/src/profile/profile.ts`（`§` 分隔、单条完整、10000 字上限、字面查询、唯一匹配、原子写）。新增 `user_profile` 工具：`read` 免确认；`add/replace/remove` 必须先在本会话读过 USER，再经确认卡片（确认/取消）后写入，并追加 journal `audit`（`event: user-profile`）。
4. **P2 会话工具**：不造索引，包装宿主原生 `sessionQuery`（SQLite FTS5）为五个只读工具：`session_search`、`session_event_search`、`session_event_read`、`session_event_trace`、`session_trace`；默认当前会话，搜索限 1–10 条，正文截断 4000 字。
5. **体检**：`mem inspect` / `/mem inspect` 增加三份人工文件的字符数；`mem doctor` 在文件缺失时提示 `mem scaffold`。

## 被否方案

- **USER 也默认封存**：agent 每次提议改 USER 都要人先手动重封，卡片流程断裂。
- **自建会话索引**：原生 `sessionQuery` 已有 FTS5、谱系与替换链，重复建设且要处理多 cwd。
- **偏好做成记录库**：条目短、整体注入、人可手改；记录库适合带出处的事实，不适合偏好。
- **把 guidance 路由一起做进本轮**：会同时改配置三件套与预设分段，风险集中；留到 P3。

## 证据

- `node scripts/ci.mjs` 全绿：**224 个测试**。新增用例：`S10.1`（脚手架/注释不注入/封存语义）、`S10.2`（条目格式/冲突/上限/注释剥离）、`S10.3`（先读后写、卡片确认/取消、审计）、`S10.4`（五个会话工具与参数校验）。
- 真实 store 上 `mem scaffold` 生成模板并封存 SOUL/RULES（USER 保持空封存）。
- 旧快照（schema v1）在下次会话自动重捕，注入内容不变。

## 偏差与回滚

- `user_profile` 目前注册在根 agent 上下文；子 agent 的工具过滤沿用现有 `delegationDepth` 机制，尚未单独验证（P3 一并处理）。
- `MEMORY_GUIDANCE` 分段路由（confirm/direct/readonly）未做，P3。
- 会话工具依赖宿主 `sessionQuery`；宿主未提供时工具报 "session query service is unavailable" 而不是静默降级。
- 回滚：移除 `scaffold`/`profile` 模块与两个注册调用、恢复 `sealPolicy` 的 user 行为；数据侧新增的 USER 条目与 journal 行可保留。
