# Agent Memory

给 DSH 用的本地长期记忆：**一条记忆一个 Markdown 文件**，索引是可随时删掉重建的缓存，注入是每会话冻结一次的快照。目标是几十到几百条记忆、可 grep、可 diff、可回滚，并且**不靠提示词守边界**。

- 开发方案：[v1.3](docs/research/V1.0-开发方案-v1.3.md)（取代 v1.2 与更早版本）
- 原始调研材料：[docs/research/](docs/research/)
- 当前阶段：**S0 + S1 + S2a + S2b + S3 完成**，下一步 S4（[ADR-0003](docs/adr/0003-dsh-compat.md)、[ADR-0005](docs/adr/0005-s2a-store.md)、[ADR-0006](docs/adr/0006-s2b-integrity.md)、[ADR-0007](docs/adr/0007-s3-recall-inject-rules.md)；M1–M4 已在 rc.2 复测）
- 配置与策略：**config v2（22 键）/ policy v2（8 + sealed_files 3 键）**，见 [ADR-0004](docs/adr/0004-plan-v1.3.md)
- 目标宿主：桌面 DSH **0.2.1-rc.2**（M1–M4 的实测记录在 rc.1，S3 改插件时重跑），运行时 Node **24.21.0**（`.node-version`）
- 环境：Windows / 本地 NTFS · 运行时零依赖

## 现在能做什么（S3）

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
| 阶段门禁 | `node scripts/stage.mjs S3` |
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
   ✅           ✅            ✅             ✅              ✅                  ⬜ 下一步          ⬜              ⬜
```

| 阶段 | 目标 | 关键产出 | 验收 | 估时 | 状态 | 记录 |
|---|---|---|---|---|---:|---|---|
| **S0** | 锁定宿主与接口 | 版本/API/沙箱边界实测；最小探针插件 | M1–M4 | 2–3 d | ✅ 完成（M2 已复测） | [ADR-0003](docs/adr/0003-dsh-compat.md) |
| **S1** | 能启动、能拒绝坏配置 | workspaces、受限 TOML、严格 schema、策略封存、门禁、CLI 3 命令 | 未知键拒绝、哈希不符拒绝、core 纯净 | — | ✅ 完成 | [ADR-0001](docs/adr/0001-skeleton.md)/[0002](docs/adr/0002-optimized-plan-deltas.md) |
| **S2a** | 写入→读出→重建闭环 | journal、锁、模型、store、子串召回、CLI 4 命令、配置冻结 22 键 | S2a.1–S2a.6 | 4–5 d | ✅ 完成 | [ADR-0005](docs/adr/0005-s2a-store.md) |
| **S2b** | 坏文件不拖垮、可修 | 隔离/adopt、路径红队、journal 一致性、`sealed_files`、备份演练 | S2b.1–S2b.5 | 3–4 d | ✅ 完成 | [ADR-0006](docs/adr/0006-s2b-integrity.md) |
| **S3** | 每轮看得见该看的 | BM25 + 60 条 fixture、section 注入、快照、RULES 解析、token 预算 | S3.1–S3.6 | 4–5 d | ✅ 完成 | [ADR-0007](docs/adr/0007-s3-recall-inject-rules.md) |
| **S4** | 只能从一个门进出 | 5 个模型工具、可信来源绑定、提案/决定、T0/T1/T2、扫描 | S4.1–S4.6 | 4.5–5.5 d | 下一步 | 0008 |
| **S6** | 项目收尾有候选可采纳 | L0 打标、`/closeout`、决定界面、去重 | S6.1–S6.5 | 3–3.5 d | — | 0009 |
| **S7** | 可备份、可回滚、可发布 | `inspect`/`export`/`purge`、备份、`mem pack`、真实 DSH smoke | S7.1–S7.6 | 3–4 d | — | 0010 |

- 估时合计约 **11–13 人日**（S4–S7；S0–S3 已完成）。
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

<!-- 下一轮追加到这里：### 第 6 轮 · S4 工具、权限与审批（YYYY-MM-DD） -->

