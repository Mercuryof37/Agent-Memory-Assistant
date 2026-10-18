# ADR-0016 · P0.5：段注册表、模块健康与能力组

- 状态：已实现（P1 未开工）
- 日期：2026-10-18
- 阶段：V2.0 P0.5（P0 探针之后）
- 依据：[V2.0 架构审核](../plan/v2-architecture-review.md) §2–§3、[ADR-0014](0014-memory-v2-p3-p4.md)

## 问题

审核发现三处耦合会让 V2 越做越重：

1. `assemble` 硬编码五个文件与顺序，新增顶层文档必须改核心；
2. RULES 非法/超预算会让整次注入抛错，拖垮所有记忆功能；
3. 工具权限散落在 `mode`、`delegationDepth`、`hooks` 里，preset/GUI/MCP 各自判断。

## 选择

1. **段注册表**（`packages/core/src/inject/sections.ts`）：每个注入段是一个 `SectionSource`（key、order、预算、load、render）。内置 SOUL 100 / GUIDANCE 110 / RULES 150 / USER 200；MEMORY 目录仍由 assemble 生成（300）。`AssembleInput.extraSections` 是扩展缝：新增 `PRINCIPLES.md` 这类文档只需加一个 source（或在宿主侧传入），不改 assemble 与 GUI。
2. **模块健康隔离**：段渲染失败不再抛全局错误，而是把该段替换成 `⚠ 本节不可用（KEY）：原因` 的可见提示，并写入 `health`；其他段照常注入。封存校验与存储/journal 完整性仍是全局失败。结果与快照记录 `sectionList` / `health`（schema v4）。
3. **模块级 guard**：插件把 `user-profile`、`session-tools`、`injection` 分别包进 `guard`，失败只记录在 `moduleHealth`；`/api/agent-memory/status` 返回 `modules`，客户端页面在任一模块失败时显示「部分模块不可用：…」。
4. **能力组**：新增 `capabilitiesFor(mode, delegationDepth)`，返回 `facts.read` / `facts.write` / `proposals.review` / `rules.read`；`registerTools` 按组注册工具。readonly 只缺 `facts.write`，子 agent 只有读组。
5. **快照**：schema 升到 v4（`sectionList` + `health`），旧快照自动重捕。

## 被否方案

- **保留 RULES 硬失败**：违背「一个文档坏了不拖垮全部」的明确要求；改为可见降级 + `doctor`/健康面板可查。
- **只把新文档塞进现有五段字符串**：没有顺序与预算，无法独立降级。
- **在 preset 层做能力组**：preset 是组合层，能力组是插件内部策略；两者分开，preset 只选组。

## 证据

- `ci` 全绿：**232 个测试**。新增：
  - `S13.3 rules over budget degrade only the rules section`（RULES 失败时 SOUL 仍在、只出现提示段、health 标红）；
  - `S13.4 an extra document layer plugs into the section registry`（`extraSections` 注入 PRINCIPLES，按 order 落在 GUIDANCE 与 RULES 之间）；
  - `S13.5 capability groups follow mode and delegation depth`（confirm/direct/readonly/子 agent 四组）。
- 快照 v4 兼容旧数据：缺 `sectionList` 的旧快照自动重捕。

## 偏差与回滚

- MEMORY 目录仍由 assemble 生成（它需要 store 的 active 文档）；未来若把目录也做成 source，可移入注册表。
- 插件级 guard 目前覆盖 profile / session / injection；`/mem`、`/closeout`、review 的注册仍在主流程，P1 再包。
- 回滚：恢复 assemble 的五段硬编码与 RULES 抛错；删除 `sections.ts` 与 capability 函数；快照因 schema 不匹配自动重捕。
