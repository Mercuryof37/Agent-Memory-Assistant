# V2.0 架构审核与预期（含 10 问决策回执）

> 日期：2026-10-18 · 审核对象：[V2.0 方案](v2-gui-and-distribution.md) · 基线：V1.0（第 14 轮，228 测试，数据格式 v1.3）
> 结论先行：**架构方向成立，但落地前需要三处解耦**（段注册表、模块健康隔离、Service 门面）；不改变三层数据模型。做完这三处，后续换底层、加文档层、接新平台都只需加适配器。

## 0. 10 问决策回执（已按你的回答定稿）

| # | 问题 | 决定 | 对架构的含义 |
|---|---|---|---|
| 1 | 发布渠道 | **先出 `.tgz`**，下一版开发后再发布 npm | 打包流程必须先于发布：`npm pack` 产物即可安装；版本号与回滚走 profile 备份 |
| 2 | 入口形态 | **侧栏「记忆」+ 全页工作台** | 客户端只注册一个主面板 + 一个侧栏入口；不占用右侧栏（右侧栏留给文件/计划） |
| 3 | 默认写入 | **confirm 默认 + UI 一键切换** | 模式切换必须是 GUI 控件（纯新手原则），写 `config.toml` 后提示「下一会话生效」 |
| 4 | MCP 写权限 | **只读 + 提案** | MCP 默认不暴露 record/decide；提案需人回 GUI 审批 |
| 5 | 审批卡 | **两种卡片**（聊天卡 + GUI 弹窗），架构兼容 | 两者都调用同一个 `decide` 命令与同一审计；卡片是呈现层，不是新写入路径 |
| 6 | 平台优先级 | **DSH 与 Codex 一起做** | 接口层先行（Memory API），DSH GUI 与 MCP server 都是消费者 |
| 7 | 数据目录 | **共用** | 同一 `~/.dsh/memory`；锁 + journal 已是单写者；MCP 只读默认避免并发写冲突 |
| 8 | 审计字段 | **加入 GUI 审批**；硬约束（RULES/封存）**只有人亲自在 GUI 操作才写入** | journal 增 `surface: chat|gui|cli|mcp`；RULES 写入走 GUI 专用入口 + 二次确认 |
| 9 | 视觉基线 | **默认风格，V3 再独立视觉** | 先做设计令牌（颜色/间距/字号）与组件库接口，不做品牌化 |
| 10 | P0 闸门 | **接受** | 三项技术验证不过就不进入 P1 |

## 1. 三层设计对照：V2 没有破坏它

V1 的三层是**数据域**；V2 新增的是**访问与呈现**，不是第四种数据：

```text
数据域（V1，不变）
  人设层  SOUL / USER / RULES / GUIDANCE（人维护、封存、注入）
  事实层  不可变记录 + 提案 + journal + 目录
  历史层  DSH sessionQuery（只读）+ skills（复用）

访问层（V2 新增，薄）
  MemoryService 门面：facts / persona / proposals / history / ops
  ├─ 工具适配器（模型面向，现有 13 个）
  ├─ HTTP/JSON API（GUI 用，/api/agent-memory/*）
  ├─ MCP server（Codex 等）
  └─ CLI（mem，高级用户，保留全量）

呈现层（V2 新增）
  DSH 客户端插件：侧栏 + 全页工作台 + 聊天卡 + 设置页
  其余平台：各自的 UI 或 MCP 客户端
```

**审核结论**：分层是清楚的，但方案原文把「访问层」写得偏散（有些地方直接提 store、有些提 API）。落地时必须统一为：**任何呈现/接入都只调用 MemoryService，不直接碰 `MemoryStore` 与文件**。这是 V2 的第一条硬约束。

## 2. 当前耦合点（审计发现，按严重度）

| # | 耦合 | 现状 | 后果 | 处理 |
|---|---|---|---|---|
| C1 | 注入段硬编码 | `assemble.ts` 固定读 SOUL/GUIDANCE/RULES/USER/MEMORY 五个文件、固定顺序 | 新增一个顶层文档（如 `PRINCIPLES.md`）要改核心；某一段解析失败会拖垮整次组装 | **段注册表**：每段声明 key/order/预算/读取器/渲染器/是否封存；核心只负责合并 |
| C2 | 插件一次性组装 | `plugin.ts` 在一个 `apply` 里注册工具、命令、章节、卡片；`startup` 失败即整体退回探针 | SOUL 坏了不影响其他段（已做到），但 RULES 非法、store 不可用会让**所有**记忆功能消失 | **模块健康隔离**：必需模块（store）失败才降级；可选模块（persona/proposals/history/gui）各自 try/catch，健康面板显示 per-module 状态 |
| C3 | 工具权限散落 | `registerTools` + `mode` + `delegationDepth` + `hooks` | 新增 GUI/MCP 时容易出现「同一写入多个入口」 | **能力组**：`facts.read/write`、`persona.read/write`、`proposals.read`、`sessions.read`；preset/GUI/MCP 只选组 |
| C4 | 快照版本整体升级 | 加 GUIDANCE 段 → schema v3 | 每次加段都要全量重捕（可接受，但不优雅） | 段注册表带**段版本**；快照记录每段 revision，缺段只重捕该段（P2） |
| C5 | GUI API 未定 | 方案里 `/api/agent-memory/*` 是待验证 | 直接让 GUI 调 core 会绕过审计与锁 | P0 先定 **API 契约表**（路径、入参、返回、错误码、审计字段），GUI 只按契约写 |

## 3. 模块化设计（目标：缺一个文档只影响一个板块）

把 V2 拆成 7 个可独立失败的模块，每个模块声明：**依赖、提供的段/工具/页面、失败降级方式**。

| 模块 | 提供 | 失败时 |
|---|---|---|
| `store`（必需） | 记录、journal、锁、重建 | 启动失败 → 整体记忆不可用（唯一允许的全局失败） |
| `persona` | SOUL/GUIDANCE 段、人设页面 | 缺 SOUL → 该段为空、页面提示「未配置人格」，其余照常 |
| `rules` | RULES 段、规则页面、机器门禁 | RULES 非法 → **只降级 RULES 段**为「规则不可用，请修复」提示 + 红色状态，不阻断注入其他段与写入 |
| `user-profile` | USER 段、偏好页面 | USER 文件损坏 → 偏好页面报错、注入跳过 USER；事实与提案不受影响 |
| `proposals` | 提案列表/审批卡/决定 | 提案文件损坏 → 只影响提案板块，记忆读写正常 |
| `history` | 会话检索工具/页面 | 宿主无 `sessionQuery` → 工具组不注册、页面隐藏，不报错到其他板块 |
| `ops` | doctor/inspect/export/purge/GUI 诊断 | 失败只影响运维页 |

**新增顶层文档的接入方式**（你举的例子）：在段注册表加一条声明（key、order、文件名、预算键、是否封存、渲染器），并在 GUI 的「人设」页自动生成一张卡片；**核心与 GUI 框架都不改代码**。这就是「与现有工作树流畅耦合」的具体形态。

## 4. 可替换性：换底层时能不能整体替换？

可以，但需要现在补一个 **MemoryPort 接口**（只定义不实现新后端）：

```ts
interface MemoryPort {
  facts: { list(filter); get(id); search(q); write(input); correct(id, input); invalidate(id) };
  proposals: { list(); create(input); decide(id, 'accept'|'reject') };
  persona: { documents(); read(key); write(key, text, opts) };   // SOUL/USER/RULES/未来文档
  history: { searchSessions(q); readEvent(id, seq); trace(...) }; // 可委托给宿主
  ops: { doctor(); export(dir); purge(id) };
  health(): ModuleHealth[];
}
```

- 默认实现 = 现有 core（文件 + journal）；
- 未来换 SQLite / 远端服务 = 新实现该接口，GUI/MCP/CLI **零改动**；
- 数据迁移靠现有 `export` + 新后端导入；文件格式仍是可读的 Markdown，迁移不锁死；
- 接口带 **schema 版本**，避免 V3 换存储时契约漂移。

**风险**：接口过宽会变成"伪抽象"。控制方式：接口按模块拆分（上表 7 个），只暴露 GUI/MCP 真正用到的方法；内部细节（journal 行、锁实现）不进接口。

## 5. 闭环验证：每一环怎么验收

沿用 V1 的 `stage.mjs + closure.mjs`，V2 每阶段扩成五类检查：

| 检查 | 内容 | 工具 |
|---|---|---|
| 单元/契约 | 每个模块的单测；API 契约（路径/入参/返回/错误码）快照 | `npm test` + 契约快照用例 |
| 隔离 | 删除/损坏 SOUL、USER、RULES、提案、history 各自只影响本模块 | 新增 `S13.x module isolation` 用例（每模块一条） |
| UI 冒烟 | 侧栏入口存在、面板可打开、列表/详情/审批卡渲染、无控制台错误 | P0 需验证构建链；P1 起加浏览器冒烟（可用宿主自带测试层，待验证） |
| 打包/安装 | `npm pack` 产物在干净 profile 安装→重启→卸载→回滚 | `mem setup` + 备份脚本，记录到 ADR |
| 审计 | 每次 GUI 写/审批都有 `surface:gui` 行；RULES 写入只来自 GUI 人工确认 | journal 断言 + 负向用例（模型/HTTP 均不可写 RULES） |

**阶段出口**（P0–P3 各一条，写进 ADR 与 README 第 N 轮）：

- P0：构建链通、侧栏/全页面板出现、一条只读 API 返回真实数据；三项任一失败 → 退回「宿主卡片 + `/mem`」并在 ADR 记录；
- P1：只读工作台可用（列表/详情/搜索/导出一屏），模块隔离用例全绿；
- P2：写流与两种审批卡可用；`decide` 仍只由人触发；RULES 写入只有 GUI 人工确认一条路径；
- P3：`.tgz` 安装/升级/回滚过；MCP stdio 在 Codex 读同一数据目录；发布说明与手册更新。

## 6. 预期（时间、产出、失败姿态）

- **工期**：P0 2–3 人日、P1 5–6、P2 6–8、P3 7–10；加 20% 缓冲，约 **24–32 人日**（含审核返工）。
- **产出**：一个可 `npm pack` 的包；侧栏 + 全页工作台；聊天卡与 GUI 审批；MCP server；更新后的手册（纯新手版 + 命令全量附录）。
- **失败姿态**：任一可选模块失败只降级本模块并在 GUI 顶部显示「X 不可用」；存储/锁/journal 完整性失败才全局停写；P0 不通过则整个 V2 退回 V1 形态，不半成品上线。
- **依赖风险**：DSH 客户端插件槽位/构建链是最大不确定项（方案标了 12 条待验证）；P0 就是为它设的闸门。

## 7. 审核结论

- **清晰度**：三层数据模型清晰；V2 需要把「访问层」写成硬约束（MemoryService 唯一门面），否则 GUI 容易绕过审计。
- **模块化**：方向对，但必须做 C1（段注册表）、C2（模块健康）、C3（能力组）三件事，否则「缺 SOUL 只影响 SOUL」做不到。
- **可替换**：补 MemoryPort 后可以整体换底层；现在不补，V3 会绑死在文件实现上。
- **闭环**：沿用 stage/closure，新增模块隔离、UI 冒烟、打包安装、审计四类检查；每阶段有明确出口。
- **建议**：把 C1/C2/C3 作为 **P0.5**（P0 技术验证通过后、P1 开工前，约 2–3 人日）——它们是 V2 其他一切的地基，越晚做返工越大。
