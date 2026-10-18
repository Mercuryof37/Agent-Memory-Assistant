# ADR-0037 · V4.0-S3：Mem0 导入、Memory API v1 与 MCP 对齐

- 状态：已实现
- 日期：2026-10-18
- 阶段：V4.0-S3
- 依据：[V4 方向](../plan/v4-directions.md) §6.3

## 问题

互操作只有自家 JSON 导出，Mem0 用户迁移要手工抄；HTTP 响应没有版本标识；MCP 工具没有和 API 对齐的文档，外部集成只能读代码。

## 选择

1. **`source` 字段（v1.4 扩展）**：`{type, id}` 可选；导入记录保留原始来源，不伪造 DSH `event_seq`。
2. **Mem0 adapter**：
   - 接受 `{results:[]}` / `{memories:[]}` / 裸数组；
   - `memory/text/content` → body + ≤120 字摘要；
   - `metadata.kind/project/workspace/tags` 与 `categories` 映射；
   - `created_at` → `valid_from`；`id` → `source.id`；
   - 预览（valid/invalid/byKind/byProject）与 `--apply` 分离；失败逐行报告。
3. **Memory API v1**：响应头 `x-agent-memory-api-version: 1`；导出 bundle `v2`；路由与 MCP 契约写入 [docs/guide/api.md](../guide/api.md)。
4. **MCP 对齐**：工具固定为 `memory_search/read/list/propose`；无 `decide`/`record`；server 版本随包（0.2.1）。

## 被否方案

- **把 Mem0 id 塞进 tags**：污染标签语义与上限；用结构化 `source`。
- **新增 `/v1/` 路由前缀**：会复制整套 GUI 路由；先用响应头/契约版本，破坏性变更再升主版本。
- **MCP 改名为社区 `search/read/add`**：会破坏现有工具面；保留 `memory_` 前缀并在文档中映射。

## 证据

- S22.1 预览不写库；S22.2 导入保留 source/project/tags 且二次导入 dedupe；S22.3 非法行逐条报告。
- `mem import-mem0 <file> [--apply]` dry run/写入；`npm test` 276 pass / 1 skip。
- API/MCP 文档：`docs/guide/api.md`。

## 回滚

- 删除 `transfer/mem0.ts` 与 CLI 命令；已导入记录保留 `source`（旧解析器会因未知键拒绝，安全）。
- `source` 字段向后兼容：旧记录缺省 `null`；不写回旧文件。
