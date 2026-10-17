# ADR-0011 · 聊天框内的人机指令面（`/mem`）

- 状态：已实现（待用户验收）
- 日期：2026-10-17
- 阶段：post-V1.0 可用性增强（S7.5 之后）
- 依据：用户要求「对人的审批等一切用户操作指令都能在聊天框完成」；[ADR-0003](0003-dsh-compat.md)（宿主的 commands 面）、[ADR-0008](0008-s4-tools.md)（`decide` 永不是工具）

## 问题

人的通道（采纳/否决提案、写入、删除、导出等）到今天只有终端 `mem` CLI。每次审批都要离开对话、切终端、复制提案 id。用户要求这些操作在聊天输入框里完成，同时不能破坏「模型不能自己批准自己」。

## 选择

1. **用宿主的 commands 服务注册 `/mem`**（`ctx.commands.register`）。命令在 UI 命令面执行，**不进入模型消息与上下文**（`dsh-commands` 的 Model Experience：命令与结果都不进模型请求）。因此模型无法触发命令，也不需要宿主审批 UI。
2. **语法与实现在 core**：`packages/core/src/human/command.ts` 的 `runHumanCommand` 是唯一实现，可单测；DSH 适配器只转发 invocations。CLI 与命令面调用同一批 core API。
3. **子命令**：`proposals`、`decide <id> accept|reject`、`decide --batch accept|reject`、`add`、`read`、`recall`、`inspect`、`adopt`、`delete`、`purge`、`rebuild`、`export`、`seal`、`help`。
4. **破坏性动作显式确认**：`purge`/`seal` 必须带 `--accept`；`decide` 必须写出 `accept`/`reject`；`delete` 必须带 `--reason`。命令解析支持引号与 `--flag=value`。
5. **两条链路接上**：`memory_propose` 的工具输出追加一行「人在聊天框决定：/mem decide <id> accept」。
6. **审计**：宿主为每次命令写 `command/run` + `command/done`（会话日志）；数据权威仍是 journal 的 `decide`/`record` 行——命令日志证明「谁在哪个会话点了」，journal 证明「数据发生了什么」。

## 被否方案

- **注册 `memory_decide` 工具 + 宿主审批 UI**：模型可触达决定接口，违背 T1/S4 的「`decide` 不可经模型到达」；宿主审批的语义（自动允许、记住允许）不在我们控制内，无法作为机器保证。
- **模型用 `ask_user_question` 收集同意后自己调用 store**：执行者仍是模型，human-in-the-loop 退化成 human-on-the-loop。
- **只把 CLI 输出贴回聊天**：仍要切终端，只是把复制 id 的步骤换个地方。

## 证据

- `node scripts/ci.mjs` 全绿：**200 个测试**（S8.1 命令面 9 条 + DSH 插件注册用例），1 个 S7.5 人工用例 skip。
- DSH 插件测试断言：工具表仍无 `decide`；store 可用时 `/mem` 被注册、`input.hint` 含 `decide`；`/mem add` → `/mem read` 在真实 store 上读回。
- CLI 测试与命令面测试共用同一套 store/proposals 断言（同源实现）。

## 偏差与回滚

- 命令面位置参数与 CLI 略有不同（命令面不含 verb 位置）；引号/`--flag=value` 语义相同。
- `init`/`doctor` 仍只在 CLI：宿主已经启动，命令面重跑初始化没有意义。
- `/mem proposals` 在聊天里额外显示替换摘要（CLI 只显示 id/op/targets/reason），便于当场做决定。
- 回滚：删除 `apply` 里的 `/mem` 注册与 `human/command.ts` 的导出；CLI、数据、journal 不受影响。
