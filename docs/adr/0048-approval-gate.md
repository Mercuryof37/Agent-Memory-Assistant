# ADR-0048 · 审批门禁：提案创建不得触发审批卡片

- 状态：已实现（0.5.3）
- 日期：2026-10-18
- 背景：用户反馈“创建提案后疑似自动采纳”，截图显示 pending 0。

## 调查结论

- 本机 `config.toml` 的 `[personalization] mode = "confirm"`；
- 本机 journal 没有 `prop-mem-20261018-cb219152` 的 `decide` 行，也没有 `DS-MEM-TEST-01` 记忆文件；
- 因此截图中的“已采纳”**无法在本机数据中复现为真实决策**，可能是模型 hallucinate、另一个 profile 的数据，或旧版本客户端/服务端不同步。

但代码里确实存在一个风险设计：

- `memory_propose` 创建提案后**立即调用 review hook 弹卡片**，并把 `review` 一起返回；
- 如果宿主/测试环境自动回答了这张卡片，模型调用就会推进审批；这不是“代码直接 accept”，但把“创建”和“审批”耦合在一次工具调用里，违背“提案必须由人主动审批”的承诺。

## 决策

1. **`memory_propose` 只创建 pending 提案，绝不弹审批卡片、绝不 decide**；
2. 审批只能由人从提案页操作，或显式调用 `memory_review` 后由人点击卡片；
3. `reviewProposal` 必须校验 answer 的 `id` 等于当前 proposal id，否则一律 defer；
4. 执行 `/mem decide` 后再次检查 proposal 是否仍在 pending；仍存在则返回失败，不报“已采纳”；
5. 保留 `decide` 不是模型工具的红线；
6. **每次创建提案都返回 `reminder`**，并渲染“请到【记忆 → 提案】审批”，模型必须把提示转告用户（0.5.4）。

## 结果

- `memory_propose` 返回 `{id,...}`，不再返回 `review`；
- 模型无法在创建提案的同一次调用里触发审批；
- 即使宿主返回错配的 answer，也不会推进审批。

## 测试

- S9.1：`memory_propose` 不调用 review hook；`memory_review` 才弹卡片；
- S9.1：answer id 不匹配 → defer，不执行 decide；
- 全量测试通过。
