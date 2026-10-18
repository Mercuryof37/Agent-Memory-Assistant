# ADR-0040 · V5.0-S2：checkpoint + 尾部重放

- 状态：已实现（S2）
- 日期：2026-10-18
- 阶段：V5.0-S2
- 依据：[V5 方案](../plan/v5-robustness.md) §3.1/§3.2

## 问题

每次 `reload()` 都读全量 journal 并逐行校验哈希，启动与写入随历史增长变慢；需要“checkpoint 状态 + 只重放尾部”，同时保持审计可验证、HMAC 默认、旧数据兼容。

## 选择

1. **`.state/checkpoint.json`（schema 1）**：
   - `journal {seq, hash, segment}`；
   - `docs:[{id, sha256, deleted}]`（checkpoint 时的入账/删除状态）；
   - `journal_root`：journal 行 hash 的 Merkle root；
   - `docs_root`：排序后 `id:sha256:deleted` 的 Merkle root；
   - `hmac`：默认 HMAC-SHA256，密钥 `.state/checkpoint.key`（32 字节，`init` 生成）。
2. **启动**：读 checkpoint（验证 HMAC + docs_root）→ 只从 checkpoint 所在 segment 开始读尾部；旧 segment 不再扫描；尾部链必须接上 checkpoint 的 `last hash`。
3. **自动 checkpoint**：每次 `writeDerived` 后，若 journal head 与上次 checkpoint 差 ≥200 行，写一次；`rebuild()` 强制写；测试可调 `store.checkpoint()`。
4. **HMAC 缺失/不匹配**：不静默信任，加入 issues（写入被阻塞），仍可全量 journal 读取做人工诊断。
5. **兼容**：没有 checkpoint 的旧库走原 `readAll`；旧 journal 不变；checkpoint 是新增派生文件，可删除后全量重建。

## 被否方案

- **每次写都 checkpoint**：写放大；200 行阈值在“启动尾长”和“写成本”之间折中。
- **checkpoint 存完整记录**：体积大、重复内容真相；只存 id/hash/deleted。
- **不 HMAC、只 hash**：本机仍可能被悄悄改；按 V5 决策默认 HMAC。
- **直接删除旧 journal**：S3 才做归档/保留；S2 只跳过扫描，不移动/删除。

## 证据

- S25.1 checkpoint 后新增记录，重启只读尾部且两条都在；
- S25.2 篡改 HMAC 被报告；
- S25.3 Merkle root 确定性；
- 全量测试/ci 绿；200 条基准 reload 从 25ms 降到 16ms（同机波动，主要收益在 segment 跳过与尾部重放）。

## 回滚

- 删除 `.state/checkpoint.json` 即回到全量 journal 读取；不丢数据。
- 密钥丢失：恢复 `.state/checkpoint.key` 或删除 checkpoint 后全量重建；删除 checkpoint 会失去 HMAC 快速校验，但 journal 仍在。
