# ADR-0045 · V5.0-S5b：批量 WAL 与 10k 导入

- 状态：已实现
- 日期：2026-10-18
- 阶段：V5.0-S5b
- 依据：[ADR-0044](0044-v5-verify.md)、[V5 方案](../plan/v5-robustness.md)

## 问题

单条 `add` 每次都要 fsync + 派生文件；10k 条逐条写入不可接受。用户希望“本来会丢的数据归档，同时让 10k 快”。

## 关键判断

**不能等崩溃后再归档已丢的数据**：内存里的最后一批写入一旦掉电就没了。正确做法是**先写 WAL、再确认**：

1. 批量文件写入（每条仍原子写）；
2. `Journal.appendBatch` 一次写入整批 journal 行，**一次 fsync**；
3. fsync 成功后才返回成功；
4. 崩溃时最多丢未确认批次；已确认批次在 journal 中，重启恢复/隔离。

这不是“丢后归档”，是“先归档再确认”，因此不牺牲已确认写入的耐久性。

## 结果（10k）

| 模式 | 单条耗时 | reload | recall P95 |
|---|---|---|---|
| 逐条 `add`（1000 条） | 29.9 ms | 69 ms | 2.3 ms |
| 批量 `addMany`（10k，batch 1000） | **2.62 ms** | 624 ms | 20.5 ms |

10k 批量导入 26.2s；逐条 10k 仍慢，因为每次确认都要 fsync，这是耐久性代价，不是 bug。

## 选择

- 新增 `Journal.appendBatch`：整批一次 fsync，段滚动按 5MiB；
- `addMany` 改为 appendBatch + 内存增量更新 + 一次 writeDerived；
- 基准新增 `--batch`；10k 验收使用批量导入（真实导入路径），不把逐条 add 的 10k 当目标。

## 被否方案

- **崩溃后归档丢失数据**：不可实现；掉电后数据已不存在。
- **异步 fsync 后立即确认**：会在崩溃时丢已确认数据；不接受。
- **只优化 benchmark 不优化真实批量路径**：不诚实。

## 证据

- `node scripts/bench.mjs --count 10000 --batch 1000`：2.62 ms/条、reload 624ms、recall P95 20.5ms；
- 10k journal 2.7MB；全量测试/ci 待跑。
