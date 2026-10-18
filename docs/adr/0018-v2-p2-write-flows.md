# ADR-0018 · V2 P2：图形界面人工写流与审批

- 状态：已实现（待真实桌面复验）
- 日期：2026-10-18
- 阶段：V2.0 P2
- 依据：[V2.0 方案](../plan/v2-gui-and-distribution.md) §4、[ADR-0017](0017-v2-p1-workbench.md)

## 问题

P1 只能看不能改。P2 要把「人」的写动作搬进 GUI，同时保证：决定仍由人做出、写入仍走同一条提案/journal 链、RULES 这类硬约束只有人亲自在 GUI 操作才落盘。

## 选择

1. **提案面板**：`GET /api/agent-memory/proposals` 列出待审提案（目标序号/摘要、原因、替换内容）；`POST /proposals/decide` 执行 `decideProposal`（与 `/mem decide`、`memory_review` 同一函数），接受/驳回后 journal 记录 `decide`，并追加 `surface` 审计 `gui-decide`。
2. **修订**：`POST /revise {id, abstract, body}` 先 `createProposal`（supersede，沿用旧记录 provenance），再 `decideProposal` accept；旧记录失效、新记录 author=human，journal 留下 `proposal-created` + `decide` + `gui-revise` 审计。
3. **删除**：`POST /delete {id}` 走 delete 提案 + 立即 accept，`store.remove` 保留 journal 记录。
4. **偏好（USER.md）**：`GET/POST /profile` 读写条目，`saveProfile` 校验后原子写；GUI 保存是人的动作，不经过模型工具。USER 默认非封存；若曾封存 USER，保存后仍按现有策略提示重新封存。
5. **规则（RULES.md）**：`GET/POST /rules` 读取原文、校验后原子写，并调用 `sealPolicy({accept:true})` 由人的点击完成封存；保存后下一轮注入生效。该路由不由模型工具暴露，CLI 也没有写规则的命令——**RULES 的唯一写入口是 GUI**。
6. **界面**：工具条新增「提案 N」「偏好与规则」；详情新增「修订/删除」；修订用行内表单，删除二次确认；偏好/规则用文本域 + 保存按钮；所有写操作后刷新列表与提案计数。

## 被否方案

- **GUI 直接调 `store.add` 写新记忆**：绕过提案/证据链；修订与删除坚持走提案 + 决定。
- **GUI 提供「新建记忆」表单**：人的「记住这件事」应通过对话发生，而不是手工填表；P2 不做，P3 再评估。
- **RULES 支持命令行写入**：与「硬约束只有人亲自在 GUI 才写」冲突；CLI 不提供。
- **给模型一个 GUI 写工具**：会让界面变成模型入口；工具面保持不变。

## 证据

- `ci` 全绿：**239 个测试**。新增：
  - `S14.5` GUI decide 走同一提案管线（旧记录失效、新记录生效）；
  - `S14.6` GUI 修订生成新记录并 `supersedes` 旧记录；GUI 删除清空活动记忆；
  - `S14.7` GUI 偏好与规则保存（规则保存会重新封存）；
  - `S14.4` 更新为 11 条路由（含 profile/rules 的 GET+POST 合并）。
- 客户端新增 proposals/revise/delete/profile/rules 请求与按钮；`S13.1` 断言扩展。

## 偏差与回滚

- 修订沿用旧 provenance（新的措辞由人在 GUI 确认，但不伪造新的 event_seq）；若旧记录没有 provenance，新记录 provenance 为空，详情显示「无出处」。
- 「新建记忆」未做（见上）；MCP 写流留到 P3。
- 回滚：删除 P2 路由与界面面板，恢复只读 P1；数据层零改动（提案与 journal 行保留无害）。
