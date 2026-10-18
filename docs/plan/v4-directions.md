# V4.0 方向调研：从本地记忆工具到可信记忆层

> 状态：调研稿（V4 未立项） · 日期：2026-10-18 · 基线：Agent Memory 0.2.1（V3.2）
> 方法：读 `docs/plan/todo.md`、`open-questions.md`；浅克隆并阅读 5 个成熟项目的代码/文档（见 §9）；`web_search` 补充产品资料。

## 0. 结论先行

1. **待办与开放问题已基本清空**：todo 仅剩 T9/T10/T13（V1.1 顺延/接受），open questions 仅 Q4/Q8 顺延到 V1.1；V4 不应再围绕这些边角。
2. **我们的护城河是“可信”**：不可变记录、提案人审、provenance、append-only journal、规则封存、本地 Markdown。Mem0 / Basic Memory / Graphiti / Letta / claude-mem 都没有把“人审批 + 可审计”做成默认写入路径。
3. **最大短板是“记忆质量与互操作”**：我们只有 BM25；对手已有 hybrid（向量+BM25+实体/图）、时序失效、评测集；且 claude-mem 已提供 **DSH 原生插件**（`@claude-mem/dsh`），正面竞争。
4. **建议 V4.0 = 质量 + 互操作 + 轻结构**，不做云/团队为主：
   - 检索：可选本地 embedding + hybrid + rerank + 评测；
   - 结构：显式关系、时序失效、冲突提示（文件格式 v1.4，向后兼容）；
   - 互操作：统一 Memory API + MCP 标准工具 + 从 Mem0/Basic Memory/Claude-Mem 导入；
   - 保持：人审、provenance、封存、本地优先。
5. 预估 **24–34 人日**；团队/云同步放 V4.1 或更后。

## 1. 现状盘点

### 1.1 待办（todo.md）

| 项 | 状态 | V4 处理 |
|---|---|---|
| T9 home junction realpath | 顺延 V1.1 | 可并入 V4 安全/运维小项 |
| T10 锁 PID 复用 | 顺延 V1.1 | 保持“超时失败、不覆盖”，不阻塞 V4 |
| T13 目录 fsync | 接受 | 不承诺断电零丢失，继续靠备份 |
| 其余 T1–T18 | 完成 | — |

### 1.2 开放问题（open-questions.md）

- Q1–Q3、Q5–Q7、Q9：已解决；
- Q4（PID 复用）、Q8（junction realpath）：顺延 V1.1，建议在 V4 的“安全/运维”里顺手关掉。

**判断**：V4 不需要“补债”，需要选新战场。

## 2. 调研方法与样本

本机 `web_fetch` 对 GitHub/多数站点被 DNS 策略阻断；`git ls-remote` 可用但 `git clone` 因 schannel 凭据失败。解决方式：

```powershell
git -c http.sslBackend=openssl -c credential.helper= clone --depth 1 <repo>
```

已克隆并阅读（2026-10-18）：

| 项目 | 版本/提交 | 定位 |
|---|---|---|
| Mem0 | `0724291`（2026-10-14） | 托管/OSS 记忆层，SDK + 平台 |
| Basic Memory | `a72751c`（2026-10-15） | 本地 Markdown + 知识图谱 + MCP，含 Cloud/Teams |
| Graphiti（Zep） | `417c3a1`（2026-10-17） | 时序知识图谱框架 |
| Letta（MemGPT） | `5bcdd17`（2026-09-10） | 有状态 Agent 框架，memory blocks |
| claude-mem | `b85cd12`（2026-10-17，v14.0.1） | 会话记忆压缩 + 多 IDE 插件，**已含 DSH 原生插件** |

产品层补充：WorkBuddy（腾讯办公智能体，闭源）、ChatGPT/Claude 内置记忆（不透明、不可导出为主）。

## 3. 对比矩阵

| 维度 | Agent Memory（我们） | Mem0 | Basic Memory | Graphiti/Zep | Letta | claude-mem |
|---|---|---|---|---|---|---|
| 存储 | 一条记忆一个 MD + journal | 向量库/托管（可自托管） | Markdown + SQLite 图 | 图数据库（Neo4j/FalkorDB 等） | 框架内部/Postgres | SQLite + Chroma |
| 本地优先 | ✅ 纯本地、可读可 diff | ⚠️ 自托管或云 | ✅ 本地 + 可选云 | ⚠️ 需图库 | ⚠️ 需服务 | ✅ 本地 worker + 云选项 |
| 写入模型 | **提案 → 人审批**；不可变 + provenance | LLM 单遍 ADD-only，自动累积 | 双向写文件，无审批 | 增量抽取，自动失效 | Agent 自己编辑 memory block | hooks 自动捕获/压缩 |
| 审计 | journal 哈希链 + 封存 | 平台审计有限 | 文件历史/git | episodes 溯源 | 有限 | 会话/观察记录 |
| 检索 | BM25 + 字面 | 向量 + BM25 + 实体融合 | 全文 + 向量 + hybrid + rerank | 语义 + 关键词 + 图遍历，双时序 | 语义/块 | FTS5 + Chroma hybrid |
| 时序 | `valid_from/until` + supersedes | 时间感知排序 | 笔记时间戳 | **双时序、自动失效** | 有限 | 时间线 |
| 关系 | 仅 supersedes | 实体链接 | wikilink 知识图谱 | **实体/关系图** | 块 | 观察/会话 |
| 评测 | 自有 250+ 测试；无公开 benchmark | LoCoMo 92.5 / LongMemEval 94.4 | 部分 benchmark | 论文/基准 | 有限 | 自有 |
| 集成 | DSH 插件 + MCP + CLI + GUI | SDK/API/多框架 | MCP + 多 IDE + 云 | 框架/云 | 框架/ADE | **多 IDE + DSH 插件** |
| UX | DSH 侧栏工作台、提案卡、手写 | 平台 dashboard | Web/Cloud/Obsidian | 开发者框架 | ADE | Web viewer + My Work |
| 治理 | **规则封存、只读模式、人审** | 弱 | 弱 | 中（企业） | 弱 | 弱 |
| 许可 | MIT | Apache-2.0（OSS） | AGPL-3.0 | Apache-2.0 | Apache-2.0 | Apache-2.0 |

## 4. 差距分析

### 4.1 我们领先的

- **人审写入**：提案 + GUI/聊天卡决定，`decide` 不是模型工具；对手默认自动写。
- **可审计**：journal 哈希链、snapshot、封存；删除/修订有据可查。
- **本地文件即真相**：Markdown 可直接读、diff、git；导出 JSON 可恢复。
- **DSH 原生**：侧栏工作台 + `/api` 同源路由 + preset/只读模式，比通用 MCP 更贴合宿主。
- **安全边界**：SOUL 不编辑、RULES 仅 GUI 保存、MCP 无 decide/record。

### 4.2 我们落后的

1. **检索质量**：只有 BM25；无 embedding/rerank/实体，长对话召回弱。
2. **记忆结构**：只有 supersedes；无实体/关系、无自动冲突检测、无衰减/巩固。
3. **评测**：没有公开基准（LongMemEval/LoCoMo/BEAM），无法证明“记得准”。
4. **互操作**：只能导入自家 JSON；没有 Mem0/Basic Memory/Claude-Mem 迁移；MCP 工具是自定义子集。
5. **规模**：文件扫描 + 内存索引，几千条后性能未知；无 SQLite/向量后端选项。
6. **多端/团队**：单机单用户；对手已有 Cloud/Teams（Basic Memory）、托管（Mem0/Zep）。
7. **产品化**：无自动更新/签名、无 i18n、无使用分析；claude-mem 的安装器/多 IDE 更成熟。
8. **竞争压力**：claude-mem 已发 `@claude-mem/dsh`（first-party DSH 集成），会直接抢 DSH 用户。

## 5. V4 候选方向

### A. 检索质量与评测（P0，建议必做）

- 可选本地 embedding（ONNX/FastEmbed 类，零 API key），失败回退 BM25；
- hybrid 融合（RRF/加权）+ 可选 rerank（小模型或 cross-encoder，本地）；
- 查询改写/同义扩展、类型/日期/来源过滤；
- **评测工具**：内置 LongMemEval 子集 + 自有 fixture，输出 recall@k / answer correctness / token cost；
- “为什么召回”解释：命中词/向量分数/来源，GUI 可看。

**价值**：直接决定“AI 记不记得住”，也是对手最硬的指标。**风险**：本地模型体积/性能；用可选依赖 + 回退控制。

### B. 记忆结构：关系、时序、冲突（P1）

- 记录间显式关系（`relates_to`/`contradicts`/`derived_from`），仍存 Markdown frontmatter；
- 时序：自动 `valid_until`、冲突检测（同一实体/主题的新旧事实），提示人合并/失效；
- 巩固：把多条相似经验聚类成“主题”，生成候选摘要（仍走提案）；
- GUI：时间线、关系图（可选）、冲突面板；
- 文件格式 v1.4，旧记录自动兼容。

**价值**：从“条目堆”变“可推理的记忆”；**风险**：过度设计；先做关系+冲突，图数据库不做。

### C. 多端/团队/同步（P2，建议 V4.1）

- 命名空间/scope（个人/项目/团队）、权限、共享只读；
- 可选同步（文件同步/Git/自建服务），冲突合并策略；
- 多 agent provenance（谁写的、哪个宿主）。
- **不建议 V4.0 做云**：会稀释本地优先与可信卖点。

### D. 互操作与标准（P0/P1）

- 统一 **Memory API v1**（已有雏形）+ 稳定 JSON schema；
- MCP 工具对齐社区记忆服务器（search/read/add/propose），保留 decide 人审；
- 导入适配器：Mem0 JSON、Basic Memory Markdown、Claude-Mem 导出；
- 导出：Markdown + JSON + 可选 JSONL；
- DSH / Codex / Cursor / Claude Code 四端适配矩阵与测试。

**价值**：降低迁移成本、扩大入口；**风险**：格式碎片化，需版本化契约。

### E. 产品体验（P1，持续）

- 首启引导、记忆健康面板（活跃/待审/冲突/预算）、批量操作、diff/merge；
- “为什么注入这条”解释、token 预算可视化；
- 命令面板、快捷键、i18n（中/英）；
- 安装器/自动更新/签名（V3.2 已有基础）。

### F. 安全与运维（P1/P2）

- 加密 at rest（可选，密钥本地）、PII 脱敏策略、保留期/自动清理；
- 备份校验/恢复演练自动化；崩溃恢复；
- 审计查询 UI；发布签名与 SBOM。

## 6. 推荐 V4.0 范围（三支柱）

> 主题：**“记得准 + 说得清 + 带得走”**，不改变人审与本地优先。

1. **检索质量（A）**：本地 embedding 可选、hybrid、rerank、评测 harness；目标 LongMemEval 子集 recall@5 提升 ≥15%，token 成本不升。
2. **互操作（D）**：Memory API v1 + MCP 标准工具 + 三类导入 + 四端适配；导入/导出 roundtrip 100%。
3. **轻结构（B-lite）**：关系字段 + 冲突提示 + 时间线；不做图数据库、不做自动改写。

**不做**：云同步、团队权限、移动端、自动写入默认开启、向量库强依赖。

### 4.x 路线

| 版本 | 内容 | 人日 | 出口 |
|---|---|---|---|
| V4.0 | A + D + B-lite | 18–24 | 评测提升、导入 roundtrip、冲突提示 |
| V4.1 | 团队/同步（C） | 12–18 | 共享 scope、冲突合并、权限 |
| V4.2 | 安全/运维（F）+ 产品化（E） | 8–12 | 加密、审计 UI、i18n、自动更新 |
| V4.3 | 生态/插件市场 | 8–12 | 第三方 adapter、模板 |

### 验收指标

- 检索：LongMemEval 子集 recall@5、answer correctness、平均 token/查询；
- 结构：冲突检测 precision/recall（人工标注 50 例）；
- 互操作：三类导入 + 导出 roundtrip；MCP 四端握手；
- 可信：所有写入仍有 journal + provenance；`decide` 仍非工具；规则仍仅 GUI 保存；
- 性能：1000/5000 条列表与召回 P95。

## 7. 待拍板

1. V4.0 是否按“质量+互操作+轻结构”，还是先做团队/云？
2. 本地 embedding 是否接受额外依赖/模型体积（约 50–200MB）？还是只做 BM25+rerank？
3. 是否引入公开评测集（LongMemEval 子集）与基线分数？
4. 是否做图/时间线 UI，还是只做冲突面板？
5. 导入优先级：Mem0 / Basic Memory / claude-mem 谁先？
6. 团队/云是否永远不做，还是 V4.1 可选自建同步？

## 8. 对现有架构的影响

- 数据格式 v1.4：新增 relations/valid_until 自动维护，旧记录兼容；
- `MemoryPort` 接口（V3 审核提出）在 V4.0 落地，SQLite/向量后端可作为可选实现；
- 段注册表、能力组、GUI API、MCP 契约继续复用；
- 人审与封存不放松：自动抽取只能生成提案，不能直接落库。

## 9. 来源

- Mem0：https://github.com/mem0ai/mem0（克隆 `0724291`；README 的 ADD-only/hybrid/temporal/benchmark）
- Basic Memory：https://github.com/basicmachines-co/basic-memory（`a72751c`；ARCHITECTURE、NOTE-FORMAT、README）
- Graphiti：https://github.com/getzep/graphiti（`417c3a1`；双时序/图检索/episodes）
- Letta：https://github.com/letta-ai/letta（`5bcdd17`）
- claude-mem：https://github.com/thedotmack/claude-mem（`b85cd12`，v14.0.1；含 `dsh/` 原生插件）
- WorkBuddy / 内置记忆产品：`web_search` 摘要（未逐页打开）
