# ADR-0007 · S3 召回、注入与规则

- 状态：已完成
- 日期：2026-10-17
- 阶段：S3（计划 4–5 人日；实际 1 个工作日，AI 辅助，含测试）
- 依据：[V1.0-开发方案-v1.3.md](../research/V1.0-开发方案-v1.3.md) §6.1、§6.3、§9；[ADR-0005](0005-s2a-store.md)、[ADR-0006](0006-s2b-integrity.md)

## 问题

S2a 的子串召回只能证明链路通，不能排序；注入还没有"四段 + 预算 + 转义 + 会话冻结"的实现；RULES.md 没有解析，也没有机器校验；召回好坏无法量化，改分词就可能悄悄退化。

## 选择

1. **分词**：NFKC + 小写；CJK run 取二元组；ASCII 词；含 `- _ . : /` 或数字的代码型片段整体保留并再按分隔符拆分。`tokenizer_version=1` 写进 manifest。二元组比词切更密（示例句 12 个二元组 vs `Intl.Segmenter` 9 个词），换来 CJK 子串召回，代价是索引更大。
2. **BM25**：k1=1.2、b=0.75；`error_signatures ×4`、`abstract ×3`、正文 ×1；字面命中独立加分；命中分数按本次查询的**最高分归一化到 0..1**，`recall.min_score` 是千分制（500 = 0.5）。无答案查询返回空，不返回"相似但无关"。
3. **评估**：fixture 60 条记忆 / 16 查询（12 dev / 4 held-out），覆盖中英混排、错误码、时间边界、失效、冲突、无答案；`node scripts/eval.mjs` 把指标写到 `docs/eval/s3-baseline.json`，门槛在 `docs/eval/s3-thresholds.json`，测试只允许"不低于门槛"。
4. **注入**：SOUL / USER / RULES / MEMORY 四段；RULES 超预算**硬失败**（不截断），目录按 evidence 档位 → valid_from → id 确定性裁剪并写明"还有 N 条未列出"；空段不产生空标题；四段整体用随机 16 hex 分隔符包裹，内容中出现的同串替换为 `<escaped>`，围栏与 `</memory>` 不能逃逸。
5. **快照**：`.state/snapshots/<sha256(session)[0..32]>.json`，记录 `session_id`、`memory_revision`、`prompt_schema_version`、`text`；同会话重复装配字节一致，新会话看到新 revision；缺失时重捕获并追加 journal `audit`；保留最近 20 个。
6. **注入时重校验**：装配前调用 `verifySealedFiles`，消除"启动后被改、注入前未查"的 TOCTOU；注入只取 `active(asOf)`，删除的记忆不会回流。
7. **RULES**：解析编号 / `[机器门禁]` / `[模型指引]` / `[废止]`；机器门禁要求 `check:` 指向的符号存在、`test:` 文件存在且含 `[neg]` 用例；`[模型指引]` 不得自称"保证"。`scripts/rules-gate.mjs` 进 CI，仓库根 `RULES.md` 是第一个被校验的实例。
8. **DSH 适配缝**：`packages/dsh/src/assemble.ts` 只做 `{name, order, text, interpolate:false}` 的映射，不引入 core 的文件 I/O；`dist/plugin.mjs` 保持零 import，新增 bundle 契约测试。真实 section 的装配接线留到 S4（工具/服务注入同批），S3.4 在 core 层用会话 id + 快照验证。

## 门槛（只升不降）

| 指标 | 基线（2026-10-17） | 门槛 |
|---|---:|---:|
| Recall@5 | 1.0 | 1.0 |
| dev / held-out | 1.0 / 1.0 | 1.0 / 1.0 |
| 误返回率（无答案） | 0.0 | ≤ 0.0 |
| per-kind fact/pitfall/exp | 1.0 / 1.0 / 1.0 | 1.0 / 1.0 / 1.0 |
| p95 查询 | 1.75 ms | 只记录 |
| 冷启动 | 8.18 ms | 只记录 |

结论：拿到满分是因为 fixture 只有 60 条、由实现者编写，属于**乐观基线**；held-out 只有 4 条，不能证明泛化。门槛先锁在基线，后续任何分词/权重改动都不得低于它；要证明真实效果需要 S7 的真实会话样本，而不是继续调 fixture。

## 被否方案

- **保留子串召回**：无法区分"摘要命中"与"正文提过一次"，排序只能靠 valid_from。
- **只用 `Intl.Segmenter` 词切**：CJK 词边界依赖词典，错误码与中英混排的边界不稳；二元组更保守。
- **RULES 超预算时截断**：等于静默丢掉硬约束；选择启动/装配失败。
- **注入文本不做会话快照**：压缩或重连后同会话的 section 可能漂移，S3.4 无法成立。

## 证据

- **144 个测试**通过（目标 Node 24.21.0 与开发机 25.2.1 各跑一遍）；`npm run ci` 含 `gates + rules-file + typecheck + build + test`。
- `npm run smoke` 增加 S3 段：add → assemble（含活动记忆）→ 删除的记忆不出现 → 同会话字节一致。
- `node scripts/eval.mjs` 产出基线；`docs/eval/s3-thresholds.json` 被测试读取。
- `scripts/rules-gate.mjs`：仓库 `RULES.md` 的 1 条机器门禁、1 条模型指引、1 条废止全部通过。

## 偏差与回滚

- **真实 DSH section 未接线**：S3 只完成 core 装配 + 适配缝 + bundle 契约；插件仍只有探针 section，真实注入在 S4 与工具/服务同批接线。S3.4 用 core 的会话 id/快照测试覆盖，不宣称真实宿主注入已生效。
- **token 双轨**：core 接受 `measure` 回调；无回调时按 `chars / 2.5` 估算并标 `estimated`。真实 `ctx.tokenMeter.estimateMessage` 定价留给 S4 接线时复验（Q2 仍保留该复核点）。
- **门槛乐观**：见上；不把满分当作真实召回质量。
- 回滚：删除 `index/`、`inject/`、`rules/`、`eval/`、`dsh/assemble.ts`、`RULES.md` 与 eval 产物，`store.recall` 退回 S2a 子串实现；journal 与既有数据不受影响。
