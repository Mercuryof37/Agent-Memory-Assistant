# 路径 B：SQLite 本地结构化记忆（混合检索）

> **一句话**：把记忆存进一个本地 SQLite 文件——每条事实是一行记录，带类型、作用域、标签、置信度、时间戳和版本号；检索不再靠"字面包含"，而是中文分词 + BM25 + 字符 n-gram 的混合排序；系统提示词里只注入有界的几条。
>
> **适配环境**：DeepSeek Harness `0.2.0-rc.2` / Node ≥ 22.19（`node:sqlite`）/ 单机
> **调研基准**：2026-10-17（star 数为当日 GitHub API 实测值）

---

## 一、这条路径用的是什么技术

路径 A 的记忆是"文件"，路径 B 的记忆是"记录"。

为什么值得多花这些力气？因为文件方案有个绕不过去的硬伤：**中文检索基本失效**。默认分词器下，"用户希望技术文档多用实例"这句话会被当成一个 token，你用"文档"去搜根本命中不了。而 `dsh-ltm` 的 README 把这条讲得很直白：

> `dsh-memory@0.1.0` 是纯文本 + FTS5 配默认分词器：**中文检索实际上不工作（整句变成一个 token）**。

路径 B 的做法是把每条记忆拆成结构化的一行，然后给检索装上三件武器：

1. **CJK 感知分词**：中日韩用 bigram（两字切分），让"文档"能命中"技术文档"；
2. **BM25 打分**：关键词命中的经典排序，比"包含/不包含"细腻得多；
3. **字符 n-gram 余弦相似度**：处理错字、缩写、语序变化，作为第二路信号混合重排。

再叠加记忆特有的一层——**生命周期**：去重（近重复写入直接返回已有记录）、`revision` 版本号做乐观并发、`pinned` 置顶、`stale` 过期标记、`scope` 作用域隔离（全局 / 项目）。最后只把排好序的前几条注入提示词，不把整库塞进去。

一句话对比：路径 A 是"**备忘录**"，路径 B 是"**带索引的档案柜**"。

### 技术栈一览

| 层 | 选型 | 作用 | 是否必须 |
|---|---|---|---|
| 存储引擎 | SQLite（`node:sqlite` 内置模块） | 单文件、WAL、事务、零服务 | ✅ 必须 |
| 全文索引 | FTS5 | 关键词一路召回 | ✅ 必须 |
| 中文分词 | CJK bigram（中日韩）/ trigram（泰文） | 让中文能搜 | ✅ 必须 |
| 排序 | BM25 + 字符 n-gram 余弦 混合重排 | 提高精确率 | ✅ 必须 |
| 并发 | `revision` 乐观并发（期望版本 CAS） | 防覆盖写 | ✅ 必须 |
| 生命周期 | 去重阈值、`pinned`、`stale_after`、`confirm` | 防膨胀、防过期 | ✅ 必须 |
| 作用域 | `scope`（全局 + 按项目 cwd/Git 根自动派生） | 隔离不同项目 | 推荐 |
| 语义增强 | `sqlite-vec` + 本地嵌入（可选） | 语义模糊召回 | 可选 |
| 注入 | 有界提示词段（字符/ token 双预算） | 只给必要内容 | ✅ 必须 |
| CLI/诊断 | 只读 `doctor`、`export`/`import` | 运维与迁移 | 推荐 |
| 宿主接线 | DSH 插件（工具注册） | 暴露给模型 | ✅ 必须 |

### 优势

- **中文能搜了**：这是相对路径 A 最实质的收益，也是中文用户最容易踩的坑。
- **仍然零服务**：一个 `.db` 文件，不要 PostgreSQL、不要向量库、不要 API key。
- **记忆质量可控**：去重、置信度、`pinned`、过期复核，都是文件方案做不干净的。
- **并发安全**：`revision` CAS 在数据库事务里做，比"靠规范约束"硬得多。
- **可迁移**：`export`/`import` 能带着作用域与复核时间一起搬。
- **检索成本可控**：排好序取前 K 条，注入量固定，不会随库变大而膨胀。

### 劣势

- **不再"打开就能读"**：要查记忆得写 SQL 或跑 CLI，人工编辑成本高。
- **schema 与迁移是真工作量**：加字段要写升级脚本，还要处理"旧库只读拒绝打开"这类边界。
- **写入成本随库增长**：近重复检测要扫同作用域全部记录，条目多了写入会变慢（这是设计取舍，不是 bug）。
- **中文分词没有银弹**：bigram 会带来一些误命中，需要靠重排和阈值压下去。
- **生态不成熟**：DSH 生态里这条路最完整的 `dsh-ltm` **只有 1 star**，等于没有社区背书。

### 技术要求

| 项 | 要求 | 说明 |
|---|---|---|
| 编程能力 | Node / TypeScript，懂 SQL 与 FTS5 | 比路径 A 高：要设计 schema、写迁移 |
| 数据建模 | 能定义"一条记忆"的字段与作用域边界 | 中等，容易过度设计 |
| 机器资源 | 无特殊要求 | SQLite 单文件，几万条无压力 |
| 外部账号 | **不需要**（除非启用语义增强） | 本地嵌入可选，也可不用 |
| 运维负担 | 中（schema 迁移、备份、`doctor` 巡检） | 备份 = 复制 `.db` + WAL |
| 上手时间 | 骨架 2–3 天，可用 1–2 周 | 有 `dsh-ltm` 源码可读 |

---

## 二、适用与不适用

**适合你，如果**：
- 你被"中文搜不到记忆"折磨过；
- 记忆条目会明显超过几十条，文件方案已经开始靠删除维持；
- 你想要去重、过期、置信度这些"档案管理"能力；
- 你仍然坚持本地、单进程、无云服务。

**不适合你，如果**：
- 你高度依赖人工直接编辑记忆内容（数据库不友好）；
- 你不熟悉 SQL，也不想维护 schema 迁移；
- 你的记忆量很小、以"人格 + 偏好"为主——那路径 A 更划算。

---

## 三、架构与数据模型

```
记忆写入
  → 去重检查（同作用域近似比对；命中则返回已有记录，除非 force）
  → 写入事务（校验 + 生成 revision + 更新 FTS 索引）
  → 记录落库

记忆读取
  → 作用域过滤（当前项目 + 全局）
  → 双路召回：FTS5/BM25  ←→  字符 n-gram 余弦
  → 混合重排 → 取前 K
  → 有界注入（字符预算 + 可选 token 预算）
```

**最小表结构**（参照 `dsh-ltm` 与知乎 MVP 结构的共同部分）：

```sql
CREATE TABLE memories (
  id            INTEGER PRIMARY KEY,
  scope         TEXT NOT NULL,        -- '' = 全局；'git:<sha>' / 'dir:<name>' = 项目
  text          TEXT NOT NULL,
  tags          TEXT NOT NULL DEFAULT '',  -- 规范化后的标签
  pinned        INTEGER NOT NULL DEFAULT 0,
  revision      INTEGER NOT NULL DEFAULT 1,   -- 乐观并发
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_review   TEXT,                 -- confirm 时刷新，用于陈旧判定
  deleted_at    TEXT                  -- 软删除（优于物理删）
);
CREATE VIRTUAL TABLE memories_fts USING fts5(
  text, tags, content='memories', content_rowid='id', tokenize='<CJK 分词器>'
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);  -- schema_version 等
```

**作用域设计**（`dsh-ltm` 的口径，值得抄）：按每个会话的 `session.header.cwd` 解析，**不用共享进程的 cwd**；Git 检出按规范化后的 common Git 目录识别，子目录与 linked worktree 共享同一作用域；**绝不存绝对路径**。

---

## 四、关键实现点

**1. 用 `node:sqlite`，不要引入原生模块。** Node ≥22.19 内置，省掉编译与跨平台问题。开 WAL、设 `busy_timeout`。

**2. 分词器决定成败。** 先跑一个对照实验：把同一批中文记忆导入，分别用默认分词器和 bigram，用 20 个真实查询对比命中率。**这一步不做，后面全是自嗨。**

**3. 去重放在写入事务内，但"相似度"不得自动合并。** 近重复检测（Jaccard / 余弦阈值）必须与写入同一事务，否则并发时会漏。代价是写入持锁更久——这是明确的取舍，写进文档。

**但要区分两种"重复"**（口径来自 [agent-memory 的操作边界设计](https://github.com/tigerless-labs/agent-memory/blob/main/docs/design/management-operation-boundaries.md)，值得照抄）：

| 判据 | 处置 |
|---|---|
| **所有语义字段完全一致**（摘要、正文、type、语义字段、有效期起点、作者、关系、provenance；比较保留 Unicode/大小写/顺序/标点/内部空白） | **T0 自动合并**，保留最旧一条，其余指向它 |
| **仅相似（阈值命中）** | **只生成提案，走人工评审**，绝不自动合并 |

原文一句话点破了理由：*"Similarity alone belongs to the reviewed proposal path."* 这与我们已核实的论文结论一致——失效模式正是"把相似的东西说成同一件事"。**阈值只用来产提案，不用来自动合并。**

**3b. 写锁要覆盖"读—校验—持久化—投影"全过程。** 这一点我们之前漏了：如果"读"发生在拿锁**之前**，两个并发修改会**静默互相丢弃**（双方读到的都是旧版本，CAS 也可能被绕过）。正确做法是**在读取之前就获取写锁**，并一直持有到投影更新完成。

**4. `revision` 做 CAS，且模型不传版本号。** 与路径 A 同理：`expectedRevision` 由服务端维护。冲突时返回结构化错误码（`MEMORY_REVISION_CONFLICT`），**什么都不写**，让模型重读后重试，而不是自动重放旧内容。

**5. 软删除 + `stale_after`，不要物理删。** 知乎那篇设计文与几份高赞答案都指向同一条：**事实失效时加"标记失效"而不是删除**。物理删除让审计和回溯失去意义。

**6. 注入要有双预算。** 字符预算（UTF-16）保底，token 预算（可选本地 tokenizer）更准。注入段要**字节稳定**——同一会话内不因记忆编辑而重渲染，否则前缀缓存反复失效。

**7. 陈旧度清扫。** 定时扫描 `last_review`，按年龄分桶：>90 天复审、>180 天归档候选；**无可解析时间戳的条目一律视为过期**（让人介入才是正确结果）。这是路径 A 完全没有的一环。

**8. 提供只读诊断。** `doctor` 用 `readOnly: true` 打开库，不改任何东西，输出条目数、标签分布、陈旧项、疑似重复对。运维时它是唯一不脏手的工具。

---

## 五、可复用的项目（star 数为 2026-10-17 实测）

| 项目 | Stars | 许可证 | 最近推送 | 能给你什么 | 注意 |
|---|---:|---|---|---|---|
| [tr1v3r/dsh-ltm](https://github.com/tr1v3r/dsh-ltm) | **1** | MIT | 2026-10-04 | **与本路径最贴合的实现**：CJK 分词、BM25+ngram、去重、`revision` CAS、作用域、`doctor`、`export/import` | ⚠️ **仅 1 star、极新**。可直接读源码学习，但别当长期依赖；它注册 `memory_write/search/forget`，**与其它记忆插件冲突，装前先禁旧** |
| [EverMind-AI/EverOS](https://github.com/EverMind-AI/EverOS) | 13,455 | Apache-2.0 | 2026-10-16 | **同哲学的开源实现**：Markdown 作原文 + 本地 SQLite + LanceDB 索引，"不要 MongoDB/ES/Redis"；**有官方 DSH 插件** | 需要一次 OpenRouter key 起步；LanceDB 引入向量依赖 |
| [basicmachines-co/basic-memory](https://github.com/basicmachines-co/basic-memory) | 4,254 | **AGPL-3.0** | 2026-10-16 | Markdown 为真相 + SQLite 索引 + FastEmbed 本地嵌入；工具面最全 | ⚠️ **AGPL 传染**：可借鉴其 Markdown 语法约定，**不要依赖代码** |
| [doobidoo/mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) | 2,021 | Apache-2.0 | 2026-10-17 | 本地 ONNX 嵌入、因果图、REST+MCP+CLI 四形态 | 常驻服务模型，不管你的 Markdown |
| [asg017/sqlite-vec](https://github.com/asg017/sqlite-vec) | 8,192 | Apache-2.0 | 2026-05-18 | 单文件 SQLite 向量检索的事实标准积木 | 只管向量存取，不含记忆语义 |
| [sqliteai/sqlite-memory](https://github.com/sqliteai/sqlite-memory) | 129 | **Elastic License 2.0** | 2026-07-21 | 单 `.db` + 向量&FTS5 混合 + llama.cpp 本地嵌入 | ⚠️ **非 OSI 开源**，有商用限制 |
| [YQteam-hq/yq-nova-agent](https://github.com/YQteam-hq/yq-nova-agent) | 0 | NOASSERTION（BSL-1.1） | 2026-10-16 | Rust 单文件记忆层，混合检索思路 | ⚠️ **0 star**、BSL 商用需授权 |

**诚实评级**：这条路在 DSH 生态里**没有一个"成熟"的现成依赖**。`dsh-ltm` 思路对但只有 1 星；`EverOS` 有 1.3 万星但带 LanceDB。所以路径 B 的现实定位是：**自己实现核心，读 `dsh-ltm` 源码学细节**。

---

## 六、与 DSH 0.2.0-rc.2 的兼容性

| 项 | 状态 | 说明 |
|---|---|---|
| `node:sqlite` | ✅ 需核对 Node 版本 | Node ≥22.19 或 ≥24 才内置 |
| 插件工具注册 | ✅ 可用 | 与路径 A 同一套 cordis 机制 |
| `memory_*` 工具命名冲突 | ⚠️ 必查 | 多个记忆插件注册同名工具会互相覆盖 |
| 注入点 `systemPrompt.assemble` | ✅ 可用 | 与路径 A 相同 |

**装插件前先跑** `dsh --profile <name> --dump-config`，确认没有两个记忆插件同时挂载。

---

## 七、开发流程（照 Amadeus 的做法）

Amadeus 的流程可以直接平移，只需把"文件设计"换成"schema 设计"：

```
docs/research/
  01-prior-art.md        ← 先读 dsh-ltm / EverOS / basic-memory 的源码与设计
  02-schema-draft.md     ← 表结构、字段语义、迁移策略（明确"待定项"）
  03-retrieval-eval.md   ← 中文检索对照实验（默认分词 vs bigram），带数据
  04-implementation.md   ← 实现记录与偏差
docs/audits/             ← 每次发布的审计
```

**必须补的一环（Amadeus 没有、你需要）**：**检索评测**。知乎那篇设计文给了一组很实用的指标——召回率、精确率、新鲜度、成本、延迟；还有读/写路径各自的指标。先在 20–50 条真实记忆 + 30 个真实查询上跑出基线，再谈优化。

---

## 八、里程碑与验收

| 阶段 | 产出 | 验收标准 |
|---|---|---|
| M1（2 天） | schema + FTS5 + 迁移骨架 | 建库、写入、读出；schema 版本号落库 |
| M2（2 天） | CJK 分词 + 混合重排 | **对照实验**：bigram 相对默认分词器的命中率提升有数据 |
| M3（2 天） | 去重 + `revision` CAS | 并发写入测试：冲突返回结构化错误且不落盘 |
| M4（1 天） | 作用域隔离 | 两个 Git 仓库互不可见；linked worktree 共享 |
| M5（1 天） | 有界注入 + 字节稳定 | 同一会话内编辑记忆不改变已注入文本 |
| M6（1 天） | 陈旧清扫 + `doctor` | `doctor` 只读；陈旧报告按年龄分桶 |
| M7（1 天） | `export`/`import` | 导出再导入后，作用域与复核时间不丢 |

---

## 九、风险、许可证与退出策略

| 风险 | 影响 | 应对 |
|---|---|---|
| `dsh-ltm` 只有 1 star | 作者弃坑、无人修 bug | 只学其源码与设计，自己维护实现 |
| 分词效果不及预期 | 中文仍搜不准 | 先做 M2 对照实验再决定是否继续；不行就退回路径 A |
| 写入随库增长变慢 | 长会话卡顿 | 去重扫描限作用域 + 加采样上限，如实标注 |
| SQLite 并发 | 多会话 `SQLITE_BUSY` | WAL + `busy_timeout`；不做跨机同步 |
| 迁移把库写坏 | 数据丢失 | 迁移前 `VACUUM INTO` 做一致性备份，失败回滚（照 `dsh-ltm` 的做法） |
| 许可证 | basic-memory AGPL / sqlite-memory Elastic | 只用 MIT / Apache-2.0 的代码；AGPL 只借鉴文档 |

**退出策略**：`export` 出 JSON 即可导入路径 A 的文件或路径 C/D 的服务。**schema 是你的资产，不是枷锁**——但一定要先写好导出。

---

## 十、结论

**如果路径 A 让你痛在"搜不到"，就上路径 B。**

它解决的是三个实实在在的问题：中文检索、去重、陈旧。代价是失去"打开就能读"的爽感，以及要维护 schema 和迁移。

**但别指望装个现成的包就完事**——DSH 生态里这条路最强的实现只有 1 星。**正确姿势是：读 `dsh-ltm` 的源码学细节，自己实现核心，把 `EverOS` 当同哲学参考。**

**建议的组合**：路径 A 的**注入与快照**（已验证）+ 路径 B 的**存储与检索**（补短板）。这两者不冲突——文件负责"人可读的权威副本"，SQLite 负责"可检索的索引"，索引坏了可从文件重建。这其实就是 `EverOS` 和 `basic-memory` 都在用的结构。

---

## 十一、外部调研补充（2026-10-17）

**1. `scope` 增加 `site:<domain>` 维度（最重要的一条）。**

原来只有"全局 / 项目"，但有一类高频重复劳动不属于这两者：**固定站点的固定操作路径**——某校务系统怎么登录、某个课件站哪条路径能直达、哪些选择器有效、哪些坑要避开。

按域名沉淀这类**程序性记忆**，检索时按当前 URL 域名加权（先不加表，用 `scope` 前缀即可）：

| scope | 装什么 | 半衰期 |
|---|---|---|
| `global` | 用户偏好、通用约定 | 长 |
| `project:<sha>` | 项目事实、构建命令、坑 | 项目生命周期 |
| **`site:<domain>`** | **站点操作路径、有效选择器、登录方式、版本改版痕迹** | 中，站点改版后失效 |
| `task:<id>` | 一次性上下文 | 短，设 TTL |

**2. 抽取前剥离 `<private>…</private>`。** 注意是**入库之前**剥离，不只是"不索引"——否则原文还在库里。

**3. 写入前安全扫描。** 不可见 Unicode、提示词注入模式、凭据特征、外泄指令；在服务端做，与 `revision` CAS 同一事务边界。

**4. 计划文件不进库。** `PLAN.md` 属于工作区产物，不是记忆记录。如果把它也收进 `memories` 表，会迅速污染检索结果。

---

## 十二、外部调研补充之二（结构细节，2026-10-17）

完整规范见 [08-结构细节补齐与CSDN文章取舍.md](08-结构细节补齐与CSDN文章取舍.md)。落到 schema 上是三处：

**1. `memories` 表加 `kind` 列**（`fact` | `exp`），并与 `scope` 一起建复合索引：

```sql
ALTER TABLE memories ADD COLUMN kind TEXT NOT NULL DEFAULT 'fact'
  CHECK (kind IN ('fact','exp'));
ALTER TABLE memories ADD COLUMN kind_meta TEXT;   -- exp 的日期、fact 的 verified 日期
CREATE INDEX idx_mem_scope_kind ON memories(scope, kind, revision);
```

`exp` 必须带日期（`kind_meta` 里存 `observed_at`），否则写入拒绝；`exp` 合计字符数超 40% 配额时拒绝新增。

**2. 检索加两件东西**：

```
1) 多路融合用 RRF：score += 1 / (rank + 60)
   再取 top-3k，做 MMR 去重（λ=0.7），截到 top-k
   —— 防止 5 条近似经历占满名额（我们目前完全没有这层）
2) 打分带时间衰减，且两类用不同半衰期：
   final = 0.6*relevance + 0.25*recency + 0.15*confidence
   recency = 0.5 ** (age_days / half_life)
   half_life: fact=90d, exp=30d
```

注意：**不要用阶梯式折扣**（如"超过 7 天乘 0.8"），用连续衰减；`[fact]` 与 `[exp]` 半衰期不同正是拆 type 的收益。

**3. `strategy` 另立一张表**（不要和 `memories` 混）：

```sql
CREATE TABLE strategies (
  id            TEXT PRIMARY KEY,
  claim         TEXT NOT NULL,
  scope         TEXT NOT NULL,
  evidence_ids  TEXT NOT NULL,     -- JSON 数组，必须都存在于 memories
  session_count INTEGER NOT NULL,  -- 由证据反算，模型不得填
  confidence    INTEGER NOT NULL CHECK (confidence BETWEEN 1 AND 3),
  status        TEXT NOT NULL DEFAULT 'active',  -- active|contested|retired
  created_by    TEXT NOT NULL,     -- human|distill-confirmed
  counterexamples TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  last_validated TEXT
);
```

**关键约束**：`confidence` 由 `evidence_ids` 的数量与会话数**算出**；`distill-confirmed` 必须有 ≥2 条跨会话证据；strategy **不进默认注入**，只通过 `strategy_search` 按需取。
