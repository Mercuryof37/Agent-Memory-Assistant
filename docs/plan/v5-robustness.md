# V5.0 开发方案：长期稳定、存储可控、始终最快

> 日期：2026-10-18 · 基线：Agent Memory 0.4.0（V4.0） · 状态：方案（未开工）
> 目标：把插件做成**能长期运行、崩溃可恢复、性能不随历史增长而退化、存储可预期**的本地记忆层。

## 0. 结论先行

V5.0 不重写产品，重点修四条“随时间变坏”的路径：

1. **journal 无界增长**：当前追加式哈希链永不删除，`reload` 每次读全量；先加 checkpoint + 归档 + 保留策略，而不是直接删审计。
2. **全量 reload / 全量建索引**：`read`、`recall`、写入都重新扫 journal 与记忆文件；改为“checkpoint 状态 + 尾部增量 + 索引缓存”。
3. **崩溃恢复靠事后隔离**：文件/ journal 之间没有显式事务边界；补写入顺序、fsync、恢复状态机与故障注入测试。
4. **缺少运维观测**：没有 journal 体积、reload 耗时、查询 P95 的指标；先能看见，再谈优化。

一句话：**审计仍然只追加，但“热 journal”有界；历史进入可校验归档；启动只读状态与尾部，不读全史。**

### 0.1 拍板回执（2026-10-18）

| # | 决策 | 对方案的影响 |
|---|---|---|
| 1 | 热 journal 上限按 **50k 行** | 行数是主触发；50MB/30 天仅作安全兜底，不先启用 |
| 2 | 超过保留期**允许只保留 checkpoint root** | 归档不再无限保留原文；内容仍可从记忆文件恢复，root 证明历史 |
| 3 | `mem maintain` **默认自动** | 低峰/启动后自动 checkpoint + 归档；仍需日志、dry-run 和失败回退 |
| 4 | checkpoint root **默认 HMAC** | 本机密钥文件；丢失时 `doctor` 明确警告并进入只读校验模式 |
| 5 | SQLite **评估但不优先** | 仅当纯文件方案达不到 SLO，或功能/性能有明显提升时采纳；主存储仍 Markdown |

## 1. 现状架构回顾

### 1.1 已有基础（保留）

- 一条记忆一个 Markdown；文件是内容真相；
- journal 单一日志、每行 SHA-256 + `prev` 链；5 MiB 分段；
- manifest 记录 journal head，作为截断 tripwire；
- 写锁 + 原子写；`addMany` 有失败回滚；
- 快照最多 20 份；索引/目录可重建；
- 备份导出、`doctor`、`rebuild`、`adopt`、`purge`；
- 所有写入经 core，GUI/CLI/MCP 共用一条路径。

### 1.2 实测基线（真实个人库）

| 项 | 当前 |
|---|---|
| journal | 54.5 KB / 228 行 / 1 个 segment |
| snapshots | 75 KB / 20 份上限 |
| memories | 18 KB |
| 整个 store | 156 KB |
| 单条 journal 均值 | ~239 B |

结论：**当前完全没压力**；问题是趋势，不是今天。

### 1.3 S1 基线（2026-10-18，`scripts/bench.mjs`）

| 记录数 | 单条写入 | 冷启动/reload | recall P95 | journal |
|---|---|---|---|---|
| 200 | 41 ms | 8.4 ms | 18.7 ms | 54 KB |
| 1000 | 177 ms | 102 ms | 130 ms | 272 KB |

1000 条时写入与查询已经开始明显变慢，原因是每次写入都 reload + 重写 manifest/catalog；这正是 S2/S4 要解决的。10k/100k 基准留到 S1 的 CI 之外手动跑（当前写入按 fsync 设计，跑满会很久）。

### 1.4 随规模变坏的路径

| 路径 | 当前行为 | 规模变大后 |
|---|---|---|
| 启动/读取 | `reload()` 读全部 journal + 全部记忆 | O(历史) 启动变慢 |
| 检索 | 每次 `recall` 全量 `buildIndex` | O(记录数) 查询变慢 |
| 写入 | 写文件 → 追加 journal → reload → 写派生 | 每次写都付全量代价 |
| 审计 | 行只追加，永不删除/归档 | 磁盘增长；百万行后 reload 秒级 |
| 崩溃 | 文件与 journal 非同一事务；靠隔离/恢复 | 窗口内崩溃需要人工 adopt |
| 观测 | `doctor` 有 head/统计，无体积/耗时 | 无法提前发现退化 |

## 2. 成熟产品的维护逻辑（调研）

| 产品/系统 | 机制 | 对我们的启示 |
|---|---|---|
| **SQLite WAL** | WAL 追加，checkpoint 把页刷回主库，可 truncate；崩溃按 WAL 恢复 | 日志不是永久真相；checkpoint 后可以回收/截断 |
| **etcd** | WAL + 定期 snapshot；compaction 清旧 revision；defrag 回收空间 | 用 snapshot/checkpoint 替代“重放全部历史”；归档与压缩分离 |
| **Kafka** | 分段日志；按时间/大小 retention；key 的 compaction | 分段保留，不做“全量永久”；但审计是事件流，不能简单按 key 覆盖 |
| **Git** | 不可变对象 + packfile；`gc` 打包/清理不可达对象；`fsck` 校验 | 不可变内容 + 可达性/归档；校验与清理是独立运维动作 |
| **RocksDB** | WAL + MANIFEST + SST；compaction 合并；启动按 MANIFEST 恢复 | manifest 是恢复入口；WAL 可滚动，旧数据进 SST/归档 |
| **PostgreSQL** | WAL + checkpoint + autovacuum | 定期维护自动化；空间回收不是“删日志” |
| **Obsidian** | 文件恢复快照，有限保留 | 用户侧快照应有上限，默认不无限增长 |

参考：
- [SQLite WAL / checkpoint](https://www.sqlite.org/wal.html)、[wal_checkpoint_v2](https://www2.sqlite.org/draft/c3ref/wal_checkpoint_v2.html)
- [etcd maintenance: compaction & defrag](https://etcd.io/docs/v3.2/op-guide/maintenance/)
- [Kafka topic config / log compaction](https://kafka.apache.org/36/generated/topic_config.html)
- [Git internals: maintenance & data recovery](https://git-scm.com/book/en/v2/Git-Internals-Maintenance-and-Data-Recovery)
- [RocksDB Write-Ahead Log](https://github.com/facebook/rocksdb/wiki/Write-Ahead-Log)
- [PostgreSQL routine vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html)
- [Obsidian file recovery](https://obsidian.md/help/plugins/file-recovery)

**共同模式**：热日志有界；状态快照/检查点承担启动；旧数据归档/压缩；校验与清理分离；维护有自动化与观测。

## 3. V5 目标架构

### 3.1 存储：带 Merkle checkpoint 的分段审计

保留“只追加 + 可验证”，但把“无限热日志”拆成三层：

```text
.state/journal/
  0001.jsonl              # 热段：最近写入，参与启动尾部重放
  0001.meta.json          # 段元数据：first/last seq、count、bytes、root
  checkpoints/
    0001.json             # Merkle root + last_seq + 前一个 checkpoint hash
  archive/
    0001.jsonl.gz         # 冷段：压缩 + 单独 checksum
    0001.meta.json
```

- **Merkle root**：段内每行 hash 组成 Merkle 树，root 写入 `meta`/checkpoint；
- **checkpoint 链**：每个 checkpoint 含 `previous_checkpoint_hash`，形成“检查点链”，仍然只追加；
- **热段**：默认最多 **50k 行**（主阈值）；50MB/30 天只作安全兜底，不先启用；超过触发自动 maintain；
- **归档**：旧段压缩 + checksum；默认保留最近 1 年；
- **保留策略**：超过保留期后**允许只保留 checkpoint root**（证明存在与顺序），原始压缩段可清理；内容仍可从记忆文件恢复；
- **不重写历史行**：只移动/压缩；任何“删除”都是归档/保留策略，不是篡改。

### 3.2 启动：checkpoint 状态 + 尾部增量

新增 `.state/checkpoint.json`（或 `catalog`）：

```json
{
  "schema": 1,
  "last_seq": 12345,
  "last_hash": "…",
  "journal_checkpoint": "checkpoints/0031.json",
  "docs": { "mem-…": { "sha256": "…", "deleted": false } },
  "created_at": "…"
}
```

启动：

1. 读 checkpoint（文档 id→hash、删除集合、journal head）；
2. 只重放 **checkpoint 之后**的 journal 尾部；
3. 扫记忆文件校验 hash（可并行/懒加载）；
4. 不一致时进入恢复状态机，而不是全量重放。

这样启动与日常写入不再 O(全部历史)。

### 3.3 读取/检索：索引缓存与增量

- 把 BM25 索引与文档向量缓存为可重建派生文件，带 `tokenizer_version`/`model_id`；
- 写入时增量更新，而不是每次 `recall` 全量 `buildIndex`；
- `read`/`recall` 只在 manifest 检测到外部变化时 reload；同进程内用内存版本；
- 大库可只加载摘要/索引，正文按需读（当前记录最大 10KB，先用 10k 条压测再决定）。

### 3.4 写入与崩溃一致性

统一事务顺序（所有写入口）：

```text
1. 获取写锁
2. 写临时文件 + fsync + rename
3. 追加 journal 行 + fsync
4. 更新 checkpoint/manifest（原子）
5. 释放锁
```

崩溃点测试：在 2/3/4 之间 kill，启动必须能判定“文件未入账/入账未 checkpoint/checkpoint 未刷新”并选择可证明的恢复动作；不允许静默丢数据。

### 3.5 并发

- 单写者锁保留；增加锁的持有者 PID + 进程启动时间/心跳（Windows 尽力）；
- 读者使用 checkpoint + tail 的只读快照；
- CLI/MCP/DSH 同时写时，用 `op_id` 幂等 + `base_hash` 乐观并发；
- 锁等待/超时指标可观测。

### 3.6 观测与维护

新增：

- `mem doctor --json`：journal 行数/段数/字节、checkpoint 年龄、reload ms、索引大小、快照数；
- `mem maintain`：`--checkpoint`、`--archive`、`--retention 365d`、`--verify`、`--dry-run`；
- **自动维护（默认开启）**：热 journal 达到 50k 行后，在低峰/启动后自动 checkpoint + 归档；维护前先写临时锁文件，失败保持原状并记录原因；
- 自动维护不阻塞普通读取；可通过配置关闭/改为只提示；
- 指标日志：`reload_ms`、`recall_ms`、`journal_bytes`、`lock_wait_ms`、`maintain_ms`。

### 3.7 安全

- checkpoint root **默认 HMAC**（本机密钥）防“悄悄改历史”；密钥丢失时 `doctor` 明确警告，进入只读校验模式，不允许悄悄降级为纯 hash；
- HMAC 密钥文件与备份一起导出；不写入日志/遥测；
- 归档 checksum；`verify --deep` 解压校验；
- 备份包含 checkpoint + manifest；恢复演练；
- 不引入加密强依赖（V5 可选加密存储为后续）。

## 4. 数据格式与兼容

- 新 journal 元数据/checkpoint 为 **v1.5**；旧 `0001.jsonl` 原样可读；
- 迁移 `mem migrate --checkpoint`：先备份 → 生成首个 checkpoint → 保留原 journal；
- 双读：旧版本忽略 unknown checkpoint 文件；新版本对旧 journal 走兼容路径；
- 回滚：删除 checkpoint/archive 不影响旧 journal；`mem verify` 仍可按旧链校验；
- 不改变记忆 frontmatter（仍是 `mem_schema: 2`）。

## 5. 性能与可靠性指标（SLO）

以 1k / 10k / 100k 条记忆、10 万/100 万 journal 行为基准：

| 指标 | V5.0 目标 |
|---|---|
| 冷启动（10k 条） | < 300 ms |
| 冷启动（100k 条） | < 1.2 s |
| 单次 recall P95（10k 条） | < 50 ms |
| 外部变更后的增量 reload | < 20 ms |
| 写入 P95（单条） | < 30 ms |
| journal 热数据 | 默认 ≤50k 行；50MB 仅安全兜底，超出自动归档 |
| 崩溃注入 | 不丢已确认写入；不产生不可解释的断链 |
| `verify --deep` | 可验证归档 root；错误可定位到段/行 |

## 6. 阶段计划（V5.0）

| 阶段 | 内容 | 出口 |
|---|---|---|
| **S1 观测与压测** | `doctor --json` 体积/耗时；1k/10k/100k 合成基准；故障注入框架 | 有基线数字；CI 不退化 |
| **S2 checkpoint** ✅ | v1.5 checkpoint 状态；启动只读 checkpoint + tail；Merkle root；HMAC 默认 | [ADR-0040](../adr/0040-v5-checkpoint.md) |
| **S3 归档/保留** ✅ | `mem maintain` 自动归档、压缩、checksum、50k 行阈值、root-only 保留；`verify --deep` 待 S5 | [ADR-0041](../adr/0041-v5-archive.md) |
| **S4 性能** | 索引/向量缓存、增量 reload、查询缓存；SQLite 派生索引只做对照实验 | S4a 读路径完成（recall 130→3ms）；写路径待 S4b | [ADR-0042](../adr/0042-v5-read-cache.md) |
| **S5 加固** | 崩溃点测试、并发、HMAC 默认、自动维护、发布 0.5.0 | 长稳测试通过 |

预计：S1 3–5 人日；S2 8–12；S3 6–8；S4 8–12；S5 8–12。可先做 S1+S2，尽快拿到“启动不再 O(历史)”的收益。

## 7. 被否/暂缓方案

- **直接把 journal 换成 SQLite 作为真相**：性能好，但丢文件可 diff/可 grep 与“Markdown 即真相”；SQLite 只作为**派生索引**评估，并且只在纯文件方案达不到 SLO、或功能/性能有明显提升时才考虑采纳（不优先）。
- **定期删除旧 journal**：断链、无法审计；必须 checkpoint + 归档 + 保留，而不是删。
- **Kafka 式按 key 覆盖**：审计是事件流，覆盖会丢历史；只做段保留。
- **区块链/分布式账本**：单机单用户不需要共识；Merkle checkpoint 足够。
- **一次性重写整个存储引擎**：风险高；按阶段兼容迁移。

## 8. 风险

| 风险 | 缓解 |
|---|---|
| checkpoint 本身损坏 | 保留上一 checkpoint；启动选择最新可验证；`doctor` 修复 |
| 迁移中断 | 迁移前备份；dry-run；旧 journal 只读保留 |
| 归档校验慢 | `verify` 分级：默认尾部，`--deep` 全量 |
| 性能优化引入不一致 | 所有缓存可删重建；写入仍只走 core；基准 + 故障注入门禁 |
| 自动维护打扰用户 | 低峰/启动后执行；失败保持原状；可关闭/改为只提示 |
| HMAC 密钥丢失 | 备份包含密钥；丢失时只读校验并明确提示，不静默降级 |

## 9. 已拍板

1. 热 journal 以 **50k 行**为主阈值；50MB/30 天仅安全兜底；
2. 超过保留期允许**只保留 checkpoint root**，内容从记忆文件恢复；
3. `mem maintain` **默认自动**（低峰/启动后），失败保持原状；
4. checkpoint root **默认 HMAC**，密钥丢失进入只读校验；
5. SQLite **评估但不优先**：纯文件达不到 SLO，或功能/性能有明显提升时才考虑派生索引。

---

参考实现会从 S1 开始：先加 `doctor` 指标与压测，不改数据格式；确认基线后再做 checkpoint。
