# ADR-0014 · 记忆架构 v2 的 P3–P4 落地

- 状态：已实现
- 日期：2026-10-17
- 阶段：post-V1.0（架构 v2 收口）
- 依据：[架构 v2](../plan/memory-architecture-v2.md)、[ADR-0013](0013-memory-v2-p0-p2.md)

## 问题

P0–P2 补齐了人设层、USER 条目与会话工具，但还差两块：

1. 模型不知道"什么时候该写、写到哪、是否需要先问"——需要一段按权限路由的注入指引；
2. 权限开关没有配置面：confirm / direct / readonly 只能靠改代码。

P4 还要把文档、测试与真实数据收口。

## 选择

1. **新增 `MEMORY_GUIDANCE` 注入段**：由 `renderGuidance(mode)` 生成中文短指引（记忆分类、先读后写、只走工具、mode 规则、子 agent 只读），注入顺序为 SOUL 100 → GUIDANCE 110 → RULES 150 → USER 200 → MEMORY 300。
2. **新配置键**（三件套齐）：`inject.guidance_max_chars`（默认 300）、`inject.total_max_chars` 3700→**4000**（五段之和）、`personalization.mode`（`confirm|direct|readonly`，默认 `confirm`）。校验从"四段之和"改为"五段之和"。
3. **模式执行**：
   - `readonly`：`memory_record` / `memory_propose` / `user_profile` 写入一律拒绝（工具层报错，不触达 store）；
   - `direct`：`user_profile` 写入跳过确认卡片，其余同 confirm；
   - `confirm`（默认）：`user_profile` 与提案审批走卡片。
4. **快照 schema v3**：`parts` 增加 `GUIDANCE`；旧快照（v2）在下次会话自动重捕，注入内容与顺序按新结构生成。
5. **真实数据**：真实库 `config.toml` 按新模板重建（含 guidance 与 `[personalization]`），启动校验通过。
6. **P4 收口**：`mem doctor` 的 inject 行显示 guidance；文档、手册、测试同步；阶段门禁（ci + smoke + closure）作为验收。

## 被否方案

- **把 guidance 写进 SOUL/固定字符串**：无法随 mode 路由，也无法单独设预算。
- **direct 模式连提案审批也跳过**：`decide` 必须由人执行（T1），direct 只影响助手自己的写入。
- **复用一个 `inject.guidance` 布尔开关**：三态语义更直接，避免"开/关"表达不了只读。

## 证据

- `node scripts/ci.mjs` 全绿：**228 个测试**；新增 `S11.1`（readonly 拒绝 record/propose）、`S11.2`（readonly 拒绝偏好写入、direct 无卡片直接写）、`S11.3`（guidance 随 mode 变化且不超预算）。
- 配置测试同步：24 个键、模板与默认值一致、五段之和校验。
- 真实库 `mem doctor`：`inject: 4000 chars total (persona 200 / guidance 300 / user 1100 / rules 1200 / index 1200)`，journal `#35` 一致。

## 偏差与回滚

- `personalization.mode` 只影响**助手写入**；人类命令（`/mem decide`、`/mem add`）不受限，这是有意的：人是最终决定者。
- 子 agent 的只读由既有 `delegationDepth` 工具过滤保证；mode 只影响根 agent。
- 真实桌面端仍需一次重启验证 guidance 段与 mode 行为（compat 走真机，不进 CI）。
- 回滚：移除 `guidance.ts` 与相关调用、恢复五段校验为四段、删除配置键与文档行；快照会因 schema 不匹配自动重捕。
