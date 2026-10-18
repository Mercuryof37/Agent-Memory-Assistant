# ADR-0042 · V5.0-S4：读路径缓存与增量 reload

- 状态：S4a 已实现（读路径）；写路径仍待优化
- 日期：2026-10-18
- 阶段：V5.0-S4
- 依据：[V5 方案](../plan/v5-robustness.md) §3.3

## 问题

S1 基线 1000 条：recall P95 130ms、单条写入 177ms。`recall` 每次都 `reload` + `buildIndex`；`reload` 每次重新读/解析全部记忆文件。

## 选择

1. **索引缓存**：`indexFor(activeSet, asOf)` 在 `revision` + `asOf` 相同时复用 BM25 索引；`reload` 递增 revision 并失效。
2. **recall 快路径**：`reloadIfJournalChanged()` 只比较 journal head；head 未变则跳过 reload（外部 CLI 写入会推进 head，仍会 reload）。
3. **文档解析缓存**：`reload` 保留上一轮 docs 与文件 `mtimeMs/size`；文件未变则复用已解析的 `MemoryDoc`，只做 stat + 账本校验。
4. **不改变语义**：写入仍 reload 以校验外部变化；缓存只用于读路径，删掉可重建。

## 结果（1000 条，同一台机）

| 指标 | S1 | S4a |
|---|---|---|
| recall P95 | 130 ms | **~3 ms** |
| 单条写入 | 177 ms | ~49 ms |
| reload（新 Store） | 102 ms | ~103 ms |

读路径达到目标；写入仍高于 30ms SLO，主要成本是每次写入的 `reload` + manifest/catalog 重写。S4b/S5 继续处理，不把“读快了”当成“全快了”。

## 被否方案

- **写路径节流 manifest**：试验后 1000 条写入反而波动到 ~81ms，且派生文件语义变模糊，已回退。
- **只缓存查询结果**：只能命中完全相同查询，价值低。
- **跳过 reload 直接读内存**：外部 CLI 写入/手工改文件会读到旧数据；只对 head 未变的 recall 生效。

## 证据

- 全量 288 pass / 1 skip；
- `scripts/bench.mjs --count 1000` 可复现；
- 索引缓存/文档缓存均为派生状态，删除或重启即重建。

## 回滚

- 移除缓存字段与 `reloadIfJournalChanged` 即可回到 S3 行为；无数据格式变化。
