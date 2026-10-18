# ADR-0043 · V5.0-S4b：增量写入路径

- 状态：已实现（S4b）
- 日期：2026-10-18
- 阶段：V5.0-S4b
- 依据：[V5 方案](../plan/v5-robustness.md) §3.3、[ADR-0042](0042-v5-read-cache.md)

## 问题

S4a 把 1000 条 recall P95 从 130ms 降到 ~3ms，但单条写入仍 ~49ms：`add` 在写文件 + journal 之后还要 `reload()` 两次，每次都扫全部记忆并重建账本。

## 选择

1. **写后增量更新内存**：`add` 成功后不再 reload：
   - 解析刚写入的文件（一次小 parse）；
   - 更新 `docs/accounted/fileMeta/head`；
   - revision++、索引缓存失效；
   - 然后 `writeDerived()`。
2. **head 哈希**：用 `hashLine(JSON.stringify(entry))` 与 journal 追加行保持一致。
3. **保留校验**：写入前仍 reload 检查 journal 一致性、dedupe、锁；只是写后不重复全量扫描。
4. **失败回退**：文件/journal/parse 任一步抛错，不更新内存；下次 reload/启动按 journal 恢复。

## 结果（1000 条，同机）

| 指标 | S1 | S4a | S4b |
|---|---|---|---|
| recall P95 | 130 ms | ~3 ms | **~2.3 ms** |
| 单条写入 | 177 ms | ~49 ms | **~29.9 ms** |
| 新 Store reload | 102 ms | ~103 ms | **~69 ms** |

写入达到 30ms 目标附近；但 10k/100k 仍会随 manifest/catalog 的 O(n) 重写增长，S5 继续观察。

## 被否方案

- **写后完全跳过 writeDerived**：GUI/CLI 派生文件滞后，语义变模糊。
- **写路径节流 manifest**：实测波动且收益不稳定，已回退。
- **只写 journal 不写文件**：丢失文件真相，不可接受。

## 证据

- 288 pass / 1 skip；`ci`/`stage S7` 全绿；
- `scripts/bench.mjs --count 1000` 可复现；
- 写入后 `read`/`recall` 直接读内存，无需 reload。

## 回滚

- 恢复 `add` 的两次 reload 即回到 S4a；无数据格式变化。
