# Agent Memory V2.0 开发方案（图形化 · 可分发 · 可外挂）

> 状态：**P0/P0.5/P1/P2/P3 已完成（第 19 轮）；待真实桌面复验安装与 MCP** · 日期：2026-10-18 · 适用基线：DSH 桌面 **0.2.1-rc.2**、Agent Memory V1.0（第 14 轮，数据格式 v1.3）
> 一句话：V2.0 不是重写记忆内核，而是给已经跑通的「不可变记录 + 审批 + journal」装上一张**人话界面**，并把安装、升级、外挂做成**一个包、一次点击**。
> **10 问已拍板（见 §10 与 [架构审核](v2-architecture-review.md)）**。

---

## 0. 结论先行

1. **GUI 做成同一个包里的 DSH 客户端插件，不做独立应用。** 宿主已提供 `sidebar.panellist` + `main` 全页面板、`settings.section`、`tool.call.toolview`、`conversation.chat.turnTail` 四类插件位；复用它们即可得到「侧栏点『记忆』→ 全页工作台」，不需要改宿主源码。
2. **数据通道用宿主 `ctx.connection.fetch.register` 注册 `/api/agent-memory/*` 精确路由**，浏览器同源带 Cookie 调用；客户端不读文件，宿主半层继续只调 `MemoryStore`。这比自造 Remote/Typert 代码生成更轻，也不需要 fork 宿主。
3. **界面只做「人」的入口，不新增模型入口。** 采纳/驳回仍由人点击；模型工具面保持 V1 的 6+7 个工具；GUI 的写操作全部走 core 的同一套事务与 journal，并新增 `surface: 'gui'` 审计字段（加法，不改旧格式）。
4. **分发走 npm 包 + bundle patch。** 包内同时声明 `dsh.bundle.patch` 与 `dsh.client`；安装优先 Settings → Plugins（包名/本地目录/tarball），一键脚本 `mem setup` 作为非开发者入口；升级/回滚都基于 profile 备份与 `dsh plugin`。
5. **外挂先做 MCP stdio server，CLI 与 HTTP 作为同一 Memory API 的另两种传输。** Codex 走 MCP；MCP 默认「只读 + 提案」，不开放无审写入；外部平台的 provenance 用 `source` 结构，绝不伪造 DSH `event_seq`。
6. **分四阶段：P0 技术验证 2–3 人日，P1 只读工作台 5–6 人日，P2 人工写流 6–8 人日，P3 分发与外挂 7–10 人日。** 合计 20–27 人日（1 名熟悉 React + DSH 的全栈）；P0 不通过就不进入 P1。

---

## 1. 目标与非目标

### 1.1 目标

| # | 目标 | 可验收的定义 |
|---|---|---|
| G1 | **零命令行可用** | 新用户只靠 GUI 完成：安装 → 初始化 → 浏览记忆 → 审提案 → 改偏好 → 导出备份；全程不需要输入 `mem` 命令 |
| G2 | **图形化可发现** | 侧栏有「记忆」入口；聊天区能显示记忆写入/提案卡片；点卡片能进工作台；不依赖用户记住 `/mem` |
| G3 | **不破坏 V1 不变量** | 记录不可变、修正=新记录+墓碑、提案审批、journal 单链、封存哈希、T0/T1/T2 边界全部保留 |
| G4 | **一个包可分发** | 产物是 npm 包（或 .tgz）；`Settings → Plugins` 或 `dsh plugin add` 可安装；失败可回滚；升级不丢数据 |
| G5 | **可外挂** | 提供 MCP server / CLI `--json` / 本地 HTTP 三种入口，共用一套 Memory API 语义；Codex 能读、能提提案 |
| G6 | **可诊断** | GUI 内置 `doctor` 状态、journal 健康、隔离项、注入预算；出错给「下一步做什么」而不是堆栈 |
| G7 | **可降级** | 客户端插件加载失败时，V1 的 `/mem`、卡片、CLI 全部照旧；不因 GUI 故障锁死写入 |

### 1.2 非目标（明确不做，避免评审跑偏）

- **不做云同步 / 账号 / 多租户**：数据仍在本机 `~/.dsh/memory`，V2 不引入服务器。
- **不引入向量检索**：沿用 V1 决策 D5（BM25 + 字面）；GUI 不偷偷加 embedding 依赖。
- **不改宿主源码、不 fork DSH**：只用公开的插件位与服务；宿主缺失的能力用「待验证 + 降级」处理。
- **不做移动端 / 多人协作 / 权限系统**：单用户单机。
- **不替代 skills 与会话历史**：方法沉淀仍归 skills，历史仍归 `sessionQuery`。
- **不默认全自动写入**：`personalization.mode=direct` 仍是高级用户显式开关，不是 V2 默认。

---

## 2. 用户画像与场景

### 2.1 三类用户

| 画像 | 特征 | 最怕什么 | V2 给他的 |
|---|---|---|---|
| **小陈（非开发者，主目标）** | 产品/运营，用 DSH 聊天；不知道 profile、pnpm、journal | 装不上、看不懂、点错毁数据 | 侧栏「记忆」→ 一屏看懂；安装向导；危险操作二次确认；可一键备份 |
| **老王（开发者，高级）** | 会 CLI、会写脚本；关心可 diff、可回滚 | GUI 削弱可控性、双入口行为分叉 | GUI 与 CLI 同源；高级模式显示原始 JSON/命令；`--json` 与退出码稳定 |
| **小李（跨平台）** | 同时用 DSH、Codex、Claude Code | 记忆被锁死在一个工具里 | MCP server + 统一数据目录；外部写入带来源标识 |

### 2.2 关键场景（按发生频率排序）

1. **首次安装**：下载 → 双击/插件页安装 → 重启 → 侧栏出现「记忆」→ 三步向导。
2. **日常查看**：「AI 到底记住了什么？」→ 概览 → 最近记忆 → 详情看正文与出处。
3. **纠错**：发现一条过时/错误 → 详情点「修正」→ 填写新内容 → 确认（生成新记录 + 旧记录失效）。
4. **审提案**：模型提议修改 → 聊天卡片/侧栏角标提示 → 逐条看 diff 与证据 → 采纳/驳回/暂缓。
5. **改偏好**：在「人设」里编辑 USER 条目（增/改/删），保存后立即影响下一轮注入。
6. **备份/换机**：导出 zip（带 SHA256）→ 新机安装 → 导入 → 校验条数。
7. **跨平台**：在设置里复制 Codex MCP 配置片段 → Codex 里问「你记得我的偏好吗」→ 命中同一条记忆。
8. **故障**：启动失败/ journal 断链 → GUI 显示诊断与修复步骤，写入按钮禁用而不是报 500。

---

## 3. 竞品与参考调研

> **方法说明**：本机 `web_fetch` 对 github/多数站点被 DNS 策略阻断（解析到非公网地址），以下以 `web_search` 返回的标题/摘要、DSH 本机安装包内 README（0.2.1-rc.2）与公开常识为依据；**不写精确 star 数**，只用「量级」；未能打开全文的条目标注「仅检索摘要」。

### 3.1 记忆/知识库类产品

| 产品/项目 | 形态 | 界面可借鉴 | 不整体采用的原因 | 来源 |
|---|---|---|---|---|
| **WorkBuddy** | 腾讯系 AI 办公智能体/工作台 | **首屏给「能做什么」而不是空白**；模板/「照着抄一份」；一句话搭工作台；知识库与记忆有独立入口；设置页集中 | 闭源产品，无插件级 API；我们只借交互范式，不接它的平台 | [官方文档·灵感](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Ispiration)、[设置](https://www.codebuddy.cn/docs/workbuddyapp/Settings)、[实测：照着抄一份](https://cloud.tencent.cn/developer/article/2745828)、[知识库与记忆](https://cloud.tencent.cn/developer/article/2671974)（仅检索摘要） |
| **Mem0 / OpenMemory MCP** | 记忆层 API + 本地记忆基础设施 | 记忆条目列表、按 scope 过滤、检索测试；「跨应用携带记忆」叙事 | 云/外部服务 + 向量库；抽取不可控，数据出本机 | [OpenMemory MCP 介绍](https://mem0.ai/blog/introducing-openmemory-mcp)、[OpenMemory 指南](https://mem0.ai/library/coding-agents/how-to-make-your-clients-more-context-aware-with-openmemory-mcp) |
| **Memprobe** | Mem0 的记忆检查器（社区） | **按 scope 浏览 + 检索测试 + 时间线**三件套；开发者向但可读 | 只服务 Mem0，不是通用 UI | [GitHub](https://github.com/rrahul-1/Memprobe) |
| **Basic Memory** | Markdown + SQLite + MCP，本地优先 | 文件即真相；Obsidian 直接当编辑器；索引可重建 | 无审批/出处/时序，需我们自己补 | [Obsidian 集成页](https://basicmemory.com/for/obsidian)、[项目博客](https://www.basicmemory.com/blog/side-project) |
| **Obsidian** | 本地 Markdown 知识库 | 列表/图谱/反向链接、命令面板、可 diff；「文件在，心不慌」 | 不是 agent 记忆，没有写入治理；不能要求用户装它 | [官网](https://obsidian.md) |
| **Letta（MemGPT）ADE** | 有状态 agent 开发环境 | 记忆块（core memory）可视化编辑、边跑边看 | 完整 agent 框架，不是插件；运维重 | [ADE 文档](https://docs.letta.com/v1-sdk/ade) |
| **Zep / Graphiti** | 时序知识图谱 | 双时态（valid_from/valid_to）——我们已有；时间线视图 | 图数据库重，量级不匹配 | [Graphiti](https://github.com/getzep/graphiti)（公开仓库） |
| **Claude Code memory** | 产品内置 `MEMORY.md` 索引 + 主题文件 | **索引/详情分离**；容量预算提示 | 闭源，不能复用实现 | [Anthropic 文档](https://docs.anthropic.com/en/docs/claude-code/memory)（公开文档） |
| **OpenClaw + memory-viewer / dashboard** | 产品内置记忆 + 社区查看器 | 单页浏览/编辑 agent 记忆文件；状态灯、实时面板 | 社区项目质量参差；只借「单页查看器」形态 | [memory-viewer](https://github.com/silicondawn/memory-viewer)、[openclaw-dashboard](https://github.com/tugcantopaloglu/openclaw-dashboard)（仅检索摘要） |
| **MCP Inspector** | MCP 官方调试 UI | 工具/资源/提示分区；「测试调用」面板；原始 JSON 折叠 | 开发者工具，不是日常入口；可做我们的「高级模式」参考 | [MCP Inspector](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector)、[Gcore 教程](https://docs.gcore.com/developer-tools/mcp-server/test-tools-with-mcp-inspector) |
| **Open WebUI** | 本地 LLM Web UI | 模型/知识库/工具设置的组织方式；本地部署的「傻瓜化」 | 通用聊天 UI，不是记忆治理 | [Features](https://docs.openwebui.com/features/) |

**结论**：没有一款同时满足「本地优先 + 人可读 + 审批 + 出处 + 时序」。V2 的差异化不是再做一个 Mem0，而是把**治理过程本身**做成可点、可看、可回滚的界面。UI 参考优先级：WorkBuddy 的首屏/模板化 > Memprobe 的时间线/检索测试 > Basic Memory 的文件感 > MCP Inspector 的高级模式。

### 3.2 界面实现工具与组件

| 工具/库 | 用途 | 取舍 |
|---|---|---|
| **Penpot / Figma** | 画信息架构、关键页高保真 | Penpot 开源可自托管（[官网](https://penpot.app/design/design-tool)）；Figma 协作更顺。**设计稿只用于评审，不进构建链** |
| **shadcn/ui + Tailwind** | 现成表格/对话框/表单 | 代码可复制、无运行时依赖；但与 DSH 宿主视觉 token 不一致，且会增大客户端包。**P1 不引入**，只抄交互，不抄皮肤 |
| **Storybook** | 组件工作台/状态矩阵 | 对 7 个页面很值，但需要独立构建与宿主 mock；**P2 再评估**，P1 用真实宿主手测 + 单测 |
| **assistant-ui** | 聊天消息/工具卡片 React 原语 | 成熟但绑定自己的运行时与样式；我们已有宿主 chat 槽位，**不引入**，只参考消息分组 |
| **DSH 自带 `ui-primitives` / `ui-slots`** | 按钮、对话框、Markdown、slot 类型 | npm 上可获取（`@deepseek-ai/dsh-client-ui-slots`、`ui-primitives`），优先复用；但版本需与宿主锁定，**待验证**具体导出 |

### 3.3 DSH 宿主能力（本机 0.2.1-rc.2 安装包内文档，已核对）

| 能力 | 事实 | 对 V2 的意义 |
|---|---|---|
| 客户端插件声明 | 包 `package.json` 的 `dsh.client`（`platform: 'web'`）+ `exports["./client"]`；宿主扫描 Loader 条目并服务 `/plugins` | 我们的包可以同时是 host bundle 与 client plugin |
| 客户端 bundle 格式 | `window.__ModuleLoader__.load({ id, factory: (require) => {…} })`；factory 内 `require` 共享模块 | 可用 esbuild 自建，不必依赖宿主私有构建链；**P0 必须实测** |
| 侧栏入口 | `sidebar.panellist` 列表注册 `{id, order, label}`，同 id 对应 root `main` keyed slot | 「记忆」全页工作台的入口，点击即开 |
| 设置页 | `settings.section` 贡献页；`settings.general.item` 加行 | 放「记忆」设置（模式、预算、数据目录） |
| 工具卡片 | `tool.call.toolview` 按 wire tool name 注册 | `memory_*` 工具在聊天区显示自定义卡片，而不是通用 JSON |
| 回合尾部 | `conversation.chat.turnTail` 列表 | 「本轮记住 1 条 / 待审 1 条」回执卡 |
| 审批卡片 | 宿主 `userQuestions`（V1 已用） | 保留；P2 可加自定义提案卡 |
| 数据通道 | `ctx.connection.fetch.register({ path, methods, requestBody, fetch })`，精确路由必须在 `/api/…`，只接受 owner peer；浏览器 Cookie 同源 | GUI 读写本地记忆的正式通道 |
| 安装 | Settings → Plugins 支持包名/Git/tarball/本地绝对路径；bundle patch 必需；无 HMR 时需重启 | 分发主路径 |
| 版本 | 宿主 0.2.1-rc.2；npm 已有 `@deepseek-ai/dsh-client-ui-slots`、`ui-primitives`；社区已有第三方 DSH 插件 | 生态可行，但 API 仍在 rc，需锁版本 + compat |

---

## 4. V2.0 产品设计

### 4.1 产品命名与入口

- 产品名：**记忆工作台（Agent Memory）**。
- 一级入口：左侧栏 `sidebar.panellist` 的「记忆」图标（列表项可带待审角标）。
- 二级入口：
  - 聊天区 `memory_*` 工具卡片上的「查看」/「审阅」；
  - 提案卡的「采纳/驳回/暂缓」与「在记忆面板打开」；
  - 设置页「记忆」分区（模式、预算、诊断）。
- 全局快捷键（P2）：`Mod+Shift+M` 打开/关闭记忆面板（若宿主快捷键服务允许注册；**待验证**）。

### 4.2 信息架构（IA）

```text
记忆工作台（全页面板，主区域）
├─ ① 概览 Overview
│   ├─ 状态卡：记忆总数 / 待审提案 / 人设完整度 / 注入预算占用
│   ├─ 快捷动作：浏览记忆 · 审阅提案 · 完善偏好 · 导出备份
│   ├─ 最近记忆（5 条）
│   └─ 系统状态：doctor 摘要、journal head、隔离项
├─ ② 记忆 Memories
│   ├─ 搜索框 + 过滤器（全部 / 事实 / 坑 / 经验 / 已失效）
│   ├─ 列表（虚拟滚动，分页 cursor）
│   └─ 详情（正文 Markdown、元数据、出处、supersede 链、操作）
├─ ③ 提案 Proposals
│   ├─ 待审列表（diff、理由、证据、目标）
│   ├─ 批量选择（采纳/驳回）
│   └─ 历史（已决定，只读）
├─ ④ 人设 Profile
│   ├─ SOUL（散文人格）
│   ├─ USER（§ 条目卡片：增/改/删）
│   └─ RULES（编号规则 + 机器检查状态）
├─ ⑤ 搜索 Search
│   ├─ 记忆（BM25，分数/命中字段）
│   ├─ 会话（原生 sessionQuery，只读）
│   └─ 高级：as-of 时间旅行、原始 JSON
├─ ⑥ 数据 Data
│   ├─ 导出（zip + SHA256）/ 导入（上传 zip，预览后应用）
│   ├─ 重建索引 / 物理清除（T2，二次确认）
│   └─ 打开数据目录（显示路径，复制）
└─ ⑦ 设置 Settings
    ├─ 写入模式（confirm / direct / readonly）
    ├─ 注入预算（只读展示 + 高级编辑）
    ├─ 语言 / 主题（跟随宿主）
    ├─ 版本、检查更新、回滚说明
    └─ 诊断包导出
```

> **布局**：宽屏三栏（导航 200px / 列表 360px / 详情自适应）；窄屏单栏 + 返回。列表与详情同一 URL 状态（面板内 state，不引入路由库）。顶部固定「搜索 + 待审角标 + 刷新」。

### 4.3 首屏（Overview）——「傻瓜式」的核心

**目标**：用户打开就知道「这里有什么、我现在该做什么」，不出现空白页、不出现术语。

- **有数据时**：四张状态卡 + 「继续上次」+ 最近记忆 + 「今天可以做什么」三条建议（按状态生成）：
  - 有 pending 提案 → 「有 2 条修改等你拍板」→ 主按钮「去审阅」；
  - USER 为空 → 「AI 还不知道你的偏好」→ 主按钮「写 3 条偏好」；
  - 7 天无新增 → 「把最近的经验记下来」→ 主按钮「新建记忆」。
- **空数据/首次安装**：三步向导卡（不弹全屏 modal，避免打断聊天）：
  1. **初始化记忆库**（按钮；若已初始化则跳过）——解释「数据只存在你电脑的 `~/.dsh/memory`」；
  2. **写下第一条**：给 3 个模板按钮（「我的职业/角色」「我的表达偏好」「一个项目约定」），点开预填表单；
  3. **让 AI 记住**：给一句可直接发到聊天框的话术（「请记住：…」），并说明「之后它会先提案、你点采纳」。
- **术语翻译**：界面上不出现 `provenance`/`supersede`/`journal` 原文；用「出处」「替代旧记忆」「操作记录」，高级模式再显示原名。
- **空状态插图**：用 CSS/内联 SVG，不引入图片资源包。

### 4.4 记忆列表与详情

**列表行**：摘要（最多两行）· 类型徽章（事实/坑/经验）· 有效时间（「2026-10 起」/「已失效」）· 出处图标（有会话引用）· 待审标记（若正被提案修改）。

**过滤器**：类型 chips、状态（有效/已失效/全部）、时间（近 7/30/90 天）、来源（人/agent）。**排序**：最近更新（默认）、创建时间、类型。**不做「召回次数」排序**——V1 没有该统计，不造假数据。

**详情**：
- 顶部：摘要 + 类型 + 状态 + 复制 ID；
- 正文：宿主 Markdown 渲染（复用 `MarkdownText`，走不可信内容策略；**待验证**能否在自定义面板直接引用）；
- 元数据折叠区：id、content_hash 前 8 位、创建时间、valid_from/valid_until、supersedes（链式，可点跳转）；
- **出处**：列出 `session_id`、`event_seq`、`speaker`、quote、可校验标记；点击「查看原话」打开只读引用卡（不在 V2 内嵌完整会话播放器）；
- 操作：`修正`（P2）、`删除`（写墓碑 + 理由）、`复制为 Markdown`、`高级：查看文件路径`。

**修正语义（重要）**：不直接改旧文件。点「修正」打开表单，预填旧摘要/正文；保存时执行一个事务：新增一条记录（`author: human`，`supersedes: [旧 id]`）+ 给旧记录写 `delete` 行（理由「被人修正」）。UI 明确写：「旧记录会保留可追溯，但不再参与注入与召回。」

### 4.5 提案审批

**列表**：每条提案一张卡：
- 头部：`替代 1 条 / 删除 1 条` + 目标摘要 + 时间；
- 中部：**diff 视图**（旧摘要 → 新摘要；正文折叠展开）；
- 底部：理由（模型给的 reason）、证据 quote（最多 3 条，超出折叠）、`采纳` / `驳回` / `暂缓`。
- 多选后底部出现批量条：`已选 3 条` → 采纳/驳回（二次确认，说明「会写入操作记录」）。

**冲突处理**：采纳前服务端重算 `base_hash`；不一致返回 `409`，卡片变为「内容已变化，请刷新后重评」，不静默覆盖。

**空状态**：「没有待审提案。模型想改记忆时会先放这里，只有你点采纳才会生效。」

**键盘**：`J/K` 上下、`A` 采纳、`R` 驳回、`S` 暂缓、`Esc` 取消选择；输入框聚焦时不拦截。

**证据展示**：quote 用引用块；旁边标注 `会话 … · 事件 #123`；无法校验时显示「出处不可校验（只读展示）」，不假装可信。

### 4.6 人设编辑（SOUL / USER / RULES）

- **SOUL**：大文本域 + 字数/预算进度；提示「这是 AI 的人格底色，建议 200 字内」。
- **USER**：条目卡片列表（V1 的 `§` 分隔语义）；每张卡可编辑/删除；新增卡片；保存时做「单条完整、不内嵌 §、总字数 ≤10000」校验；错误定位到具体条目与字符位置。
- **RULES**：文本域 + 语法提示（编号、`[硬]` 需 check/test）；保存后调用规则解析，显示「3 条规则，2 条有机器检查，1 条仅模型指引」；解析失败给行号。
- **封存**：SOUL/RULES 改动后顶部出现黄色条「这些文件受封存保护，改完需要重新封存才能生效」+ 按钮「重新封存」。点击弹确认（说明这是人专属动作、会更新哈希），成功后绿色条。**绝不自动重封**，保持 V1 的「人专属」边界。
- **USER 写入模式**：若 `personalization.mode=confirm`，页面上说明「AI 修改偏好会先弹卡片」；`readonly` 时显示只读徽章。

### 4.7 搜索

- 一个输入框，两个 tab：**记忆**（BM25）/ **会话**（原生 sessionQuery，只读）。
- 输入 250ms 防抖；显示「找到 N 条 · 用时 xx ms」；结果高亮命中词；空结果给原因（「低于召回阈值」/「没有字面命中」/「索引未重建」）与「重建索引」按钮（人确认）。
- **高级抽屉**：`limit`、`min_score`、`as_of`、原始 JSON；默认收起。这是给老王的，不给小陈添乱。

### 4.8 聊天区卡片

| 卡片 | 挂载点 | 内容 | 交互 |
|---|---|---|---|
| **记忆回执** | `conversation.chat.turnTail` | 「本轮记住 1 条 · 待你审 1 条」+ 两条摘要 | 「查看」→ 打开对应详情/提案；「不再提示」仅本次 |
| **recall 卡** | `tool.call.toolview` key=`memory_recall` | 命中条数 + top 3 摘要 + 分数 | 点条目→打开详情；「查看全部」→ 工作台搜索 |
| **read 卡** | key=`memory_read` | 摘要 + 正文前 6 行 + 出处 | 展开全文、复制、打开详情 |
| **record 卡** | key=`memory_record` | 绿色「已记住」+ 摘要 + id | 打开详情；「撤销」→ 删除确认 |
| **propose 卡** | key=`memory_propose` | 黄色「提案已创建，等你决定」+ diff 摘要 | 采纳/驳回/暂缓（P2 直接调 GUI API；P1 沿用宿主卡片） |
| **context 卡** | key=`memory_context` | 时间线（seq + 说话人 + 预览） | 点击复制 event_seq |
| **rules 卡** | key=`rules_list` | 规则清单 + 硬/软标记 | 打开 RULES 编辑 |
| **user_profile 卡** | key=`user_profile` | 偏好 diff | 「查看偏好」 |

**审批卡**：V1 的 `userQuestions` 卡片继续保留（兼容旧宿主）；P2 增加自定义「提案卡」放在 `turnTail`，两者都调用同一个 decide API，文案一致。自定义卡必须显示「模型不能替你决定」，并在按钮点击后禁用防连点。

### 4.9 关键交互流

**首次使用**
```text
点侧栏「记忆」→ 概览（空）→ 点「初始化」→ 进度 → 成功
→ 模板选「我的表达偏好」→ 填 3 条 → 保存 → 提示「已写入 USER.md」
→ 点「让 AI 记住」→ 复制话术 → 回聊天框粘贴 → 模型调 memory_record
→ 回执卡「已记住 1 条」→ 点「查看」→ 详情
```

**审批**
```text
模型 memory_propose → 聊天区 propose 卡 + 侧栏角标 +1
→ 点「审阅」→ 提案列表 → 看 diff/证据 → 点「采纳」
→ 二次确认（说明不可撤销、会写 journal）→ API 200 → 卡片变绿「已采纳」
→ 记忆列表出现新记录，旧记录标「已失效」→ 角标 -1
```

**修正**
```text
记忆详情 → 「修正」→ 表单预填 → 保存 → 确认「旧记录将失效但保留」
→ 事务：新记录 + 旧记录 delete 行 → 成功 → 跳新记录详情
```

**导入**
```text
数据 → 导入 → 选 zip → 上传到宿主临时目录 → 校验 SHA256/结构/版本
→ 预览「将新增 42 条、跳过 3 条重复、2 条冲突」→ 确认
→ 自动备份当前库 → 应用 → 结果报告（成功/跳过/失败明细）
```

### 4.10 空/错/加载状态（必须逐个设计）

| 状态 | 文案与动作 |
|---|---|
| 加载中 | 骨架屏（列表 6 行），不转圈遮全屏 |
| 无数据 | 「还没有记忆。AI 记住的第一件事，可以从这里开始。」+ 新建 |
| 宿主未连接 | 「DSH 连接中断，正在重试…」+ 手动重试（复用宿主 connection 状态） |
| 插件未启用 | 「记忆插件未启用」+ 打开 Settings → Plugins |
| 数据目录缺失 | 「还没有初始化」+ 初始化按钮 + 显示路径 |
| 启动失败 | 红色诊断卡：点名文件/键 + 可复制修复命令 + 「打开诊断」；写操作禁用 |
| journal 断链 | 红色只读横幅：「为保护数据，写入已暂停」+ 导出备份 + 恢复步骤链接（docs/ops.md §8） |
| 提案冲突 | 黄色「内容已变化」+ 刷新按钮，不自动重试 |
| 无权限/子 agent | 只读徽章（GUI 本来就是人操作，主要防误触） |

---

## 5. 技术架构

### 5.1 总览

```text
┌──────────────────────────── 浏览器（DSH Web GUI） ────────────────────────────┐
│  @agent-memory/dsh 客户端半层（React，client.js）                              │
│  ├─ sidebar.panellist「记忆」 + main keyed panel「agent-memory」               │
│  ├─ tool.call.toolview（memory_* / user_profile / rules_list）                │
│  ├─ conversation.chat.turnTail（记忆回执 / 提案卡）                            │
│  └─ settings.section（记忆设置）                                              │
│         │ 同源 fetch /api/agent-memory/*（Cookie，HttpOnly + SameSite=Strict） │
└─────────┼─────────────────────────────────────────────────────────────────────┘
          ▼
┌──────────────────────── 宿主进程（Cordis 插件） ──────────────────────────────┐
│  @agent-memory/dsh 宿主半层                                                    │
│  ├─ plugin.ts：V1 工具/命令/注入（不变） + 注册 routes                         │
│  ├─ routes.ts：ctx.connection.fetch.register（精确 /api 路由，owner-only）     │
│  ├─ api.ts：请求校验 → 调 core（纯逻辑，可单测）                               │
│  └─ core：MemoryStore / runHumanCommand / profile / journal / policy          │
└─────────┼─────────────────────────────────────────────────────────────────────┘
          ▼
   ~/.dsh/memory/  memories/ · proposals/ · SOUL/USER/RULES · .state/journal · .index
```

**一个进程、一个包、两半层**：宿主半层已经存在（V1）；V2 新增客户端半层与路由层，不新增 daemon。MCP 是**独立进程**，只在外部平台使用时启动。

### 5.2 为什么用「精确 Fetch 路由」而不是自造 Remote

候选：
1. 走 DSH 的 Typert/Remote 代码生成：类型安全最好，但需要接入宿主的 `/remote` 生成与 `dsh-api-remotes` 装配，第三方包很难独立完成，且每个宿主版本可能变。
2. 注册 `ctx.connection.fetch` 精确路由：宿主公开服务，路径必须在 `/api/…`，自动继承浏览器认证与 Host/Origin 防护；浏览器 `fetch` 同源即可。**选它**。
3. 自建 HTTP server：多一个端口、多一套认证、与宿主断开；**否**。
4. 只靠工具调用结果渲染：读不到全量列表/提案；**不够**。

**约束**：精确路由按 pathname 精确匹配，不能有 `:id` 路径参数；统一用 query（`?id=`）。路由返回 `Response`；写操作只接受 `POST` + `application/json`；不实现 CORS。若宿主未提供 `connection`（极简组合），客户端隐藏入口并提示「当前宿主不支持图形界面」。

### 5.3 客户端插件契约

```jsonc
// packages/dsh/package.json（新增字段）
{
  "name": "@agent-memory/dsh",
  "version": "2.0.0",
  "type": "module",
  "main": "./dist/plugin.mjs",
  "exports": {
    ".": "./dist/plugin.mjs",
    "./client": "./lib/client.js"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-layout", "..."] }
  },
  "files": ["dist", "lib/client.js", "cordis.patch.yml", "locale/*.json"]
}
```

- `dsh.client.inject` 列的是客户端要用的客户端包（slot 服务、layout、settings）；具体名字以宿主版本为准，**P0 实测**。
- bundle 格式（已从宿主包 `lib/client.js` 核对）：
```js
window.__ModuleLoader__.load({
  id: '@agent-memory/dsh',
  factory: (require) => {
    const React = require('react');
    // ... 组件与 apply()
    return { apply, inject };
  }
});
```
- 构建：`scripts/build-client.mjs` 用 esbuild 打 CJS，外置 `react`、`react-dom`、`react/jsx-runtime`（以及可选的 `@deepseek-ai/dsh-client-ui-primitives`），再用 banner/footer 包成上面的 factory；CSS 以字符串在 `apply` 时注入一次（`<style data-agent-memory>`），避免依赖宿主的 CSS 抽取。
- **不引入** Tailwind/shadcn 运行时；颜色用宿主 `--dsw-alias-*` / `--dsh-*` 变量 + 少量自有变量，跟随明暗主题。
- 图标：内联 SVG（16/20px），不引图标库。

### 5.4 数据流与状态

- **读**：面板打开 → `GET /api/agent-memory/overview` + 列表首页；搜索/翻页按需；面板聚焦、`connection/reset`、动作完成后刷新。
- **写**：按钮 → `POST`（JSON）→ 服务端返回 `{ok, text, journalSeq, data}` → 成功 toast + 局部刷新；失败按 `code` 映射文案（`conflict` / `sealed` / `journal-inconsistent` / `readonly` / `not-found`）。
- **轮询**：面板可见时 5s 拉一次 overview（轻量，<2KB）；页面隐藏时停止；P2 可升级 SSE（`GET /api/agent-memory/events`，宿主 route 返回 `ReadableStream`），但**不作为 P1 依赖**。
- **缓存**：内存内 store（`useSyncExternalStore`），不落 localStorage（避免跨用户/跨版本脏数据）；只记住「上次打开的 tab」。
- **乐观更新**：只用于「暂缓/标记已读」这类无副作用动作；采纳/驳回必须等服务端确认。

### 5.5 HTTP API（GUI 与外部 HTTP 共用语义）

> 全部路径前缀 `/api/agent-memory`；GUI 路由只接受 owner peer；外部 HTTP（可选）另用 Bearer token。

| 方法 | 路径 | 作用 | 阶段 |
|---|---|---|---|
| GET | `/health` | 版本、home、store 状态、journal head | P0 |
| GET | `/overview` | 计数、待审、预算、doctor 摘要 | P1 |
| GET | `/memories?q=&kind=&status=&cursor=&limit=` | 列表/召回 | P1 |
| GET | `/memory?id=` | 详情 + 出处 + 链 | P1 |
| GET | `/proposals` | 待审/历史 | P1 |
| POST | `/proposals/decide` | `{id, decision, note?}` | P2 |
| POST | `/proposals/decide-batch` | `{ids, decision}` | P2 |
| POST | `/memories/add` | `{kind, abstract, body}`（author=human） | P2 |
| POST | `/memories/correct` | `{id, kind, abstract, body, reason}`（新记录+旧失效，单事务） | P2 |
| POST | `/memories/delete` | `{id, reason}` | P2 |
| POST | `/memories/purge` | `{id, reason, confirm:true}` | P2 |
| GET | `/profile` | 三份文件 + 封存状态 + 字数 | P1 |
| PUT | `/profile` | `{file, content}` 或 `{file, items[]}`（USER） | P2 |
| POST | `/profile/reseal` | 人确认后重封 | P2 |
| GET | `/search?q=&mode=memory|session` | 搜索 | P1 |
| GET | `/export?format=zip` | 流式下载备份 | P2 |
| POST | `/import` | multipart，校验后应用 | P3 |
| POST | `/rebuild` | 重建索引 | P2 |
| GET | `/doctor` | 结构化诊断 | P1 |

**响应约定**：`{ok:true, data, text?, journalSeq?}` / `{ok:false, code, message, next?}`；HTTP 状态码 200/400/401/403/404/409/422/500；错误 `message` 中文、点名文件/键，`next` 给下一步命令或按钮。

### 5.6 权限、审计与威胁模型

| 面 | 规则 |
|---|---|
| 模型 | 只能调 V1 工具；`decide` 永不是工具；GUI 路由不在工具表里 |
| 人（GUI） | 所有写操作二次确认（删除/清除/重封/批量采纳）；按钮点击即人意 |
| 浏览器认证 | 宿主 HttpOnly Cookie + SameSite=Strict + Host/Origin 栅栏；仅同源；CORS 不开放 |
| 写请求 | 仅 `POST` + `application/json` + 自定义头 `X-Agent-Memory-Surface: gui`；拒绝 GET 写 |
| 审计 | journal 增 `audit` 行：`{surface:'gui', action, target, result, at}`；不记录正文；与 command/run 审计并存 |
| 本地其他进程 | 读不到浏览器 Cookie；若拿到数据目录读权限，本就能读文件——不把它当安全边界（docs/ops.md §5 同款声明） |
| 子 agent | 只读工具；GUI 不区分，但写操作是人点 |
| MCP | 默认只读 + `memory_propose`；`memory_record` 需显式 `--allow-record`；没有 `decide` |

### 5.7 与 V1 核心的边界

| 层 | V1 现状 | V2 改动 |
|---|---|---|
| 数据格式 | 记忆 frontmatter 行式 JSON；journal 单链；proposal JSON | **不改**；只加 journal `audit.data.surface`（可选字段，旧行仍合法） |
| core | `MemoryStore`、`runHumanCommand`、`assemble`、`startup` | 新增 `humanCorrect`（新记录+旧 delete 单事务）、`writeHumanProfile`（校验+可选重封）、`exportZip`；全部纯函数、可单测 |
| dsh 宿主 | 工具/命令/注入/卡片 | 新增 `routes.ts`；`plugin.ts` 注册/释放；不改工具表语义 |
| CLI | `mem` 全命令 | 新增 `--json` 稳定输出、`mem setup`、`mem mcp`；旧命令不变 |
| 客户端 | 无 | 新增 `packages/client`（或 `packages/dsh/src/client`），独立构建 |

### 5.8 待验证清单（P0 必须逐条给结论）

| # | 假设 | 验证方式 | 不成立时的降级 |
|---|---|---|---|
| V1 | 第三方包用 esbuild + `__ModuleLoader__` 包装可被宿主加载 | 最小 client 包挂到真实桌面 profile，看侧栏出现 | 改用宿主 tsdown 模板；再不行退回「只用宿主卡片 + `/mem`」 |
| V2 | `sidebar.panellist` + `main` 同 id 可开全页面板 | 真机点击 | 用 `shell.bottom` 或 settings 页承载 |
| V3 | `ctx.connection.fetch.register` 在桌面组合可用 | 路由 `GET /api/agent-memory/health` 返回 200 | 改用 `ctx.connection.rpc` 或宿主 `webServer` 路由 |
| V4 | 客户端 fetch 自动带 Cookie 且过 Origin 栅栏 | 真机请求 | 宿主注入一次性 token 到 boot 数据 |
| V5 | `tool.call.toolview` 的 owner props 足够渲染 recall/read | 真机工具卡 | 只用通用卡 + turnTail 回执 |
| V6 | `conversation.chat.turnTail` 能拿到本轮工具调用数据 | 真机 | 回执改到工具卡内 |
| V7 | `settings.section` 的注册形状与生命周期 | 真机 | 设置并入工作台第 7 页 |
| V8 | `@deepseek-ai/dsh-client-ui-primitives` 可外置复用 | 构建 + 真机 | 全部自绘（成本 +2d） |
| V9 | Codex 的 `mcp_servers` 配置键与启动方式 | 本机 Codex 实测 | 先文档 + CLI 包装，MCP 延后 |
| V10 | npm 包名 `@agent-memory/dsh` 可用/可发布 | `npm view` / 发布预演 | 改 `dsh-agent-memory` 或只发 tarball |
| V11 | 桌面宿主是否允许客户端插件注册全局快捷键 | 真机 | 不做快捷键 |
| V12 | 自定义 Markdown 渲染是否复用宿主不可信策略 | 真机 XSS 用例 | 纯文本 + 受限 Markdown |

---

## 6. 插件打包与一键部署

### 6.1 产物

| 产物 | 内容 | 何时发布 |
|---|---|---|
| `@agent-memory/dsh@2.x` | 宿主半层 `dist/plugin.mjs` + 客户端 `lib/client.js` + `cordis.patch.yml` + locale + `package.json` | P3 |
| `@agent-memory/mcp@1.x` | MCP stdio server（复用 core，独立进程） | P3 |
| `agent-memory-2.x.tgz` | 上述包的离线包 + `SHA256SUMS` | 每个 RC |
| `mem` CLI | 已存在，随仓库/包发布 | 持续 |

包内**不打包**数据、不打包用户配置；`files` 白名单只含运行必需文件。

### 6.2 安装路径（按用户能力分层）

**A. 图形安装（推荐给小陈）**
1. DSH → Settings → Plugins → **Add plugin**；
2. 输入包名 `@agent-memory/dsh`（或选择本地 `.tgz`/目录）；
3. 宿主 `pnpm add` → 校验 bundle patch → 默认启用；
4. 提示「需要重启 DSH」→ 重启 → 侧栏出现「记忆」；
5. 首次打开 → 初始化向导。

**B. 命令安装（老王/脚本）**
```powershell
dsh plugin add @agent-memory/dsh --profile desktop
# 或离线
dsh plugin add .\agent-memory-dsh-2.0.0.tgz --profile desktop
# 开发期
dsh plugin add link:"D:\Ai Agent\Agent Memory\packages\dsh" --profile desktop
```
> CLI 的具体参数（`--profile` 位置、是否需要 `--accept`）以宿主 `dsh plugin --help` 为准，**待验证**；本仓库已有 `scripts/install-desktop-plugin.mjs` 可先兜底。

**C. 一键脚本（双击）**
`mem setup` / `install-agent-memory.cmd`：
1. 检测 DSH 安装与运行版本（`0.2.x` 白名单）；
2. 备份 profile 的 `package.json`、`cordis.patch.yml`、`pnpm-lock.yaml`；
3. 写依赖 + bundles 末尾追加（保持顺序）；
4. 调宿主 pnpm 安装（路径从 DSH 安装目录解析，不假设全局 pnpm）；
5. `import('@agent-memory/dsh')` 校验导出 `apply/inject`；
6. 失败自动回滚备份并打印原因；成功打印「请重启 DSH」；
7. `--dry-run` 只打印将改什么（默认）。

**D. 不做**：单文件 `.exe` 安装器（需签名、会碰 Electron profile 锁、审计困难）；等 P3 后确有需求再评估。

### 6.3 bundle patch 与 profile 变更

`cordis.patch.yml` 保持最小：
```yaml
- id: agent-memory
  name: "@agent-memory/dsh"
  config:
    home: "~/.dsh/memory"
    ui:
      enabled: true
```
- 不写死绝对路径；`home` 缺省走 `resolveHome`。
- 不在 patch 里覆盖宿主配置；只加自己的行。
- 客户端半层由 `dsh.client` 自动发现，不需要 patch。

### 6.4 升级

- **语义化版本**：`2.x` 内数据格式不变；`3.0` 才允许破坏性格式迁移。
- **检查更新**：GUI「设置 → 检查更新」→ 打开 Plugins 页的 bundle 详情（`ctx.pluginNavigation.openBundle`，宿主已有），由宿主负责 Update/卸载重装；**不自建更新器**（避免与宿主 profile 锁冲突）。
- **升级前**：自动提示「先导出备份」；一键导出 zip。
- **迁移**：启动时读 `format_version`；高于当前 → 拒绝启动并提示升级插件；低于当前 → 备份后迁移。
- **回滚**：`mem rollback` 恢复最近一次 profile 备份（package.json + lockfile + bundle 选择）并重装旧版；数据不自动回退（forward-only），但备份 zip 可人工恢复。回滚演练必须进 P3 验收。

### 6.5 发布门禁

- `npm pack` 内容清单固定（无 test/docs/源 map 可选）；
- 干净 profile 安装 smoke（Windows 路径含空格/中文）；
- 宿主版本矩阵：`0.2.1-rc.2` 必测，下一 rc 预演；
- 不联网启动（除检查更新外零网络）；
- `node scripts/ci.mjs` 全绿；新增客户端构建脚本纳入 CI；
- 安全扫描：无 `eval`、无远程脚本、无 `dangerouslySetInnerHTML` 未净化路径。

---

## 7. 跨平台外挂接口

### 7.1 统一 Memory API v1（传输无关）

**资源**：
- `Memory`：`id, kind, abstract, body, valid_from, valid_until, supersedes[], provenance[], error_signatures[], content_hash`
- `Proposal`：`id, op, targets[], replacements[], reason, evidence[], status`
- `Profile`：`soul, user_items[], rules[]` + 封存状态
- `SearchResult`：`id, score, matched_fields[]`

**操作**：`recall / read / list / add / correct / delete / propose / decide(human-only) / profile.get / profile.update / export / import / doctor`。

**版本**：`api_version: "1"`；字段只增不改；新增可选字段不升 major。

### 7.2 适配层取舍

| 传输 | 适用 | 优点 | 代价 | 结论 |
|---|---|---|---|---|
| **MCP stdio** | Codex、Claude Code、其他支持 MCP 的 agent | 生态标准；工具/资源/提示都能表达；进程隔离 | 每个客户端各配一次；无 GUI 卡片，审批要靠 DSH/GUI | **首选** |
| **CLI `mem`** | 脚本、CI、无 MCP 的工具 | 已有；退出码稳定；可 `--json` | 需要用户会终端；无法交互审批 | **保留并增强** |
| **本地 HTTP** | 自建 UI、语言无关集成 | 通用；可流式 | 多端口/认证/CSRF 面；默认关闭 | **可选，仅 127.0.0.1 + token** |
| **直接读文件** | 只读备份/分析 | 零依赖 | 绕过锁与 journal；只能读 | 不推荐，文档标注风险 |

### 7.3 MCP server 设计

- 包：`@agent-memory/mcp`，`bin: mem-mcp`；`AGENT_MEMORY_HOME` 或 `--home`。
- Tools（与 V1 对齐）：
  - `memory_recall` / `memory_read` / `memory_context` / `rules_list`（只读）
  - `memory_propose`（写提案，需要 `base_hash`）
  - `memory_record`（默认关闭；`--allow-record` 才注册，且仍写 provenance=`external`）
  - `session_*` 只在 DSH 内可用，MCP 不暴露（没有宿主 sessionQuery）
  - **没有 `decide`、没有 `purge`、没有 `seal`**。
- Resources：`memory://<id>`、`memory://profile/user`、`memory://proposals/pending`（只读）。
- 写策略：默认「提案 → 人在 DSH 工作台/`/mem decide` 采纳」；外部 agent 不能自批。
- 并发：MCP 进程长期运行，每次读写前 `store.reload()`；文件锁与 DSH 共用；冲突返回可读错误。
- 安装：`npx @agent-memory/mcp` 或全局安装；Windows 路径用绝对路径。

**Codex 配置（待验证精确键名）**：
```toml
# ~/.codex/config.toml
[mcp_servers.agent-memory]
command = "node"
args = ["C:\\Users\\<you>\\AppData\\Roaming\\npm\\node_modules\\@agent-memory\\mcp\\bin\\mem-mcp.mjs"]
env = { AGENT_MEMORY_HOME = "C:\\Users\\<you>\\.dsh\\memory" }
```
> Codex 支持 `mcp_servers` 配置已被公开文档/提交证实（[Codex MCP Servers](https://mintlify.wiki/openai/codex/configuration/mcp-servers)、[config.md 提交](https://github.com/openai/codex/blob/65cc12d72e25723aece48edd6ff93dd288b6c042/docs/config.md)）；字段细节以本机 Codex 版本为准。

### 7.4 外部 provenance（关键完整性设计）

外部平台没有 DSH `event_seq`。**绝不伪造**。新增可选结构：

```json
{
  "source": {
    "kind": "external",
    "platform": "codex",
    "session": "<platform session id>",
    "quote": "用户原话片段",
    "content_sha256": "<quote 的哈希>",
    "captured_at": "2026-10-18T10:00:00+08:00"
  }
}
```

- core 校验：`quote` 非空、`content_sha256` 匹配、`platform` 白名单；`event_seq` 与 `source` 二选一，不可同时伪造。
- 注入与 `memory_read` 显示「外部来源（Codex）」；`provenance_verifiable` 对 DSH 事件仍走原校验，对外部来源标 `external`，不冒充「已验证」。
- 该字段是**加法**；旧记录无 `source` 仍合法；导出/导入保留。

### 7.5 平台适配优先级

1. **Codex**（MCP）：用户明确点名；配置一次即可。
2. **Claude Code / 其他 MCP 客户端**：零额外代码，文档给配置片段。
3. **自建脚本**：CLI `--json`。
4. **HTTP**：最后，默认关闭。

---

## 8. 分阶段路线（P0–P3）

> 估时假设：1 名熟悉 React + DSH 的全栈，包含自测与文档；不含设计稿评审等待。每个阶段的验收项都要落成测试用例或人工走查记录（沿用仓库「验收项写成测试」约定）。

### P0 · 技术验证与骨架（2–3 人日）

| 交付 | 内容 |
|---|---|
| 最小客户端包 | esbuild 构建、`__ModuleLoader__` 包装、`dsh.client` 声明、侧栏「记忆」+ 空白面板 |
| 最小路由 | `GET /api/agent-memory/health` 返回 `{version, home, journalHead}` |
| 真机装载 | 桌面 profile 安装、重启、面板出现、health 200 |
| 结论文档 | 更新 §5.8 的 12 条待验证，逐条「成立/不成立/降级」 |

**验收**：
- `P0.1` 侧栏出现「记忆」，点击打开面板（截图 + 真机记录）；
- `P0.2` 浏览器请求 health 返回 200 且 JSON 字段正确；
- `P0.3` 构建可重复（两次构建 hash 一致或差异仅时间戳）；
- `P0.4` 未修改宿主源码/未 fork；
- `P0.5` 卸载后 V1 `/mem` 与工具仍正常（无残留注册）。

**出口条件**：V1–V4 至少成立；否则回到「宿主卡片 + `/mem`」方案，暂停 P1。

### P1 · 只读工作台（5–6 人日）

| 交付 | 内容 |
|---|---|
| 页面 | 概览、记忆列表/详情、提案列表、人设只读、搜索、诊断 |
| API | overview / memories / memory / proposals / profile / search / doctor |
| 聊天卡 | recall / read / context / rules 的 toolview；turnTail 回执（只读版） |
| 体验 | 加载/空/错状态、响应式、键盘可达、中文文案、明暗主题 |

**验收**：
- `P1.1` 1000 条 fixture 下列表首屏 < 300ms、滚动不卡（人工 + 计时）；
- `P1.2` 列表过滤/分页/搜索与 CLI 结果一致（对拍 20 组）；
- `P1.3` 详情正文/出处/supersede 链与 `mem read` 一致；
- `P1.4` doctor 异常（journal 断链、隔离项）在 GUI 正确显示且写按钮禁用；
- `P1.5` 面板关闭/重开、断线重连不丢状态、不发重复请求；
- `P1.6` 所有空/错状态有文案与下一步（走查清单 9 项）。

### P2 · 人工写流与审批（6–8 人日）

| 交付 | 内容 |
|---|---|
| 审批 | 单条/批量采纳/驳回/暂缓、冲突 409、二次确认、journal 审计 `surface=gui` |
| 记忆 | 新增、修正（新记录+旧失效）、删除（理由）、清除（T2 二次确认） |
| 人设 | SOUL/USER/RULES 编辑、USER 条目卡片、校验、重新封存 |
| 数据 | 导出 zip、重建索引、导入（P2 末或 P3 初） |
| 卡片 | 自定义提案卡（turnTail）+ 工具卡写操作 |

**验收**：
- `P2.1` 采纳后：新记录 active、旧记录失效、journal 连续、`mem inspect` 一致；
- `P2.2` base_hash 冲突返回 409，不产生部分写入（故障注入）；
- `P2.3` 修正为单事务：断电模拟（kill）后重启无半条记录；
- `P2.4` USER 条目增改删后注入立即生效（下一轮 system prompt 快照变化）；
- `P2.5` SOUL/RULES 改动未重封 → 启动失败并点名；重封后恢复；
- `P2.6` 删除/清除/批量采纳都有二次确认，取消不写 journal；
- `P2.7` 导出 zip 的 SHA256 与 `mem export` 一致；导入预览数字与最终一致；
- `P2.8` 所有写路由拒绝 GET/无自定义头/跨源请求（安全用例）。

### P3 · 分发、外挂与发布（7–10 人日）

| 交付 | 内容 |
|---|---|
| 分发 | npm 包、tgz、`mem setup` 一键脚本、干净 profile 安装 smoke |
| 升级/回滚 | 检查更新跳转、备份、`mem rollback`、回滚演练 |
| MCP | `@agent-memory/mcp`、Codex 配置文档、端到端实测 |
| CLI | `--json` 稳定输出、`mem mcp`、`mem serve`（可选） |
| 文档 | 用户手册重写（图 + 步骤）、开发者文档、ADR、兼容矩阵 |

**验收**：
- `P3.1` 干净 Windows 用户目录（无仓库）从 tgz 安装到侧栏出现 < 5 分钟，全程 GUI；
- `P3.2` 卸载/回滚后 profile 与安装前一致（文件 diff）；
- `P3.3` Codex 通过 MCP 完成：recall 命中、propose 生成、DSH 采纳后 Codex 再读可见；
- `P3.4` 外部 provenance 校验通过；伪造 `event_seq` 被拒；
- `P3.5` 升级 `2.0.0 → 2.0.1` 数据零丢失；`format_version` 更高时拒绝启动；
- `P3.6` 全套 `node scripts/ci.mjs` + 新客户端构建 + 安装 smoke 绿。

**总估时**：20–27 人日；含缓冲建议 4–5 周。关键路径：P0 的 V1/V3 两项验证。

---

## 9. 风险与取舍

| 风险 | 概率/影响 | 缓解 | 触发后的动作 |
|---|---|---|---|
| 客户端插件 API 在 rc 版本变动 | 高/高 | 锁宿主版本；P0 只依赖 4 个稳定面；feature-detect；release 矩阵 | 暂停 P1，先补兼容层或退回宿主卡片 |
| 第三方构建链不可用 | 中/高 | esbuild 自建 + 真机验证；保留宿主 tsdown 模板备选 | 改为「预构建产物 + 不做本地构建」 |
| 路由/认证被宿主收紧 | 中/高 | 只用 owner peer + 同源；不开放 CORS；P0 实测 | 改用 `connection.rpc` 或只读快照注入 |
| XSS（记忆正文含恶意 Markdown/HTML） | 中/高 | 复用宿主不可信 Markdown 策略；禁止原始 HTML；CSP 由宿主 | 降级纯文本渲染 |
| 大数据量卡顿 | 中/中 | 分页/cursor、虚拟列表、防抖、服务端 limit 上限 | 加索引/限制默认 50 条 |
| GUI 与 CLI 行为分叉 | 中/中 | 同一 core 函数；对拍测试；文案共用字典 | 以 CLI 为准修 GUI |
| 双入口导致误操作 | 中/中 | 危险动作二次确认；批量上限；操作历史可查 | 收紧为逐条 |
| 模型绕过审批（外部 MCP） | 中/高 | MCP 默认只读+提案；无 decide；record 需显式开关 | 关闭 record，只留 propose |
| 升级破坏数据 | 低/高 | 迁移前备份；format_version；forward-only | 停写 + 从备份恢复 |
| 包名/scope 不可用 | 中/低 | 预演 `npm view`；备选名；tarball 兜底 | 改包名，代码不变 |
| 非开发者仍被「封存/提案」术语吓到 | 中/中 | 术语翻译层；默认折叠高级概念；向导 | 用 5 名非开发者做可用性测试 |
| 维护成本（两半层 + MCP + CLI） | 高/中 | 共用 core；薄适配层；CI 矩阵；文档单一事实源 | 砍 HTTP，保留 MCP/CLI |

**明确取舍**：
- 用「宿主插件位」换「独立应用」：省掉窗口/导航/主题/认证，但受宿主版本约束。
- 用「精确 Fetch 路由」换「Typert Remote」：省代码生成与宿主装配，代价是手写请求/响应校验。
- 用「轮询」换「实时事件」：P1 简单可靠，P2 再评估 SSE。
- 用「MCP 提案制」换「外部直接写」：牺牲一点顺滑，保住「只有人能决定」。
- 用「一个共享数据目录」换「每平台一份」：跨平台一致，代价是并发与来源标注要做对。

---

## 10. 拍板结果（2026-10-18）

| # | 问题 | 决定 |
|---|---|---|
| 1 | 发布渠道 | 先出 `.tgz`，下一版开发后再发布；不先发 npm |
| 2 | 入口形态 | 侧栏「记忆」+ 全页工作台；界面参考 Opus 5.5 的简洁风格，命令行手册做成小按钮跳转 |
| 3 | 默认写入 | `confirm` 默认；UI 提供一键切换（纯新手原则） |
| 4 | MCP 写权限 | 只读 + 提案 |
| 5 | 审批卡 | 两种都做（聊天卡 + GUI 卡），同一 `decide` 与审计 |
| 6 | 平台优先级 | DSH 与 Codex 一起 |
| 7 | 数据目录 | 共用 `~/.dsh/memory` |
| 8 | 审计字段 | 增加 `surface`；**RULES/封存等硬约束只有人亲自在 GUI 操作才写入** |
| 9 | 视觉基线 | 先用默认风格；独立视觉 V3 再做，留设计令牌接口 |
| 10 | P0 闸门 | 接受「不通过就退回宿主卡片 + `/mem`」 |

详见 [V2.0 架构审核与预期](v2-architecture-review.md)（含三层对照、耦合审计、模块化与替换性方案）。

---

## 11. 给主 Agent 的摘要（≤400 字）

> V2.0 建议做成**同一个 npm 包里的 DSH 客户端插件**，不改宿主源码：侧栏「记忆」入口 + 全页工作台（概览/记忆/提案/人设/搜索/导入导出/设置），聊天区用 `tool.call.toolview` 和 `turnTail` 显示记忆回执与提案卡；数据经宿主 `ctx.connection.fetch` 的 `/api/agent-memory/*` 同源路由读写，客户端不碰文件。界面只服务「人」：采纳/驳回仍由人点击，模型工具面不变；修正=新记录+旧记录失效，全部走 core 与 journal，新增 `surface:gui` 审计。分发用 bundle patch + `dsh.client`，装法优先 Settings→Plugins，配 `mem setup` 一键脚本与回滚；外挂先做 MCP stdio（Codex 用 `mcp_servers` 配置），默认只读+提案，外部来源用 `source` 结构、绝不伪造 DSH event_seq。路线 P0 技术验证 2–3 人日、P1 只读 5–6、P2 写流 6–8、P3 分发外挂 7–10，合计 20–27 人日；P0 的客户端构建/侧栏面板/路由三项不通过就退回「宿主卡片 + `/mem`」。需拍板：包名与发布渠道、入口形态、默认写入模式、MCP 写权限、审批卡形态、平台优先级、是否共用数据目录、审计字段、视觉基线、P0 闸门授权。

---

### 附：主要来源

- DSH 公开仓库：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)；客户端插件规范：[packages/client/AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)。
- 本机 DSH 0.2.1-rc.2 安装包内 README：`@deepseek-ai/dsh-client-ui-layout`、`dsh-client-ui-sidebar`、`dsh-client-ui-settings`、`dsh-client-ui-tool`、`dsh-client-ui-conversation`、`dsh-client-ui-plugin-manager`、`dsh-plugin-manager`、`dsh-client-connection`（已逐条核对，文中「已核对」均指这些文档/源码）。
- WorkBuddy：[灵感](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Ispiration)、[设置](https://www.codebuddy.cn/docs/workbuddyapp/Settings)、[照着抄一份](https://cloud.tencent.cn/developer/article/2745828)、[知识库与记忆](https://cloud.tencent.cn/developer/article/2671974)、[一句话搭工作台](https://cloud.tencent.cn/developer/article/2720607)。
- 记忆产品：[Mem0 OpenMemory MCP](https://mem0.ai/blog/introducing-openmemory-mcp)、[Memprobe](https://github.com/rrahul-1/Memprobe)、[Basic Memory × Obsidian](https://basicmemory.com/for/obsidian)、[Letta ADE](https://docs.letta.com/v1-sdk/ade)、[OpenClaw memory-viewer](https://github.com/silicondawn/memory-viewer)、[MCP Inspector](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector)、[Open WebUI](https://docs.openwebui.com/features/)。
- 设计/组件：[Penpot](https://penpot.app/design/design-tool)、[Storybook](https://storybook.js.org/docs/writing-stories/build-pages-with-storybook)、[assistant-ui](https://www.assistant-ui.com/elements/message-pair.md)、[shadcn/ui](https://ui.shadcn.com)。
- Codex MCP：[MCP Servers 文档](https://mintlify.wiki/openai/codex/configuration/mcp-servers)、[config.md](https://github.com/openai/codex/blob/65cc12d72e25723aece48edd6ff93dd288b6c042/docs/config.md)。
- npm 可用性：[`@deepseek-ai/dsh-client-ui-slots`](https://www.npmjs.com/package/@deepseek-ai/dsh-client-ui-slots)、[`@deepseek-ai/dsh-client-ui-primitives`](https://www.npmjs.com/package/@deepseek-ai/dsh-client-ui-primitives)；社区插件：[DSH-Plugins](https://github.com/nguyenhnhatquang/DSH-Plugins)、[dsh-gitnexus-plugin](https://github.com/akash-digitavision/dsh-gitnexus-plugin)。

> 说明：`web_fetch` 在本机被 DNS 策略阻断，以上链接来自 `web_search` 结果与公开常识；未逐页打开全文的条目已在正文标「仅检索摘要」。文中不写精确 star 数；「量级」仅用于说明生态规模。
