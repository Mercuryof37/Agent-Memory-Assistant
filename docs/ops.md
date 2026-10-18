# 运维（本机）

> 记录的是**这台机器**上的实测事实与操作步骤（2026-10-17）。换机器时先按第 1 节核对，别把这里的环境结论当通用承诺。

## 1. 本机环境事实

| 项 | 现状 | 影响 |
|---|---|---|
| Node / npm | Node `v25.2.1`、npm `11.6.2`（项目要求 ≥ 24） | 可直接跑 `node:test`、原生 TypeScript |
| PowerShell | **没有 PowerShell 7**：`pwsh` 不在 PATH，也没有 `C:\Program Files\PowerShell\7\pwsh.exe`；DSH 工具说的 `pwsh -Command` 实际由 **Windows PowerShell 5.1**（`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`）执行 | 文档里写 `pwsh -File ...` 的命令**在这台机器上会 `CommandNotFoundException`**，要换成 `powershell.exe -NoProfile -File ...` |
| 权限修复脚本 | 在 PowerShell 5.1 下实测可运行（修复与回滚都跑过） | 不需要为了它装 PS7 |
| 仓库脚本 | 全部是 Node（`scripts/*.mjs`），不经 PowerShell | 不受上面两条影响 |

## 2. 工作区权限异常与修复

**症状**：工具调用在最开始就失败，报 `SetNamedSecurityInfoW failed (Win32 5): grantWrite(<workspace>)`；或受限会话无法写入/列目录，但文件本身可读。

**本例原因**：工作区目录缺少有效的 `WRITE_OWNER`（更改所有者）。当时 `WRITE_DAC` 和内容权限都在（`Authenticated Users` 有 Modify），唯一缺的是所有权；DSH 预置沙箱授权要写安全信息，于是失败的正是"授权"这一步。

**修复**（必须**非受限**运行；沙箱令牌不能改 DACL——实测 `Set-Acl` 报 `UnauthorizedAccessException`）：

```powershell
& '<skill 脚本目录>\scripts\diagnose-windows-sandbox-acl.ps1' -Path 'D:\Ai Agent\Agent Memory' -AllowRoot 'D:\Ai Agent\Agent Memory' -Out 'D:\Ai Agent\dsh-acl-recovery'
```

> 上面那个路径是 DSH 技能包解压出的临时目录，可能被清理。备份目录里的 `acl-backup-<id>.json.ps1` 是**同一脚本的完整副本**（带 `-Restore` 参数），找不到原脚本时可以直接用它，不传 `-Restore` 就是诊断/修复模式。

脚本的行为（可从 `acl-report-*.jsonl` 复核）：

- 先备份 DACL，写 `acl-backup-<id>.json` 与一份可执行的 `.json.ps1`；
- 只给当前用户补一条显式 FullControl ACE，不动 deny、不改 owner、不改 SACL；
- 修复后自检 `writeDac`/`writeOwner` 都为 true；报告里看 `verification` 的 `after`。
- 本次实测：`granted=1`、`refused=0`，继承的 8 条 ACE 与备份快照逐条相等，owner 与文件内容未变。

### 2.1 回滚（真还原，不是清理）

```powershell
powershell.exe -NoProfile -File 'D:\Ai Agent\dsh-acl-recovery\acl-backup-ca570b9ff4b1440f9a1da72d22f53e97.json.ps1' -Path 'D:\Ai Agent\Agent Memory' -AllowRoot 'D:\Ai Agent\Agent Memory' -Restore 'D:\Ai Agent\dsh-acl-recovery\acl-backup-ca570b9ff4b1440f9a1da72d22f53e97.json'
```

- **这是精确还原**：记录里的自有 DACL 是 `"D:"`，执行后会把该目录当前**所有**自有 ACE 清掉——包括修复后 DSH 沙箱自己加的两条（`Everyone` 拒绝删子项、`S-1-4-*` 写入授予）。结果回到修复前状态，也就是**沙箱再次无法预置写入**。它只适合"我要撤销这次权限变更"，不是日常整理。
- 记录与 `-Path` 不匹配时拒绝（`RESTORE_REFUSED`）且不做任何改动。
- 2026-10-17 演练：正例 1 → 0 条自有 ACE、`verified`、退出码 0；负例（路径不匹配）退出码 2、目标 ACL 不变。
- 回滚记录在仓库之外（`D:\Ai Agent\dsh-acl-recovery`）。换机器或删掉了就重跑诊断脚本，别手改权限。

## 3. 安装与运行（沙箱内）

- `npm install` 的 lifecycle 脚本在受限会话会 `EPERM`（npm 用管道 spawn），用 `npm install --ignore-scripts`。esbuild 与 TypeScript 7 的二进制都在平台包里，不依赖 postinstall。
- `npx` 在受限会话同样 `EPERM`；直接用 `node scripts/...` 或 `npm run <script>`（后者实测可用）。
- npm 缓存固定在仓库内 `.npm-cache/`（`.npmrc`），避免写用户目录缓存。
- 完整校验：`node scripts/ci.mjs`（= gates + typecheck + test）；成功路径：`node scripts/smoke.mjs`。

## 4. 数据目录与策略

- 数据目录默认 `~/.dsh/memory`，可用 `AGENT_MEMORY_HOME` 或 `mem … --home` 指向别处；**不要**拿本仓库目录当数据目录。
- 改过 `policy.json` 后必须 `mem policy seal --accept` 才能启动；这是唯一的重新封存入口，agent 没有通道。
- 改了 `SOUL.md` / `RULES.md` 但忘记重新封存时，启动错误里会带一段 `REQUIRED ACTION`，直接给出可复制的修复命令（`mem policy seal --home "<数据目录>" --accept`，或在聊天框 `/mem seal --accept`）；桌面端启动失败时，这段文字也会出现在 probe 回退的注入段里，模型可以转告你。
- 启动失败一律非零退出并点名文件/键；先跑 `mem doctor` 看结构化原因。
- 想把记忆变成可选组合（不同 preset 不同权限）时，用 `npm run preset -- --id memory --mode readonly --out memory.patch.yml` 生成补丁，按 [docs/presets/README.md](presets/README.md) 追加到 profile；生成的补丁会同时停用根挂载，避免工具重复注册。
- Windows 编辑器可能给文件加 UTF-8 BOM：解析层会剥掉（不会报"未知键"），但**哈希按原始字节算**，加/去 BOM 会造成失配，需要重新封存。
- **沙箱只给"权限修复之后创建的文件"继承写权限**：修复前就存在的文件（例如 `V1.0-开发方案.md`）可能仍然不能被受限工具写入，报 `UnauthorizedAccessException`。实测该文件 DACL 对 `Authenticated Users` 是 Modify，但缺少沙箱自己的 `S-1-4-*` ACE；这不是文件坏了，是沙箱的写授权 ACE 没有回溯到旧文件。需要改它时：用非受限运行补 ACL，或先复制成新文件再改名。

## 5. 已知边界（别把它当安全承诺）

- 沙箱的写入边界是**工具层**的，不是 OS 级隔离：宿主进程与插件不受它约束。ADR-0003 已实测：**写被围栏、读不被围栏**。
- 权限修复记录只覆盖"目录 DACL"这一件事，不覆盖数据文件本身的 ACL。
- 本次修复后 DSH 自己加的那两条 ACE 是沙箱正常预置的产物；正常增删文件不受影响（已实测）。

## 6. 本地插件探针（S0 M1–M4）

S0 尾款需要真实会话，所以先交付了一个**最小可装载插件**（不是真实记忆服务）：

```
packages/dsh/
├── package.json          dsh.bundle.patch + main=dist/plugin.mjs（无依赖）
├── cordis.patch.yml      insert: id=agent-memory, name=@agent_memory/dsh
├── locale/{en,zh}.json   插件页显示用
├── src/plugin.ts         源（探针）
└── dist/plugin.mjs       node scripts/build.mjs 产物（2.7 KB，自包含、无 import）
```

探针注册了四样东西：

| 名称 | 类型 | 用途 |
|---|---|---|
| `am_echo` | 工具 | M1：证明工具注册生效 |
| `am_probe_tokens` | 工具 | M3：读 `ctx.tokenMeter.measure(agent.session)` |
| `agent-memory:probe` | system prompt section | M1/M2：模型看到固定一行探针说明 |
| `/am-closeout` | 命令 | M4：`agent.followup()` 起一轮 |

### 6.1 安装（二选一）

**A. 插件页（首选）**：Settings → Plugins → 安装本地包，路径填
`link:D:\Ai Agent\Agent Memory\packages\dsh`，启用后重启应用。
这是 `plugin_manager` 文档支持的开发期安装方式。

**B. 脚本（已在本机执行过，2026-10-17）**：用仓库里的脚本代替手工编辑，它会备份、写入、跑 pnpm、校验软链，失败自动回滚：

```powershell
node scripts/install-desktop-plugin.mjs            # 只看将改什么
node scripts/install-desktop-plugin.mjs --apply    # 写 profile + pnpm install
node scripts/install-desktop-plugin.mjs --revert   # 恢复备份并重装
```

本机执行结果：`~/.dsh/profiles/desktop/package.json` 已加
`"@agent_memory/dsh": "link:D:\\Ai Agent\\Agent Memory\\packages\\dsh"`，bundles 末尾已加
`@agent_memory/dsh`，`node_modules/@agent_memory/dsh` 是指向仓库的 junction；
`import('@agent_memory/dsh')` 从 profile 目录解析成功，导出 `apply, inject`。
备份在同目录的 `package.json.bak-agent-memory` 与 `cordis.patch.yml.bak-agent-memory`。

如果你想手工改，等价改动是（保留原有 bundles 顺序，只在末尾追加）：

```json
{
  "dependencies": { "@agent_memory/dsh": "link:D:\\Ai Agent\\Agent Memory\\packages\\dsh" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@agent_memory/dsh"] } }
}
```

然后在 profile 目录安装并重启：

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
node "D:\DeepSeekHarness\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs" install
```

### 6.2 验证（重启后在新会话里逐条做，把结果记进 ADR-0003）

| # | 操作 | 期望 |
|---|---|---|
| M1a | 让模型调用 `am_echo`，`text="hi"` | 返回 `echo: hi` |
| M1b | 直接发送 `am-probe` | 回复**恰好** `am-probe-ok`（section 生效） |
| M2 | 先 `/compact`（会话够长时），再发 `am-probe` | 仍回复 `am-probe-ok`（section 未被压缩 shadow） |
| M3 | 让模型调用 `am_probe_tokens` | 返回 `{"totalTokens":…,"surfaceTokens":…}` 且为正数 |
| M4 | 输入 `/am-closeout` | 起一轮新对话，模型回复**恰好** `am-closeout-ok`；**再重开会话（或重启应用），历史仍能载入**（§6.5、ADR-0003 §5.7） |

M2 只验证"压缩后 section 还在"；**逐字节稳定**要等 S3 的真实注入再测（S3.6）。

### 6.3 回滚

删掉 `package.json` 里的 `@agent_memory/dsh` 依赖与 bundles 末尾条目（或恢复 `.bak`），在 profile 目录重跑一次 `pnpm install`，重启应用。`cordis.patch.yml.bak` 只是备份用户层，探针不写它。

### 6.4 注意

- 探针没有数据目录、没有策略、不读写记忆；它的 section 文本是写死的探针，不是记忆注入。
- 插件未加载时先看应用日志/插件页的 `error`；`npm run compat` 只校验静态版本，不校验装载。
- **插件页显示"启动失败"时**：绝大多数是 `apply()` 抛错。Cordis 的硬规则是**不能裸读未写进 `inject` 的服务**（`ctx.systemPrompt` 等），错误形如 `cannot get property "systemPrompt" without inject`。用一次性 profile 跑 `dsh --profile <name> --json` 能把堆栈打到 stderr；只写 `link:` 的 bundle 改完代码后**必须重启应用**才会重新 import。
- **历史加载失败 `lacks an identified message`**：会话被一条没有 `id` 的 `user/message` 污染，不是磁盘损坏；按 §6.5 修复，不要删会话。

### 6.5 会话日志修复（消息缺 `id` / `role`）

**症状**：打开旧会话报历史加载失败（`gateway/internal`），错误里带

```text
stored session "session-…" is corrupt: stored session "session-…" failed validation:
Error: session event at seq N lacks an identified message
```

早期探针写出的形状还会报 `session event at seq N message must have role "user"`。

**原因**：`/am-closeout` 曾把手工拼的 followup 消息原样写成 `user/message`，没有 `id`（更早的版本连 `role` 都没有）。宿主写时只校验事件数据、不校验消息身份，读时才校验，于是当轮正常、事后打不开。根因与修复见 [ADR-0003 §5.7](adr/0003-dsh-compat.md)。

**修复**（`~/.dsh` 在沙箱外：用**非受限权限**、并先退出 DSH）：

```powershell
node scripts/repair-dsh-session.mjs "<会话目录>"            # dry-run：只列将改的 seq
node scripts/repair-dsh-session.mjs "<会话目录>" --apply    # 先备份再写入
```

会话目录形如 `%USERPROFILE%\.dsh\sessions\<workspace-key>\session-<uuid>\`；脚本读其中的 `session.v4.jsonl.zstd`，也可以直接给这个文件。它只补 `id`（必要时把 `role` 改成 `user`），其他字段、其他事件、首帧 header 行原样保留；遇到身份之外的损坏会点名拒绝，不猜。备份写在同目录的 `session.v4.jsonl.zstd.bak-<YYYYMMDD-HHmmss>`。

**验证**：重启 DSH 后重开会话应能加载。需要机器校验时，用宿主 `dsh-session-persistence-jsonl` 的 `validateStoredEvents` 跑一遍（本机三份修复后日志均为 `VALIDATION: OK`，见 ADR-0003 §5.7）。

## 7. 全量历史审计（v4 + v3）

```powershell
node scripts/audit-sessions.mjs              # 默认扫 ~/.dsh/sessions
node scripts/audit-sessions.mjs <根目录>
```

只读：逐个 `session.v*.jsonl.zstd` 检查 `user/message` 是否有 `id` 与 `role:user`。v4 缺陷会让命令退出 1；v3 旧格式只计数、不判定（当前 DSH 在加载时迁移）。本机 2026-10-17 的结果是 **106 个日志 / 54 v4 + 52 v3 / 0 缺陷**。

## 8. journal 断链/截断后的恢复步骤

`mem doctor` 返回 2 且点名 `journal is inconsistent` 时，说明 journal 链断、seq 不连续，或比 manifest 记录的 `journal_head` 短：

1. **停写**：不要继续 `mem add/delete/decide`，也不要运行 `mem rebuild`（它会拒绝，这是刻意的）；
2. **先备份**：`mem export <dir>` 会把 `memories/`、`proposals/`、`.state/journal/`、`.state/policy.seal.json`、三份人工文件、配置与策略复制出来并生成 `SHA256SUMS`；
3. **判断**：若只是 manifest 过期（journal 更长），可删 `.index/` 让下次重建；若是 journal 被截断/改行，**以备份或上一版本为准**，不要手工补行；
4. **恢复**：把备份目录当数据目录用（`--home <dir>`），先 `mem doctor` 再 `mem rebuild`；确认 `records` 与 `journal_head` 后再替换原目录；
5. **记录**：在 journal 里留一次 `audit`（恢复动作由人执行，`mem` 不自动改写历史）。

V1 不承诺断电零丢失；目录项不 fsync 的边界见 README。

