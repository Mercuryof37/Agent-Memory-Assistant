# ADR-0001 · S1 骨架的取舍

- 状态：已采纳
- 日期：2026-10-17
- 范围：S1（骨架）落地时做出的、会影响后续所有阶段的技术决定
- 依据：`docs/research/V1.0-开发方案.md` §3、§7；`06-约束硬化设计.md` §L3；`10-架构决策与v1规格.md` §四、§八

## 背景

S1 只做骨架：分层、配置、测试、启动校验。但骨架阶段的选择会渗进 S2–S8，所以凡是有争议的地方都记在这里，免得后面"实现时再改"变成分层返工。

## 决定

### D1 · npm workspaces，三个包，core 是唯一有状态的一层

```
packages/core   纯逻辑（配置、策略、存储、索引、审计、注入、蒸馏），零宿主依赖
packages/dsh    宿主适配器（assemble、tools、approval、viewer、settings）
packages/cli    本地命令（init / doctor / policy seal；后续 rebuild / closeout）
```

原方案 §3.1 里还有一个 `packages/mcp` 骨架；S1 不建它——优化版方案明确"不为暂未实现的客户端预建空包"，MCP 等真有第二个客户端再加（见 [ADR-0002](0002-optimized-plan-deltas.md)）。

三条硬纪律写进了 CI 门禁（`scripts/gates.mjs`）：

1. `packages/core` 整棵子树**不得出现宿主包字样**（`core-purity`）；
2. `packages/dsh` 的 `src` **不得 import `node:fs` / `fs`**（`dsh-no-file-io`）——要数据就调 core；
3. `packages/core` 整棵子树**不得出现商业化分支字样**（`core-no-paid-hooks`，词边界、大小写不敏感）——V1 没有付费能力，空钩子也不留。

选"整棵子树扫字符串"而不是"只扫 import 语句"，是因为注释里的 import 也能被下一次编辑复活；门禁宁可误报，不可漏报。

### D2 · 运行时零依赖，devDependencies 只有三个

`typescript`（类型检查）、`esbuild`（构建）、`@types/node`。业务代码只用 Node 内置模块：`node:test`、`node:crypto`、`node:fs`、`node:path`、`node:os`。

后果：frontmatter 与 TOML 都自研受限解析（见 D3），不引 YAML / TOML 依赖；`.npmrc` 把 npm 缓存放进仓库，否则受限会话（无法写用户目录缓存）连 `npm install` 都跑不了。

### D3 · config.toml 用自研的受限 TOML 子集

支持：注释、`[table]`、`[a.b]`、`key = value`、基础/字面量字符串、整数、布尔、单行同类型数组。

拒绝：浮点、日期、内联表、点号键、多行字符串、嵌套数组、`[[table]]`——都带行号报错。

理由：与本方案对 frontmatter 的处理一致（"只支持 scalar 与 string[]，语法超出范围直接拒绝，避免半解析"）。半解析的配置比没有配置更危险：用户以为生效了，其实没有。

### D4 · 未知键 = 启动失败，命名到键、带行号

`validateAgainstSchema` 是 config.toml 与 policy.json 共用的严格校验器：未知键、类型错误、枚举外、超范围、跨字段矛盾，一次性列出全部问题，键名精确到 `inject.persona_max_chars`，并做一次编辑距离建议（"did you mean …?"）。

决策记录：不做"未知键只警告"的宽松模式。宽松模式会让 `inject.persona_limits` 这种拼写错误静默退回默认值，正是 Hermes 静默失效事故的同类。

### D5 · config.toml 管预算，policy.json 管边界

- config.toml 在数据目录根部，人可改，只包含预算、容量、开关，**不含任何安全开关**；
- policy.json 用整份文件字节的 SHA-256 封存（`.state/policy.seal.json`），启动时比对，不符即拒绝启动；
- 重新封存只有 `mem policy seal --accept` 一条路，没有 `--accept` 就拒绝；
- config 只能收紧 policy：`storage.*` 超过 `capacity.*` 时启动失败，由 `checkPolicyBounds` 在启动路径上执行。

这样"改配置"永远改不出更宽的权限；放宽必须由人越过 T2 通道。

### D6 · Node 原生 TypeScript，构建仍然用 esbuild

- 源码直接是 `.ts`，import 带显式 `.ts` 扩展名（Node 的类型剥离要求）；
- `erasableSyntaxOnly` 打开，禁掉 enum / 参数属性等"需要编译期改写"的语法，保证 Node 与 esbuild 的行为一致；
- **跨包引用用相对路径**（`../../core/src/index.ts`），不用 `@agent-memory/core` 这个 specifier：Node 明确拒绝为 `node_modules` 下的文件剥离类型（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），而 npm workspaces 在 `node_modules` 里放的是指向 `packages/*` 的 junction，加载时仍按 `node_modules/...` 判定。相对路径绕过这个判定，也让"core 是纯逻辑、谁都能直接读"这件事在源码层可见。构建产物由 esbuild 打包成自包含文件，不存在这个问题；
- 测试用 `node:test`，`npm test` → `scripts/test.mjs`，默认 `--test-isolation=none`（单进程）。原因很实际：受限会话里"带管道启动子进程"是禁的，默认的每文件一个子进程会 `EPERM`；测试量小，单进程足够。设 `AGENT_MEMORY_TEST_ISOLATED=1` 可回到 Node 默认隔离；
- 构建调 **esbuild 原生二进制**而不是 JS API：JS API 走管道，受限会话同样不可用；
- 类型检查调 `node_modules/typescript/bin/tsc`，同样 spawn + 继承 stdio。

依赖安装的注意点：受限会话里 `npm install` 的 lifecycle 脚本会 `EPERM`（npm 用管道 spawn），用 `npm install --ignore-scripts` 安装即可——esbuild 与 TypeScript 7 的二进制都在 optional platform 包里，不依赖 postinstall。`.npmrc` 把缓存放进仓库，避免写用户目录缓存。`npm run <script>` 本身是可用的（`npm test`、`npm run ci` 都实测通过），失败的是 `npx` 与安装脚本。

### D6a · 容忍 UTF-8 BOM，但哈希仍覆盖原始字节

Windows 编辑器（以及 PowerShell 的 `Set-Content`）会给文件加 BOM。`config.toml` 解析与 `policy.json` 解析都在入口剥掉前导 BOM，否则第一行键名会带着不可见字符而被判未知键。但策略哈希仍按**文件原始字节**计算：剥 BOM 只影响解析，不影响封存——加/去 BOM 本身就是一次字节变化，哈希照样失配，必须 `mem policy seal --accept` 重新封存。两层的分工是：解析层不会因为 BOM 报"未知键"，哈希层不会因为 BOM 放过一次改动。

### D7 · 数据目录解析顺序固定

`--home` → `AGENT_MEMORY_HOME` → `$DSH_HOME/memory` → `~/.dsh/memory`。

数据目录必须在 agent 沙箱之外（`06` §L0）；路径只由宿主决定，绝不来自模型参数。`mem init` 幂等：已存在的文件一律保留，不覆盖人的编辑。

### D8 · 启动校验顺序固定为：目录 → 策略 → 配置 → 边界

1. 数据目录不存在 → `HOME_INVALID`（不是"悄悄用默认值"）；
2. 策略缺失/未封存/哈希不符 → 拒绝；
3. 配置未知键/类型/范围 → 拒绝并点名；
4. 配置越过策略上限 → 拒绝。

顺序做了取舍：先策略后配置，因为策略是地板；地板不成立时，配置对不对没有意义。

### D9 · 文档与 schema 的键名由 CI 比对

`docs/config.md`、`docs/policy.md` 的键表是**被机器检查的文档**：`docs-schema-keys` 门禁从 core 导入 `configKeys()/policyKeys()`，与文档表格逐键比对，双向查缺（文档漏键、文档多键都失败）。这样"文档与 config schema 一致"（总表 CI 第 6 条）从 S1 起就是自动的，而不是靠人记得。

### D10 · 文档中文、代码英文

代码、标识符、错误信息、提交信息用英文；`docs/`、`AGENTS.md`、`README.md` 用中文。错误信息英文是为了可 grep、可粘贴进 issue；文档中文是因为读者是人。

## 与开发方案的偏差

| 方案原文 | 本实现 | 原因 |
|---|---|---|
| `packages/core/src/config.toml` 位置未指定 | 数据目录根部 `<home>/config.toml` | 配置与策略文件放在同一处生命周期里，`init` 一次建齐；仓库里不存第二份，避免漂移 |
| 审计 `audit.db`（10 §8.1） | `audit.jsonl` | 方案 §3.2 已收敛到 JSONL，本阶段只落路径占位 |
| `material` 迁入 `docs/research/` | 已迁入 16 份原始材料 | 方案 §3.1 要求；工作区根目录的 `V1.0-开发方案.md` 保留，便于对照 |
| S1 未要求 CI 文档比对 | 提前实现 `docs-schema-keys` | 成本一条门禁，收益是后续每加一个键都不用手工同步文档 |
| `scripts/smoke.sh` | 主体在 `scripts/smoke.mjs`，`smoke.sh` 只是 POSIX 包装 | 本机没有 bash；成功路径必须真的能跑（R4），不能因为缺 shell 就跳过 |

## 本阶段**没有**做的事

- 没有 `MemoryService`、没有存储、没有索引、没有注入、没有工具、没有 MCP server；
- 没有 `SOUL/USER/RULES/MEMORY.md` 的内容格式（各自阶段负责）；
- 没有 git 仓库初始化、没有提交（等指令）；
- 没有 `RULES.md` 的检查映射门禁（S5）。

## 后果

- S2 可以直接在 `writeFileAtomic` 上做原子写，在 `startup()` 之上做 `MemoryService`；
- S3 从 `Runtime` 里拿 `config.inject.*` 与 `paths`，不需要重新解析配置；
- 任何新增配置键必须同时改三处（schema、`docs/config.md` 键表、`CONFIG_TEMPLATE`），否则门禁或测试会红——这是刻意设置的摩擦。
