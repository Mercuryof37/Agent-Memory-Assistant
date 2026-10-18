# ADR-0038 · V4.0-S4：记忆工作树 L0–L2

- 状态：已实现
- 日期：2026-10-18
- 阶段：V4.0-S4
- 依据：[V4 方向](../plan/v4-directions.md) §6.1

## 问题

记录已有 `project/tags/relations`，但 GUI 仍是平铺列表；用户看不到项目边界和关系，工作树只停留在方案。

## 选择

1. **只读派生图**：`buildGraph(store, home)` 从活动记录 + 项目注册表计算 `projects/nodes/edges/conflicts`，不落盘、不建图数据库；节点上限 200，超出标 `truncated`。
2. **L0 项目总览**：项目卡片显示记忆数、最近更新、相似提示数；「＋ 新建项目」走 `POST /api/agent-memory/projects`。
3. **L1 项目工作树**：左侧按 kind 分组（项目 → 类型 → 记忆），右侧焦点面板；点节点加载详情。
4. **L2 焦点局部图**：围绕选中节点的 1 跳关系（`supersedes`/`relates_to`/`derived_from`），SVG 只读，最多 8 个邻居。
5. **冲突提示（轻量）**：同项目、共享标签、摘要字符重叠 ≥0.8 → 标记「相似提示」，只提示不自动改。
6. **入口**：工具栏「项目」切换；不新增第二个图页，避免 UI 碎片化。

## 被否方案

- **自由力导向全图**：默认毛线球；只做项目内的焦点图。
- **把树写成独立路由/第二套列表**：复用现有 detail/search/API，树只是一个 view。
- **自动合并相似条目**：违反人审；只提示。

## 证据

- S23.1：`buildGraph` 按项目计数、保留 `relates_to` 边；
- GUI 路由新增 `/graph`、`/projects`（GET/POST），S14.4 路由表更新；
- `npm test` 277 pass / 1 skip；client 构建通过。

## 回滚

- 删除 `buildGraph` + 两条路由 + 客户端树视图即可；无数据迁移。
- 冲突提示是计算属性，关掉不影响存储。
