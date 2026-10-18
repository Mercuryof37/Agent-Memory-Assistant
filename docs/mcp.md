# MCP 外挂：在 Codex / 其他 agent 里用同一份记忆（V2 P3）

> Agent Memory 通过 **MCP stdio** 暴露只读工具 + 提案工具。数据目录与 DSH 共用：`~/.dsh/memory`。
> 设计边界：**没有 decide，没有 record**。外部 agent 只能读与提案；采纳/驳回仍由人在 DSH 里点。

## 1. 启动

开发仓库内：

```powershell
node "D:\Ai Agent\Agent Memory\packages\cli\bin\mem.mjs" mcp
```

或安装后的 `mem`：

```powershell
mem mcp
```

指定数据目录（默认 `~/.dsh/memory`）：

```powershell
mem mcp --home "C:\Users\<you>\.dsh\memory"
```

协议：换行分隔的 JSON-RPC 2.0（MCP stdio）。日志/错误走 stderr，stdout 只放协议消息。

## 2. Codex 配置

`~/.codex/config.toml`：

```toml
[mcp_servers.agent-memory]
command = "node"
args = ["D:\\Ai Agent\\Agent Memory\\packages\\cli\\bin\\mem.mjs", "mcp", "--home", "C:\\Users\\<you>\\.dsh\\memory"]
```

重启 Codex，问「你记得我的偏好吗」，它会调用 `memory_search` / `memory_read`。

其他 MCP 客户端（Claude Code 等）同理，填 command/args 即可；若客户端只支持 JSON 配置，结构是：

```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "node",
      "args": ["D:\\Ai Agent\\Agent Memory\\packages\\cli\\bin\\mem.mjs", "mcp"]
    }
  }
}
```

## 3. 工具面

| 工具 | 作用 | 写入？ |
|---|---|---|
| `memory_search` | 关键词检索（返回摘要、id、出处可核验标志） | 否 |
| `memory_read` | 读全文、出处、状态（id 来自 search/list） | 否 |
| `memory_list` | 列出活动记忆（可按 fact/pitfall/exp 过滤） | 否 |
| `memory_propose` | 提修订/删除提案，状态 `pending_human_review` | 只写待审提案 |

- **没有** `memory_record`、`memory_decide`：外部 agent 不能直接落盘、不能替人决定。
- 提案在 DSH「记忆 → 提案」或聊天卡里由人处理；采纳后台账与 journal 与 DSH 内提案一致。
- 外部提案的 `provenance` 为空（外部 agent 没有 DSH 的 event_seq），**不伪造**；来源由提案的 journal 记录体现。

## 4. 数据与并发

- DSH 与 MCP 进程共用同一数据目录；写入经过 core 的文件锁，单写者排队，不会互相覆盖。
- MCP 默认只写提案，不会与 DSH 的记录写入争抢；如果两个 agent 同时提案，待审列表会同时出现，按到达顺序处理。
- 备份：`mem export <dir>`；MCP 侧不提供 export 工具，避免外部进程把整库带走。

## 5. 故障排查

| 现象 | 处理 |
|---|---|
| 启动即报 `SEAL`/`POLICY` | 数据目录未初始化或封存失效；先在 DSH 里 `mem doctor` / GUI 保存规则重新封存 |
| Codex 看不到工具 | 确认 command 路径存在、Node ≥24；在终端手跑 `initialize` 应返回 `agent-memory` |
| 提案不在 GUI 出现 | 确认 MCP 与 DSH 的 `--home` 相同；重启 DSH 刷新提案计数 |
| 中文乱码 | 终端/客户端使用 UTF-8；stdout 仅协议消息 |
