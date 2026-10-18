# 记忆助手 · 开发者手册

> 面向维护者、集成开发者与需要命令行/接口的人。普通用户请读 [用户使用手册](user-manual.md)。

- 当前版本：`0.4.0`（V4.0）
- 宿主：DSH 桌面 `0.2.1-rc.2+`
- 运行时：Node `>=24`
- 数据：本地 `~/.dsh/memory`（可用 `--home` 或 `AGENT_MEMORY_HOME` 指定）

## 1. 功能全景（V4.0）

| 模块 | 已实现 |
|---|---|
| 存储 | 一条记忆一个 Markdown；journal 哈希链；manifest/索引可重建；原子写；单写者锁 |
| 模型 | 事实/坑/经验；`project/tags/relations/source`；`mem_schema: 2`，兼容 v1 |
| 写入 | `memory_record`（模型）、`memory_propose`（提议）、GUI 人工新增/修订/删除、项目移动、标签/关系编辑 |
| 审批 | create/supersede/delete 提案；GUI 卡片 + `/mem decide`；`decide` 不是模型工具 |
| 注入 | SOUL/GUIDANCE/RULES/USER/MEMORY 五段；每会话冻结快照；预算与段注册表 |
| 检索 | BM25；可选 hash 兜底 hybrid；sidecar 向量缓存 + `recallAsync` |
| UI | 侧栏工作台、列表/详情、搜索、提案、偏好/规则、SOUL 路径、备份、项目工作树 L0–L2 |
| 项目 | 用户自建；删除只删标签；多选移动；同项目标签关系图 |
| 互操作 | 导出 bundle v2 / 导入 v1/v2；Mem0 导入；MCP；Memory API v1 |
| 安全 | SOUL 不由插件改；RULES 仅 GUI 保存并封存；扫描/去重/journal；readonly/confirm/direct |
| 运维 | `doctor`、`inspect`、`rebuild`、`adopt`、`purge`、备份/恢复 |
| 回顾 | 内置 skill `agent-memory-retro`；`/mem-fact`、`/mem-pitfall`、`/mem-exp` |

## 2. 本地开发

```powershell
npm install
npm run build          # 构建 host/cli/client
npm run ci             # gates + typecheck + build + tests
npm run smoke          # init/doctor/seal/add/read/recall/rebuild
npm run plugin:install # 链接到 desktop profile（先备份）
npm run plugin:revert  # 还原
npm run pack           # release/agent_memory-dsh-<version>.tgz
```

工程约束：

- `packages/core` 不得出现 `@deepseek-ai/`（宿主字样）；
- `packages/dsh/src` 不得 import `node:fs`，数据操作走 core；
- `packages/core` 不得出现 `entitled`/`paid`/`tier` 一类商业化分支；
- 新增配置键必须同步 schema、`CONFIG_TEMPLATE`、`docs/config.md`；
- 数据格式 v1.4：`mem_schema: 2`；新增可选字段，旧记录读时不重写。

## 3. CLI

```text
mem init [--home <dir>]
mem doctor [--home <dir>] [--json]
mem add --abstract <text> [--kind fact|pitfall|exp] [--body <text>]
        [--valid-from YYYY-MM-DD] [--project <name>] [--tag a,b]
mem read <id> [--json]
mem recall <query> [--limit n] [--kind kind]
mem adopt <id>
mem delete <id> --reason <text>
mem purge <id> --accept --reason <text>
mem rebuild
mem inspect [--limit n]
mem proposals
mem decide <id> accept|reject [--reason <text>]
mem decide --batch accept|reject
mem export <dir>
mem pack <dir>
mem project list|add <name> [--description <text>]
mem import-mem0 <file> [--apply]
mem embed [--apply]        # sidecar 向量缓存
mem mcp [--home <dir>]
mem policy seal [--home <dir>] --accept [--seal-user]
```

聊天内指令：`/mem help`、`/mem recall`、`/mem read`、`/mem add`、`/mem proposals`、`/mem decide`、`/mem profile`、`/mem scaffold`、`/mem seal`；回顾用 `/mem-fact`、`/mem-pitfall`、`/mem-exp`。

## 4. 数据与格式

```text
~/.dsh/memory/
  SOUL.md USER.md RULES.md
  projects.json                 # {schema:1, projects:[{name,description,created_at,updated_at}]}
  policy.json seal.json
  memories/<kind>/<id>.md
  proposals/pending/<id>.json
  .state/journal/                # 哈希链
  .index/                        # manifest、embeddings.json（派生）
  .state/snapshots/
```

frontmatter 一行一个 `key: <JSON>`。`mem_schema: 2` 字段：

`id, mem_schema, kind, scope, project, tags, relations, source, abstract, created_at, valid_from, valid_until, supersedes, author, evidence_level, error_signatures, provenance, body`

- `relations`：`{type: relates_to|derived_from, target}`；
- `supersedes` 独立不可变；
- `source`：`{type,id}`，用于 Mem0 等外部来源；
- 删除不写回旧文件，journal 追加；`purge` 才物理移除。

项目删除只删 `projects.json` 标签；图中的未知 project 映射为「未归类」。移动/标签编辑会重写对应字段并写 journal（`record` + `audit`），ID 不变。

## 5. 架构

```text
packages/core      domain：store/journal/model/inject/proposals/rules/profile/transfer/embed/eval
packages/dsh       host adapter：plugin/service/tools/gui/client
packages/cli       mem CLI + MCP server
scripts            build/test/gates/stage/pack/setup/preset
```

写入只有一条主路径：GUI/工具/CLI/MCP → core 服务 → 锁/校验/journal。图、向量、索引都是派生数据。

关键入口：

- 宿主插件：`packages/dsh/src/plugin.ts`
- GUI 数据面：`packages/dsh/src/gui.ts`
- 工具 schema：`packages/dsh/src/tools.ts`
- 客户端：`packages/dsh/client/src/index.ts`
- 段注册表：`packages/core/src/inject/sections.ts`
- 架构总览：[docs/architecture/overview.md](../architecture/overview.md)

## 6. Memory API v1

响应头 `x-agent-memory-api-version: 1`；导出 `agent-memory-export-v2`。

主要路由（完整表见 [API](api.md)）：

```text
GET  /api/agent-memory/status|list|item|search|graph|proposals|rules|export
POST /api/agent-memory/create|revise|delete|import|summarize|meta
POST /api/agent-memory/proposals/decide|policy/seal
GET/POST/DELETE /api/agent-memory/projects
POST /api/agent-memory/projects/move
```

`meta` 只改 tags/relations；`projects/move` 批量改归属；`decide` 只由人触发。

## 7. MCP

```powershell
mem mcp
```

工具：`memory_search`、`memory_read`、`memory_list`、`memory_propose`；没有 `decide`、没有 `record`。外部提案进入同一待审队列。Codex 接入示例见 [MCP 指南](mcp.md)。

## 8. 检索

- 默认 BM25（字段加权 + 字面命中）；
- `recall.hybrid=true` 且存在 sidecar 缓存时走 `recallAsync`：BM25 + 向量按 `embedding_weight` 融合；
- sidecar 契约：`AGENT_MEMORY_VECTORIZER` 指向 `cmd <input.json> <output.json>`，输入 `{texts}`、输出 `{vectors}`；
- `mem embed --apply` 生成 `.index/embeddings.json`；缺失/失败回退 BM25 并 warning；
- 评测：`npm run eval:longmem`；ONNX 必要性见 [调研](../plan/onnx-necessity.md)。

## 9. 配置与安全

- 配置键：[docs/config.md](../config.md)；策略/封存：[docs/policy.md](../policy.md)；
- `personalization.mode`：`confirm`（默认）/`direct`/`readonly`；
- RULES 只能由 GUI 保存并重新封存；SOUL 只显示路径，插件不读写；
- readonly 在工具层拒绝 record/propose；子 agent 只读；
- 扫描会拒绝明显像密钥的内容，但不能替代用户判断。

## 10. 测试与发布

```powershell
node scripts/ci.mjs
node scripts/stage.mjs S7
npm run smoke
npm run pack
npm run eval:longmem
```

- 测试：`packages/*/test/**/*.test.ts`，`node:test`；
- 发布：更新 `packages/dsh/package.json`/CHANGELOG → `pack` → tag `vX.Y.Z` → GitHub Release → `npm publish ./packages/dsh --access public`；
- 发布检查单：[docs/development/release.md](../development/release.md)；
- 当前 V4.0：`0.4.0`，tarball `release/agent_memory-dsh-0.4.0.tgz`；
- 基准：`node scripts/bench.mjs --count 1000`（V5 S1 已加入；输出 add/reload/recall/journal 统计）。

## 11. 运维与排障

- [运维手册](../ops.md)：doctor、journal 恢复、权限、回滚；
- [安装与分发](install.md)：npm/tgz/一键安装/升级；
- 常见失败：配置未知键 → 启动拒绝并点名；journal 断链 → 停写、备份、恢复；project 删除 → 记忆回到未归类。

## 12. 文档地图

| 文档 | 内容 |
|---|---|
| [用户使用手册](user-manual.md) | 无命令的安装/UI 使用 |
| [安装与分发](install.md) | 安装、升级、回滚 |
| [MCP](mcp.md) / [API](api.md) | 外部集成 |
| [架构总览](../architecture/overview.md) | 分层/数据流/扩展点 |
| [ADR](../adr/) | 决策原因 |
| [开发历程](../history/rounds.md) | 逐轮记录 |
