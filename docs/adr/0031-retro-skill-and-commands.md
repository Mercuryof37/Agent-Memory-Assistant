# ADR-0031 · 本轮回顾：内置 skill 与三条聊天指令

- 状态：已实现（待真实桌面复验）
- 日期：2026-10-18
- 阶段：V3.2（回顾工作流）
- 依据：[V3.0 方案](../plan/v3-visual-and-workflows.md) §4、[ADR-0028](0028-v31-manual-workflows.md)

## 问题

用户想"让 Agent 自己回顾这一轮做了什么，并提案写入事实/坑/经验"，但当时：

- `memory_propose` 只支持修订/删除，不能"新建一条待审提案"；
- 没有面向"本轮回顾"的指令，用户不知道该怎么要求、用什么证据；
- 没有任何 skill 固化"回顾——提炼——提案"的步骤与质量要求。

## 选择

1. **提案支持新建**：`ProposalInput` 增加 `op: 'create'`；`Proposal` 的 `targets/base_hashes` 为空数组；接受时 `store.addMany(replacements)`（author=human），拒绝时只删待审文件。`memory_propose` 工具 schema 允许 `op: "create"` 且不再强制 ids/base_hashes，仍强制 replacements 与 evidence。
2. **三条聊天指令**（名字直白）：
   - `/mem-fact`：回顾本轮，提炼事实并提案新增；
   - `/mem-pitfall`：回顾本轮，提炼坑并提案新增（要求 error_signatures）；
   - `/mem-exp`：回顾本轮，提炼经验并提案新增。
   - 每条指令通过 `agent.followup` 排队一个模型回合，prompt 固化「只回顾本轮、最多 3 条、必须带 event_seq/quote、只调用 memory_propose create、不写 RULES/SOUL、不替人采纳」。
3. **内置 skill** `.dsh/skills/agent-memory-retro/SKILL.md`：同一步骤写成可发现 skill（`whenToUse` 覆盖"回顾本轮/沉淀记忆/三条指令"），任何 agent 都能按步骤执行；`/mem help` 里列出三条指令。

## 被否方案

- **用 memory_record 直接写**：用户明确要"提案"，且新内容应经人审批。
- **把回顾塞进 `/mem` 子命令**：`/mem` 已是人的运维平面；三条回顾是"让模型做事"，单独命名更清楚。
- **自动回顾（每轮结束自动提案）**：会制造噪音并绕过人的节奏；必须手动触发。

## 证据

- `ci` 全绿：**255 个测试**。新增 `S17.1`（create 提案接受后才入库、targets 为空）、`S17.2`（工具 schema 接受 create、无 replacements 报错、delete 仍要 ids/base_hashes）、`S17.3`（skill frontmatter/命令注册）、`S17.4`（`/mem help` 列出三条指令）。
- 客户端提案卡把 `create` 显示为「新增 · 一条新记忆」。
- skill 已出现在本会话技能目录（`agent-memory-retro`）。

## 偏差与回滚

- 三条指令只排队一个模型回合；模型若找不到合适证据，会回复"本轮暂无<类型>"而不创建。
- create 提案的 provenance 由模型在提案时绑定当前会话事件；接受后台账 author=human。
- 回滚：删除 create 提案分支、三条命令与 skill，恢复 `memory_propose` 只允许 supersede/delete。
