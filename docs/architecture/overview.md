# 架构总览

> 目标读者：维护者与新贡献者。用户说明见 [README](../README.md)，决策背景见 [ADR](../adr/)。

## 1. 设计目标

- **文件即真相**：一条记忆一个 Markdown；索引可删可重建；数据可读、可 diff、可备份。
- **人保留决定权**：模型能检索、能提案；采纳/驳回由人点击，`decide` 不是模型工具。
- **边界在代码里**：不可变记录、内容哈希、append-only journal、封存校验、单写者锁。
- **宿主可替换**：core 不依赖 DSH；DSH、CLI、MCP 都是适配器。

## 2. 分层

```text
┌─────────────────────────────────────────────────────────┐
│ 呈现层  DSH 客户端插件（侧栏 / 工作台 / 聊天卡）          │
│         CLI（mem）· MCP server（Codex 等）               │
├─────────────────────────────────────────────────────────┤
│ 访问层  MemoryService / GUI API / 工具 / 提案 / 运维命令  │
├─────────────────────────────────────────────────────────┤
│ 数据域  人设层  SOUL · USER · RULES · GUIDANCE           │
│         事实层  记录 + 提案 + journal + 索引             │
│         历史层  DSH sessionQuery（只读）                 │
└─────────────────────────────────────────────────────────┘
```

硬约束：

1. `packages/core` 不出现 `@deepseek-ai/`（宿主）依赖；
2. `packages/dsh/src` 不直接 `import fs`，数据读写经 core；
3. GUI/MCP/CLI 不直接写存储，只调用 core 的服务与事务；
4. 规则（RULES）只有人在 GUI 保存并封存；SOUL 不由插件编辑。

## 3. 代码地图

| 路径 | 职责 |
|---|---|
| `packages/core/src/store/` | 记录读写、去重、锁、journal、manifest、purge |
| `packages/core/src/inject/` | 段注册表、注入组装、快照 v4、预算 |
| `packages/core/src/proposals/` | 提案创建（create/supersede/delete）与决定 |
| `packages/core/src/rules/` | RULES 解析、校验、保存 |
| `packages/core/src/profile/` | USER.md 条目读写 |
| `packages/core/src/transfer/` | 备份 JSON 导入 |
| `packages/core/src/ops/` | doctor、inspect、export、rebuild |
| `packages/dsh/src/plugin.ts` | DSH 插件入口：工具、命令、路由、注入 |
| `packages/dsh/src/gui.ts` | `/api/agent-memory/*`：只读投影 + 人工写流 |
| `packages/dsh/src/tools.ts` | 模型工具与能力组 |
| `packages/dsh/client/src/` | 侧栏 + 工作台（React，独立 `am-*` 视觉层） |
| `packages/cli/src/` | `mem` 命令与 MCP stdio server |
| `scripts/` | 构建、测试、门禁、打包、安装、发布 |
| `docs/adr/` | 决策记录（编号即历史） |

## 4. 数据模型

```text
~/.dsh/memory/
  SOUL.md USER.md RULES.md                # 人维护，注入（RULES/SOUL 封存）
  policy.json seal.json                   # 封存
  memories/<kind>/<id>.md                 # 不可变记录
  proposals/pending/<id>.json             # 待审提案
  .state/journal/                         # 哈希链审计
  .state/index/  .state/snapshots/         # 可重建缓存
```

**GUIDANCE 不是文件**：它是 `renderGuidance(personalization.mode)` 在注入时生成的短指引（记忆分类、先读后写、写入必须带出处、当前模式的写权限、子 agent 只读），没有用户可编辑的 `GUIDANCE.md`。

记录（v1.3）：`id, kind(fact|pitfall|exp), abstract, body, valid_from/valid_until, supersedes, author, evidence_level, error_signatures, provenance, content_hash`。删除不写回旧文件，只在 journal 追加；`purge` 才物理移除。

## 5. 关键流程

### 5.1 注入

`assemble()` 读取段注册表（SOUL 100 / GUIDANCE 110 / RULES 150 / USER 200 / MEMORY 300），按预算渲染 → 每会话冻结到 snapshot（schema v4）→ 宿主注册为独立 systemPrompt section。GUIDANCE 随 `personalization.mode` 变化（confirm/direct/readonly），预算 `inject.guidance_max_chars`（默认 300）。可选段失败只降级该段并写 health；封存/存储完整性仍是全局失败。

### 5.2 写入

| 入口 | 路径 |
|---|---|
| 模型记录 | `memory_record` → `store.add`（证据必须绑定当前会话事件） |
| 模型修订/新增 | `memory_propose` → 待审；接受后 `store.addMany` |
| 人工 GUI 新增/修订 | `/api/agent-memory/create`、`/revise` → `store.add` / 提案 |
| 人工删除 | `/api/agent-memory/delete` → `purge`（含被替代祖先） |
| 导入 | `/api/agent-memory/import` → `importBundle` |

所有入口共用锁、校验、内容去重、journal；GUI 写入额外记录 `surface` 审计。

### 5.3 提案

`create`（新增）、`supersede`（修订）、`delete`（删除）；`decide` 只由人触发（命令或 GUI）。接受前校验 `base_hash`，失败保留待审文件。

### 5.4 运行时隔离

客户端是独立 bundle；宿主 / CLI / MCP 通过同一 core 共享数据目录。MCP 默认只读 + 提案，无 decide/record；外部来源不伪造 DSH `event_seq`。

## 6. 扩展点

- **段注册表**：新增文档层 = 加一个 `SectionSource`（key/order/预算/load/render），不改 assemble 与 GUI。
- **能力组**：`capabilitiesFor(mode, depth)` 决定工具面；preset/GUI/MCP 只选组。
- **GUI API 契约**：`packages/dsh/src/gui.ts` 的路由表；客户端只依赖契约。
- **视觉层**：`client/src/styles.ts` 的 `am-*` 令牌；组件在 `components.ts`。
- **接入新平台**：实现 MCP/HTTP/CLI 适配器，复用 core；不复制写入逻辑。

## 7. 质量门禁

- `npm run ci`：仓库 gates（core 纯度/宿主隔离/无付费分支/正则/文档键）→ typecheck → build → 256+ 测试；
- `node scripts/stage.mjs S7`：ci + smoke + ADR + 闭环检查；
- `npm run pack`：产物含宿主半层、客户端半层、patch；缺一即失败；
- 发布：`docs/development/release.md` 检查单；CI 在 Linux 上跑同一套门禁。

## 8. 已知边界

- 单用户单机；无云同步/多租户；
- 检索 BM25 + 字面，不是向量；
- 客户端为宿主插件，依赖 DSH 0.2.1-rc.2+ 的槽位与 `ctx.connection.fetch`；
- SOUL 只在注入时读取，GUI 不提供读写接口。

## 9. 延伸阅读

- [数据与注入方案 v1.3](../research/V1.0-开发方案-v1.3.md)
- [记忆架构 v2](../plan/memory-architecture-v2.md)
- [V3 视觉与工作流](../plan/v3-visual-and-workflows.md)
- [ADR 目录](../adr/)
