# ADR-0044 · V5.0-S5：校验、故障注入与长稳加固

- 状态：已实现（S5）
- 日期：2026-10-18
- 阶段：V5.0-S5
- 依据：[V5 方案](../plan/v5-robustness.md) §3.7/§6

## 问题

S1–S4 有了 checkpoint、归档和缓存，但缺少：

- 用户可执行的完整性校验（HMAC、归档、journal）；
- HMAC 密钥丢失/被篡改时的明确姿态；
- 归档“写索引前删原段”的崩溃窗口；
- 10k 规模的真实压测与故障矩阵。

## 选择

1. **`mem verify [--deep]`**：
   - 默认：checkpoint HMAC、journal 链、归档 meta/index；
   - `--deep`：解压 `.jsonl.gz`，校验 sha256、seq 范围、Merkle root；
   - 失败返回 degraded，逐条列出问题。
2. **HMAC 密钥缺失 = 只读**：`readCheckpoint` 不再自动生成密钥；缺失时 checkpoint 校验失败、写入被阻塞，提示恢复 `.state/checkpoint.key` 或删除 checkpoint。
3. **归档顺序**：先写全部 `.gz/.meta`，再写 `archive/index.json`，最后删除原段；崩溃在中间时原段仍在，或重复段由 `readAll` 按 seq 跳过。
4. **故障注入**：S24.1–S24.3 覆盖 before-write / before-journal / before-derived；S26.1 覆盖归档后重启；S27.1 覆盖 verify/篡改 checkpoint。
5. **压测**：`scripts/bench.mjs --count 10000`，记录 add/reload/recall/journal；不作为 CI 阻塞（真实 fsync）。

## 被否方案

- **自动重建密钥**：会让 HMAC 从“防篡改”退化成“装饰”，且密钥丢失时掩盖问题。
- **先删原段再写索引**：崩溃会留下无法解释的 gap；已改为索引先行。
- **把 10k 压测放进 CI**：真实 fsync 太慢；单独脚本 + 人工记录。

## 证据

- S27.1：正常 checkpoint verify ok，篡改 hmac 被报告；
- S24.1–S24.3：三个崩溃点可判定/可恢复；
- 3000 条逐条实测：38.3 ms/条、reload 201 ms、recall P95 5.7 ms；
- 10k 批量导入：2.62 ms/条、reload 624 ms、recall P95 20.5 ms；逐条 10k 不在目标内（每次确认 fsync）。

## 回滚

- 删除 verify 命令不影响存储；HMAC 行为回到旧版需同时回退 checkpoint。
- 归档顺序回滚只影响维护命令，不影响已有归档。
