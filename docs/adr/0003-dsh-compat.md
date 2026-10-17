# ADR-0003 · S0 DSH 兼容性实测（真实环境）

- 状态：已采纳（结论基于本机已安装的 DSH，静态代码 + 实机运行）
- 日期：2026-10-17
- 环境：`D:\DeepSeekHarness`（桌面端）+ 全局 `dsh` CLI + 本机 `%USERPROFILE%\.dsh`
- 依据：`app.asar` 内 304 个 `@deepseek-ai/dsh-*` 包的 README/代码、`~/.dsh` 实际配置与数据、在本机捆绑 Node 上跑通的 S1 测试
- 结论对 [v1.2 方案](../research/V1.0-开发方案-v1.2.md) 有约束力；后续如 DSH 升级，重跑 `npm run compat`

## 0. 一句话结论

官方接口足够支撑 V1：**工具注册、系统提示段、会话事件读取、token 计量、子 agent 识别、宿主命令、插件打包**都有可用的正式入口；唯一必须放弃的是原方案的 `appendPluginRecord`（官方明确禁止外部插件调用）。另外有两个环境事实会直接改方案：**桌面端是 0.2.1-rc.1（不是 0.2.0-rc.2；当晚升级到 0.2.1-rc.2，复测见 §5.5）**，且**桌面 profile 由 Electron 独占管理**，CLI 不能 boot 它。

## 1. 版本与运行时（实测）

| 项 | 实测值 | 证据 |
|---|---|---|
| 桌面端 DSH | **0.2.1-rc.1**（2026-10-17 晚升级到 **0.2.1-rc.2**，复测见 §5.5） | `D:\DeepSeekHarness\resources\app.asar` → `dsh/package.json`（`@deepseek-ai/dsh-desktop-runtime`）；`npm run compat` 报 rc.2 |
| 桌面运行时 | `runtime.json`：desktopVersion `0.2.1-rc.1`、node `24.21.0`、python `3.12.14` | `resources\runtime\primary-runtime\runtime.json` |
| 捆绑 Node | `v24.21.0`（`runtime\primary-runtime\dependencies\node\bin\node.exe`） | 实跑 `--version` |
| 全局 CLI | `dsh` **0.2.0-rc.2**（`%APPDATA%\npm\node_modules\@deepseek-ai\dsh`） | 实跑 `dsh --version` |
| 本机 PATH Node | v25.2.1 | `node -v` |
| 桌面 profile | `~/.dsh/profiles/desktop`（`package.json` 的 `dsh.profile.bundles = [dsh-base, dsh-web-app]`，`cordis.yml` 为 `[]`，`cordis.patch.yml` 是用户层） | 直接读文件 |

**结论**：

- **目标宿主是桌面端 0.2.1-rc.1**，不是 CLI 的 0.2.0-rc.2；两者不能混为一谈。
- `.node-version` 锁定 **24.21.0**（DSH 实际运行时）。S1 已在该版本上跑通全部测试（见 §2）。
- 本机开发用的 PATH Node 25.2.1 只用于日常开发；兼容性验收以 24.21.0 为准。

## 2. 真实运行时验证（已做）

```
D:\DeepSeekHarness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe scripts/test.mjs
→ tests 57 / pass 57 / fail 0
```

S1 全部用例在 DSH 自带 Node 24.21.0 上通过，包含 `node:test`、`node:crypto`、`node:fs`、原生 TS 剥离与 `--test-isolation=none`。

## 3. 九个问题逐条结论

| # | 问题 | 结论 | 证据 / 约束 |
|---|---|---|---|
| 1 | 外部插件能否经官方接口注册工具 | **能**。`ctx.tools.register(defineTool({...}))`；工具 schema 自动进入系统提示装配 | `dsh-tools/README.md`「Registering a tool」；`dsh-tool-*` 全部这样注册 |
| 2 | prompt assembly 能否挂注入段、有无官方持久化 | **能挂**：`ctx.systemPrompt.section({ name, order, text, interpolate:false })`；`system-prompt/assemble` 是 waterfall；tool schema 与 section 一起装配。**持久化不能用 `appendPluginRecord`**：官方写明只给 `packages/experimental/` 的包用，仓库外插件也不得调用 | `dsh-system-prompt/README.md`；`dsh-session/README.md`「Write experimental plugin records」 |
| 3 | 压缩是否保护 system 节点 | **保护 node 0**：压缩范围从"第一个不是 `system/message` 的节点"开始，system prompt 不会被 shadow。但**提示词本身每轮重渲染**，文本变了 node 0 会被替换 → 冻结要我们自己做 | `dsh-compaction-basic/README.md`（range 起点规则）、`dsh-session/README.md`（surface fold 保护 node 0） |
| 4 | 会话事件能否按 (session, seq) 取回 | **能，但不要用已弃用的同步读**：`session.eventAt/snapshotEvents` 标记 deprecated、禁止新生产调用。改用 **`ctx.sessionPersistence.open(id,'read')` + `handle.read(offset,len)`**（官方 seam），或 live session 的 `ctx.sessions.get(id)` | `dsh-session/README.md`（deprecated 段）、`dsh-session-persistence/README.md`（open/read） |
| 5 | shell / 文件工具 / 子 agent 能否访问 `<home>` | **写被围栏、读不被围栏**：sandbox 只 fence writes（`workspace-write` 以 session cwd 为边界）；读路径不 fence。实测 CLI 写 `~/.dsh/profiles/web/cordis.yml` 被沙箱拒绝（EPERM）；插件代码在宿主进程内运行、不受沙箱约束 | `dsh-api-workspace-files/README.md`；`dsh-sandbox-policy/README.md`；本次 `dsh --dump-config` 实测 EPERM |
| 6 | 能否识别子 agent | **能**：`parentAgent` 选项建立 runtime 父子关系；`isOwnedBy(id, parent)`；子会话有 `parentSession` 血缘；`dsh-subagent` 暴露 `delegationDepthOf`，`dsh-tool-schedule` 已用它在工具层拒绝子 agent | `dsh-agent/README.md`、`dsh-subagent/README.md`、`dsh-tool-schedule/README.md` |
| 7 | 审批 UI 是否由宿主渲染、答案不经模型 | **有审批面**（`tools/pre-execute` 的 allow/deny/ask + `dsh-client-ui-approval`），但**我们不需要它**：`decide` 走 CLI，不注册为工具；`ask_user_question` 子 agent 不可用（`DELEGATED_CALLER`） | `dsh-tools/README.md`（pre-execute）、`dsh-tool-ask-user/README.md` |
| 8 | 有无 token 计数 | **有**：`ctx.tokenMeter.measure(session, header?)` 返回 `totalTokens/surfaceTokens/nodes[].tokens`；`estimateMessage(message)` 给单条估价；确定性、无模型调用 | `dsh-token-meter/README.md` |
| 9 | 能否由宿主命令触发一轮模型调用 | **能**：`ctx.commands.register({name, handler})`，handler 拿到 `agent`；`agent.followup({ content, source })` 排一轮普通对话并唤醒 driver（命令本身不产生模型消息）。`/closeout` 可这样做 | `dsh-commands/README.md`、`dsh-agent/README.md`「Drive an agent's conversation」 |
| 10 | 插件怎么打包/安装/升级 | **bundle 形态**：包内 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，加入 profile 的 `dsh.profile.bundles` 或走 app 插件页；开发期用 `link:<绝对路径>`；**桌面 profile 由 Electron 独占管理**，CLI 拒绝 boot（实测 `profile "desktop" is managed exclusively by the Electron application`），安装后需重启应用 | `dsh-base/package.json`（bundle 字段）、`dsh-plugin-manager/README.md`；本次实测 |

## 4. 对方案的直接影响

1. **目标版本改为桌面 0.2.1-rc.1**；`compat` 同时报告 CLI 0.2.0-rc.2，避免误锁。
2. **`appendPluginRecord` 从方案里删除**（原计划是"除非 S0 证明支持"——现在证明不支持），快照落 `<home>/.state/snapshots/`。
3. **注入用 section，不用追加 system message**：section 进入 node 0，压缩不会 shadow；同时**必须自己冻结文本**，因为 DSH 每轮按当前 section 重渲染。
4. **溯源读取走 `ctx.sessionPersistence`**，不用已弃用的 `session.eventAt`。
5. **`decide` 只做 CLI**，不依赖宿主审批 UI，也就没有"无应答者"分支。
6. **`/closeout` 用 command + `agent.followup`**；命令由人输入，模型不能触发。
7. **边界表述**：工具层不能写 `<home>`（要测），但**能读**；插件进程能写。文档只能说"模型工具没有写入口 + 篡改可检测"，不能说"agent 读不到"。
8. **子 agent 写入**：用 `delegationDepthOf` 在工具层拒绝（与 `dsh-tool-schedule` 同款），不依赖提示词。

## 5. S0 尾款（探针已交付；桌面端已复测 M1/M3）

探针包已就位并**已装进桌面 profile**（2026-10-17）：`packages/dsh`（bundle 形态，`dist/plugin.mjs` 自包含）。注册 `am_echo`、`am_probe_tokens`、`agent-memory:probe` section、`/am-closeout` 命令。安装由 `scripts/install-desktop-plugin.mjs --apply` 完成，改动与备份见 [docs/ops.md §6](../ops.md)。

### 5.1 首次装载失败：根因与修复

桌面插件页显示 `agent-memory` / `@agent-memory/dsh` 状态 **启动失败**。用一次性 profile 跑 `dsh --profile amprobe --json` 抓到真实堆栈：

```text
agent-memory (@agent-memory/dsh): Error: cannot get property "systemPrompt" without inject
```

**根因**：Cordis 禁止在 `apply` 里直接读未写进 `inject` 的服务属性（`ctx.systemPrompt` / `ctx.commands` / `ctx.tokenMeter`）。探针为了"可选服务缺失也能加载"，做了裸属性访问，于是 `apply` 抛错，整插件启动失败。

**修复**：`service()` 改为先 `ctx.get(name)`（与 YAML `!!js` 同一种查询），失败再走带 try/catch 的属性回退；`inject` 仍只声明必需的 `tools`。

**证据（真实宿主 0.2.0-rc.2，headless 一次性 profile）**：

```text
{"type":"tool_call","tool":"am_echo","input":{"text":"hi"}}
{"type":"tool_result","status":"completed","result":"echo: hi"}
{"type":"final","text":"echo: hi"}
```

同时加了回归用例：一个"未声明服务就抛错"的 Cordis 风格 context 下，`apply` 仍能注册两个工具（`packages/dsh/test/plugin.test.ts`）。

桌面端 0.2.1-rc.1 已于 2026-10-17 重启完成，重建后的 `dist/plugin.mjs` 已生效（bundle 是 `link:`，重启即生效），复测见 §5.2。

| # | 事项 | 现状 | 怎么做 |
|---|---|---|---|
| M1 | 最小插件在桌面端装载（工具 + section） | **桌面端通过（2026-10-17）**：`am_echo` → `echo: hi`；`am-probe` → 恰好 `am-probe-ok` | 已按 [docs/ops.md §6.2](../ops.md) 复测 |
| M2 | 压缩后 section 仍在（字节稳定） | **桌面端通过（2026-10-17，rc.2）**：宿主压缩会话后发 `am-probe`，仍回复恰好 `am-probe-ok`，section 原文与源码一致 | 见 §5.5；逐字节稳定留到 S3.6 |
| M3 | `ctx.tokenMeter` 数值 | **桌面端通过（2026-10-17）**：`totalTokens=30809`、`surfaceTokens=14799` | 已复测 |
| M4 | command handler 经 `agent.followup` 起一轮 | **桌面端通过（2026-10-17，rc.1）**：输入 `/am-closeout` 后模型回复恰好 `am-closeout-ok` | 已复测（§5.4）；rc.2 复测见 §5.5 |

### 5.2 桌面复测记录（2026-10-17，DSH 0.2.1-rc.1）

按 [docs/ops.md §6.2](../ops.md) 在新会话里逐条执行，结果：

| # | 操作 | 结果 |
|---|---|---|
| M1a | 模型调用 `am_echo(text="hi")` | 返回 `echo: hi` |
| M1b | 发送 `am-probe` | 回复恰好 `am-probe-ok`；同轮 system prompt 中可见 `agent-memory:probe` 的 section 原文（与 `packages/dsh/src/plugin.ts` 的 `PROBE_LINE` 一致） |
| M3 | 模型调用 `am_probe_tokens` | 返回 `{"totalTokens":30809,"surfaceTokens":14799}`，两值均为正 |

M2（压缩后 section 仍在）尚未执行：需会话长到可 `/compact`。M4 的复测结果见 §5.4。

### 5.3 M4 失败：`agent.followup` 少 `role`

复测 `/am-closeout` 时供应商返回：

```text
Failed to deserialize the JSON body into the target type: messages[30]: missing field `role`
INVALID_REQUEST
```

**根因**：`agent.followup(input)` 只是把 `input` 原样塞进 inbox，循环随后 `session.append('user/message', input)`；而 session 校验要求消息的 `role` 与事件类型匹配（`user/message` ⇒ `role: 'user'`）。探针只传了 `{ content, source }`，于是模型请求里出现一条没有 `role` 的消息。

**修复**：`followup` 输入补 `role: 'user'`，`source.kind` 用文档示例里的 `'user'`（自定义 kind 留给真正的 closeout 再评估）：

```ts
agent.followup({
  role: 'user',
  content: [{ type: 'text', text: 'Reply with exactly: am-closeout-ok' }],
  source: { kind: 'user' },
});
```

单测同时断言 `role` 与 `source.kind`，防止回归。`dist` 已重建；桌面端需再重启一次加载新 bundle。

### 5.4 M4 复测通过（2026-10-17）

桌面端重启后输入 `/am-closeout`，模型收到 `agent.followup` 排入的那一轮，回复**恰好** `am-closeout-ok`（与探针里要求的内容一字不差）。由此确认：

- `ctx.commands.register` 的 handler 能用 `agent.followup` 唤醒 driver，起一轮普通对话；
- 补 `role: 'user'` 后供应商请求不再报 `missing field role`；
- 命令本身不产生模型消息，被观察到的只有 followup 排入的那一轮。

结论：**M4 关闭**。尾款只剩 M2（压缩后 section 字节稳定），需会话长到可 `/compact` 时验证；它的结论只影响 S3.6 的验收写法，不影响 S2a。

### 5.5 rc.2 复测（2026-10-17）

桌面端当晚从 0.2.1-rc.1 升到 **0.2.1-rc.2**。`npm run compat` 报告：desktop `0.2.1-rc.2`、runtime node `24.21.0`、306 个捆绑包、全局 CLI `0.2.0-rc.2`（另一套，不混用）；`compat ok`。插件仍以 `link:` 装载，重启即生效。在 rc.2 的新会话里复测：

| # | 操作 | 结果 |
|---|---|---|
| M1a | `am_echo(text="hi")` | `echo: hi` |
| M1b | 发 `am-probe` | 回复恰好 `am-probe-ok`；section 原文与 `packages/dsh/src/plugin.ts` 的 `PROBE_LINE` 逐字一致 |
| M2 | 宿主压缩会话（checkpoint）后发 `am-probe` | 仍回复恰好 `am-probe-ok`；section 未被压缩 shadow，文本未变（逐字节稳定实测留 S3.6） |
| M3 | `am_probe_tokens` | `{"totalTokens":24914,"surfaceTokens":11991}`，两值均为正 |
| M4 | 输入 `/am-closeout` | 起一轮，回复恰好 `am-closeout-ok`（用户 2026-10-17 确认；rc.1 记录见 §5.4） |

结论：**M1–M4 在 rc.2 上全部通过，S0 尾款关闭**。仓库侧 `node scripts/ci.mjs` 同时为绿（114 个测试），其中 `packages/dsh/test/plugin.test.ts` 覆盖了 `agent.followup` 的 `role: 'user'` 与 `source.kind: 'user'`，防止探针代码回归。

### 5.6 版本记录与目标（2026-10-17 晚）

- `runtime.json`：desktopVersion `0.2.1-rc.2`、node `24.21.0`、`payloadDigest e2cef445…`；`.node-version` 与 runtime node 一致，`npm run compat` 通过。
- 全局 CLI 仍是 `0.2.0-rc.2`（另一套），`compat` 会持续提示"桌面端与 CLI 不一致"；诊断用 CLI 的结论不能代表桌面宿主。
- 沙箱/写 fence/读权限这类**行为**事实随 Electron 升级可能变化；`compat` 只查版本与包，查不了行为，仍以真实会话的 M1–M4 为准。

### 5.7 复盘：消息缺 `id`，「写时能存、读时打不开」（2026-10-17）

**现象**：打开旧会话报历史加载失败（`gateway/internal`）：

```text
stored session "session-ff45a937-…" is corrupt: stored session "session-ff45a937-…"
failed validation: Error: session event at seq 10 lacks an identified message
```

**物理层没坏**。文件 `~/.dsh/sessions/--D-Ai~0020Agent-Agent~0020Memory--/session-ff45a937-…/session.v4.jsonl.zstd` 的 450 个 zstd 帧全部可解，753 行，`seq` 0–751 连续，末事件是正常的 `turn/end`；坏在语义校验。

**根因**：`/am-closeout` 的 handler 手工构造 followup 消息，没有 `id`：

```ts
agent.followup({ role: 'user', content: [...], source: { kind: 'user' } });
```

`agent.followup` 把对象原样排进 inbox，循环再 `session.append('user/message', message)`（`dsh-agent-loop`）。写成败在两边校验不对称：

- **写**：`Session#append` 只跑 `validateSessionEventData`，不检查消息身份 → 静默落盘，当轮照常回复；
- **读/快照**：`adoptSessionEvent → assertMessageEventShape` 要求 `data.id` 是非空字符串、角色与事件类型一致 → `lacks an identified message`，持久层包成 `SessionPersistenceCorruptionError`，history RPC 再包成 `gateway/internal`。

宿主的正规入口 `createUserMessage()` 会盖 `id: randomUUID()`（`dsh-llm` 的 message 工厂）；探针绕开它自己拼对象，于是写进了一条「匿名消息」。

**影响面**（扫描本机全部 43 个会话）：只有跑过 `/am-closeout` 的 3 个会话中招，且命令次数与坏事件一一对应——`session-ff45a937…`（seq 10、747）、`session-d33a64bc…`（seq 2809）、`session-64a8cf57…`（seq 133）。最后一个是探针早期形状：`data` 里连 `role` 都没有，当时供应商直接 422 `missing field role`（见 §5.3）。没跑过该命令的会话全部通过。

**修复**：

1. `packages/dsh/src/plugin.ts`：followup 消息补 `id: globalThis.crypto.randomUUID()`。bundle 不得 import node 内置（S3.6 契约），所以用 `globalThis.crypto` 而不是 `node:crypto`。
2. `packages/dsh/test/plugin.test.ts`：断言 id 是 UUID、每次调用各不相同；`tests/session-repair.test.ts` 覆盖修复工具的写入、备份与拒绝猜测。
3. 数据修复：新增 `scripts/repair-dsh-session.mjs` + `scripts/lib/session-repair.mjs`——给坏事件补 id（必要时补 `role: 'user'`），首帧（header 行）字节原样保留，其余按 16 行一帧重编码；默认 dry-run，`--apply` 才写，并在同目录留 `.bak-<YYYYMMDD-HHmmss>`。三份日志已用宿主自带校验器（`dsh-session-persistence-jsonl` 的 `validateStoredEvents`）验证为 `VALIDATION: OK`，备份后缀 `20261017-1926`。
4. **验收口径变更**：M4 不再只看「回复恰好 `am-closeout-ok`」，还必须**重开会话/重启应用后历史能载入**（见 [docs/ops.md §6.2](../ops.md)）。§5.4/§5.5 的"通过"只覆盖了即时回复，漏了重放。

**闭环**：`todo.md` 增补 T14（本轮修复，状态完成）；上游侧建议 `Session#append` 对 message 事件复用 `assertMessageEventShape`，让坏事件在写入点就失败——`append()` 的注释本来就承诺 "a bad event fails at the append site rather than later during a backend flush"。缺陷报告见 [docs/reports/2026-10-17-dsh-append-message-identity.md](../reports/2026-10-17-dsh-append-message-identity.md)。

## 6. 兼容性回归方式

- `npm run compat`（`scripts/compat.mjs`）：读安装目录与 profile，校验版本、关键包存在性、`.node-version`、以及"桌面端与 CLI 版本不一致"这一已知事实；不通过即失败。
- 需要真实宿主的用例（M1–M4）手工执行，结果写进本 ADR 的修订记录；不塞进 CI。
- M4 的"通过"必须包含**重放**：跑完 `/am-closeout` 后重开会话（或重启应用）仍能载入；只看回复文字不算通过（§5.7）。
- 探针的单元测试在 `packages/dsh/test/plugin.test.ts`、`packages/dsh/test/session-repair.test.ts`（假 context / 临时目录，不进真实宿主）。
- 会话日志修复工具：`scripts/repair-dsh-session.mjs`（默认 dry-run；`--apply` 前先退出 DSH，见 [docs/ops.md §6.5](../ops.md)）。
