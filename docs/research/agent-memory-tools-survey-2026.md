# Agent 长期记忆：可复用开源工具 / MCP / Skill 选型清单

> 调研时间：2026-10-12（所有时间戳均为实际抓取所得 UTC 时间）
> 调研方式：`web_search` + `web_fetch`，优先抓 GitHub 原始文件（`raw.githubusercontent.com`）、GitHub Atom feed（`releases.atom` / `commits/main.atom`）、npm/PyPI registry API、Go module proxy，以及各厂商官方文档。
> **说明**：GitHub REST API 在本次调研中触发未认证限流（HTTP 403），部分 star 数取自限流前成功抓取的一批，其余标注为「未核实」。

## 阅读约定（请严格遵守）

- ✅ **查证到的事实** = 本次实际抓取到的原文内容或时间戳。
- ⚠️ **推测** = 我基于事实的推断，未经直接证据支持，已显式标注。
- ❓ **未核实** = 尝试抓取但失败，或该维度在原始资料中不存在，不做猜测。

---

## 0. 先说结论（TL;DR）

**你的架构不是孤例，而是与三个成熟产品高度同构。** 这是本次调研最重要的发现：

| 你的设计 | 已有同构实现（均为查证到的事实） |
|---|---|
| `SOUL.md` / `USER.md` / `MEMORY.md` 单文件 Markdown | **OpenClaw** 官方文档：`USER.md`（稳定偏好，独立小预算）+ `MEMORY.md`（长期事实）+ `memory/YYYY-MM-DD.md`（工作层） |
| 单文件上限 10000 字符 | **Claude Code auto memory**：`MEMORY.md` 只加载前 200 行或前 25KB，超限时**写入仍成功但返回错误要求重写索引**；**opencode-agent-memory**：frontmatter `limit` 软预算（默认 5000 字符），超限块在下次会话快照标记 `over_limit` |
| `memory` 工具 add/replace/remove（字面匹配 + 强制先读 + 版本冲突检测） | **opencode-agent-memory**：`memory_get` 返回磁盘当前值与 mtime；`memory_replace`「apply one or several exact replacements atomically」；**basic-memory** `edit_note` |
| 五个会话检索工具（跨会话搜索 / 会话内搜索 / 读原文 / 替换链 / 谱系） | **ccrider**：`search_sessions` / `list_recent_sessions` / `get_session_messages`（支持 tail 模式与搜索命中上下文）；**claude-mem**：`search` → `timeline` → `get_observations` 三层渐进披露 |
| `MEMORY_GUIDANCE.md` 分段注入 | **OpenClaw** memory 文档的 "Action-sensitive memories"（何时可安全行动、批准边界、过期条件）；**opencode-agent-memory** 每块 `description` 字段注入「告诉 agent 如何使用该块」 |

**核心判断**：你手写的部分，**大部分有高度可复用的参考实现与规范文本，但没有任何一个现成工具能原样替换整套**。原因有三：
1. 所有现成 MCP memory server 都是**多文件或图数据库**模型，没有「单文件 + `§` 分隔符 + 硬字符上限」的原生支持 → **未找到成熟方案**（详见方向 4）。
2. 所有会话检索工具都**只索引特定产品的会话格式**（Claude Code / Codex / opencode…），**没有一个支持 DSH 的会话存储** → 可借鉴架构，不能直接替换。
3. 你架构中真正独特、值得保留的是**「改前先读 + 字面匹配 + 版本冲突检测」三者组合**。现成工具最多各覆盖其中两项。

**最省力的路径**：不要替换，而是**补强 + 抄规范**。详见第 7 节。

---

## 1. 方向一：MCP memory server

### 1.1 `@modelcontextprotocol/server-memory`（官方参考实现）— 最相关

- URL：<https://github.com/modelcontextprotocol/servers/tree/main/src/memory>
- License：**MIT**（该 server 的 `src/memory/README.md` 末尾明确写 "This MCP server is licensed under the MIT License"）。
  ⚠️ 注意陷阱：**仓库根目录的 LICENSE 已改为「MIT → Apache-2.0 迁移中」的混合文本**（原文：*"The MCP project is undergoing a licensing transition from the MIT License to the Apache License, Version 2.0… Contributions made by authors who originally licensed their work under the MIT License and who have not yet granted explicit permission to relicense remain licensed under the MIT License."*）。所以 GitHub API 返回 `NOASSERTION`。**以 server 子目录的 MIT 声明为准**。
- 活跃度：✅ 活跃。仓库最近提交 `2026-10-11T05:10:42Z`；最近 release `v1.0.0`（`2026-10-11T02:25:14Z`）；npm `@modelcontextprotocol/server-memory` 最新版 **1.0.0**，发布时间 `2026-10-11T02:42:27Z`（npm registry API 实测）。仓库 star 数 **91,166**（限流前实测，指整个 servers 仓库）。
- 存储介质：**单个 JSONL 文件**（`MEMORY_FILE_PATH`，默认 `memory.jsonl`）。
- 是否需要外部服务：**不需要**。`npx` 或 Docker 单进程即可；无 embedding、无向量库、无外部 API。
- 接口设计（9 个工具，全部查证自 README）：
  `create_entities`、`create_relations`、`add_observations`、`delete_entities`、`delete_observations`、`delete_relations`、`read_graph`、`search_nodes`、`open_nodes`。另暴露 MCP Resource `memory://knowledge-graph`（完整图 JSON），变更工具会发 `notifications/resources/updated`。
- **并发控制值得单独学习**（这是查证到的、你可能会忽略的细节）：每次写操作会在记忆文件旁取一个独占锁文件 `<memory file>.lock`；持锁期间每 15 秒刷新；崩溃遗留的锁若同机进程已退出会立即清理，否则 30 秒无刷新后由一个等待者（经 `.lock.break` 守卫）打破；60 秒内拿不到锁则**工具报错而不是覆盖文件**。注释明确说该机制依赖本地文件系统的独占创建语义，**网络文件系统不安全**。
- 能力边界一句话：**本地单 JSONL 的实体-关系-观测知识图谱，零依赖零外部服务，但它是图模型而非 Markdown 记忆文件，`search_nodes` 只做字段子串匹配，不具备「字面替换 + 先读后写 + 版本冲突检测」语义。**

⚠️ 推测：官方 README 明确说 *"The prompt for utilizing memory depends on the use case. Changing the prompt will help the model determine the frequency and types of memories created"*，并给出了一段示例 system prompt（分 4 步：User Identification / Memory Retrieval / Memory categories a–e / Memory Update）。**这段 prompt 可以直接当作你 `MEMORY_GUIDANCE.md` 的写作参照。**

### 1.2 mem0 的 MCP — ⚠️ 已归档，不要选

- `mem0ai/mem0-mcp`：License Apache-2.0，**`archived: true`（已归档）**，最后 push `2026-03-24T23:36:56Z`，star 663。
- `mem0ai/openmemory`：独立的本地 SQLite 记忆 MCP。License **MIT**，最后 push `2026-07-29T09:40:39Z`，star 98。
- **查证到的事实**：主仓库 `mem0ai/mem0`（Apache-2.0，star **67,037**，最后 push `2026-10-09T06:17:43Z`）当前的 README **已不再出现 "MCP" 或 "OpenMemory" 字样**（我实测抓取全文并 grep，只匹配到 License 一行）。
- 能力边界一句话：**mem0-mcp 已归档；OpenMemory 虽为本地 SQLite 且 MIT，但 star 极少、与 mem0 主仓库关系已断，作为长期依赖风险高。**

⚠️ 推测：mem0 官方很可能已把 MCP 能力内化到主库或改为云端服务，社区里流传的多个 "mem0 MCP" 包互相冲突（搜索中出现 `@iflow-mcp/mem0-mcp`、`pinkpixel-dev/mem0-mcp` 等多个第三方转发包）。**建议不要把 mem0 作为记忆 MCP 的选型。**

### 1.3 其他知识图谱型 memory server

| 项目 | URL | License | 活跃度（实测） | 存储 / 外部依赖 | 能力边界一句话 |
|---|---|---|---|---|---|
| `mcp-knowledge-graph` | [shaneholloman/mcp-knowledge-graph](https://github.com/shaneholloman/mcp-knowledge-graph) | MIT（第三方目录记载）❓ 本次未直接抓到 LICENSE 文件 | ❓ 未核实 | 本地知识图谱 JSONL | 官方 memory server 的社区维护演进版，聚焦本地开发；**本次未取得一手验证，仅列为线索** |
| `memento-mcp` | [gannonh/memento-mcp](https://github.com/gannonh/memento-mcp) | **MIT**（GitHub API 实测） | star **425**；最后 push `2025-10-27T15:04:50Z`；⚠️ 距今近 12 个月未更新 | **Neo4j 5.13+**（Docker 或 Desktop）；embedding 用**OpenAI API**（默认 `text-embedding-3-small`） | 功能最强的一档（实体/关系/观测 + `semantic_search` 混合检索 + 完整版本历史 `get_entity_history`），**但需要 Neo4j 服务 + OpenAI key，违反你「本地优先、无外部服务」的约束** |
| `mcp-memory-service` | [doobidoo/mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) | **Apache-2.0**（README badge + PyPI 实测） | ✅ 活跃：PyPI 最新 **11.15.0**，release `2026-10-03T16:07:55Z`，最后 push `2026-10-12T09:27:16Z`，star **2,010** | 可自托管：**SQLite / Cloudflare 等后端**；**embeddings 本地经 ONNX 运行**（README 原文 *"Embeddings run locally via ONNX — memory never leaves your infrastructure"*）；同时提供 REST API + MCP + CLI + dashboard，5ms 检索、带类型边的因果知识图谱（causes/fixes/contradicts）、自主整合 | 本地可跑、无云成本的持久记忆服务，**但它是「常驻服务 + 自有存储」模型，不是文件型记忆，也不管理你的 Markdown** |
| `graphiti`（Zep 家族） | [getzep/graphiti](https://github.com/getzep/graphiti) | **Apache-2.0**（GitHub API 实测） | ✅ 活跃：star **31,672**，最后 push `2026-10-11T20:51:03Z` | 时序知识图谱；通常需图数据库后端 | 实时时序知识图谱，面向生产级 agent；**重，且不是文件型记忆，不适合作为你单文件方案的替代** |
| `MemOS` | [MemTensor/MemOS](https://github.com/MemTensor/MemOS) | **Apache-2.0**（raw LICENSE 实测确认；GitHub API 亦返回 Apache-2.0） | ✅ 活跃：star **11,827**，最后 push `2026-10-10T07:55:31Z` | 记忆操作系统层，混合检索 | ⚠️ **注意**：该仓库描述里含 "**DeepSeek Harness support**" 字样，与你的环境直接相关，**建议单独深入评估** |

> ⚠️ **关于 MemOS 的特别提示**：仓库描述原文包含 *"with 35.24% token savings and DeepSeek Harness support"*。这是本次调研中**唯一一个在自述里明确提到 DSH 的记忆类项目**。我只抓到了 README，未验证其 DSH 集成的具体形态与质量，**建议你把它列为第一优先深入评估对象**。

### 1.4 第三方目录（省时间用，但数字不可信）

- [ArdurAI/agent-memory-almanac](https://github.com/ArdurAI/agent-memory-almanac) — 一本「agent 记忆工具年鉴」，收录 **15 个**工具，分 Tier A/B，每月更新一期（最新 `editions/2026-07.md`），内容 License **CC BY 4.0**。
- ⚠️ **可信度警告**：其表格中的 star 数**已被证明滞后**。例：表中 Mem0 记为 58,186，我实测为 **67,037**；表中 Basic Memory 记为 3,173，实测 **4,152**；表中 Graphiti 记为 27,220，实测 **31,672**。**请只用它做「有哪些工具」的索引，不要引用它的任何数字。**
- 它把一个类别命名为 **"MCP, markdown-native (1)"**，唯一成员是 Basic Memory — 佐证「Markdown 原生 MCP 记忆」确实只有极少选择。

---

## 2. 方向二：本地优先的单文件记忆层

### 2.1 `basic-memory` — Markdown 即真相 + 可重建索引（⭐ 最贴合你的理念）

- URL：<https://github.com/basicmachines-co/basic-memory>（文档：<https://docs.basicmemory.com>）
- License：**AGPL-3.0**（GitHub API 实测 `AGPL-3.0`；PyPI 实测 `AGPL-3.0-or-later`）。⚠️ **这是本清单中传染性最强的许可证，若你的 DSH 记忆层要分发或以服务形式暴露，需评估合规风险。**
- 活跃度：✅ 非常活跃。star **4,152**；最后 push `2026-10-12T13:52:52Z`（即调研当天）；PyPI 最新 **0.23.2**，release `2026-08-25T20:43:45Z`。
- 存储介质：**Markdown 文件是 source of truth**，配一个**本地 SQLite 索引**，「Just files plus a local SQLite index. **No servers required.**」（README 原文）。可选 Postgres 部署。
- 是否需要 embedding API：**不需要**。语义检索用 **FastEmbed 本地嵌入**（README：*"Hybrid full-text + vector ranking with FastEmbed embeddings, on SQLite or Postgres"*），可选本地 FastEmbed 交叉编码器重排，或 LiteLLM 支持的外部 provider。
- 接口设计（MCP 工具，查证自 README）：
  - 内容：`write_note`、`read_note`、`edit_note`、`move_note`、`delete_note`、`read_content`、`view_note`
  - 检索发现：`search_notes`、`recent_activity`、`list_directory`
  - 知识图谱：`build_context`（导航 `memory://` URL）
  - 项目：`list_memory_projects`、`list_workspaces`、`create_memory_project`、`delete_project`
  - Schema：`schema_infer`、`schema_validate`、`schema_diff`
  - 无 MCP 也能用 CLI：`basic-memory tool edit-note ...`
  - README 明确说所有工具都带 MCP behavior hints（read-only / destructive / idempotent / open-world）。
- **Markdown 语法约定**（这个可以整段抄给你的记忆文件格式）：每个文件是一个 Entity，含 `Observations` 与 `Relations`；frontmatter 为 `title` / `type` / `permalink` / `tags`；观测写成 `- [method] 内容 #tag`；关系写成 wiki 链接 `- pairs_well_with [[Target]]`，裸 `- [[Target]]` 与散文中的 `[[Target]]` 都归类为 `links_to`。
- 能力边界一句话：**目前最接近「Markdown 为真相 + 本地索引可重建 + 无需向量数据库」的成熟 MCP server，工具面覆盖读/写/编辑/检索/图谱/校验，但它的编辑粒度是 `edit_note` 的 append/prepend（README 明确描述）， ❓ 未证实支持「条目级字面替换 + 版本冲突检测」，且 AGPL-3.0 有传染性。**

### 2.2 `sqlite-memory` — SQLite 扩展形态的单文件记忆

- URL：<https://github.com/sqliteai/sqlite-memory>
- License：⚠️ **Elastic License 2.0（LICENSE.md 原文：*"Elastic License 2.0 (modified for open-source use)"*，Copyright © 2025 SQLite Cloud, Inc.）**。这**不是 OSI 认证的开源许可证**，属于 source-available，有商用/托管限制。GitHub API 返回 `NOASSERTION` 正是因为它是自定义文本。
- 活跃度：✅ 活跃。star **126**；最后 push `2026-07-21T12:26:19Z`（约 3 个月前）。
- 形态：**一个 SQLite 扩展（C 语言）**，不是独立服务。README 原文定位：*"Markdown based AI agent memory with semantic search, hybrid retrieval, and offline-first sync between agents."*
- 存储介质：**整个知识库放在单个可移植 `.db` 文件**里（README：*"Single File: Your entire knowledge base lives in one portable .db file"*）；Markdown 文件作为 source of truth 被摄入。
- 混合检索：**向量余弦相似度（经 `sqlite-vector`）+ FTS5 全文检索**。Markdown-aware chunking（md4c 解析器）保留语义边界。
- 是否需要 embedding API：**不需要**。本地经 **llama.cpp** 跑 GGUF 嵌入模型（如 `nomic-embed-text-v1.5`）；也可选远程 `vectors.space`（需免费 key）。README：*"Local-First: Run entirely on-device with local embedding models - no API costs, no latency, no data leaving your system"*。
- 依赖：SQLite + `sqlite-vector` 扩展（必需）+ `sqlite-sync`（可选，仅 agent 同步用）。
- 工程细节（值得学习）：内容哈希变更检测跳过未改文件、原子替换、删除清理；SAVEPOINT 事务保证摄入安全；**embedding 缓存**避免重复计算。
- **它的架构自述直接引用了 OpenClaw**：*"Inspired by OpenClaw's memory architecture, sqlite-memory implements what we believe will become the de facto standard for AI agent memory systems: **markdown files as the source of truth**."*
- 能力边界一句话：**把「Markdown 为真相 + 混合检索 + 本地嵌入」压进单个 .db 的最紧凑实现，嵌入成本为零，但 Elastic License 2.0 授权受限、star 数低（126）、且需要 SQLite 扩展加载能力（DSH 侧集成成本不低）。**

### 2.3 `opencode-agent-memory` — 与你的 memory 工具语义最接近（⭐ 强烈建议精读）

- URL：<https://github.com/joshuadavidthomas/opencode-agent-memory>
- License：**MIT**（LICENSE 文件实测确认）。
- 活跃度：✅ 较活跃。最后提交 `2026-09-22T19:15:07Z`（约 3 周前）。star ❓ 未核实（未抓取）。
- ⚠️ 自我定位：README 首行标注 **"Experimental"**，灵感来自 Letta 的 memory blocks。
- 形态：**opencode 插件**（非 MCP server），npm 包 `opencode-agent-memory`，要求 opencode ≥ v2.0.12。
- **块格式（这是与你 `§` 方案最直接的对照物）**：每个块是一个带 YAML frontmatter 的 Markdown 文件：

  | 字段 | 类型 | 默认值 | 说明 |
  |---|---|---|---|
  | `label` | string | 文件名 | 块唯一标识 |
  | `description` | string | 通用 | **告诉 agent 如何使用这个块**（README 强调「essential」，缺失则 agent 只拿到通用兜底文案） |
  | `limit` | integer | **5000** | 软性「进入上下文的字符预算」 |
  | `read_only` | boolean | false | 阻止 agent 修改 |

- 工具清单（5 + 3，查证自 README）：
  - `memory_list` — 列出可用块（label/description/大小）
  - `memory_get` — **读该块的磁盘当前值与修改时间**
  - `memory_set` — 创建或整体覆盖
  - `memory_replace` — **「Apply one or several exact replacements atomically」**（原子地应用一个或多个精确替换）
  - `memory_oversized` — 列出接近或超出软预算的块
  - Journal（可选）：`journal_write` / `journal_search` / `journal_read`，追加式 Markdown + YAML frontmatter，存 `~/.config/opencode/journal/`，语义检索用**本地嵌入 `all-MiniLM-L6-v2`**（*"no data leaves your machine"*）
- **超限处理策略（直接回答你的「上限 10000 字符」设计）**：README 原文 — *"Writes above `limit` succeed instead of forcing retry loops. Over-budget blocks are marked `over_limit` in the next session snapshot so the agent can compact them with `memory_replace` or intentionally raise the limit."*
  → **即：不硬拒绝写入，而是打标记让 agent 自己压缩。这与你的硬上限是两种哲学，值得对比取舍。**
- **缓存稳定性设计（你的方案可能缺失的一环）**：README — *"Cache-stable system context - Memory is frozen per session and refreshed after context compaction, so edits do not repeatedly invalidate the provider prompt cache"*；*"the injected snapshot stays byte-stable for prompt caching"*。
  → **这是「分段注入系统提示词」的一个关键工程细节：会话内快照字节稳定，避免每次编辑都击穿 prompt cache。**
- 默认种子块：`persona`（全局，行为风格）/ `human`（全局，用户偏好）/ `project`（项目级）— **与你的 SOUL / USER / MEMORY 三文件划分几乎一一对应。**
- 能力边界一句话：**在「Markdown 块 + 字符预算 + 精确替换 + 本地语义日志」这一层，它是与本项目重合度最高的开源实现（MIT、零外部服务），但它是 opencode 专用插件、非 MCP、且自述 experimental。**

### 2.4 底层检索积木（当你要自己实现混合检索时）

- [asg017/sqlite-vec](https://github.com/asg017/sqlite-vec) — License **Apache-2.0**（GitHub API 实测）；star **8,181**；最后 push `2026-05-18T06:50:45Z`。能力边界：**纯 C 的 SQLite 向量检索扩展，是「单文件 SQLite + 向量」路线的事实标准积木，但它只管向量存取，不含记忆语义、不含嵌入模型。**
- [sqliteai/sqlite-vector](https://github.com/sqliteai/sqlite-vector) — License **Apache-2.0**；star **1,180**；最后 push `2026-09-11T14:27:22Z`。能力边界：SQLite Cloud 家的向量扩展，是 `sqlite-memory` 的底层依赖。
- [langchain-ai/langmem](https://github.com/langchain-ai/langmem) — ❓ 本次未取得一手元数据（GitHub API 限流 403）。第三方年鉴记为 MIT / 1,496 star / Tier A，**数字不可信**。能力边界 ❓ 未核实：据第三方描述为 LangChain 生态的记忆原语层。
- 注：**`clawinfra/hybrid-memory`（搜索结果中出现）已归档（`archived: true`）且 star 为 0、无 License，不要选。**（GitHub API 实测）

---

## 3. 方向三：跨会话历史检索

> **本方向是五个方向中「成熟方案最多」的一个。** 但有一个共同硬约束：**全部只索引特定产品的会话格式，没有一个支持 DSH。**

### 3.1 `ccrider` — 最成熟的现成方案（⭐ 首选参考/复用对象）

- URL：<https://github.com/neilberkman/ccrider>
- License：**MIT**（README badge 明确 `License: MIT`，链接到 opensource.org/licenses/MIT）。
- 活跃度：✅ **非常活跃**。最新 release **v1.13.0**（`2026-10-05T21:55:21Z`）；此前 v1.12.0（`2026-08-25`）、v1.11.1（`2026-08-13`）、v1.11.0（`2026-08-11`）、v1.10.0（`2026-08-11`）；`commits/main.atom` 最新提交 `2026-10-09T19:02:01Z`；Go module proxy 实测 `@latest` = **v1.13.0 / 2026-10-05T21:55:21Z**。star ❓ 未核实。
- 存储介质：**单机 SQLite + FTS5 全文检索**；README 原文 *"Single binary - no npm, no pip, no dependencies"*（Go 编写）。
- 是否需要外部服务：**不需要**（唯一例外：Amp 提供商是云端，且默认关闭，需显式 `amp_enabled = true`，因为会把可检索文本下载到本地 SQLite）。
- **支持的会话来源（覆盖面最广）**：Claude Code（`~/.claude/projects/`）、Codex CLI（`~/.codex/sessions/`）、GitHub Copilot CLI（`~/.copilot/session-state/`）、OpenCode（`~/.local/share/opencode/opencode*.db`）、Pi（`~/.pi/agent/sessions/`）、Antigravity CLI/IDE/desktop（`~/.gemini/antigravity*/brain/`）、Amp（云端，默认关）。
- **MCP 工具（直接对应你的五个工具！）**：
  1. `search_sessions` — 跨所有会话内容全文检索，支持日期/项目/提供商过滤
  2. `list_recent_sessions` — 最近会话列表，可按项目或提供商过滤
  3. `get_session_messages` — **取某会话的消息（支持 tail 模式、以及搜索命中点的上下文）**
  4. `generate_session_anchor` — 生成唯一短语用于标记会话以便事后检索
  所有工具都支持 `provider` 参数。MCP server 对本地会话库为**只读**。
- 其他能力：交互式 TUI 浏览器（`/` 搜索、回车看完整对话、`p` 按项目过滤、`r` 用提供商原生 resume 命令原地恢复会话）、增量同步 `ccrider sync`、Homebrew cask 安装。
- 一个**重要运维情报**（README 原文 warning）：*"Claude Code auto-deletes session JSON files after 30 days by default. ccrider preserves all session content in its own database, but if you want the original files kept (for resume, etc.), add `"cleanupPeriodDays": 99999` to your `~/.claude/settings.json`."*
- 能力边界一句话：**目前覆盖面最广、且唯一同时具备「跨会话全文检索 + 会话定位 + 会话内消息展开（含命中上下文）」的开源工具，MIT、Go 单二进制、SQLite FTS5、自带 MCP，但 ✅ 明确只认那 7 家提供商的会话格式，DSH 会话不在其列，要用就得自己写 importer。**

⚠️ **推测（对项目有实际影响）**：ccrider 的 README 自述架构为「严格 core/interface 分离」，`pkg/ccsessions/` 是公开的 Claude Code 解析器 API，`internal/core/importer/` 承担导入。**如果其 importer 是可插拔的，加一个 DSH provider 可能是中等工作量；但这属于推测，需读源码确认。**

### 3.2 `claude-mem` — 三层渐进披露模式（架构最值得抄）

- URL：<https://github.com/thedotmack/claude-mem>（文档 <https://docs.claude-mem.ai>）
- License：**Apache-2.0**（LICENSE 首行实测 `Apache License / Version 2.0`；README 亦明确）。
- 活跃度：✅ **非常活跃**。最新 release **v13.35.0**（`2026-10-09T03:33:45Z`）；此前 v13.34.2（`2026-10-06`）、v13.34.1（`2026-10-06`）；最后提交 `2026-10-12T07:06:14Z`。
- 存储：**SQLite**（存 sessions / observations / summaries，FTS5 检索）+ **Chroma 向量库**（混合语义 + 关键词检索）；Python 依赖 `uv`（缺则自动安装）；本地 Worker 服务（Bun 管理）带 Web 查看器。
- ⚠️ **默认是托管服务**：README 提到默认 `CMEM Pro`（hosted memory），本地 observer 需显式 `--provider host` 才启用。**若要纯本地需确认配置。**
- **三层工作流（与你五个工具的同构点）**：
  1. `search` — 返回带 ID 的紧凑索引（约 50–100 tokens/结果）
  2. `timeline` — 取某观测或查询前后的时间线上下文
  3. `get_observations` — **仅对筛选后的 ID 批量取完整详情**（约 500–1000 tokens/结果）
  README 称 *"~10x token savings by filtering before fetching details"*。
- 能力边界一句话：**「搜索拿索引 → 定位 → 再取原文」的两阶段检索范式的最佳现成实现，且把 token 成本量化了；但默认走托管服务、需 Chroma 向量库、且围绕 Claude Code 生命周期 hook 构建。**

⚠️ **关键架构提示（对你的启发）**：你现在的五个工具里，「跨会话搜索」和「读单条原文」是分开的两次调用——这正是 claude-mem 的 `search` + `get_observations` 模式。**你的设计方向与业界最佳实践一致，不需要重做，只需确认「搜索结果先返回轻量索引、再按 ID 取全文」这一层是否已经显式实现。**

### 3.3 其他会话检索工具（含未验证线索）

| 项目 | URL | License | 活跃度（实测） | 关键能力 | 边界 |
|---|---|---|---|---|---|
| `history-rag` | [standingwave/history-rag](https://github.com/standingwave/history-rag) | ⚠️ **未找到 LICENSE 文件，README 亦无 license 段落**（已抓全文 grep 确认）→ 视为「无明确授权」 | 最后提交 `2026-09-06T21:51:28Z`；❓ star 未核实 | 4 个 MCP 工具构成**披露阶梯**：`history_stats`（定位可用过滤器）→ `search_history` / `list_window` → **`expand`（阅读视图：完整 chunk + 源感知上下文，源仍在时实时回读——对话前后轮次、`git show --stat`、整篇笔记等）** | 纯本地（sqlite-vec + Ollama `nomic-embed-text` 768 维），但**强绑 macOS**（Safari `History.db` 需 Full Disk Access、launchd、app usage tracker），且**无许可证**，法务上不可安全复用 |
| `deja` | [CynepMyx/deja](https://github.com/CynepMyx/deja) | **MIT**（LICENSE 实测） | 最后提交 `2026-08-23T22:57:40Z` | 面向 Claude Code 会话的语义检索 MCP（`pip install dejasearch`） | 距今约 7 周未更新；单一来源（仅 Claude Code）；❓ 会话内展开能力未核实 |
| `claude-code-history-mcp` | npm `claude-code-history-mcp` | ❓ 未核实 | ❓ 未核实（npm 页面显示 v1.0.1） | 会话历史 MCP | **仅线索，本次未取得一手验证** ⚠️ 另有 `@iflow-mcp/yudppp-claude-code-history-mcp` 等第三方转发包，注意甄别 |
| `opencode-history-mcp` | PyPI `opencode-history-mcp` | ❓ 未核实 | ❓ 未核实 | opencode 专用历史 MCP | 仅线索，未验证 |

**方向三结论**：**有成熟方案，且不止一个。** 若只挑一个参考对象：**`ccrider`（MIT、覆盖面最广、工具语义与你的五个工具最接近）**；若要抄「两阶段检索省 token」的范式：**`claude-mem`**。

---

## 4. 方向四：Markdown 记忆文件的编辑器 / 校验工具

### 4.1 直接结论：**未找到成熟方案**

**没有任何一个开源工具原生理解「`§` 分隔符 + 条目级字面替换 + 硬字符上限」这一组合。** 这是本次调研中唯一一个五个方向里明确「未找到成熟方案」的。

**依据（均为查证到的事实）**：
- Basic Memory 的编辑语义是 `edit_note` 的 **append/prepend**（README 原文：*"`edit_note` append/prepend auto-creates notes when..."*），工作粒度是**整篇 note**，不是条目。
- 官方 MCP memory server 的 `add_observations` / `delete_observations` 粒度是**单条 observation 字符串**，但它存 JSONL 而非 Markdown，且 `search_nodes` 只做子串匹配，**没有字面替换语义**。
- `opencode-agent-memory` 的 `memory_replace` 是最接近的（*"apply one or several exact replacements atomically"*），但它是**整块粒度**、按「精确替换」而非「条目分隔符」工作，且是 opencode 插件而非通用库。
- 没有任何项目的文档中出现相当于「条目分隔符」「delimiter」「max chars per entry」的概念（除 `limit` 这类整块预算）。

### 4.2 可复用的「既有做法」——这才是本方向真正的产出

虽然没有现成工具，但**三个成熟产品用三种不同策略解决了与你完全相同的问题**，可以直接抄设计：

#### (a) Claude Code auto memory：索引 + 主题文件 + 读上限

来源：<https://code.claude.com/docs/en/memory>（官方文档，本次抓取 51,465 字符全文）

- 存储：`~/.claude/projects/<project>/memory/` 下 **`MEMORY.md` 作索引（每条记忆一行）+ 每条记忆一个主题文件**（如 `user_role.md`、`feedback_testing.md`）。
- **上限机制（与你的 10000 字符直接对应）**：*"The first 200 lines of `MEMORY.md`, or the first 25KB, whichever comes first, are loaded at the start of every conversation."*
- **超限行为（值得你对比）**：*"After Claude writes to `MEMORY.md`, Claude Code measures the file against the 200-line and 25KB read limits. If the file is near a limit, Claude Code reminds Claude to shorten it... If the file is over a limit, **the write still succeeds, but Claude Code returns an error telling Claude to rewrite the index**, because everything past the limit is dropped on the next load."*
  → **即「写入成功 + 返回错误提示重写」，而不是「拒绝写入」。**
- **记忆分类法（4 类，写在 frontmatter 的 `type` 字段）**：`user`（角色/专长/工作偏好）、`feedback`（用户给的纠正与确认的做法）、`project`（代码与 git history 推不出的进行中工作、截止日、决策）、`reference`（外部信息在哪找，如 issue tracker、dashboard）。
- **明确的「不要记什么」规则（可直接抄进 MEMORY_GUIDANCE）**：*"Claude skips anything it can derive from the codebase, such as architecture, file paths, or debugging fixes. It also skips anything your CLAUDE.md files already say."*
- **写入频率哲学**：*"Claude doesn't save something every session. It decides what's worth remembering based on whether the information would be useful in a future conversation."*
- **冲突审计工具**：`/doctor prompt-audit` 会检查指令文件之间的**过时与互相矛盾**内容，并给出「发现 + 建议修改」，**在你要求应用前不改动文件**。
- **一个反直觉但重要的限制**：*"CLAUDE.md content is delivered as a user message after the system prompt, **not as part of the system prompt itself**."* → 这对你「分段注入系统提示词」的策略是一个对照点（你是真正注入 system prompt，控制力更强）。
- **子代理独立记忆**：subagent 的 `memory` frontmatter 字段（README 来源称 v2.1.33 起，❓ 本次未从官方 changelog 验证版本号）有 `user` / `project` / `local` 三种作用域，对应 `~/.claude/agent-memory/<agent>/`、`.claude/agent-memory/<agent>/`、`.claude/agent-memory-local/<agent>/`。（来源：[第三方整理](https://github.com/rohitg00/claude-code-best-practice/blob/main/reports/claude-agent-memory.md)，⚠️ 版本号属第三方陈述，未一手验证）
- 能力边界：**这是一套「索引 + 分文件 + 读上限 + 审计命令」的成熟产品级设计，可作为你单文件 `§` 方案的直接对照组；但它是产品内建能力，不是可复用库。**

#### (b) OpenClaw：USER.md / MEMORY.md + 分层预算 + 截断而非拒绝

来源：<https://docs.openclaw.ai/concepts/memory>（官方文档，本次抓取全文）

- 四个记忆文件：`USER.md`（可选，稳定偏好/沟通风格/关系/活跃项目上下文，**以 directive 形式书写，加载时用独立的小预算**）、`MEMORY.md`（长期记忆，会话启动加载）、`memory/YYYY-MM-DD.md`（每日笔记，工作层，**被索引供 `memory_search`/`memory_get` 使用，但不每轮注入 bootstrap prompt**）、`DREAMS.md`（可选，梦醒扫描摘要供人审阅）。
- **超限行为**：*"If `MEMORY.md` grows past the bootstrap file budget, OpenClaw keeps the file on disk intact but truncates the copy injected into context. Treat that as a signal to move detailed material into `memory/*.md`..."* → **「磁盘不动、注入副本截断」**，第三种策略。
- **偏好更新语义（与你的 replace + 冲突检测直接对应）**：*"When a preference changes, **supersede it in place instead of appending a contradictory active directive**."* 并建议写入**观测日期**与 **active/superseded 元数据**。
- **Action-sensitive memories（这是你 `MEMORY_GUIDANCE.md` 最该抄的一段）**：对「会影响未来行动」的记忆，要记录**何时可以安全行动**，而不仅是事实本身。需捕获行动边界的情形包括：审批/权限要求、临时约束、跨会话/线程/人的交接、过期条件、可安全行动的时机、来源或所有者的权威性、以及「避免某个诱人动作」的指令。一个有用的行动敏感记忆应说明：什么会改变未来行为、在什么条件下适用、何时过期或什么解锁行动、应避免做什么、谁是有权威的来源/所有者。
- **重要边界声明（直接回答你「记忆写入是否需要用户确认」）**：*"Memory can preserve approval context, but **it does not enforce policy**. Use OpenClaw approval settings, sandboxing, and scheduled tasks for hard operational controls."*
  → **即：记忆只承载「批准上下文」，不能替代真正的策略执行机制。**
- **工具**：`memory_search`（语义检索，措辞不同也能找到）、`memory_get`（读指定文件或行范围）、`intent`（创建/列出/取消事件条件化的 standing intent）。
- **会话历史检索的分工（与你的设计几乎逐条对应）**：当启用 session indexing 时，`memory_search` 也能返回会话 transcript 命中；其 `sessions/...jsonl` 路径是**搜索引用而非可读文件**；需用 `sessions_search`（可选 `sessionKey` 限定）拿到返回的 `sessionKey` / `messageId` / `sessionId`，再传给 `sessions_history` 获取**有界、已脱敏**的摘录。文档还特别提醒：*"Memory-search line numbers are not session-history offsets."*
- **引擎**：默认 **Builtin（SQLite，关键词 + 向量 + 混合，零额外依赖）**；可换 Honcho、LanceDB 插件。
- **`memory-wiki` 插件**：把持久知识编译成带确定性页面结构、结构化 claim 与证据、**矛盾与新鲜度追踪**、生成式 dashboard 的 wiki vault；提供 `wiki_status` / `wiki_search` / `wiki_get` / `wiki_apply` / **`wiki_lint`**。
- **自动记忆冲刷**：compaction 摘要对话前，会跑一个**静默 turn** 提醒 agent 保存重要上下文；使用对话的私有副本，其 housekeeping 消息不会出现在后续用户轮次中。
- **Dreaming（后台巩固）**：默认开启，收集短期召回信号、打分、**只把通过门槛的项提升进 `MEMORY.md`**；门槛含分数、召回频率、查询多样性；**taint gated**（不可信与系统来源的候选永不进入巩固提示或持久提升路径）；结果写到 `DREAMS.md` 供人审阅。文档自述其动机源自 sleep-time compute（arXiv:2504.13171）与 Generative Agents 研究。
- **导入能力**：Control UI 可从 Codex / Claude Code / Hermes 导入既有 Markdown 记忆；**只复制 Markdown 记忆**，不导入 rollout/transcript 原始文件、不导入配置与凭据。
- CLI：`openclaw memory status` / `search "query"` / `index --force`。
- 能力边界：**这是与你的架构最同构的产品级实现，且官方文档把「分层预算、截断策略、偏好取代语义、行动敏感记忆、矛盾/新鲜度追踪、后台巩固、不可信来源门控」全部写清楚了；但它是 OpenClaw 产品内建，不可作为库复用。**

#### (c) Letta / MemGPT 的 memory blocks（概念源头）

- URL：<https://github.com/letta-ai/letta>；License **Apache-2.0**（LICENSE 实测）；最后提交 `2026-09-10T17:59:06Z`；最新 release **v0.16.8**（`2026-05-14T16:58:54Z`）。star ❓ 未核实。
- 能力边界：**「可编辑记忆块 + 大小限制 + 由 agent 自己管理」这一整套思想的源头**（`opencode-agent-memory` 的 README 明确说自己 adapted from Letta，并引用 Letta 关于 `description` 字段重要性的文档）。→ **值得读它的 memory blocks 与 shared memory blocks 两篇文档。**

### 4.3 通用 Markdown / 并发编辑积木（若你自己实现编辑层）

❓ **本子方向本次未逐一取得一手验证**（时间与 API 限流所限）。以下为**未经本次抓取验证的候选线索**，仅作检索起点，**不得直接采信其许可证或活跃度**：
`remark`/`mdast`/`unified`（JS 生态 AST，注意 remark 生态近年有维护节奏变化）、`markdown-it-py` + `mdit-py-plugins`、`marko`、`mistletoe`、`mdformat`（Python 格式保持型格式化）、`python-frontmatter`、`pulldown-cmark`、`tree-sitter-markdown`、`markdownlint`/`remark-lint`/`textlint`（校验类）。
并发/冲突方向：`diff3`、Python `merge3`、`jsdiff`、`node-diff3`、`git merge-file`，以及 CRDT 文本库 `Yjs` / `Automerge` / `Loro`（若你要做真正的协同编辑而非单写者）。
> ⚠️ **我的建议**：你的「字面匹配 + 改前先读 + 服务端版本冲突检测」本质上是一个**乐观并发控制（CAS）**问题。与其引入 CRDT（会改变你的单文件真相模型），不如沿用你现有做法并补一个**内容哈希 / 版本号 CAS**——这正是官方 MCP memory server 用锁文件、Basic Memory 用 SQLite 索引所解决的问题的不同侧面。

---

## 5. 方向五：可复用的 skill / 提示词模板 / 规范文本

### 5.1 ⭐ `agent-handoff-skill` — 唯一明确支持 DSH 的记忆类 skill

- URL：<https://github.com/WeirdSky924/agent-handoff-skill>
- License：**MIT**（LICENSE 实测）。
- 活跃度：✅ 较活跃。最后提交 `2026-08-27T14:40:48Z`（约 6.5 周前）。
- **它的 description 字段原文（查证自 SKILL.md）**：*"Cross-platform skill for Codex, Claude Code, and **DeepSeek Harness (DSH)** that creates, updates, compacts, rotates, repairs, and reviews durable repository handoffs. Use when bootstrapping cross-session memory; creating or maintaining `AGENT_HANDOFF.md` and `.agent-handoff` files; adding `AGENTS.md` or `.claude/CLAUDE.md` rules; enforcing continuation recovery or closeout; **managing oversized snapshots and logs**; installing optional Claude advisory hooks; or reviewing handoff quality."*
- **它直接给出了 DSH 的 skill 安装路径（这是关于你自己环境的一手信息，值得注意）**：
  - DSH personal skill：`~/.dsh/skills/agent-handoff`
  - DSH shared-agent skill：`~/.agents/skills/agent-handoff`
  - DSH project skill：`<repo>/.dsh/skills/agent-handoff` 或 `<repo>/.agents/skills/agent-handoff`
  - 并明确：*"DSH does not discover `~/.codex/skills`, `~/.claude/skills`, or `<repo>/.claude/skills`; install or link the bundle into one of its roots above."*
- 边界声明：*"The handoff mechanism is repository-local by default. Do not edit user-level Codex, Claude Code, or DSH instructions, profiles, or settings unless the user explicitly asks for it."*
- 能力边界一句话：**面向 DSH/Codex/Claude Code 的「仓库级跨会话交接记忆」skill，明确处理超大快照与日志，MIT 且给出了 DSH 的安装路径——是本清单中与你的运行环境唯一直接兼容的 skill。**

⚠️ **推测**：它解决的是「任务交接（handoff）连续性」，与你的「长期人格/用户/跨任务事实」三层记忆**互补而非替代**。它值得作为「会话临时内容如何沉淀」这一层的现成方案。

### 5.2 `claude-memory-skill` — 单 `.md` 的完整记忆管理流程（⚠️ 已停更）

- URL：<https://github.com/SomeStay07/claude-memory-skill>
- License：**MIT**（LICENSE 实测，Copyright (c) 2025-2026 Timur Ceberda）。
- 活跃度：⚠️ **已停更约 8 个月**。唯一 release **v1.0.0**（`2026-02-12T08:26:50Z`）；最后提交 `2026-02-17T13:52:40Z`。
- 形态：**单个 `SKILL.md`**（16,306 字符），零依赖零配置，官方安装方式就是一条 curl 到 `.claude/skills/memory/SKILL.md`。
- 提供的 4 个模式：`/memory update`（扫描对话、抽取学习、持久化）、`/memory prune`（找重复、矛盾、过时条目）、`/memory reflect`（捕获纠正与错误）、`/memory status`（所有记忆文件健康检查）。
- **可直接复用的规范文本**（查证自 SKILL.md）：
  - **写入前三问质量门（自述过滤掉 60–70% 的候选条目）**：① 忘了它会不会导致 bug 或浪费时间？不会→别写。② 这是本项目特有的吗？不是→别写。③ 记忆里已经有了吗？有→更新既有条目，不要新建。
  - **5 级置信度分类**：CRITICAL（忘记会崩溃/彻底失败）→ HIGH（导致错误行为、难调试）→ MEDIUM（明显省时间）→ LOW（知道也好、容易重新发现）→ SKIP（一次性/通用/显而易见），并规定每级写到哪里。
  - **去重决策树**：精确匹配→跳过；部分重叠→更新既有条目；矛盾→解决（**以会话数据为更新者**）。
  - **反臃肿纪律**：CLAUDE.md 中每条最多 2 行，细节下沉到更深层；**绝不重复其他记忆文件已有的信息，改用交叉引用** `See [file] #[section]`；CLAUDE.md 超限就压缩（合并条目、细节下沉）。
  - **编辑纪律**：*"Use `Edit` for surgical changes, not `Write` for full rewrites"*；*"Replace outdated info — update, don't append a second version"*；*"**Edit, don't rewrite** — surgical changes preserve existing structure"*。
  - **5 层记忆层级 + 每层预算**（如 CLAUDE.md 最多约 120 行、auto-memory 约 200 行且超出截断）。
  - **自动发现项目布局**（运行时探测 `docs/project_notes/*.md`、`memory-bank/*.md` 等），**适配你已有的记忆结构，而不是强加新结构**。
- 能力边界一句话：**把「质量门 → 置信度分级 → 去重 → 交叉引用 → 一致性清扫 → 反臃肿」这套记忆写入规范写成了一份可直接抄的 SKILL.md 文本，MIT、零依赖；但代码停在 2026-02，且是 Claude Code 专用（依赖 `Read`/`Write`/`Edit` 工具与 CLAUDE.md 约定）。**

⚠️ **这是本清单中「方向五」性价比最高的一项**：即使你不用它的 skill，**它的那份规范文本可以近乎直接改写成你的 `MEMORY_GUIDANCE.md`**。

### 5.3 `orchestkit` 的 memory skill — MCP 增强型 skill 的范例

- URL：<https://github.com/yonatangross/orchestkit>，skill 路径 `plugins/ork/skills/memory/SKILL.md`
- License：skill 的 frontmatter 中标 **`license: MIT`**；**仓库整体 License ❓ 未核实**（仅抓取了 skill 文件）。
- 活跃度：❓ 未核实（未取得提交时间）。
- 形态：一个 frontmatter 丰富的 Claude Code skill（`name` / `compatibility: "Claude Code 2.1.277+. Requires memory MCP server."` / `allowed-tools: "Read Grep Glob Bash AskUserQuestion mcp__memory__search_nodes mcp__memory__read_graph"` / `version: "2.0.1"` / `model: haiku`）。
- 子命令：`search` / `load` / `history` / `viz` / `status`。
- **可复用设计一：分层读取顺序（省 context）**：① `~/.claude/projects/<slug>/memory/MEMORY.md`（持久索引，**先加载、总是加载**）→ ② `.claude/chain/state.json` + 最近的 `NN-*.json` 交接（会话续接）→ ③ MCP `search_nodes`（只在文件系统索引答不了时才用，做类型化图遍历）。理由自述：Layer 1 便宜（小索引）、Layer 2 有界（会话专属）、Layer 3 选择性（按需）。并警告 **「避免把整个知识图谱倒进 context — 先用索引收窄再搜」**。
- **可复用设计二：staleness 定时清扫**：夜间 cron 扫描所有记忆 MCP 实体的最新观测时间戳，标记超过 30 天未更新的，输出 Markdown 报告（总数/过期/新鲜计数、按陈旧度排序的 Top N、每条的名字/类型/天龄/观测数、按年龄分桶的建议动作：>90d 复审、>180d 归档候选）；**无可解析时间戳的实体一律视为过期**（自述理由：operator 介入才是正确结果，要么回填 `last_read` 观测、要么剪枝）。
- 关联 skill：`ork:remember`（写入侧）、`memory-fabric`（检索内部）、`dream`（清理）。
- 能力边界一句话：**示范了如何把 memory MCP 包装成「读侧 skill + 定时陈旧度清扫 + 分层读取顺序」，其 staleness 清扫脚本与分层读取顺序可直接借鉴；但它强绑定 `mcp__memory__*` 工具与 Claude Code 2.1.277+，且依赖一个私有 PyPI 包（`yg-mcp-core`，仅 HQ 可用）才能跑清扫脚本。**

### 5.4 其他相关规范与线索

- **`AGENTS.md`（跨工具标准）**：<https://agents.md/>（本次抓到 81,670 字符页面）+ <https://github.com/openai/agents.md>。Claude Code 官方文档已明确支持直接读取 `AGENTS.md`（`/docs/en/memory` 有专章，含 `claude-md-and-agents-md` / `claude-md` / `agents-md` / `managed-only` 四种 Project instructions 取值），并给出 `@AGENTS.md` import 与 symlink 两种共享方式。
  → **对你有直接价值**：若你想让记忆/指令文件跨工具复用，`AGENTS.md` 是当前的行业落点。
- [obra/private-journal-mcp](https://github.com/obra/private-journal-mcp) — License **MIT**（实测）；最后提交 `2026-08-11T18:24:13Z`。由 Jesse Vincent 开发，给 Claude 一个私有日记能力。**被 `opencode-agent-memory` 的 README 列为参考项目。** 能力边界：面向「自省/内心体验」的日记写入，不是结构化事实记忆。
- [obra/superpowers](https://github.com/obra/superpowers) — License **MIT**；最后提交 `2026-10-10T00:28:04Z`；star **298,023**（限流前实测）。⚠️ **本次未验证其是否含记忆相关 skill**，仅作为 skill 生态的高活跃入口线索。
- [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates) — **MIT**；star **32,578**；最后 push `2026-10-12T04:35:14Z`。CLAUDE.md/agent 模板集散地，可作为 `MEMORY_GUIDANCE` 类文本的素材库。❓ 未验证是否含专门的记忆规范。
- [wshobson/agents](https://github.com/wshobson/agents) — **MIT**；star **40,458**；最后 push `2026-10-12T03:07:19Z`。❓ 记忆相关未验证。

---

## 6. 总对比表

### 6.1 核心候选（按对你的适用度排序）

| 项目 | URL | License | 活跃度（实测） | 存储 | 需外部服务 | 最贴合你架构的哪一层 | 一句话能力边界 |
|---|---|---|---|---|---|---|---|
| **opencode-agent-memory** | [链接](https://github.com/joshuadavidthomas/opencode-agent-memory) | MIT | 提交 2026-09-22 | Markdown 块 + frontmatter | ❌ 否（本地嵌入） | **memory 工具 + 字符预算 + 分段注入** | 与你的 memory 工具语义最接近的开源实现（`memory_get` 返回值+mtime、`memory_replace` 精确原子替换、`limit` 软预算、per-session 快照保 cache），但是 opencode 专用插件、自述 experimental |
| **basic-memory** | [链接](https://github.com/basicmachines-co/basic-memory) | **AGPL-3.0** ⚠️ | push 2026-10-12，PyPI 0.23.2 | **Markdown 为真相 + SQLite 索引** | ❌ 否（FastEmbed 本地） | **单文件记忆层 + 可重建索引 + 检索** | 最贴合「Markdown 真相 + 本地索引 + 无向量库」的成熟 MCP server，工具面最全（含 schema 校验），但编辑粒度是 note 级 append/prepend，且 AGPL 传染 |
| **ccrider** | [链接](https://github.com/neilberkman/ccrider) | MIT | release v1.13.0 (2026-10-05)，提交 2026-10-09 | SQLite + FTS5 | ❌ 否 | **五个会话检索工具** | 覆盖面最广的会话历史检索工具，`search_sessions`/`list_recent_sessions`/`get_session_messages`（含命中上下文）与你的工具语义几乎一一对应，但只认 7 家提供商，无 DSH |
| **claude-mem** | [链接](https://github.com/thedotmack/claude-mem) | Apache-2.0 | release v13.35.0 (2026-10-09)，提交 2026-10-12 | SQLite + Chroma 向量 | ⚠️ 默认托管(CMEM Pro) | **跨会话检索的两阶段范式** | `search`→`timeline`→`get_observations` 三层渐进披露、量化了 ~10x token 节省，但默认走托管、依赖 Chroma、围绕 Claude Code hook |
| **官方 memory server** | [链接](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) | MIT（子目录）/ 根仓库 MIT→Apache-2.0 迁移中 | npm 1.0.0 (2026-10-11)，提交 2026-10-11 | 单 JSONL | ❌ 否 | **MCP 接口设计 + 并发锁** | 零依赖的实体-关系-观测知识图谱 server，锁文件并发方案值得抄，但非 Markdown、无字面替换语义、`search_nodes` 仅子串匹配 |
| **agent-handoff-skill** | [链接](https://github.com/WeirdSky924/agent-handoff-skill) | MIT | 提交 2026-08-27 | 仓库内 Markdown | ❌ 否 | **skill + DSH 适配** | **唯一明确支持 DSH 的记忆类 skill**，含超大快照管理，且给出 DSH 三个 skill 安装根路径；但解决的是任务交接而非长期人格记忆 |
| **claude-memory-skill** | [链接](https://github.com/SomeStay07/claude-memory-skill) | MIT | ⚠️ 停更，v1.0.0 (2026-02-12)，提交 2026-02-17 | 单 SKILL.md | ❌ 否 | **MEMORY_GUIDANCE.md 文案** | 把「质量门+置信度分级+去重决策树+交叉引用+反臃肿纪律」写成可直接抄的规范文本，但已停更 8 个月且绑 Claude Code |
| **OpenClaw memory 文档** | [链接](https://docs.openclaw.ai/concepts/memory) | 文档，非软件 | 持续更新 | Markdown（USER/MEMORY/日期笔记） | ❌ 否（Builtin SQLite） | **整体架构 + 分层预算 + 行动敏感记忆 + 巩固** | **与你的架构最同构的产品级设计说明书**，含截断策略、偏好取代语义、矛盾/新鲜度追踪、taint 门控；但不可作为库复用 |
| **Claude Code auto memory 文档** | [链接](https://code.claude.com/docs/en/memory) | 文档，非软件 | 持续更新 | `MEMORY.md` 索引 + 主题文件 | ❌ 否 | **容量上限 + 记忆分类法 + 审计** | 产品级「200 行/25KB 读上限 + 超限返回错误 + 4 类 type 字段 + 不记什么规则 + `/doctor prompt-audit` 冲突审计」的完整规范 |
| **orchestkit memory skill** | [链接](https://github.com/yonatangross/orchestkit) | skill MIT / 仓库❓ | ❓ 未核实 | 文件 + memory MCP | ⚠️ 依赖私有包 | **分层读取顺序 + 陈旧度清扫** | 示范分层读取（索引→交接→按需图查询）与夜间 staleness 报告，但绑 `mcp__memory__*` 且清扫脚本依赖私有 PyPI 包 |
| **sqlite-memory** | [链接](https://github.com/sqliteai/sqlite-memory) | ⚠️ **Elastic License 2.0** | push 2026-07-21，star 126 | 单 `.db`（SQLite 扩展） | ❌ 否（llama.cpp 本地嵌入） | **单文件 + 混合检索** | 把 Markdown 真相 + 向量&FTS5 混合检索 + 零 API 成本压进单个 .db，但非 OSI 开源、star 低、需 SQLite 扩展加载 |
| **mcp-memory-service** | [链接](https://github.com/doobidoo/mcp-memory-service) | Apache-2.0 | PyPI 11.15.0 (2026-10-03)，push 2026-10-12 | SQLite 等后端 | ❌ 否（ONNX 本地嵌入） | **本地无云的记忆服务** | 自托管记忆后端，本地 ONNX 嵌入 + 因果图 + REST/MCP 双协议，但是常驻服务+自有存储模型，不管你的 Markdown |
| **memento-mcp** | [链接](https://github.com/gannonh/memento-mcp) | MIT | ⚠️ 停更近 12 个月（2025-10-27） | **Neo4j** | ✅ **需要 Neo4j + OpenAI key** | — | 功能强（语义混合检索 + 完整版本历史），但违反你「本地优先、无外部服务」的双重约束 |
| **MemOS** | [链接](https://github.com/MemTensor/MemOS) | Apache-2.0 | star 11,827，push 2026-10-10 | 记忆 OS 层 | ❓ | — | ⚠️ **自述含 "DeepSeek Harness support"**，是唯一提到 DSH 的记忆类项目，建议优先深入评估 |
| **history-rag** | [链接](https://github.com/standingwave/history-rag) | ⚠️ **无 LICENSE 文件** | 提交 2026-09-06 | sqlite-vec + Ollama 嵌入 | ⚠️ 需 Ollama | 会话检索的 `expand` 阅读视图 | 4 工具披露阶梯 + `expand` 可实时回读源上下文，但强绑 macOS、无许可证，法务上不可复用 |
| **mem0-mcp** | [链接](https://github.com/mem0ai/mem0-mcp) | Apache-2.0 | ⚠️ **已归档**（2026-03-24） | — | ✅ 需 mem0 平台 | — | **不要选**：已归档，且 mem0 主仓库 README 已移除 MCP/OpenMemory 字样 |

### 6.2 五个方向的「是否有成熟方案」判定

| 方向 | 判定 | 最推荐参考 |
|---|---|---|
| 1. MCP memory server | ✅ 有多个成熟方案 | 官方 memory server（接口+锁）、`mcp-memory-service`（本地无云） |
| 2. 本地优先单文件记忆层 | ✅ 有，且与你的理念高度一致 | **basic-memory**（AGPL 需评估）、**sqlite-memory**（授权受限）、**opencode-agent-memory**（MIT，语义最贴合） |
| 3. 跨会话历史检索 | ✅ **最成熟的一个方向** | **ccrider**（MIT，覆盖面最广）、claude-mem（两阶段范式） |
| 4. Markdown 记忆文件编辑器/校验 | ❌ **未找到成熟方案**（针对 `§`+条目级+硬上限） | 转而抄 Claude Code / OpenClaw / opencode-agent-memory 三种既有策略 |
| 5. 可复用 skill / 规范文本 | ✅ 有，规范文本质量很高 | **agent-handoff-skill**（支持 DSH）、**claude-memory-skill**（规范文本可抄）、OpenClaw action-sensitive 章节 |

---

## 7. 推荐组合

### 7.1 总体建议：**不要替换，改为「抄规范 + 补强两处」**

你的系统与三个成熟产品同构，说明**架构判断是对的**，手写的价值集中在真实需求上。全盘替换为现成工具会**净损失**三样东西：单文件 Markdown 的零依赖可读性、DSH 原生集成、以及你自定义的版本冲突语义。因此建议：

### 7.2 直接用现成的（4 项）

| # | 用什么 | 怎么用 | 为什么 |
|---|---|---|---|
| 1 | **`agent-handoff-skill`**（MIT，支持 DSH） | 按其文档安装到 `~/.dsh/skills/` 或 `~/.agents/skills/` | 这是唯一**明确支持 DSH** 的记忆类 skill，零集成成本，且它解决的「任务交接连续性 / 超大快照管理」正好是你**明确没做**的一层（会话临时内容 → 持久交接）。⚠️ 先读一遍 SKILL.md 确认不与你的三层记忆冲突。 |
| 2 | **`claude-memory-skill` 的规范文本**（MIT，纯文本） | 把它的「写入前三问质量门 / 5 级置信度 / 去重决策树 / 交叉引用格式 / 反臃肿纪律」改写成你的 `MEMORY_GUIDANCE.md` | 这是**性价比最高的一步**：你已经有 `MEMORY_GUIDANCE.md` 这个注入机制，缺的只是**写什么/不写什么的内容规范**。该项目虽然停更，但规范文本不过时（它不依赖任何 API）。 |
| 3 | **OpenClaw 的 "Action-sensitive memories" 章节** | 作为 `MEMORY_GUIDANCE.md` 的第二个来源，专门补「记忆写入是否需要用户确认」这一块 | 它给出了**权威且克制**的表述：记忆只承载「批准上下文」，**不替代真正的策略执行**。这正好回答你「是否需要用户确认」的行为设计，并避免把策略职责错误地塞进记忆。 |
| 4 | **`ccrider` 作为会话检索的参照实现**（MIT） | **不直接接入**（它不支持 DSH），而是精读其 4 个 MCP 工具的参数与返回结构，对照你的 5 个工具做一次「接口体检」 | 它的 `search_sessions` / `get_session_messages`（含 tail 模式 + 搜索命中上下文）已经是**经过实战检验的接口设计**。对照它能低成本发现你的工具签名缺陷，尤其是「命中上下文」与「分页」两处。 |

### 7.3 建议动手补强的（2 项，都需要写代码）

| # | 补什么 | 依据 | 工作量估计 |
|---|---|---|---|
| 1 | **会话内快照的字节稳定性**（prompt cache 保护） | `opencode-agent-memory` README：*"Memory is frozen per session and refreshed after context compaction, so edits do not repeatedly invalidate the provider prompt cache"*；*"the injected snapshot stays byte-stable for prompt caching"* | 小。你的 `MEMORY_GUIDANCE.md` 已分段注入，需确认**同一会话内已注入的记忆快照不随工具编辑而变化**，只在 compaction 后刷新。⚠️ 若你现在每次编辑都重注入，**每次记忆写入都会击穿 prompt cache**，这是可观的成本/延迟损失。 |
| 2 | **陈旧度（staleness）自动清扫** | `orchestrack` memory skill 的夜间 cron：扫描所有记忆条目的最新时间戳，标记 >30 天未更新的，输出 Markdown 报告（按年龄分桶：>90d 复审、>180d 归档候选），**无可解析时间戳的条目一律视为过期** | 中。需要你的条目带时间戳 + 一个可重建的索引查询。⚠️ 这是你的系统目前**明显缺失**的一环——你有「替换链」但没有「过期检测」，长期记忆会只增不减。 |

### 7.4 明确不建议采用的（含理由）

| 项目 | 不建议的理由 |
|---|---|
| **官方 `@modelcontextprotocol/server-memory`** | 它是 **JSONL 图模型**，会**摧毁你「单文件 Markdown 人工可读可编辑」这一核心资产**。仅建议借鉴其**锁文件并发方案**（含 15s 刷新、30s 过期、60s 超时报错、`.lock.break` 守卫、以及「网络文件系统不安全」的明确警告）——你的服务端版本冲突检测可以对照补齐这些边界情况。 |
| **`memento-mcp`** | 同时违反你两条硬约束：需要 **Neo4j 常驻服务**、需要 **OpenAI API key** 做嵌入；且停更近 12 个月。 |
| **`mem0` / `mem0-mcp` / OpenMemory** | `mem0-mcp` **已归档**；主仓库 README 已移除 MCP 字样，社区多个同名转发包互相冲突。作为长期依赖风险过高。 |
| **`sqlite-memory`** | ⚠️ **Elastic License 2.0 不是 OSI 开源许可证**，有商用/托管限制；star 仅 126；且需 SQLite 扩展加载。技术思路（单 .db + 混合检索 + 零 API 成本）值得抄，但**代码不建议直接依赖**。 |
| **`basic-memory` 作为直接依赖** | ⚠️ **AGPL-3.0 传染性最强**。若你的记忆层会随 DSH 分发或以网络服务形式提供，合规风险显著。**建议只借鉴其 Markdown 语法约定**（frontmatter `title/type/permalink/tags` + `- [category] 内容 #tag` 观测 + `[[wikilink]]` 关系），这正是你 `§` 方案可以低成本借鉴的「可校验结构」。 |
| **`history-rag`** | ⚠️ **仓库无 LICENSE 文件**（已抓全文确认），且强绑 macOS 与 Claude Code。**法律上不可安全复用**，只可作为「`expand` 阅读视图」的设计灵感。 |
| **CRDT 文本库（Yjs/Automerge/Loro）** | ⚠️ **推测**：你的场景是单写者 + 服务端冲突检测，引入 CRDT 会显著复杂化并动摇「单文件即真相」模型。**先用内容哈希/版本号 CAS 就够了**（这本质是乐观并发控制，不是协同编辑问题）。 |

### 7.5 建议优先评估的两个「未知数」

1. **MemOS**（<https://github.com/MemTensor/MemOS>）— 唯一在自述中提及 **"DeepSeek Harness support"** 的记忆类项目，Apache-2.0、star 11,827、活跃（push 2026-10-10）。⚠️ 本次**只抓了 README**，未验证其 DSH 集成的具体形态与质量。**鉴于它直接面向你的运行时，建议列为第一优先深入评估对象。**
2. **`opencode-agent-memory` 的 `memory_replace` 实现**（MIT，可直接读源码）— 它是本清单中**唯一与你的「字面替换 + 原子性」语义直接对应**的开源实现。「apply one or several exact replacements atomically」的具体语义（是否要求唯一匹配？多处匹配如何处理？是否校验读后未变？）**README 未说明**，但 MIT 许可下你可以直接读代码并移植。**这是最可能直接省掉你手写工作量的一处。**

---

## 8. 事实 / 推测 / 未核实 —— 边界声明

### ✅ 本次实际抓取到的一手证据（可复核）
- GitHub Atom feed：`releases.atom` / `commits/main.atom`（用于全部「最后提交/最新 release」时间戳）
- `raw.githubusercontent.com`：各项目 README / SKILL.md / LICENSE 原文（含 LICENSE 首行文本）
- npm registry API（`@modelcontextprotocol/server-memory` → 1.0.0 / 2026-10-11T02:42:27Z）
- PyPI JSON API（`mcp-memory-service` 11.15.0 / Apache-2.0；`basic-memory` 0.23.2 / AGPL-3.0-or-later；`mem0ai` 2.2.1）
- Go module proxy（`proxy.golang.org`：ccrider v1.13.0 / 2026-10-05T21:55:21Z）
- 官方文档全文：`code.claude.com/docs/en/memory`（51,465 字符）、`docs.openclaw.ai/concepts/memory`（17,964 字符）、`agents.md`（81,670 字符）
- GitHub REST API（**限流前**成功的一批）：`modelcontextprotocol/servers` 91,166 star、`mem0ai/mem0` 67,037、`getzep/graphiti` 31,672、`MemTensor/MemOS` 11,827、`basicmachines-co/basic-memory` 4,152、`doobidoo/mcp-memory-service` 2,010、`gannonh/memento-mcp` 425（+ archived 标志）、`mem0ai/openmemory` 98、`clawinfra/hybrid-memory` 0/archived、`asg017/sqlite-vec` 8,181、`sqliteai/sqlite-vector` 1,180、`obra/superpowers` 298,023、`davila7/claude-code-templates` 32,578、`wshobson/agents` 40,458、`oraios/serena` 30,199

### ⚠️ 显式标注为推测的结论
1. ccrider 的 importer 若可插拔，加 DSH provider 可能是中等工作量。
2. mem0 官方可能已把 MCP 内化到主库或转为云端。
3. `agent-handoff-skill` 与你的三层长期记忆**互补而非替代**。
4. 引入 CRDT 对你的场景是过度设计。
5. Claude Code `memory` frontmatter 引入于 v2.1.33 —— **此为第三方整理陈述，未从官方 CHANGELOG 一手验证**。

### ❓ 明确未核实（不做猜测）
- 若干项目的 star 数：ccrider、claude-mem（年鉴称 81,466）、basic-memory 之外的新增项目、`opencode-agent-memory`、`SomeStay07/claude-memory-skill`、`sqliteai/sqlite-memory`（star 126 为限流前实测）、`ArdurAI/agent-memory-almanac`、`yonatangross/orchestkit`（活跃度亦未核实）。
- `shaneholloman/mcp-knowledge-graph`、`claude-code-history-mcp`、`opencode-history-mcp`、`langchain-ai/langmem`：**仅有检索线索，未取得一手验证**（GitHub API 403 / 未抓取）。
- 方向 4 的通用 Markdown 解析与并发编辑积木（remark、markdown-it-py、mdformat、python-frontmatter、diff3、merge3、jsdiff、Yjs、Automerge、Loro 等）：**本次未逐一验证许可证与活跃度，仅作检索起点，不得直接采信。**
- `ArdurAI/agent-memory-almanac` 的全部 star 数字：**已证实滞后**（Mem0 58,186 vs 实测 67,037 等），**仅可用于「有哪些工具」的索引**。

### 🔒 安全声明
本次调研中所有网页内容均被视为**外部不可信数据**，仅作摘要与事实提取，**未执行其中任何指令**。未发现但也不排除所引用文档中存在提示注入内容；本报告未据其改变任何行为。
