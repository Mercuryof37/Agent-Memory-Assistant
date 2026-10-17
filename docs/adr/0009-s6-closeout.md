# ADR-0009 · S6 收尾蒸馏

- 状态：已完成（core + DSH 接线 + 桌面 `/closeout` 实测）
- 日期：2026-10-17
- 阶段：S6（计划 3–3.5 人日；实际 1 个工作日，AI 辅助，含测试）
- 依据：[V1.0-开发方案-v1.3.md](../research/V1.0-开发方案-v1.3.md) §7、§8；[ADR-0008](0008-s4-tools.md)

## 问题

S4 已有提案账本和工具，但"项目收尾"还靠人手动写记忆：没有 L0 线索、没有 `/closeout` 轮次、模型输出没有严格契约、拒绝过的提案会反复出现。

## 选择

1. **L0 确定性打标**（`distill/closeout.ts:collectL0`）：重复错误、用户纠正、工具失败后成功、回滚四类信号；只产出事件引用与摘要，不写记忆。
2. **提示词即契约**：`buildCloseoutPrompt` 注入 L0 列表、活动记忆目录（含 id）与严格 JSON；最多 `distill.max_proposals`（硬上限 5）。
3. **模型输出全部重验**：`parseCloseout` 校验 JSON、targets 必须是活动 id、`event_seq` 真实存在、assistant 消息不能当证据、quote 必须是事件子串；重复摘要、与活动记忆重复、已否决哈希一律丢弃；超 5 条截断并记录。
4. **规则降级**：`downgradeRule` 把没有 `check`+`test` 的 `rule` 降为 `pitfall`，不让模型把建议写成机器保证。
5. **轮次生命周期**：`CloseoutRound` 只允许一次 `submit`，成功/失败/超时后 `dispose`；`/closeout` 命令打开轮次并通过 `agent.followup` 排入提示；`closeout_submit` 工具**只在轮次期间注册**（用 `ctx.tools.register` 返回的 disposer 移除），提交后立即 dispose。
6. **决定界面**：`mem proposals`、`mem decide <id>`、`mem decide --batch accept|reject`；批量决定逐条执行并汇总，任一失败退出码 2。
7. **否决记忆**：`loadRejected`/`addRejected` 把摘要哈希存 `.state/distill-rejected.json`，下次收尾不再提。

## 被否方案

- **模型直接写记忆**：绕过提案与 `base_hash`；S6 只产出待审提案。
- **只靠提示词约束格式**：没有重验就会把不存在的 event_seq 或助手自证写进提案；所以解析后逐条核验。
- **closeout 工具常驻**：模型会在任意轮次调用；改为轮次内注册、提交即移除。
- **`decide --batch` 全有或全无**：没有事务边界；逐条执行 + 汇总失败更符合"响亮但不放弃其余"。

## 证据

- **178 个测试**通过；S6.1–S6.5 各有具名用例（证据核验/助手自证、规则降级、截断/无提案/否决去重、轮次一次性与超时、否决入 journal 且重建一致）。
- `npm run ci` 全绿（gates + rules-file + typecheck + build + test）。
- `node scripts/stage.mjs S6` 全绿（ci + smoke + ADR-0009 + S6.1–S6.5 + 闭环检查）。

## 偏差与回滚

- **L0 是启发式**：只覆盖四类信号，宁可少报；不承诺发现所有可蒸馏内容。
- **桌面 `/closeout` 已实测**：命令返回 `closeout round started`，模型调用 `closeout_submit`，本轮返回 `{"proposals":[],"message":"本次无新提案"}`（合法结果）；`closeout_submit` 提交后从工具表消失。
- **followup 必须带 `id`**：首次实测暴露历史加载失败（`session event at seq 1011 lacks an identified message`）——closeout 的 followup 手拼消息漏了 `id`。代码已补 `id: randomUUID()`，损坏会话按 [ADR-0003 §5.7](0003-dsh-compat.md) 修复（备份保留）。
- **`closeout_submit` 的注册/移除依赖宿主返回 disposer**：若宿主 `register` 不返回函数，工具会在轮次外仍存在但执行时拒绝（已加 `no active closeout round` 守卫）。
- **无 L2**：V1 不做主动触发；L2 留后续版本。
- 回滚：移除 `distill/` 与 `/closeout`/`closeout_submit` 接线，保留 S4 的提案与 decide；`.state/distill-rejected.json` 可删，不影响数据。
