# ADR-0033 · V4.0-S1：v1.4 数据格式与用户自建项目

- 状态：已实现（未发布；V4.0 进行中）
- 日期：2026-10-18
- 阶段：V4.0-S1
- 依据：[V4 方向](../plan/v4-directions.md) §6.1/§6.3

## 问题

V1.3 的记录只有 `scope: local`，无法回答“这条属于哪个项目”，也没有记录间关系；工作树（L1）和跨项目过滤没有数据基础。直接加图数据库会把 Markdown 从真相降级为导出格式，违背单一数据源。

## 选择

1. **`mem_schema` 升到 2，字段只加三个**：
   - `project: string | null`（用户自建项目名；`null` 表示未归类；保留名“未归类”不可注册）；
   - `tags: string[]`（≤8，每个 ≤32 字符，去重）；
   - `relations: { type: 'relates_to' | 'derived_from', target: MemoryId }[]`（≤16，禁止自指与重复；`supersedes` 仍是独立不可变字段）。
2. **旧文件兼容**：解析器同时接受 `mem_schema: 1` 与 `2`；v1 缺省读成 `project=null/tags=[]/relations=[]`；不重写旧文件。
3. **项目注册表** `<home>/projects.json`：`{schema:1, projects:[{name,description,created_at,updated_at}]}`；用户显式创建，名称大小写不敏感去重；项目只是标签，删除项目不删除记忆。
4. **写入路径**：`store.add`/`addMany` 校验元数据并写入 frontmatter；`memory_record`/提案替换可带 `project/tags`；CLI 增加 `mem project list|add` 与 `mem add --project --tag`。
5. **导出升级**：bundle 改为 `agent-memory-export-v2`，带 `project/tags/relations`；导入同时接受 v1（缺省未归类）与 v2。
6. **图仍是派生**：S1 不建图数据库；S4 从记录/关系计算工作树。

## 被否方案

- **把项目做成目录**：移动文件会改变路径/哈希，且跨项目引用困难；项目是标签更稳。
- **现在就加图数据库**：与“Markdown 是真相”冲突；S4 先做只读投影。
- **把 `supersedes` 并入 `relations`**：会重写已冻结字段与大量测试；保留兼容，图 API 再合成边。
- **自动按 workspace 猜项目**：用户明确要求自建项目；猜错比未归类更糟。

## 证据

- 新增 S19.1–S19.9：frontmatter 三字段 round-trip、旧文件默认值、非法元数据拒绝、项目注册表创建/去重/损坏拒绝、store 持久化、v1/v2 导入、CLI 建项目并归属。
- `mem_schema: 2` 的新写入与 `mem_schema: 1` 的旧记录可共存；`npm test` 全绿（267 pass / 1 skip）。

## 回滚

- 代码回滚到 0.2.1；新记录含未知 frontmatter 键，旧解析器会**拒绝并隔离**而不是误读；如需降级，先用新版本导出 v2，再转换/移除三字段。
- `projects.json` 可删除，记忆不受影响（变为未归类）。
- 项目名暂不支持改名/删除（S4 UI 再定）；当前只创建与列出，避免半套生命周期语义。
