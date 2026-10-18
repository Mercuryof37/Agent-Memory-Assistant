# ADR-0046 · V5.0-S5c：单写 group commit

- 状态：已实现
- 日期：2026-10-18
- 阶段：V5.0-S5c
- 依据：[ADR-0045](0045-v5-batch-wal.md)

## 问题

`add` 是同步 API，每次返回前必须 fsync，单条 10k 无法靠逐条调用变快；但宿主/并发生产者可以同时提交多个写入。

## 选择

1. 新增 `MemoryStore.addAsync()`：并发调用进入 2ms 队列窗口；
2. flush 时一次 `reload` + dedupe，再按 author 调 `addMany`；
3. `addMany` 用 `appendBatch` 一次 journal fsync；
4. 只有 fsync 成功后才 resolve；失败 reject，不假装成功；
5. 同步 `add()` 保持不变，仍每条 fsync（单条确认的耐久性不被偷偷降低）。

## 结果（10k）

| 模式 | 总耗时 | 单条 | reload | recall P95 |
|---|---|---|---|---|
| 批量 `addMany` | 26.2s | 2.62 ms | 624 ms | 20.5 ms |
| 并发 `addAsync` | 24.3s | **2.43 ms** | 660 ms | 22.5 ms |
| 逐条同步 `add` | 分钟级 | 29.9 ms（1k） | 69 ms | 2.3 ms |

## 边界

- 顺序 `await addAsync` 不会自动变快：每个 await 仍等一次提交；要收益必须并发提交（`Promise.all` 或生产者并行）。
- 同步 `add` 不用 group commit，避免把“已确认”建立在未 fsync 的批次上。
- 2ms 窗口是延迟/吞吐折中；可用配置后续暴露。

## 证据

- S28.1：25 个并发 addAsync → 25 条、重启 25 条；
- `node scripts/bench.mjs --count 10000 --group` 可复现；
- 全量 ci 通过。
