# ADR-0029 · 工具条右对齐与 SOUL 一键封存

- 状态：已实现（待真实桌面复验）
- 日期：2026-10-18
- 阶段：V3.1 收尾
- 依据：[ADR-0028](0028-v31-manual-workflows.md)

## 问题

1. 工具条 `flex-wrap: wrap` 在 1400px 左右把「导入备份」挤到第二行，按钮列没有右对齐，搜索栏下方出现功能按钮；
2. SOUL 卡提示「改完请在终端执行 `mem policy seal --accept`」，对不碰终端的用户是死路。

## 选择

1. **两列工具条**：
   - `.am-toolbar` 改为 `flex-wrap: nowrap`；
   - 左列 `.am-toolbar-search`（输入框 + 搜索按钮，`flex: 1`）；
   - 右列 `.am-toolbar-actions`（新增/整理/提案/偏好/命令手册/导出/导入），`margin-left: auto` 右对齐，按钮高 30px、字号 12.5px；
   - 窄窗口时右列自身横向滚动，**不换行到搜索下方**。
2. **SOUL 一键封存**：新增 `POST /api/agent-memory/policy/seal` + `sealGui()`；
   - 点击 → 二次确认 → `sealPolicy({accept:true})` → 写 policy/seal 与 `gui-seal` 审计；
   - 只计算封存哈希，不返回、不展示文件内容；
   - SOUL 卡增加「一键封存」主按钮；提示文案改为「修改后点下方『一键封存』」，不再出现终端命令。
3. 封存仍需要人的明确点击（confirm 对话框），模型/工具面没有这个入口。

## 被否方案

- **把按钮折叠进「更多」菜单**：目前 7 个动作都是高频，折叠反而多一次点击；横向滚动是窄窗兜底。
- **封存自动化（检测文件变化）**：等于绕过人的确认；封存必须由人触发。
- **在 GUI 内编辑 SOUL**：V3 非目标，且封存语义会被破坏。

## 证据

- `ci` 全绿：**253 个测试**。新增 `S14.17`（`sealGui` 返回 64 位哈希）；`S14.4` 路由表加入 `policy/seal`；`S13.1` 断言 `am-toolbar-search/actions`、`一键封存`，并确认客户端源码不再出现 `mem policy seal`。
- 客户端构建成功；工具条现在单行右对齐。

## 偏差与回滚

- 封存会读取 SOUL/USER/RULES 的哈希（不读内容给界面）；这是 `sealPolicy` 的既有行为。
- 回滚：工具条恢复 wrap；删除 seal 路由与按钮，恢复终端提示。
