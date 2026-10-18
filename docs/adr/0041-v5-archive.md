# ADR-0041 · V5.0-S3：归档、保留与自动维护

- 状态：已实现
- 日期：2026-10-18
- 阶段：V5.0-S3
- 依据：[V5 方案](../plan/v5-robustness.md) §3.1/§3.6

## 问题

S2 让启动只读 checkpoint 尾部，但旧 journal segment 仍永久保留；50k 行后磁盘与备份会持续增长，且没有“归档/保留”的运维动作。

## 选择

1. **归档边界**：只归档 checkpoint 所在 segment **之前**的段；checkpoint 段及其后保持活跃，保证尾部链可接。
2. **归档格式**：`.state/journal/archive/<base>.jsonl.gz` + `.meta.json`（first/last seq、count、bytes、sha256、Merkle root、archived_at）；`archive/index.json` 记录 `through_seq/through_hash`。
3. **启动兼容**：`Journal.readAll` 若发现 archive index，就从 `through_seq + 1` 开始校验；旧段不再参与全量读取；checkpoint + 尾部仍可恢复。
4. **触发**：
   - 活跃 journal > **50k 行**时，写入后自动 checkpoint + 归档；
   - 启动时若已超过阈值，也尝试一次自动维护；
   - `mem maintain [--retention-days n]` 可强制。
5. **保留**：默认 365 天；超过后删除 `.jsonl.gz`，保留 `.meta.json` 和 root（用户决策：允许只留 root）。
6. **顺序安全**：先写归档副本/meta，再写 archive index，最后删除原段；若中途崩溃，`readAll` 对重合 seq 做跳过，避免“已归档行又被读一遍”。

## 被否方案

- **归档 checkpoint 段**：会丢失尾部起点；不归档。
- **删除旧 journal 而不归档**：违反审计可验证；S3 只做归档/保留。
- **保留所有压缩段**：空间仍无界；保留期后只留 meta/root。
- **每次写都归档**：写放大；只在 50k 行阈值/显式维护时做。

## 证据

- S26.1：两段 synthetic journal → checkpoint → maintain 归档 0001 → 重启无 issues；
- S26.2：保留期删除旧 `.gz`，保留 meta；
- `npm test`/`ci` 全绿；`mem maintain` CLI 输出 archived/pruned。

## 回滚

- 删除 `.state/journal/archive/` 并把归档段解压回 `.state/journal/` 可恢复全量 journal；checkpoint 可删后全量重建。
- 自动维护失败不删除原段；`doctor` 会显示 issues。
