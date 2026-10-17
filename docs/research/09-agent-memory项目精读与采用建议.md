# 09 · `agent-memory` 项目精读与采用建议

> **输入文章**：`blog.csdn.net/gitblog_00590/article/details/163172646`（《agent-memory 写入操作详解：record、supersede、merge 与 delete》）
> **核心判断先行**：**文章是三篇里信息量最低的（SEO/AIGC 搬运），但它指向的项目是三篇里唯一值得动手的。** 价值在项目，不在文章。
> **核验时间**：2026-10-17

---

## 一、先给文章定性

| 项 | 情况 |
|---|---|
| 账号性质 | `gitblog_00590` —— CSDN 的 GitCode/GitHub 项目自动搬运号 |
| 文章形态 | 项目文档改写 + 「【免费下载链接】」导流 |
| 文末自述 | **「创作声明：本文部分内容由 AI 辅助生成（AIGC）」** |
| 与上游一致性 | 大体一致；但**「`mem gc` 是唯一物理删除入口」这条我在 README 与设计文档中未直接找到**，需看源码确认（标为待核） |

**所以：不要把这篇文章当"教程"读，把它当"索引"读**——它指向了 [`tigerless-labs/agent-memory`](https://github.com/tigerless-labs/agent-memory)。

---

## 二、上游项目核实（GitHub API 实抓）

| 项 | 值 |
|---|---|
| 仓库 | [tigerless-labs/agent-memory](https://github.com/tigerless-labs/agent-memory) |
| Stars | **4,004** |
| License | **MIT** |
| 语言 | Python |
| 创建 | 2026-09-01 |
| 最近推送 | **2026-10-16**（活跃） |
| 定位（原文） | "Long-term memory runtime for AI agents — **plain Markdown as the source of truth**, local ranked retrieval, and an independent **sleep-time Manage layer**. Claude Code and Codex share one store. **No API key**." |
| 关联项目 | [mcncarl/agent-memory-vault](https://github.com/mcncarl/agent-memory-vault)（313★, MIT, Markdown-first shared vault） |

**这是我们这一路调研里，第一个同时满足"与路径 A 同哲学 + 成熟到可以信任 + 设计比我们现有文档更细"的项目。** 之前看过的：Amadeus 无许可证且 3★、`dsh-ltm` 1★、basic-memory 是 AGPL。**只有这个可以既读代码又放心借鉴。**

---

## 三、可直接采用的九条（按价值排序）

### ① `MEMORY.md` 只做索引，不做内容 —— 直接缓解容量硬墙

它的存储布局（README 原文）：

```
$AGENT_MEMORY_STORE/
├── MEMORY.md          root index, one line per memory — the only resident injection
├── schemas/           one file per type: key fields, grouping field, write mode
├── decision/<group>/  真正的记忆正文，一记忆一文件
├── archive/provenance/ 蒸馏证据，永久保留
├── archive/sessions/   完整轨迹副本
├── dream-reports/      每次 sleep 的报告：移动了什么、提议了什么
├── .index/             content-hash manifest + FTS5 + access log（可重建）
└── .state/             蒸馏水位、写锁
```

**关键一句**：`MEMORY.md` 是 "root index, one line per memory — **the only resident injection**"。

**这和我们现在的设计是根本不同的取舍**：

| | 我们现在的方案 | agent-memory |
|---|---|---|
| 常驻注入 | 全部条目正文（受 10000 字符限制） | **只有索引，一行一条** |
| 正文 | 就在注入里 | 按需读取 |
| 容量 | 硬墙，满了要删 | 索引很少满，正文不受注入预算约束 |

**这是对我们最直接有用的改进。** 我们一直卡在"10000 字符装不下"，而它的答案是：**别把正文放进注入**。

**但要看清代价**：索引 + 按需读取 = 多一跳；如果检索失灵，记忆就"不在场"。所以我的建议是**分档**：

| 记忆规模 | 建议 |
|---|---|
| ≤ 30 条 | 直接注入正文（现在这样更简单，零额外跳数） |
| 30–200 条 | **混合**：`[fact]` 短条目直接注入（它们通常一两句话），长正文与 `[exp]` 只给索引行 |
| > 200 条 | 全索引 + 按需读 |

**混合档最适合你**：事实短、经历长，正好一个注入、一个索引。

### ② 权限分级：T0 自动 / T1 提案 —— 比"全确认/全自动"二元更好

README 原文：

> "Sleep-time consolidation with **authority tiers**: an unattended pass **may add and update, deletion only ever arrives as a proposal you confirm**."
> "Manage … **cannot delete anything unattended**."

命令形态：
```
mem sleep              # T0 applies, T1 files a proposal
mem proposals          # what is waiting on you
mem decide <id> --accept
```

**这是本轮最重要的一条**，因为它解开了我们文档里的一个二元困境：我们此前只给了 `memory_confirm`（每次都问）与 `memory_direct`（全自动）两个极端。

**实际应该是三档**：

| 档 | 谁执行 | 适用动作 |
|---|---|---|
| **T0 自动** | 无人值守即可 | **新增**（可回滚）、**更新**（保留旧版）、**精确去重合并** |
| **T1 提案** | 系统提议、人确认 | 删除、基于**相似度**的合并、拆分、跨作用域移动 |
| **T2 仅人工** | agent 完全无入口 | 物理清理、策略变更、清空 |

**关键在于"新增与更新可以自动，删除只能提案"**——因为新增和更新都是可回滚的（旧版还在），删除才不可逆。

这条比我们现有的设计更成熟，**应当替换 06 里"确认 / 不确认"的二元表述**。

### ③ 有效性区间 + `recall --as-of` 时间旅行

设计文档原文：

> "The presence of `invalid_at` ends a memory's current validity. Its retained file and `valid_from`/`invalid_at` interval serve historical queries; `superseded_by` records a replacement link. … Current indexes and MEMORY.md project only files whose interval has no end."

于是可以做：`mem recall "数据库选型" --as-of 2026-09-01` —— **"半年前的记忆长什么样"**。

**我们缺这个**。我们有 Git 历史（能看 diff），但没有**查询原语**："在 9 月 1 日，agent 相信的是什么？" 这在排查"它为什么做错了"时是决定性的。

**落点**：`[fact]`/`[exp]` 条目加 `valid_from` / `invalid_at` / `superseded_by`；`memory` 工具加 `as_of` 参数；注入永远只用"未失效"的条目。

### ④ 精确的"重复"定义：相似度不得自动合并

设计文档原文：

> "**T0 duplicate supersession requires identical parsed abstract and body, type, all semantic fields, effective validity start, author, relationships and provenance.** Text comparison preserves Unicode, case, order, repetition, punctuation and internal whitespace. Names, paths, weights and bookkeeping timestamps do not establish semantic identity. The oldest duplicate remains active… **Similarity alone belongs to the reviewed proposal path.**"

**这段话回答了我们一直没定清楚的问题：什么叫"重复"。**

它的答案是二元且清晰的：

| 判据 | 处置 |
|---|---|
| **所有语义字段完全一致**（含 Unicode/大小写/顺序/标点/内部空白） | T0 **自动合并**，保留最旧的一条，其余指向它 |
| **仅相似** | **只走人工评审的提案路径**，绝不自动合并 |

**这正好呼应我们已核实的论文结论**：失效模式是"把相似的东西说成同一件事"。**"相似度只走人工"是那条结论的工程实现。**

**落点**：我们此前写的"近重复检测阈值（Jaccard / 余弦）"应当降级——**阈值只用来产生提案，不用来自动合并**；自动合并只认全等。

### ⑤ 写锁要覆盖"读—校验—持久化—投影"全过程

设计文档原文（这条是我们漏的）：

> "Correction is a read-modify-write operation… **Concurrent corrections can silently discard one another when either reads before acquiring the store's writer lock.**"
> "The Store holds **one writer lock from the correction read through validation, persistence, and projection**."

**我们的文档只写了"改前必须先读 + 服务端版本 CAS"，但没写锁的范围。**

它指出的坑很具体：**如果"读"发生在拿锁之前，两个并发修改会互相静默丢弃**——CAS 也可能被绕过，因为双方读到的都是旧版本。

**落点**：锁必须在**读之前**获取，并一直持有到投影更新完成。这是一条实现级硬约束，写进 06。

### ⑥ CLI 与 MCP 必须暴露同一操作，不得各定规则

原文：

> "**CLI and MCP must expose the same operation rather than define separate rules.**"
> "Both adapters expose these explicit operations."

我们有同样的风险：`memory` 工具、CLI、可能未来的 MCP 出口——**三套入口三套规则，就是三条绕过路径**。

**落点**：所有入口只做参数转录，行为全在 Store/服务一层（与 06 的 L1 一致，但这里给了明确的"多适配器"表述）。

### ⑦ "enforced by a test, not promised in a doc"

README 原文：

> "`rm -rf .index/ && mem rebuild` loses zero knowledge — **enforced by a test, not promised in a doc.**"

**这句话就是 06 那一整篇的浓缩版。** 它把"索引可重建"从一个说法变成了一个**会失败的测试**。

**可以直接引用作 06 的题眼。**

### ⑧ 捕获由系统保证，不由模型裁量

> "**Write coverage is the system's job, not the agent's judgement.** Distillation is triggered at boundaries and runs without holding up the task; **the full trace is copied first**, so 'missed by the distiller' never means 'lost by the system'."

**这是对我们"值守子代理产出候选"那条的升级**：光有候选还不够，**要先把完整轨迹落盘**，这样"蒸馏漏了"不等于"信息丢了"。

**落点**：路径 A 的 `archive/sessions/` 等价物——**原始轨迹必须先拷，再做任何蒸馏**。顺序不能反。

### ⑨ 库内不内置 LLM 客户端

> "**No LLM client inside the library.** Zero keys to install and no billing surface: judgement is borrowed from the host agent's own CLI, **which keeps every write visible in your transcript**."

两个好处：**零 API key**（和我们"零外部依赖"一致）+ **每次写入都出现在会话记录里**（天然可审计）。

**这比"库内偷偷调模型"好得多**——后者正是 Hermes 后台复盘被诟病的地方。

---

## 四、需要打折扣的地方

**1. 基准不要当营销数字读。** README 自己写得很清楚（这点值得称赞）：

> "Measured on LongMemEval-S with a **bounded haystack**, 120 episodes… **Absolute numbers are not comparable to published LongMemEval scores** — the haystack is bounded to 12 sessions per episode, which makes this a **write-strategy study** rather than a corpus-size one."

它给出的是 52.9% vs MemCore 35.8% vs 无记忆 5.8%，并**附了配对比较的计数与 p 值**。方法上比前两篇 CSDN 文章严谨得多——**但它是"写入策略"研究，不是"整体更强"的证明**。

**2. 它面向 Claude Code / Codex，不是 DSH。** 集成方式是 lifecycle hooks + MCP server。接到 DSH 需要：MCP 客户端（DSH 有）+ hooks 的等价物（DSH 的 `agent/pre-step`、`systemPrompt.assemble` 可覆盖）。**不是零成本移植。**

**3. 一条待核**：文章的「`mem gc` 是唯一物理删除入口」在 README 与 `management-operation-boundaries.md` 中**未直接出现**。上游确实说"unattended 不能删"，但 `gc` 这个具体命令名需读源码确认。

**4. 它的 schema 体系（按 type 分目录、字段来源 menu/system）比我们需要的重。** 个人记忆用不到"自定义 schema + 字段来源规则"，这部分不必抄。

**5. `MEMORY.md` 只做索引对"小记忆量"是过度设计**——见第三节①的分档建议。

---

## 五、对我们四条路径的具体改动

| 文档 | 改什么 |
|---|---|
| `路径A` | ① 注入分档（≤30 全注入 / 30–200 混合 / >200 全索引）；② 条目加 `valid_from`/`invalid_at`/`superseded_by`；③ 加 `archive/sessions` 先落盘再蒸馏；④ 三档权限（T0/T1/T2）替换二元的"确认/不确认" |
| `路径B` | ① "近重复阈值"降级为**只产生提案**，自动合并只认全等；② 写锁覆盖读—校验—持久化—投影全程；③ 支持 `as_of` 查询（按 validity 区间过滤历史投影） |
| `06` | ① 用 "enforced by a test, not promised in a doc" 作题眼；② L1 增加"锁必须在读之前获取"；③ 权限从二元改三档；④ 补"多适配器同一行为"（CLI/MCP/工具不得各定规则） |
| `00-总览` | 在"可复用项目"表里把 `tigerless-labs/agent-memory` 列为**路径 A 的首选参照实现**（4,004★ MIT 活跃），替代原来的 Amadeus（无许可证、3★） |

---

## 六、一句话结论

**前两篇 CSDN 是"读读可以，别照做"；这一篇是"文章别信，项目去读"。**

`tigerless-labs/agent-memory` 是目前唯一一个**和你的路径 A 同哲学、成熟度够、且设计细节比我们现有文档更硬**的实现。最该抄的三条：**索引与正文分离、三档权限（增改可自动、删除只提案）、相似度只走人工评审**。

它那句 "enforced by a test, not promised in a doc"，正好是你上一轮要求的完整注脚。
