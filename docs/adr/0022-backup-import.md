# ADR-0022 · 备份导入（GUI）

- 状态：已实现（待真实桌面复验）
- 日期：2026-10-18
- 阶段：V2 P3.6 / 备份闭环
- 依据：[ADR-0017](0017-v2-p1-workbench.md)、[ADR-0018](0018-v2-p2-write-flows.md)

## 问题

P1 只有「导出备份」，没有导入；换机或恢复时用户只能手工拷文件。需要一条人可在 GUI 完成的导入路径，且不绕过 store 的校验、锁、journal 与去重。

## 选择

1. **共享实现**：`packages/core/src/transfer/import.ts` 的 `importBundle(store, bundle)`，GUI 与未来 CLI 共用；逐条 `store.add`，走同一套校验、锁、journal、去重。
2. **API**：`POST /api/agent-memory/import`，请求体就是导出的 JSON（`format: agent-memory-export-v1`），返回 `{imported, skipped, failed, ignored_proposals}`，并写 `gui-import` 审计。
3. **GUI**：「导入备份」按钮 + 隐藏文件选择器；选 `.json` 后读取、POST、显示「新增 N 条，重复跳过 M 条，失败 K 条」，然后刷新列表。
4. **语义**：
   - 导入记录 author=human（是人在恢复），provenance 原样保留；来源会话不存在时可能显示为不可核验，但不伪造；
   - 相同内容按 `content_hash` 去重，重复导入只跳过；
   - 导出里的 pending 提案**不导入**：提案必须指向本机活动记录，静默重建会绕过人的审批队列；返回 `ignored_proposals` 计数。
5. **校验**：格式不符、条目缺 kind/abstract 等，逐条失败并计入 `failed`，不因一条坏数据中断整批。

## 被否方案

- **直接写 Markdown 文件**：绕过锁/校验/journal，重复与脏数据无法拦。
- **导入时重建 pending 提案**：接受方没有对应记录，提案无意义；且会制造无人审的队列。
- **覆盖式恢复（清空再导入）**：危险且不可逆；先合并、去重，清空另设高级入口（未做）。

## 证据

- `ci` 全绿：**245 个测试**。新增 `S14.10`：导出→导入新增 1 条，二次导入跳过 1 条，格式错误抛错；`S14.4` 路由表加入 `/api/agent-memory/import`；`S13.1` 断言客户端有「导入备份」与 `/import`。
- 导入报告字段与 GUI 提示一致；审计行 `gui-import` 可在 journal 里看到。

## 偏差与回滚

- 导入不保留原 `created_at`（store.add 以当前时间记录），因此列表顺序会按导入时间重排；`valid_from` 保留。
- 导入不覆盖同 id 的旧版本（id 由导入时重新生成）；旧版本靠 `supersedes`/journal 追溯，导出里的 supersedes 未重建（后续可补）。
- 回滚：删除 `import.ts`、`/import` 路由与「导入备份」按钮；已导入数据按 id 手工 purge。
