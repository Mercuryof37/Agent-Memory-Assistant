# ADR-0039 · 项目生命周期：删除只删标签、移动改写归属

- 状态：已实现
- 日期：2026-10-18
- 阶段：V4.0-S4 修正
- 依据：[ADR-0038](0038-v4-s4-worktree.md)

## 问题

工作树需要两个真实操作：

1. 删除项目：用户要求“只删除项目框，里面的记忆回到未归类，记忆本身不动”；
2. 记忆换项目：需要多选、一次移动，且不能丢 ID/历史。

## 选择

### 删除项目

- `deleteProject(home, name)` 只从 `projects.json` 移除标签；
- 记忆 frontmatter **不写**；`buildGraph`/工作树把“未在注册表中的 project”映射为 `未归类`；
- 若以后重建同名项目，这些记忆会重新归入它——这是可逆的标签语义，不是数据丢失。

### 移动记忆

- `store.moveProjects(ids, project|null)` 在锁内重写每条记录的 `project` 字段；
- 保留 id、kind、valid_from/until、supersedes、provenance、body 等；journal 追加 `record`（新 hash）+ `audit: project-move`；
- 不生成新 id、不 supersede，因为这是组织归属变更，不是内容修订；
- API：`POST /api/agent-memory/projects/move {ids, project}`；目标项目必须存在，`null` 表示未归类。

## 被否方案

- **删除项目时批量把 project 置空**：需要重写所有文件（大库成本高、journal 噪声），且用户明确说“记忆不动”；虚拟映射满足同一 UX。
- **移动走 supersede**：会生成新 id、旧记录失效，搜索/关系会断；归属不是内容版本。
- **把项目做成目录并移动文件**：路径/哈希变化、跨项目引用复杂；标签更稳。

## 证据

- S19.10：删除项目后注册表为空，重复删除返回 false；
- S19.11：移动后 id 不变、project 变为目标、缺 id 逐条报告；
- S23.1：图投影把未注册 project 映射为未归类；
- 路由 S14.4 覆盖 `/projects`（GET/POST/DELETE）与 `/projects/move`；
- 多选 UI：项目树勾选 + “移动到…”，批量提交。

## 回滚

- 删除这两个 API/方法；已移动的记录保留当前 project，不影响读取。
- 删除项目只是注册表操作，备份 `projects.json` 即可恢复标签关联。
