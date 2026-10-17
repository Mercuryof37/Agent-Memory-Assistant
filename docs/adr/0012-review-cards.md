# ADR-0012 · 按钮式审批卡片（S9）

- 状态：已实现（待用户验收）
- 日期：2026-10-17
- 阶段：post-V1.0 可用性增强（S8 `/mem` 之后）
- 依据：用户要求「涉及用户决策/操作时先弹出提案内容，再用按钮执行，插件把操作转成命令并执行」；[ADR-0011](0011-chat-commands.md)（`/mem` 命令面）、[ADR-0008](0008-s4-tools.md)（`decide` 不是工具）

## 问题

`/mem decide` 解决了"不用切终端"，但仍要手打提案 id。用户希望点按钮：先看到提案全文，再点「采纳/驳回」，插件把点击翻译成命令并执行。

## 选择

1. **前端复用宿主的 `userQuestions` 卡片**（与 `ask_user_question` 同一套选项界面、同一个 Markdown `detail` 渲染器）。用户明确允许"暂时和选项界面一个风格"，因此不必先自写 React 客户端插件。
2. **`memory_propose` 建完提案后立刻弹卡**：卡片 `detail` 依次给出提案 id、目标、理由、每条替换的 kind/摘要/正文/出处；选项固定为 **采纳 / 驳回 / 暂不处理**（中文 label + 一句影响说明）。
3. **点击翻译成命令行**：`采纳` → `/mem decide <id> accept`，`驳回` → `/mem decide <id> reject`，`暂不处理` → 不执行、提案保持待审。
4. **命令经宿主 `commands.execute` 执行**，与聊天框 `/mem` 完全同源；命令未注册时（测试/无命令面的宿主）回退到 `runHumanCommand`，语义一致。
5. **新增 `memory_review` 工具**：对「暂不处理」的提案重新弹卡；参数只有可选的提案 id，没有任何决定字段。
6. **降级姿态**：没有交互界面或没有活动 agent 时，不假装决定，返回"提案保留待决定"。

安全边界不变：判定只来自人在卡片上的选择；模型传不了 `accept/reject`；`decide` 仍然不是工具；卡片答案走 `userQuestions` 的 UI 通道。

## 被否方案

- **自写客户端 React 卡片**：需要客户端包构建、`dsh.client` 声明、profile 安装与 HMR 链路；先用宿主已提供的卡片面验证交互与话术，确认后再升级成自定义卡片。
- **把 `decision` 放进 `memory_propose` 参数**：等于让模型自己决定，违背 T1。
- **直接调 `decideProposal` 不经过命令**：丢掉 `command/run` + `command/done` 审计，且与 `/mem` 行为分叉。

## 证据

- `node scripts/ci.mjs` 全绿：**206 个测试**（S9.1 卡片文案/采纳/驳回/暂缓/无界面降级 5 条，`memory_review` 校验与 hooks 接线）。
- 插件测试断言：提案卡回答后实际执行的命令行是 `/mem decide <id> accept`。
- `memory_propose` 的 hooks 单测：提案创建后自动调用 review，返回 `{ proposal, review }`。

## 偏差与回滚

- 卡片挂在 `memory_propose` 的工具调用行上：关掉卡片后，体验上从该工具行重开（`ask_user_question` 行会重开；非该工具的行是否重开取决于宿主投影，未在本次验收）。
- 无计时：人不答则工具调用保持打开（可关闭卡片继续其他工作，稍后再答）。
- 「暂不处理」不写证据/不记 journal：提案文件原地保留，后续用 `memory_review` 或 `/mem decide` 处理。
- 回滚：删除 `review.ts`、`memory_review` 注册与 `registerTools` 的 hooks 参数；`/mem` 与核心数据不受影响。

## 实测追加（2026-10-17，真实桌面）

首次点「采纳」返回 `journal is inconsistent, writes are blocked: journal head #26 differs from the manifest (#25)`，暴露两处问题：

1. **交互服务解析过早**：`userQuestions` 的 provider fiber 在插件 apply 时尚未激活，`ctx.get` 返回 `undefined`，review 直接降级为“没有交互界面”。改为 `reviewDeps()` 在工具执行时解析 `userQuestions`/`commands`。
2. **快照审计绕过 manifest**：`assemble` 的 `snapshot-capture` 直接 `journal.append`，没有刷新 manifest 的 `journal_head`；下一次 `addMany` 的 `reload` 把它误判成截断并锁死写入。修复：`assemble` 优先调用 `store.appendAudit`（锁内刷新 manifest）；`reload` 只把「journal 落后于 manifest」当截断，「manifest 落后于完好链」按陈旧派生物处理（下一次 `writeDerived` 自愈）。真实库用 `mem rebuild` 修复（#26），随后卡片决策成功写入 #27/#28。

最终签收：`/mem decide prop-mem-20261017-70b94008 accept` 生成 `mem-20261017-f0fa7c44`，provenance 保留（event_seq 8255），`memory_recall` 的 `provenance_verifiable: true`。另有一条更早的暂缓提案 `prop-mem-20261017-171afbd0` 仍待审（用于演示「暂不处理」后重开卡片）。

走查后的排版调整：卡片 `detail` 里的行内编号（`1)` `2）` `3、`）由 `formatBody` 拆成独立行并转成 Markdown 有序列表，无编号的正文保持原段落；理由行同样处理。用例 `S9.3 inline enumerations get their own lines in the card` 锁定该行为。
