# ADR-0036 · V4.0-S2c：LongMemEval-style 子集评测

- 状态：已实现
- 日期：2026-10-18
- 阶段：V4.0-S2c
- 依据：[V4 方向](../plan/v4-directions.md) §6.3

## 问题

S2a/S2b 有了 hybrid 通路，但没有可复现的“记得准”指标；只看单测无法判断融合是否退步。

## 选择

1. **离线、手写子集**：24 条记忆 / 10 个问题，覆盖 LongMemEval 的六类形状：
   `single_session_user`、`single_session_assistant`、`multi_session`、`temporal`、`knowledge_update`、`abstention`。
   明确标注：**不是官方数据集**，只是检索回路的固定夹具。
2. **两种模式同评**：现有 BM25 与 hash-hybrid（S2a 兜底）各跑一遍；报告 recall@5、MRR、弃答误报率、分类召回、P95。
3. **基线 & 地板**：
   - `docs/eval/s2c-baseline.json` 由 `npm run eval:longmem` 写入；
   - `docs/eval/s2c-thresholds.json` 存地板；CI 测试（S21.1/S21.2）比对，防止静默退步。
4. **日期基线与弃答**：固定 `2026-10-17`；时序问题用 `asOf`；弃答问题必须无命中，避免“总能编出答案”。

## 被否方案

- **直接下载官方 LongMemEval**：网络/体积不可控，且官方数据含长会话与 API 依赖；先用可离线复现的子集锁定回路，后续再换真实数据。
- **只评 hybrid**：无法判断融合是否比 BM25 差；两种模式同评才有对照。
- **把 hash 分数当语义质量**：报告明确是 hash 兜底；ONNX sidecar 接入后可用同一评测脚本替换模式。

## 证据

- 基线：BM25 与 hybrid 均 recall@5 = 1.0、MRR = 0.7917、弃答误报 0；
- `npm test` 273 pass / 1 skip；`npm run eval:longmem` 可重放；
- 测试 S21.1（夹具规模/类别）与 S21.2（地板/基线可复现）。

## 回滚

- 删除 fixture/eval/script/threshold；不影响运行时检索。
- 若后续换官方数据，保留 `LongMemQuery` 形状，只替换夹具与地板。
