# ADR-0020 · V2 P3：tgz 分发与 MCP 外挂

- 状态：已实现（打包与 MCP 单测通过；安装/回滚待真实桌面复验）
- 日期：2026-10-18
- 阶段：V2.0 P3
- 依据：[V2.0 方案](../plan/v2-gui-and-distribution.md) §6–§7、[ADR-0018](0018-v2-p2-write-flows.md)

## 问题

P2 之后功能齐了，但只有开发者能从仓库链接安装；其他平台（Codex）也读不到同一份记忆。P3 要解决「一个包安装」与「跨平台外挂」，且不能给模型新增决定权。

## 选择

1. **打包**：`npm run pack`（`scripts/pack.mjs`）先跑 build，再用 `npm pack` 产出 `release/agent-memory-dsh-<version>.tgz`，检查 `dist/plugin.mjs`、`client/client.js`、`cordis.patch.yml` 三件套是否在包内，缺一即失败。
2. **安装**：优先 设置 → 插件 → 从文件安装；命令行 `dsh plugin add <tgz>`；开发期仍可 `npm run plugin:install`。升级/回滚/卸载写入 [docs/distribution.md](../distribution.md)，数据目录不动。
3. **MCP**：`mem mcp` 启动**换行分隔 JSON-RPC** 的 MCP stdio server。工具面固定为 `memory_search` / `memory_read` / `memory_list` / `memory_propose`；**没有 `memory_record`，没有 `memory_decide`**。外部提案进同一 pending 队列，人在 DSH GUI/聊天卡里决定。
4. **证据**：外部 agent 没有 DSH event_seq，MCP 提案的 provenance 为空，**不伪造**；提案与决定仍写 journal。
5. **共用数据目录**：默认 `~/.dsh/memory`，`--home` 可指定；MCP 走 core 的文件锁，与 DSH 单写者排队。
6. **发布**：本版只发 tgz；npm 公开包留到下一版（`private` 暂不改）。

## 被否方案

- **给 MCP 开 decide**：违反「决定只能由人做」；GUI/聊天卡已经覆盖。
- **给 MCP 开 record**：没有 DSH event_seq，只能伪造证据或另造来源结构；P3 不做，等数据格式 v1.4 的 `source` 字段。
- **自己写更新器**：宿主插件页已有安装/卸载/回滚；重复造会绕过 profile 备份。
- **一次性 npm 发布**：用户决定先 tgz、下版再发布。

## 证据

- `ci` 全绿：**244 个测试**。新增 `S15.1`（initialize/tools 列表无 decide/record）、`S15.2`（search 与 propose 走 core，提案 provenance 为空）、`S15.3`（decide 工具不存在）、`S15.4`（未知方法 -32601、通知静默）。
- `npm run pack` 产出 168 KB tgz；`node packages/cli/bin/mem.mjs mcp` 对 `initialize` 返回 `agent-memory 0.1.0`。
- 手册/文档：[docs/mcp.md](../mcp.md)、[docs/distribution.md](../distribution.md)。

## 偏差与回滚

- 包内暂不含 README/LICENSE；正式 npm 发布前补。
- 客户端半层仍是手写 loader bundle（P3 后续迁 TS 构建）。
- MCP 只支持换行分隔 JSON；若客户端要求 Content-Length 帧，需要另加编解码（P4/后续）。
- 回滚：删除 `scripts/pack.mjs` 与 `packages/cli/src/mcp.ts`、`mem mcp` 分支；已安装的插件按 distribution 文档卸载。
