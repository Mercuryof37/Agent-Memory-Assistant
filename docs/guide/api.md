# Memory API v1

> 面向集成开发者。GUI 与工具共用同一套 core 服务；HTTP 路由只在 DSH 宿主内注册。

## 版本

- HTTP 响应头：`x-agent-memory-api-version: 1`
- 导出 bundle：`agent-memory-export-v2`（导入仍接受 v1）
- 记忆文件：`mem_schema: 2`（解析器接受 1）
- MCP server：`agent-memory`，版本与包一致

版本只增不改：新增可选字段不升 API 主版本；破坏性变更升 `2` 并保留旧路由一个版本。

## HTTP 路由（DSH 插件内）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/agent-memory/status` | 统计、模式、预算 |
| GET | `/api/agent-memory/list` | 活动记忆列表 |
| GET | `/api/agent-memory/item?id=` | 单条详情 |
| GET | `/api/agent-memory/search?q=` | 检索（hybrid 时走 `recallAsync`） |
| GET | `/api/agent-memory/proposals` | 待审提案 |
| POST | `/api/agent-memory/proposals/decide` | 人决定（accept/reject） |
| GET | `/api/agent-memory/rules` | RULES 原文 |
| GET/POST | `/api/agent-memory/profile` | USER 条目 |
| POST | `/api/agent-memory/create` | 人工新增 |
| POST | `/api/agent-memory/revise` | 人工修订 |
| POST | `/api/agent-memory/delete` | 人工彻底删除 |
| GET | `/api/agent-memory/export` | 导出 v2 bundle |
| POST | `/api/agent-memory/import` | 导入 v1/v2 bundle |
| POST | `/api/agent-memory/summarize` | 整理建议 |
| POST | `/api/agent-memory/policy/seal` | 一键封存 |

所有写入口仍经 core：锁、校验、journal、内容去重；`decide` 只由人触发。

## MCP 工具

| 工具 | 作用 |
|---|---|
| `memory_search` | 检索（与 HTTP 同一 `recallAsync`） |
| `memory_read` | 读单条 |
| `memory_list` | 列活动记忆 |
| `memory_propose` | 提 create/supersede/delete 提案 |

没有 `decide`、`record`：外部 Agent 不能替人采纳，也不能绕过审批直接写。

## Mem0 导入

```powershell
mem import-mem0 .\mem0-export.json            # dry run
mem import-mem0 .\mem0-export.json --apply    # 写入
```

接受 `{results:[]}`、`{memories:[]}` 或裸数组；字段映射：

| Mem0 | Agent Memory |
|---|---|
| `memory` / `text` / `content` | `body` + 摘要（≤120 字） |
| `metadata.kind` | `kind`（缺省 fact） |
| `metadata.project` / `workspace` | `project` |
| `metadata.tags` / `categories` | `tags`（≤8） |
| `created_at` | `valid_from` |
| `id` | `source: {type:'mem0', id}` |

导入按内容去重；`source` 保留原始 id，不伪造 DSH `event_seq`。
