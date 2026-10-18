# V3.0 开发方案：独立视觉、手写工作流与正式发布

> 状态：**V3.0 视觉（含 Chrome 调色板）已完成；V3.1 手写/整理/SOUL 已完成（第 27 轮）；V3.2 未开工** · 日期：2026-10-18 · 基线：DSH 桌面 0.2.1-rc.2、Agent Memory V2（P3.5/P3.8，248 测试）
> 一句话：V3 不再加"记忆内核"，而是把它变成**看起来像成熟产品、用起来不需要命令、装起来像普通软件**的本地记忆工具。

## 0. 结论先行

1. **视觉独立**：以 Opus/Claude 的"安静、留白、弱边框、强排版"为底，借 WorkBuddy 的"首屏给能力、模板化入口"，借 Linear/Raycast 的"列表密度与键盘手感"。默认跟随宿主明暗，但拥有自己的 `am-*` 令牌层，不再逐处 fallback。
2. **手写工作流**：三个分组各自提供「新增一条」表单（人工条目、`author=human`、GUI 审计）；「整理记忆」由人手动触发，产出**分条建议**，用户勾选后才进 RULES 草稿，**永不自动写规则**；SOUL 只显示路径，不提供读取/写入入口，GUI 永不碰这个文件。
3. **正式发布**：npm 公共包 + GitHub Release `.tgz` 双通道；设置 → 插件一键装/升/卸，`mem setup` 作为终端兜底；版本、迁移、回滚、校验、许可证一次做齐；不做自研更新器。
4. **路线**：V3.0 视觉与组件（5–7 人日）→ V3.1 手写与整理（6–8）→ V3.2 发布与安装（5–7）→ V3.3 打磨与兼容（4–6）；合计 **20–28 人日**。

## 1. 目标与非目标

### 1.1 目标

| # | 目标 | 可验收定义 |
|---|---|---|
| G1 | 独立视觉 | 有 `am-*` 令牌与组件层；明暗两套；列表/详情/表单/弹层在 1280 与 900 宽下不溢出；不再出现宿主未定义变量导致的样式裸奔 |
| G2 | 零命令新增 | 每个分组可点「＋ 新增」，填摘要/正文/（坑的错误特征）即可落库；不需要 `/mem add` |
| G3 | 手动整理 | 点「整理记忆」→ 出现总结 + 分条 RULES 建议；不勾选不写入，写入只走 RULES 编辑器 + 人工保存 |
| G4 | SOUL 只读路径 | 设置页显示 SOUL 文件路径与"请自行编辑"说明；插件**不提供** SOUL 的读/写 API，GUI 不读取、不打开、不修改 |
| G5 | 一键安装 | npm 包与 `.tgz` 均可通过 设置 → 插件 安装；失败可回滚；升级不丢数据 |
| G6 | 可回归 | 每阶段 closure + 视觉快照/组件测试；新增 API 都有契约测试 |

### 1.2 非目标

- 不做云同步、账号、多租户；数据仍在本机 `~/.dsh/memory`。
- 不做自研主题市场；独立视觉只做一套明/暗。
- 不做自动改写 SOUL；不做自动写 RULES。
- 不引入向量检索；沿用 BM25 + 字面。
- 不做移动端。

## 2. 调研摘要（外部 + 本机）

> 说明：本机 `web_fetch` 对 GitHub/多数站点被 DNS 策略阻断，以下为 `web_search` 结果摘要与公开设计常识；链接保留，未逐页全文核对的条目标注「摘要」。

| 参考 | 可借鉴 | 不照搬 |
|---|---|---|
| **WorkBuddy**（腾讯办公智能体） | 首屏直接给"能做什么"与模板入口，而不是空白输入框；知识库/记忆有独立入口；设置集中、层级浅（[极客公园](https://w.geekpark.net/news/365512#comment#1)、[新京报](http://www.bjnews.com.cn/detail/1780889443129529.html#1#1#1)，摘要） | 闭源、无插件 API；不接它的平台 |
| **Claude / Opus 5.5 风格** | 大留白、低饱和、衬线/无衬线对比、内容优先；页面像"文档"而不是"后台"；强调可读性（[c114](https://www.c114.net.cn/industry/127324.html#1)、[Muzli 设计案例](https://feed.muz.li/claude-opus-5-5-for-designers/)，摘要） | 不复制品牌色/字体；只借排版与克制 |
| **Linear** | 列表密度、行内状态、快捷键、极窄边框；"一屏能扫完" | 不做项目管理的复杂筛选器 |
| **Raycast** | 命令面板式操作、动作可发现、空状态给下一步（[样式配方](https://github.com/ConardLi/garden-skills/blob/main/skills/web-design-engineer/references/style-recipes/raycast.md#1)、[UI 文档](https://developers.raycast.com/api-reference/user-interface.md)） | 不做全局启动器 |
| **Apple HIG** | 设置分组、破坏性操作确认、安装/权限文案直白（[HIG skills](https://github.com/Elevatormusic/apple-hig#2)） | 不套用 iOS 控件 |
| **Obsidian** | 本地文件即真相；列表/搜索/反向链接的"文件感" | 不做图谱 |
| **Mem0 / OpenMemory** | 记忆列表、scope 过滤、检索测试面板（[OpenMemory MCP](https://mem0.ai/library/coding-agents/how-to-make-your-clients-more-context-aware-with-openmemory-mcp)） | 不引入外部服务/向量库 |
| **插件管理器** | 安装/升级/卸载/回滚的对话框模式（[plugin manager spec](https://raw.githubusercontent.com/graditone/graditone/refs/heads/main/specs/048-plugin-manager-dialog/spec.md#1)，摘要） | 不自研宿主更新器 |

本机 DSH 已确认的约束：客户端插件只能注册槽位、通过 `/api` 同源路由访问宿主；`ctx.connection.fetch` 精确路由；RULES/USER 写入已有路径；SOUL/RULES 有封存哈希。V3 视觉层不改这些。

## 3. 视觉设计

### 3.1 设计原则

1. **安静**：默认白/近白底、单一强调色、无渐变、无重阴影；用间距与字重分组，而不是堆边框。
2. **内容优先**：摘要是主角，元信息（编号/日期/类型）退到 12px 灰字；一屏能读 8–10 条。
3. **动作可发现**：主操作永远在右上或行内；危险操作红字 + 二次确认；空状态给"下一步"按钮。
4. **新手不迷路**：不出现内部 ID/术语；每个页面有且只有一个主任务；命令手册是角落入口。
5. **明暗一致**：所有颜色走 `am-*` 令牌，不在组件里写死 hex。

### 3.2 令牌（草案）

```css
:root {
  --am-bg: #fbfbfa;            /* 页面 */
  --am-surface: #ffffff;       /* 卡片 */
  --am-surface-muted: #f6f6f4; /* 滚动区/代码 */
  --am-border: #e7e5e2;
  --am-text: #1f2328;
  --am-text-secondary: #6b7280;
  --am-accent: #3b5bdb;        /* 主操作 */
  --am-accent-soft: #eef2ff;
  --am-danger: #b42318;
  --am-warn: #b54708;
  --am-success: #067647;
  --am-fact: #2563eb;  --am-pitfall: #b54708;  --am-exp: #067647;
  --am-radius: 10px;  --am-radius-lg: 14px;
  --am-space: 4px;    /* 4/8/12/16/24/32 阶梯 */
  --am-font: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  --am-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --am-shadow: 0 6px 24px rgba(16,24,40,.06);
}
[data-am-theme="dark"] { --am-bg:#111214; --am-surface:#17191c; --am-surface-muted:#1e2126;
  --am-border:#2a2e35; --am-text:#e8eaed; --am-text-secondary:#9aa0a6; --am-accent:#8ea2ff;
  --am-accent-soft:#1e2440; }
```

- 明暗跟随宿主 `prefers-color-scheme`，但**允许手动切换**（记忆工作台内的小开关，存 localStorage；不写宿主配置）。
- 字体：正文 14px/1.65，标题 20–24px，元信息 12px；中文不强行用衬线。
- 圆角 10/14；阴影只用于弹层，卡片用 1px 边框。
- 动效 150–200ms ease-out，只做透明度/位移，不做弹跳；尊重 `prefers-reduced-motion`。

### 3.3 布局

- **工作台**：单列 1080px 内容区（窄窗口自适应）；顶部一行标题+计数，第二行工具条；列表分组；详情置顶内嵌卡（保留 V2 行为）。
- **详情**：改为"顶部内嵌卡 + 可展开正文"；宽屏时可右侧固定详情列（`min-width: 1200px` 时），窄屏回落单列。
- **新建/整理/设置**：右侧抽屉或居中弹层（宽 560），不使用全页跳转。
- **空状态**：插画式留白 + 一句说明 + 主按钮（如「＋ 新增第一条事实」）。

### 3.4 组件清单

`AmButton`（primary/secondary/ghost/danger）、`AmInput`/`AmTextarea`、`AmSelect`（类型）、`AmBadge`（F/P/E 与中文类型）、`AmRow`（列表行）、`AmCard`、`AmDrawer`、`AmModal`、`AmToast`、`AmEmpty`、`AmSkeleton`、`AmTabs`（记忆/提案/整理/设置）、`AmPathCard`（SOUL 路径只读）。

组件策略：先写在 `client/src/components.tsx`，不引第三方 UI 库；CSS 用 `am-` 前缀的普通样式表，由构建注入 `<style>`（或 `client.css` 由构建拼接）。

## 4. 使用逻辑设计

### 4.1 三个分组各自「新增一条」

入口：

- 分组标题右侧 `＋`；顶部工具条也有「新增」下拉（事实/坑/经验）。
- 表单字段：摘要（必填，单行，≤ 配置上限）、正文（多行）、类型（预选）、日期（默认今天）、坑额外要求「错误特征」1–3 条；不暴露 evidence_level。
- 保存：`POST /api/agent-memory/create` → `store.add(..., { author:'human' })` → journal `gui-create` 审计；同内容按现有去重规则跳过并提示"已存在：F-03"。
- 成功后：关闭弹层、刷新列表、定位/高亮新条目；若被去重，提示"已存在，未新增"。
- 权限：这是**人的写入**，与 readonly 模式无关；readonly 只约束模型。文档与 UI 都要写明。

### 4.2 手动「整理记忆」→ 分条 RULES 建议

入口：工具条「整理」按钮（不是自动运行）。

流程（两段式，人始终在环）：

1. **总结**：读取活动记忆（仅摘要/类型/日期/错误特征，不读 SOUL），按类型分组，产出：总数、最近变更、高频主题（关键词/错误特征聚类）、重复/相似提示。
2. **建议**：生成 3–8 条候选 RULES，每条含：建议文本（模型指引/机器门禁二选一）、依据（来自哪些记忆编号）、置信度（高/中/低）。
3. **人处理**：勾选一条或多条 →「加入 RULES 草稿」→ 打开 RULES 编辑器并**预填**（不保存）；人复核后点「保存并重新封存」才落盘。
4. 未勾选/关闭 → 不写入任何东西；「整理」本身只写 `gui-summary` 审计（可选）。

实现：V3.1 先用**确定性启发式**（高频 error_signatures、重复摘要、最近 N 条聚类），不依赖模型；后续可加"让助手总结"（走聊天，不新增权限）。

### 4.3 SOUL 路径卡（只读）

- 设置页新增「人格（SOUL）」卡片：显示路径 `~/.dsh/memory/SOUL.md`（Windows 展开为 `C:\Users\<你>\.dsh\memory\SOUL.md`），加「复制路径」按钮。
- 明确文案：**此文件只由你编辑；本插件不读取、不修改它；改完请在终端执行 `mem policy seal --accept`。**
- 不提供打开文件、不提供编辑框、不提供 API；GUI 不请求 SOUL 内容。现有"注入时读取 SOUL"属于核心注入逻辑，不属于 GUI；V3 不改核心读取，只保证界面不碰。
- 同理可给 RULES/USER 显示路径，但它们可编辑（RULES 只能 GUI 人工保存，USER 可 GUI 编辑）。

### 4.4 其他使用优化

- 首次进入：三步引导（看懂列表 → 新增一条 → 审批一条提案），可跳过。
- 键盘：`/` 聚焦搜索、`n` 新建、`Esc` 关详情/弹层、`↑/↓` 选行、`Enter` 打开。
- 列表：按类型/日期过滤；"仅看有出处"开关；批量选择（V3.3）。
- 提案：待审数量徽标；采纳/驳回后 toast + 列表刷新；冲突（目标已变）时给出"刷新后重试"。
- 错误：统一 `AmError`（一句话 + 下一步），不显示堆栈。

## 5. 发布与一键安装

### 5.1 发布物

- npm 公共包 `@agent-memory/dsh`（`private: false`），含宿主半层、客户端半层、`cordis.patch.yml`、README/LICENSE；
- GitHub Release 附 `.tgz` 与 SHA256；
- 版本：SemVer；`0.x` 阶段 minor 可破坏，1.0 后严格；
- 生成 `CHANGELOG.md`（Keep a Changelog 风格）；
- npm provenance：GitHub Actions `npm publish --provenance`（需要仓库与 npm 账号 2FA；发布前用 `npm pack --dry-run` 校验内容）。

### 5.2 安装路径（按新手友好度排序）

1. **设置 → 插件 → 安装**：选 `.tgz` 或输入包名；DSH 负责解包、写 profile、提示重启；
2. **一键脚本**：`npx @agent-memory/setup`（或 `mem setup`）：检测 DSH profile → 备份 → 安装 → 跑 `mem doctor` → 打印"重启 DSH"；
3. **开发链接**：`npm run plugin:install`（保留）。

安装向导（GUI 内，首次启动）：三步卡片——① 已安装/版本；② 数据目录与权限（只读/确认/直接）；③ 完成，去新增第一条。全部可跳过。

### 5.3 升级/回滚/卸载

- 升级：插件页"更新"（宿主能力）或重装新 tgz；数据不迁移；`schema` 变更走显式 migrate。
- 回滚：安装前备份 `package.json` + `cordis.patch.yml`；失败一键还原；保留上一版 tgz。
- 卸载：插件页卸载；数据目录保留；提供"同时删除数据"二次确认（默认不删）。
- 安装校验：包内三件套（宿主/客户端/patch）存在；启动后 `/api/agent-memory/status` 有响应；失败给"查看日志/回滚"。

### 5.4 发布流程（人工闸门）

1. 版本号 + CHANGELOG；
2. `npm run ci` + `stage` + `npm run pack`；
3. 本地干净 profile 安装/卸载/回滚各一次；
4. `npm publish`（人工，2FA）；
5. GitHub Release 附 tgz + sha256；
6. 更新 README/使用手册的安装链接。

## 6. 技术改动清单

| 领域 | 改动 | 风险 |
|---|---|---|
| 视觉 | `client/src/styles.ts` 令牌 + `components.tsx`；构建注入 CSS | 宿主主题变量冲突（用 `am-` 前缀隔离） |
| 新建 | `POST /api/agent-memory/create`；校验、去重、审计 | 与内容去重规则一致；不伪造 provenance |
| 整理 | `POST /api/agent-memory/summarize`（只读计算，返回建议）；不落盘 | 语言/规则质量；先确定性后模型 |
| SOUL | `GET /api/agent-memory/soul-path`（只返回路径字符串）或不加路由、客户端拼路径 | 绝不能变成读文件接口 |
| 安装 | `scripts/setup.mjs`、package 元数据、CHANGELOG | npm 账号/2FA、包内容泄漏 |
| 测试 | 组件快照、API 契约、安装 smoke | 客户端 DOM 测试需要宿主测试层（P0 已验证） |

## 7. 路线与验收

### V3.0 视觉与组件（5–7 人日）

- 令牌、组件、明暗、布局、空/错/载入态；SP13 截图走查。
- 验收：1280/900 宽无横向滚动；明暗切换全页一致；`ci` 全绿；README 第 N 轮。

### V3.1 手写与整理（6–8 人日）

- 新建三类表单 + API；整理两段式（总结→建议→RULES 草稿）；SOUL 路径卡。
- 验收：新增即出现在对应分组且作者=人工；重复内容提示已存在；整理建议可勾选进草稿且不自动保存；SOUL 无读写入口（负向测试：接口不存在）。

### V3.2 发布与安装（5–7 人日）

- npm 包、setup 脚本、安装向导、升级/回滚文档、CHANGELOG。
- 验收：干净 profile 一键装/升/卸/回滚各一次；`npx` 安装成功；失败场景有回滚。

### V3.3 打磨（4–6 人日）

- 键盘、批量、筛选、toast、性能（1000 条列表）；可访问性（对比度/焦点）。
- 验收：键盘走完全流程；1000 条打开 < 1s（本地）；对比度 ≥ 4.5:1。

每阶段出口沿用 `stage.mjs + closure`：ADR、README 轮次、闭环检查、`npm run pack`（V3.2 起）。

## 8. 风险与待拍板

| # | 问题 | 建议 |
|---|---|---|
| 1 | 独立视觉做到什么程度 | 一套明/暗 + 令牌层；不做主题市场 |
| 2 | 新建条目是否允许指定日期/证据 | 允许日期；证据不暴露，作者=人工 |
| 3 | 整理是否用模型 | 先确定性；模型总结作为可选按钮 |
| 4 | RULES 建议的格式 | 沿用现有编号/类别；机器门禁需 test/check，V3.1 先只出模型指引 |
| 5 | SOUL 路径是否可点击打开 | 只复制路径；不调宿主打开文件（安全） |
| 6 | 发布渠道顺序 | 先 GitHub Release tgz，再 npm |
| 7 | npm 包名 | `@agent-memory/dsh`（现名） |
| 8 | 安装器是否独立 | 不做独立安装器；`npx` 脚本 + 宿主插件页 |
| 9 | 是否支持旧版 DSH | 只保证 0.2.1-rc.2+；旧版提示升级 |
| 10 | 1000 条性能目标 | 首屏 <1s；超过则虚拟列表（V3.3 评估） |

## 9. 与现有架构的关系

- 数据域三层不变；V3 只在**呈现层 + 少量访问层**加东西。
- 所有写操作继续走 `MemoryStore` + journal + `surface: gui` 审计；新建/整理不引入第二条写入链。
- SOUL 不新增 API；RULES 仍只有 GUI 人工保存；MCP 权限不变。
- 组件层只依赖宿主槽位与 React，不 import 宿主内部模块；`client/src` 可单独构建。

## 10. 交付物

- `docs/plan/v3-visual-and-workflows.md`（本文）
- V3.0 起每阶段 ADR + README 轮次 + 测试
- 发布：`release/agent-memory-dsh-<version>.tgz`、npm 页面、GitHub Release、CHANGELOG
