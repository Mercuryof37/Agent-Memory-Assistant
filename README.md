# Agent Memory

给 DSH 用的本地长期记忆：**一条记忆一个 Markdown 文件**，索引是可随时删掉重建的缓存，注入是每会话冻结一次的快照。目标是几十到几百条记忆、可 grep、可 diff、可回滚，并且**不靠提示词守边界**。

- 开发方案：[v1.3](docs/research/V1.0-开发方案-v1.3.md)（取代 v1.2 与更早版本）
- **V2.0 方案**：[图形化与分发](docs/plan/v2-gui-and-distribution.md)（客户端插件、一键部署、跨平台外挂）；**架构审核与 10 问决策**：[v2-architecture-review.md](docs/plan/v2-architecture-review.md)；**UI 命名规范**：[ui-guidelines.md](docs/design/ui-guidelines.md)
- **V3.0 方案**：[独立视觉、手写工作流与正式发布](docs/plan/v3-visual-and-workflows.md)（调研稿，未开工）
- 原始调研材料：[docs/research/](docs/research/)
- 当前阶段：**V1.0 全部阶段完成**（S0–S14；[ADR-0010](docs/adr/0010-s7-ops.md) 起，最新 [ADR-0015](docs/adr/0015-preset-and-tool-trimming.md)）
- 配置与策略：**config v2（24 键）/ policy v2（8 + sealed_files 3 键）**，见 [ADR-0004](docs/adr/0004-plan-v1.3.md)
- 目标宿主：桌面 DSH **0.2.1-rc.2**（M1–M4 的实测记录在 rc.1，S3 改插件时重跑），运行时 Node **24.21.0**（`.node-version`）
- 环境：Windows / 本地 NTFS · 运行时零依赖

**使用者请从这里开始**：[使用手册](docs/manual.md)（功能、用法与规矩，面向非开发者；开发者文档在下方）。

## 现在能做什么（S7）

| 能力 | 命令 / 位置 |
|---|---|
| 建数据目录骨架 | `mem init` |
| 启动校验（配置 + 策略 + 边界） | `mem doctor` |
| 写一条记忆（人，author=human） | `mem add --abstract "…" [--kind fact\|pitfall\|exp] [--body "…"]` |
| 按 ID 读正文 | `mem read <id>` |
| 子串召回（S3 换 BM25） | `mem recall <query> [--as-of YYYY-MM-DD]` |
| 人审后入账手放/手改文件 | `mem adopt <id>` |
| 结束一条记忆的有效期（文件保留） | `mem delete <id> --reason "…"` |
| 重建索引与目录 | `mem rebuild` |
| 策略重新封存（人专属） | `mem policy seal --accept` |
| 召回基线（60 条 / 16 查询） | `npm run eval`（写 `docs/eval/s3-baseline.json`） |
| 审阅提案 / 人工决定 | `mem proposals` · `mem decide <id> accept|reject --accept` · `mem decide --batch accept|reject` |
| 收尾蒸馏 | DSH 里输入 `/closeout`，模型用 `closeout_submit` 提交候选 |
| 一屏自检 | `mem inspect [--json]` |
| 导出/打包（带校验和） | `mem export <dir>` · `mem pack <dir>` |
| 物理清除（人 T2） | `mem purge <id> --accept` |
| 历史会话审计 | `npm run audit:sessions` |
| 阶段门禁 | `node scripts/stage.mjs S7` |
| 仓库门禁（分层 / 文档键名） | `npm run gates` |
| 类型检查 / 测试 / 构建 | `npm run typecheck` · `npm test` · `npm run build` |

写入只能经 `mem add`（DSH 工具在 S4 才注册）；`memories/` 里手放、手改、直写的文件在入账前**一律隔离**，不进召回与目录。审计与入账历史合并为 `.state/journal/` 一条链，不轮转、不删段。

## 快速开始

```bash
npm install

node packages/cli/bin/mem.mjs init   --home .tmp/store
node packages/cli/bin/mem.mjs add    --home .tmp/store --abstract "示例事实" --body "正文"
node packages/cli/bin/mem.mjs recall --home .tmp/store 示例
node packages/cli/bin/mem.mjs rebuild --home .tmp/store
node packages/cli/bin/mem.mjs doctor --home .tmp/store
```

`init` 幂等：已存在的文件一律保留。`doctor` 每次启动都会重新校验配置与策略哈希，并报告 journal 链与隔离项。

## 校验

```bash
npm run ci              # 门禁 + 类型检查 + 测试（= node scripts/ci.mjs）
npm run smoke           # 成功路径：init -> doctor(json+text) -> policy seal
```

每个脚本都是独立的 Node 入口（`scripts/*.mjs`），用 spawn + 继承 stdio 调子进程，因此在受限（沙箱）会话里也能跑。`scripts/smoke.sh` 只是 `smoke.mjs` 的 POSIX 包装（本机没有 bash，成功路径不能因此被跳过）。受限会话里如果 `npm install` 的安装脚本被拦，用 `npm install --ignore-scripts`。

环境相关的事实与操作（本机没有 PowerShell 7、工作区权限修复与回滚、安装注意事项）都在 [docs/ops.md](docs/ops.md)；回滚是"真还原"，会连带撤掉沙箱自己加的权限项，用之前先看那一节。

## 仓库结构

```
├── AGENTS.md                 本仓库的工作约定（软约束，不是门禁）
├── package.json              npm workspaces
├── tsconfig.json             strict / NodeNext / erasableSyntaxOnly
├── docs/
│   ├── research/             开发方案与全部原始调研材料
│   ├── adr/                  每个阶段的决策记录
│   ├── config.md             config.toml 键表（由 CI 与 schema 比对）
│   ├── policy.md             policy.json 字段表与封存机制
│   └── ops.md                本机环境事实、权限修复/回滚、安装与运行
├── packages/
│   ├── core/                 ★ 纯逻辑，零 DSH 依赖
│   │   └── src/
│   │       ├── config/       受限 TOML 解析 + schema 校验 + 加载
│   │       ├── policy/       policy.json 加载、封存、哈希校验
│   │       ├── fs/           原子写、写锁（租约 + PID）、同步等待
│   │       ├── model/        类型冻结、frontmatter、ID、有效期
│   │       ├── journal/      单一 append-only 历史（链、幂等、恢复）
│   │       ├── store/        锁内事务、CRUD、入账/隔离、子串召回
│   │       ├── paths.ts      数据目录布局与解析
│   │       ├── init.ts       建骨架
│   │       └── startup.ts    唯一的启动路径
│   ├── dsh/                  DSH 适配器（探针插件；禁止文件 I/O）
│   └── cli/                  mem 命令（init/doctor/add/read/recall/rebuild/policy）
├── scripts/
│   ├── lib/gates.mjs         门禁实现（可被 fixture 测试）
│   ├── gates.mjs             门禁入口
│   ├── ci.mjs                gates + typecheck + test
│   ├── stage.mjs             阶段门禁（ci + smoke + ADR + 验收编号）
│   ├── test.mjs · typecheck.mjs · build.mjs
│   └── smoke.mjs · smoke.sh  成功路径（sh 只是包装）
└── dist/                     npm run build 产物（esbuild）
```

> `packages/mcp` 不在 S1：优化版方案明确"不为暂未实现的客户端预建空包"，MCP 适配器推迟到真有第二个客户端时再做（见 [ADR-0002](docs/adr/0002-optimized-plan-deltas.md)）。

## 三条硬纪律

1. `packages/core` **不得出现 `@deepseek-ai/` 字样**（CI 扫整棵子树）；
2. `packages/dsh` **不得直接读写文件**，只能调 core（CI 扫 `node:fs` / `fs` 导入）；
3. `packages/core` **不得出现 `entitled` / `paid` / `tier` 一类的商业化分支**（词边界、大小写不敏感；V1 没有付费能力，也不留空钩子）。

## 退出码

| 码 | 含义 | 什么时候 |
|---:|---|---|
| 0 | 成功 | `init` / `doctor` 正常 / `policy seal` |
| 1 | 用法错误 | 未知命令、未知参数、参数缺值 |
| 2 | 启动被拒 | 配置未知键/类型/范围、策略哈希不符、目录不存在、显式配置文件缺失 |
| 3 | 确认缺失 | `policy seal` 没有 `--accept` |
| 4 | 降级运行 | 存在被隔离（未入账/损坏）的记忆时 `doctor` 返回 4 |

## 开发路线图（v1.3）

```text
S0 兼容性 ─► S1 骨架 ─► S2a 存储核心 ─► S2b 完整性 ─► S3 召回/注入/规则 ─► S4 工具/权限 ─► S6 收尾蒸馏 ─► S7 运维/发布
   ✅           ✅            ✅             ✅              ✅                  ✅                  ✅              ✅
```

| 阶段 | 目标 | 关键产出 | 验收 | 估时 | 状态 | 记录 |
|---|---|---|---|---|---:|---|---|
| **S0** | 锁定宿主与接口 | 版本/API/沙箱边界实测；最小探针插件 | M1–M4 | 2–3 d | ✅ 完成（M2 已复测） | [ADR-0003](docs/adr/0003-dsh-compat.md) |
| **S1** | 能启动、能拒绝坏配置 | workspaces、受限 TOML、严格 schema、策略封存、门禁、CLI 3 命令 | 未知键拒绝、哈希不符拒绝、core 纯净 | — | ✅ 完成 | [ADR-0001](docs/adr/0001-skeleton.md)/[0002](docs/adr/0002-optimized-plan-deltas.md) |
| **S2a** | 写入→读出→重建闭环 | journal、锁、模型、store、子串召回、CLI 4 命令、配置冻结 22 键 | S2a.1–S2a.6 | 4–5 d | ✅ 完成 | [ADR-0005](docs/adr/0005-s2a-store.md) |
| **S2b** | 坏文件不拖垮、可修 | 隔离/adopt、路径红队、journal 一致性、`sealed_files`、备份演练 | S2b.1–S2b.5 | 3–4 d | ✅ 完成 | [ADR-0006](docs/adr/0006-s2b-integrity.md) |
| **S3** | 每轮看得见该看的 | BM25 + 60 条 fixture、section 注入、快照、RULES 解析、token 预算 | S3.1–S3.6 | 4–5 d | ✅ 完成 | [ADR-0007](docs/adr/0007-s3-recall-inject-rules.md) |
| **S4** | 只能从一个门进出 | 5 个模型工具、可信来源绑定、提案/决定、T0/T1/T2、扫描 | S4.1–S4.6 | 4.5–5.5 d | ✅ 完成 | [ADR-0008](docs/adr/0008-s4-tools.md) |
| **S6** | 项目收尾有候选可采纳 | L0 打标、`/closeout`、决定界面、去重 | S6.1–S6.5 | 3–3.5 d | ✅ 完成 | [ADR-0009](docs/adr/0009-s6-closeout.md) |
| **S7** | 可备份、可回滚、可发布 | `inspect`/`export`/`purge`、备份、`mem pack`、真实 DSH smoke | S7.1–S7.6 | 3–4 d | ✅ 完成 | [ADR-0010](docs/adr/0010-s7-ops.md) |

- **V1.0 完成**；S7.5 真实 DSH 全流程走查已通过（2026-10-17，第 9 轮）。
- 依赖：S3 起需要 S0 的实测结论；S4 依赖 S2b 的隔离与 S3 的注入；S6 依赖 S4 的提案/决定；S7 收口全部。
- 未决问题见 [docs/plan/open-questions.md](docs/plan/open-questions.md)；偏差修复待办见 [docs/plan/todo.md](docs/plan/todo.md)；阶段门禁 `node scripts/stage.mjs <S>`（ci + smoke + ADR + 验收编号）。
- **闭环检查**（`scripts/closure.mjs`，已并入阶段门禁）：已标 ✅ 的阶段必须有存在的 ADR 链接与「第 N 轮」记录；到期 `todo.md` 条目不得是"待办"（`顺延` 必须带理由）；到期 open question 必须"已解决/顺延"；README 必须仍链接两个计划文件。
- 原 S5（硬约束）已并入 S3（规则渲染与映射校验）与 S2b（封存扩展），见 v1.3 §0 与 [ADR-0004](docs/adr/0004-plan-v1.3.md)。

## 已完成功能（逐轮追加）

> 约定：**只追加、不改写历史**。每完成一个阶段，在末尾加一段（日期 / 阶段 / 新增功能 / 怎么验证 / ADR），并同步更新上面的路线图状态列。

### 第 1 轮 · S1 骨架（2026-10-17）

- npm workspaces：`core`（纯逻辑 + 文件 I/O）、`dsh`（适配器）、`cli`（`mem`）。
- 受限 TOML 子集 + 严格 schema：未知键、类型错误、超范围都在启动时失败并点名键与行号。
- `policy.json` 字节哈希封存；`mem policy seal --accept` 是人专属重封入口。
- 唯一启动路径（目录 → 策略 → 配置 → 边界）；`mem init` 幂等。
- 四条仓库门禁：core 不含宿主包、dsh 不碰文件、core 无商业化分支、docs 与 schema 键名双向一致。
- CLI：`mem init` / `doctor` / `policy seal`；退出码 0/1/2/3/4 定稿。
- 验证：`npm run ci` 绿（56 测试）、`npm run smoke` 通过。
- 记录：[ADR-0001](docs/adr/0001-skeleton.md)、[ADR-0002](docs/adr/0002-optimized-plan-deltas.md)。

### 第 2 轮 · S0 兼容性实测（2026-10-17）

- 实测宿主：桌面 DSH **0.2.1-rc.1**（2026-10-17 晚升级到 rc.2，S3 重跑 M1–M4）、运行时 Node **24.21.0**；全局 CLI 0.2.0-rc.2 是另一套（`npm run compat` 会提示）。
- 确认可用接口：`ctx.tools.register`、`ctx.systemPrompt.section`、`ctx.sessionPersistence`、`ctx.tokenMeter`、`ctx.commands.register` + `agent.followup`、`delegationDepthOf`。
- 确认禁用：`appendPluginRecord`（外部插件不得调用）、`session.eventAt/snapshotEvents`（新代码禁用）。
- 边界实测：工具**写被 fence、读不被 fence**；插件进程不受沙箱约束；桌面 profile 由 Electron 独占管理。
- 探针插件（`packages/dsh`）：`am_echo`、`am_probe_tokens`、`agent-memory:probe` section、`/am-closeout`；M1/M3/M4 在真实宿主通过，M2（压缩后字节稳定）留 S3。
- 配置/策略清理到 v2：删 `viewer.*`、`audit.*`、`policy.targets`、`policy.approval`；`private_tag` 改 `reject|confirm`。
- 验证：`npm run compat`、真实会话里的 `echo: hi` / `am-probe-ok` / `/am-closeout`。
- 记录：[ADR-0003](docs/adr/0003-dsh-compat.md)、[ADR-0004](docs/adr/0004-plan-v1.3.md)。

### 第 3 轮 · S2a 存储核心（2026-10-17）

- **单一 journal** `.state/journal/NNNN.jsonl`：append-only、5 MiB 分段、`{seq,prev,at,op,op_id,data}`、行哈希链、`op_id` 幂等；入账/删除/决定/审计同源。
- **写锁**：`wx` 创建 + 心跳租约；心跳陈旧且 PID 不存活才判陈旧；获取超时响亮失败。
- **不可变记忆 + 派生有效期**：`supersedes` 数组、`as_of`、`valid_until` 排除端、后继截断、成环/自引用拒绝。
- **frontmatter** 每行 `key: <JSON>`：未知/重复/多行/非法日期/超长/缺必填全部拒绝；CRLF/BOM 规范化后哈希稳定。
- **原子写**：临时文件 → `fsync` → rename；Windows `EPERM/EBUSY` 有限退避；目录项不 fsync 的边界写进 README。
- **store**：锁内事务（文件 → journal → `MEMORY.md`/manifest）、入账/隔离判定、全等去重、子串召回、`rebuild`。
- **tripwire**：manifest 记 `journal_head`；journal 被截断/断链 → `doctor` 返回 2、拒绝写入、**拒绝 rebuild 掩盖**。
- CLI：`mem add` / `read` / `recall` / `rebuild`；`doctor` 增加 journal head、活动/隔离计数与退出码 4。
- 配置一次加满：新增 10 键，`recall.limit` 默认 8 → 5，共 **22 键**（schema、模板、docs、测试同步）。
- 工程：`scripts/stage.mjs S2a` 阶段门禁；smoke 扩展为 add → read → recall → rebuild 七步。
- 验证：`node scripts/stage.mjs S2a` 全绿（**97 个测试** + smoke + ADR + S2a.1–S2a.6 编号）。
- 记录：[ADR-0005](docs/adr/0005-s2a-store.md)。

### 第 4 轮 · S2b 完整性（2026-10-17）

- **隔离可操作**：`mem adopt <id>` 在人审后把文件当前规范化哈希写进 journal `adopt` 行；解析失败就拒绝，文件继续隔离。
- **删除只写 journal**：`mem delete <id> --reason <text>` 追加 `delete` 行（含哈希与理由），文件保留；`read` 仍可追溯，`recall`/目录不再出现；重复删除返回 2。
- **`sealed_files`**：policy v2 加 `soul`/`user`/`rules` 三个哈希（空串跳过）；`mem policy seal --accept` 按当时内容写入，任一被改 → 启动失败并点名文件。
- **路径红队**：拒绝非绝对路径、Windows 保留名（CON/NUL/COM1…）、带冒号段；id 永远是 `mem-YYYYMMDD-8hex`，`read ../..` 只得到“不存在”。
- **`doctor` 完整版**：列出隔离 id + 原因、journal 链状态；有隔离返回 4，链不一致返回 2。
- **备份演练**：整目录复制 → 新目录重建 → 活动集合与源一致。
- CLI：`mem adopt`、`mem delete --reason`；`doctor` 输出隔离明细。
- 验证：`node scripts/stage.mjs S2b` 全绿（**114 个测试** + smoke 的 S2b 段 + ADR + S2b.1–S2b.5 编号）。
- 记录：[ADR-0006](docs/adr/0006-s2b-integrity.md)。

### 第 5 轮 · S3 召回、注入与规则（2026-10-17）

- **分词 + BM25**：NFKC + 小写、CJK 二元组、代码型片段整体保留并拆分；字段权重 `error_signatures ×4 / abstract ×3 / 正文 ×1`，字面命中加分；`tokenizer_version` 进 manifest。
- **召回门槛**：60 条记忆 / 16 查询（12 dev / 4 held-out）；`npm run eval` 写基线，`docs/eval/s3-thresholds.json` 是只升不降的地板（当前 Recall@5 = 1.0、误返回 0）。
- **`recall.min_score` 落地**：千分制（500 = 0.5），分数按本次查询最高分归一化；无答案返回空结果。
- **注入装配**：SOUL/USER/RULES/MEMORY 四段、预算与确定性裁剪、RULES 超预算硬失败、空段不产生标题、随机 16 hex 分隔符 + JSON 风格包裹（围栏/`</memory>` 不逃逸）。
- **会话快照**：同会话字节一致、新会话新 revision、缺失重捕获并写 journal `audit`、保留最近 20 个。
- **注入安全**：装配前重校验 `sealed_files`；只取 `active(asOf)`，删除的记忆不回流。
- **RULES 解析与门禁**：编号/机器门禁/模型指引/废止；`check` 符号存在、`test` 文件存在且含 `[neg]`；`scripts/rules-gate.mjs` 进 CI。
- **bundle 契约**：`dist/plugin.mjs` 零 import、导出 `apply/inject/name`；`dsh/assemble.ts` 只做 section 形状映射。
- 验证：`node scripts/stage.mjs S3` 全绿（**144 个测试** + smoke 的 S3 段 + ADR + S3.1–S3.6 编号 + 闭环检查）。
- 记录：[ADR-0007](docs/adr/0007-s3-recall-inject-rules.md)。

### 第 6 轮 · S4 工具、权限与审批（2026-10-17）

- **工具表**：`memory_recall` / `memory_read` / `memory_record` / `memory_propose` / `memory_context` / `rules_list`，严格 schema、`additionalProperties:false`、无 path/target/session/approve 字段、每个工具声明 `output {schema, render}`；`decide` 永不是工具。`memory_context` 返回最近事件的 `{seq, speaker, preview}`，让模型能选对 `event_seq`。
- **权限**：子 agent 只拿读工具；T0 配额用尽拒绝并提示改用提案；`memory_propose` 必须带 `base_hash`，accept 前重新核对。
- **扫描**：不可见/双向字符、`sk-`/`AKIA`/私钥/连接串、注入模式、`<private>`；只报规则 id + 字段名，不把原文写进错误或 journal；`add` 与 `adopt` 同一扫描。
- **提案账本**：`proposals/pending/*.json` + journal `decide`；supersede 一次写多条、失败回滚已写文件（不部分提交）；失败保留提案。
- **来源绑定**：`quote` 必须是真实事件子串，assistant 消息不能当证据，事件哈希可校验。
- **CLI**：`mem proposals`、`mem decide <id> accept|reject --accept`；`accept` 需人工确认（缺 `--accept` 退出码 3），与工具共用同一 store。
- **插件接线**：`dist/plugin.mjs` 打包 core；store 可用时注册 5 工具 + 真实注入 section，否则回退 S0 探针；bundle 契约调整为“无第三方 import，Node 内置模块允许”。
- 实测：headless 一次性 profile 里 `memory_recall`、`rules_list` 均真实调用成功；桌面会话工具表已出现 5 个工具。
- 验证：`node scripts/stage.mjs S4` 全绿（**172 个测试** + smoke + ADR-0008 + S4.1–S4.6 + 闭环检查）。
- 记录：[ADR-0008](docs/adr/0008-s4-tools.md)。

### 第 7 轮 · S6 收尾蒸馏（2026-10-17）

- **L0 确定性打标**：重复错误、用户纠正、工具失败后成功、回滚；只产出事件引用与摘要。
- **提示词即契约**：L0 列表 + 活动记忆目录 + 严格 JSON；最多 5 条提案。
- **模型输出全部重验**：targets 必须是活动 id、event_seq 必须真实、assistant 消息不能当证据、quote 必须子串；重复/已否决摘要丢弃；超 5 条截断。
- **规则降级**：无 `check`+`test` 的 rule 降为 pitfall，不冒充机器保证。
- **轮次生命周期**：`CloseoutRound` 只允许一次 submit，成功/失败/超时 dispose；`/closeout` 打开轮次，`closeout_submit` 只在轮次内注册。
- **决定界面**：`mem proposals`、`mem decide <id>`、`mem decide --batch accept|reject`；否决摘要存 `.state/distill-rejected.json`，下次不再提。
- **桌面实测**：`/closeout` → `closeout_submit` → `{"proposals":[],"message":"本次无新提案"}`；`closeout_submit` 提交后消失。
- 验证：`node scripts/stage.mjs S6` 全绿（**178 个测试** + smoke + ADR-0009 + S6.1–S6.5 + 闭环检查）。
- 记录：[ADR-0009](docs/adr/0009-s6-closeout.md)。

### 第 8 轮 · S7 运维与发布（2026-10-17）

- **`mem inspect`**：各 kind 活动数、规则清单与类别、最近 N 条 journal、预算占用、隔离与 journal head；`--json` 给机器。
- **`mem export` / `mem pack`**：复制权威数据（memories、proposals、journal、封存、三份人工文件、配置/策略），生成排序后的 `SHA256SUMS`；不复制派生物。
- **`mem purge <id> --accept`**：journal 墓碑（`purged:true` + 原因）、删文件、重建 manifest/目录、引用它的待审提案作废；`reload` 不再把墓碑当隔离。
- **历史审计**：`scripts/audit-sessions.mjs` 只读扫 106 个会话日志（54 v4 + 52 v3），0 缺陷；`repair-dsh-session.mjs` 遇 v3 明确跳过。
- **恢复文档**：`docs/ops.md §8` 写清 journal 断链/截断的停写、导出、判断、恢复顺序。
- 验证：`node scripts/stage.mjs S7` 全绿（**185 个测试**，含 S7.1–S7.6；S7.5 为人工用例）。
- 记录：[ADR-0010](docs/adr/0010-s7-ops.md)。

### 第 9 轮 · S7.5 真实 DSH 全流程走查（2026-10-17）

- **全流程**：新建会话 → `memory_record`（引用 `memory_context` 给出的 `event_seq`）→ `memory_recall` 命中 → `memory_propose` 提出替代 → `mem decide --batch accept` → `/compact` → 重启应用 → `mem rebuild` + `mem inspect`；重启后召回命中替代后的 `mem-20261017-16850c76`，旧条目仍可 `memory_read` 追溯。
- **修复：宿主缓存**——`Store.recall` 与 `Store.read` 查询前先 `reload()`；CLI 写入/决定之后，宿主常驻 store 不再返回旧索引，也不会对 CLI 刚写入的记录报“找不到 id”。
- **修复：提案证据断链**——提案在 propose 时绑定 `provenance`（`session_id`/`event_seq`/`speaker`/`quote`/`event_sha256`），accept 后写进替代记录；原先 `service.propose` 丢弃证据、`addMany` 硬编码 `provenance: []`，导致 `author: human` 的新记录无出处、`provenance_verifiable:false`。
- **收紧 `memory_propose`**：`replacements` 逐项要求 `kind`/`abstract`/`body`/`evidence`，`evidence` 非空且 `event_seq` 非负；closeout 证据 `quote` 限 160 字符。
- 真实签收：`memory_propose` 提交的提案 JSON 已含 provenance；`mem decide` 采纳后 `memory_read` 返回 `mem-20261017-c3634f09`（provenance：session、event_seq 7277、speaker=user、quote=「重启好了」、event_sha256），`memory_recall` 的 `provenance_verifiable: true`。
- 验证：`node scripts/ci.mjs` 全绿（**190 个测试**，1 个 S7.5 人工用例 skip）；真实 store `mem inspect`：3 active、journal 一致。
- 记录：[ADR-0010](docs/adr/0010-s7-ops.md)（追加 S7.5 走查）。

### 第 10 轮 · 聊天框内的人机指令 `/mem`（2026-10-17）

- **新增 `/mem` 命令面**：把 CLI 的人操作搬进聊天输入框——`proposals`、`decide`（单个 / `--batch`）、`add`、`read`、`recall`、`inspect`、`adopt`、`delete`、`purge`、`rebuild`、`export`、`seal`、`help`。
- **模型不可触达**：命令走宿主的 UI 命令面，不进模型消息/上下文；`decide` 仍不是工具。
- **安全确认**：`purge`/`seal` 要 `--accept`，`decide` 必须写出 `accept|reject`，`delete` 要 `--reason`。
- **衔接**：`memory_propose` 的工具输出追加「人在聊天框决定：/mem decide <id> accept」，提案→决定不离开对话。
- **实现**：语法与逻辑在 `packages/core/src/human/command.ts`（可单测），DSH 只转发；宿主为每次命令写 `command/run` + `command/done` 审计。
- 验证：`node scripts/ci.mjs` 全绿（**200 个测试**）；插件测试里 `/mem add` → `/mem read` 跑通。
- 记录：[ADR-0011](docs/adr/0011-chat-commands.md)。

### 第 11 轮 · 按钮式审批卡片（2026-10-17）

- **提案即弹卡**：`memory_propose` 建完提案立刻弹出中文选项卡片（复用宿主 `userQuestions` 面）：先展示提案全文（目标/理由/替换内容/出处），再给「采纳 / 驳回 / 暂不处理」三个按钮。
- **点击即命令**：采纳 → `/mem decide <id> accept`，驳回 → `… reject`，经宿主 `commands.execute` 执行，与聊天框 `/mem` 同源；暂不处理不落任何决定。
- **`memory_review` 工具**：对暂缓的提案重新弹卡；参数只有可选 id，没有任何决定字段。
- **安全边界**：判定只来自卡片上的点击，模型传不了 accept/reject，`decide` 仍不是工具；无交互界面时降级为“保留待审”。
- 实测通过：`memory_propose` 弹出卡片 → 点「采纳」→ 实际执行 `/mem decide prop-mem-20261017-70b94008 accept` → 新记录 `mem-20261017-f0fa7c44`（provenance 保留 event_seq 8255「提一条修订提案」，`memory_recall` 返回 `provenance_verifiable: true`）。
- **卡片排版**：`1)` `2）` 这类行内编号自动拆成独立行并渲染为有序列表，长正文不再挤成一段；无编号的正文保持原样。
- 实测发现并修复两处：① 交互服务在插件 apply 时尚未激活（`userQuestions` 取到 `undefined`），改为**调用时惰性解析**；② 快照审计直接写 journal、绕过 manifest 刷新，下一次写入被误判为“journal 不一致”而拒写——快照改走 `store.appendAudit`，同时 `reload` 只把「journal 落后于 manifest」视为截断，「manifest 落后」按陈旧派生物自愈。
- 验证：`node scripts/ci.mjs` 全绿（**210 个测试**，S9.1 卡片用例 + S9.2 manifest 自愈用例 + S9.3 排版用例）。
- 记录：[ADR-0012](docs/adr/0012-review-cards.md)。

### 第 12 轮 · 记忆架构 v2：人设层、用户条目、会话工具（2026-10-17）

- **人设层脚手架**：`mem scaffold`（聊天框 `/mem scaffold`）生成 SOUL.md / USER.md / RULES.md 注释模板，封存 SOUL/RULES，USER 默认不封存；模板内容在注入前被剥掉，未编辑时零噪音。
- **注入分段**：SOUL / RULES / USER / MEMORY 各自一个 prompt section（order 100/150/200/300），空文件不产生 section；快照 schema 升到 v2 以保存分段。
- **USER 条目**：`user_profile` 工具读改 `§` 条目（单条完整、10000 字上限、唯一字面匹配），写入前必须在本会话读过 USER，并经确认卡片；写后追加 journal 审计。
- **会话五工具**：包装宿主原生 `sessionQuery`（FTS5）——`session_search`、`session_event_search`、`session_event_read`、`session_event_trace`、`session_trace`，全部只读、默认当前会话。
- **体检**：`mem inspect` 显示三份人工文件字符数；`mem doctor` 在缺失时提示 `mem scaffold`。
- 验证：`node scripts/ci.mjs` 全绿（**224 个测试**，S10.1–S10.4）。
- 记录：[ADR-0013](docs/adr/0013-memory-v2-p0-p2.md)。

### 第 13 轮 · 记忆架构 v2 收口：guidance 路由与权限开关（2026-10-17）

- **`MEMORY_GUIDANCE` 注入段**：按 `personalization.mode` 生成中文指引（偏好→USER、事实→记忆、约定→RULES、先读后写、只走工具、子 agent 只读），顺序 SOUL 100 → GUIDANCE 110 → RULES 150 → USER 200 → MEMORY 300；预算 300 字，快照 schema 升到 v3。
- **权限开关**：新配置 `personalization.mode = confirm | direct | readonly`（默认 confirm）。readonly 拒绝一切助手写入（record/propose/偏好）；direct 让偏好写入跳过卡片；confirm 保持卡片确认。
- **预算调整**：新增 `inject.guidance_max_chars`（300），`inject.total_max_chars` 3700→4000（五段之和）；真实库配置已按新模板重建并校验通过。
- **诊断**：`mem doctor` 的 inject 行显示 guidance 预算。
- 验证：`node scripts/ci.mjs` 全绿（**228 个测试**，S11.1–S11.3）；真实库 `mem doctor` 通过、journal 一致。
- 记录：[ADR-0014](docs/adr/0014-memory-v2-p3-p4.md)。

### 第 14 轮 · preset 接入与只读工具裁剪（2026-10-18）

- **`npm run preset`**：`scripts/preset.mjs` 读取本机安装的 `standard` preset，复制成新的 preset 配置并追加 `@agent-memory/dsh`（带 `mode`），同时生成「停用根挂载」的补丁行；用法见 [docs/presets/README.md](docs/presets/README.md)。
- **只读裁剪**：`mode: readonly` 时不再注册 `memory_record` / `memory_propose`（模型看不到写工具），只读工具与会话检索保留。
- **稳定性**：修正一个跨天会失效的日期用例（`valid_from/as-of recall` 改用固定日期）。
- 验证：`ci` 全绿（**228 个测试**，S12.1）；生成的 preset 补丁经 YAML 解析验证（2 个顶层项、20 个插件、末项为只读记忆插件）。
- 记录：[ADR-0015](docs/adr/0015-preset-and-tool-trimming.md)。

### 第 15 轮 · V2 P0 探针与 P0.5 解耦（2026-10-18）

- **P0 探针**：客户端半层（手写 loader bundle）注册侧栏「记忆」入口与全页工作台；宿主新增只读路由 `/api/agent-memory/status`；侧栏、页面、接口三项闸门在真实桌面全部通过（路由前缀为 `/api/...`，注册走 `ctx.effect` + `ctx.inject(['connection'])`）。
- **P0.5 解耦**：
  - **段注册表** `inject/sections.ts`：新增文档层只需加一个 `SectionSource`（测试 `S13.4` 验证 PRINCIPLES 段按 order 插入）；
  - **模块健康隔离**：RULES 非法/超预算只降级该段为可见提示（`S13.3`），不再拖垮整次注入；profile / session / injection 各自 guard，`/api/agent-memory/status` 返回 `modules`，GUI 显示「部分模块不可用」；
  - **能力组** `capabilitiesFor(mode, depth)`（`S13.5`）：readonly 只缺 `facts.write`，子 agent 只有读组；
  - 快照 schema 升到 v4（`sectionList` + `health`），旧快照自动重捕。
- 验证：`ci` 全绿（**232 个测试**）；P0 真实桌面通过（侧栏入口、全页工作台、状态接口）。
- 记录：[ADR-0016](docs/adr/0016-p05-section-registry.md)。

### 第 16 轮 · V2 P1 只读工作台（2026-10-18）

- **五个只读路由**：`/api/agent-memory/{status,list,item,search,export}`，全部经 `MemoryStore`，不碰文件；导出为 JSON 附件。
- **列表**：按 事实 / 坑 / 经验 分组，组内按时间从晚到早编号，展示序号 `F-01` / `P-01` / `E-01`（V3 再出正式命名表）。
- **详情**：序号、id、维护者、日期、正文、出处列表。
- **工具条**：搜索（BM25）、导出备份、「命令手册」小按钮（弹层，强调日常不需要命令）。
- 客户端仍是手写 loader bundle；P1 跟进把它迁到 TS + 构建，减少维护成本。
- 验证：`ci` 全绿（**236 个测试**，`S14.1`–`S14.4`）。
- 记录：[ADR-0017](docs/adr/0017-v2-p1-workbench.md)。

### 第 17 轮 · V2 P2 图形界面写流与审批（2026-10-18）

- **提案面板**：列出待审提案（目标序号/摘要、原因、替换内容），「采纳/驳回」调用与 `/mem decide` 相同的 `decideProposal`，journal 追加 `gui-decide` 审计。
- **修订/删除**：详情里「修订」打开行内表单，「删除」二次确认；两者都走提案 + 决定，旧记录失效但 journal 保留。
- **偏好**：`/api/agent-memory/profile` 读写 USER.md 条目，保存后下一轮注入生效。
- **规则**：`/api/agent-memory/rules` 读写 RULES.md，保存前整文件校验、保存后重新封存；GUI 是 RULES 的唯一写入口（模型工具与 CLI 都没有）。
- 客户端仍是手写 loader bundle；`ci` 全绿（**239 个测试**，`S14.5`–`S14.7`）。
- 记录：[ADR-0018](docs/adr/0018-v2-p2-write-flows.md)。

### 第 18 轮 · UI 命名：库编号 + 内容总结（2026-10-18）

- 事实基础：用户不知道 `mem-20261017-dc3339cf` 代表什么；界面不再展示内部 ID。
- **已有记忆**：库编号 + 内容总结（≤12 字），如 `F-01 中文优先偏好`；**新内容**只有总结；类型只用中文（事实/坑/经验、修订/删除）。
- 服务端统一产出 `display`（`summarize` / `displayName`），列表、详情、提案卡共用；详情行改为 `F-01 · 事实 · 人工维护 · 日期`。
- 规范文档：[docs/design/ui-guidelines.md](docs/design/ui-guidelines.md)。
- `ci` 全绿（**240 个测试**，`S14.9`）；记录：[ADR-0019](docs/adr/0019-ui-naming.md)。

### 第 19 轮 · V2 P3 分发与 MCP 外挂（2026-10-18）

- **打包**：`npm run pack` 构建并产出 `release/agent-memory-dsh-0.1.0.tgz`，内含宿主半层、客户端半层与 `cordis.patch.yml`；检查缺件即失败。安装走 设置 → 插件（或 `dsh plugin add <tgz>`），升级/回滚见 [docs/distribution.md](docs/distribution.md)。
- **MCP 外挂**：`mem mcp` 启动 stdio MCP server；工具只有 `memory_search` / `memory_read` / `memory_list` / `memory_propose`，**没有 decide、没有 record**；外部提案进同一个待审队列，由人在 GUI 处理。Codex 用 `[mcp_servers.agent-memory]` 接同一数据目录，见 [docs/mcp.md](docs/mcp.md)。
- **提案显示**：提案卡新增「查看详情」，展开目标全文、修改后摘要/正文与理由（第 18 轮命名规则）。
- `ci` 全绿（**244 个测试**，`S15.1`–`S15.4`）；记录：[ADR-0020](docs/adr/0020-v2-p3-distribution-mcp.md)。

### 第 20 轮 · V2 P3.5 客户端 TS 构建（2026-10-18）

- 客户端源码移到 `packages/dsh/client/src/index.ts`；`scripts/build.mjs` 用 esbuild 产出 CJS 并包成宿主 loader 格式，写到固定路径 `client/client.js`（产物带 `@generated` 头）。
- `npm run build` / `ci` / `npm run pack` 都会重建客户端；tarball 只收 `client/client.js`，不再带源码。
- `S13.1` 增加生成头断言并兼容多行槽位注册；`ci` 全绿（**244 个测试**）。
- 记录：[ADR-0021](docs/adr/0021-v2-p35-client-build.md)。

### 第 21 轮 · 备份导入（2026-10-18）

- GUI 新增「导入备份」：选择导出 JSON，逐条经 `store.add` 导入并去重；返回新增/跳过/失败计数，写 `gui-import` 审计。
- 导入条目记为人工添加，provenance 原样保留；pending 提案不导入（避免绕过审批队列），报告里给出忽略数量。
- `ci` 全绿（**245 个测试**，`S14.10` 导出→导入→去重）；记录：[ADR-0022](docs/adr/0022-backup-import.md)。

### 第 22 轮 · 去重、排序与工具条（2026-10-18）

- **去重**：`store` 改为**内容去重**（kind + 摘要 + 正文 + 错误特征），忽略日期/作者/证据等级；跨日导入同一内容只跳过。
- **排序**：列表与序号统一按 `valid_from` 从晚到早（同日期再按创建时间），导入时间不再影响顺序。
- **工具条**：导出/导入移到末尾（命令手册之后）。
- `ci` 全绿（**247 个测试**，`S14.11`/`S14.12`、工具条顺序断言）；记录：[ADR-0023](docs/adr/0023-dedupe-sort-toolbar.md)。

### 第 23 轮 · GUI 彻底删除（2026-10-18）

- **删除 = 物理移除**：GUI「删除」改用 `store.purge`，移除记忆文件并失效相关 pending 提案；同时递归清除被替代的旧版本，避免「删了又复活」。
- **journal 只留审计**：追加式链不能删行；purge 只写 `delete{purged, reason, sha256}`，不保留正文，文件已不可恢复。
- **导入恢复**：被删的唯一内容可从备份重新导入；若同内容仍有活动副本，则按内容去重跳过（这是去重语义）。
- `ci` 全绿（**248 个测试**，`S14.13`）；记录：[ADR-0024](docs/adr/0024-hard-delete.md)。

### 第 24 轮 · 列表折叠、详情置顶与切换收起（2026-10-18）

- **每组最多 8 条**：超出部分放进下方独立滚动区（标注「还有 N 条，向下滚动查看」），复用细滚动条。
- **详情置顶**：详情卡在工具条之后、列表之前出现（flex order），打开条目自动回到顶部。
- **切换收起**：打开提案/偏好与规则、执行搜索、切换条目时统一清空详情与修订草稿。
- `ci` 全绿（**248 个测试**，`S13.1` 断言扩展）；记录：[ADR-0025](docs/adr/0025-list-interaction.md)。

### 第 25 轮 · V3.0 独立视觉（2026-10-18）

- 新增 `client/src/styles.ts`（`am-*` 令牌、明/暗、响应式、组件类）与 `client/src/components.ts`（`AmButton/AmBadge/AmEmpty/AmSkeleton`）。
- 工作台根节点 `am-root` + `data-am-theme`；默认跟随系统，标题右侧 ☾/☀ 手动切换并存 localStorage。
- 工具条/徽章/加载态/页面容器换成新组件与类；`ci` 全绿（**249 个测试**，`S16.1`）。
- 记录：[ADR-0026](docs/adr/0026-v3-visual-tokens.md)。

### 第 26 轮 · Chrome 配色与详情出处移除（2026-10-18）

- 令牌换成 Chrome 调色板：浅色 `#f8f9fa/#fff/#202124/#dadce0/#1a73e8`，深色 `#202124/#292a2d/#e8eaed/#3c4043/#8ab4f8`；三类色改为事实蓝 / 坑琥珀 / 经验绿。
- 详情卡移除对话出处列表，搜索结果移除「有出处/无出处」标签；数据仍保留在 API/导出/审计中。
- `ci` 全绿（**249 个测试**）；记录：[ADR-0027](docs/adr/0027-chrome-palette.md)。

### 第 27 轮 · V3.1 手动新增、整理建议与 SOUL 路径（2026-10-18）

- **新增**：`POST /create` + 工具条「＋ 新增」/分组「＋」；摘要/正文/日期，坑必填错误特征；人工维护、内容去重、`gui-create` 审计。
- **整理**：`GET /summarize` 确定性统计 + 按错误特征给出分条 RULES 建议；勾选后只放进草稿，保存并封存才生效。
- **SOUL**：`GET /soul-path` 只返回路径与提示，不读不写；设置页显示路径 + 复制按钮。
- `ci` 全绿（**252 个测试**，`S14.14`–`S14.16`）；记录：[ADR-0028](docs/adr/0028-v31-manual-workflows.md)。


