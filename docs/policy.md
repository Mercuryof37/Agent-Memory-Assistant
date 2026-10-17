# 策略（policy.json）

`policy.json` 是**不能用提示词改**的那部分系统设置：扫描命中怎么处理、容量硬上限、agent 能否改 RULES。它放在数据目录根部，和记忆文件一起位于 agent 沙箱之外（`06` §L0）。

依据：`06-约束硬化设计.md` §L3「策略不可变：启动时校验，改了就拒绝启动」。

## 封存机制

`mem init` 生成 `policy.json` 后，立刻把它的 SHA-256 写进 `.state/policy.seal.json`：

```
<home>/policy.json               策略正文
<home>/.state/policy.seal.json   { policy, sha256, sealed_at }
```

每次启动：

1. 读 `policy.json`，算 SHA-256；
2. 读封存记录，比对哈希；
3. 不一致 → **硬失败**，不挂载记忆服务，报错里给出两个哈希；
4. 一致 → 加载，且**不把 policy 内容注入模型上下文**（策略是给代码看的，不是给模型看的）。

哈希覆盖整份文件的字节：改一个空格也会失配。想放宽容量、改扫描动作、允许 agent 改 RULES，都必须走重新封存。

## 重新封存（T2，人专属）

```bash
# 1. 人工审阅改动
# 2. 显式确认后重新封存
mem policy seal --accept
```

- 没有 `--accept` → 拒绝，退出码 3；
- agent 的工具面里**没有任何入口**能调用这个函数（S4 起由工具清单固化为测试）；
- `mem init` 不会覆盖已存在的 policy.json，也不会悄悄重新封存被改过的策略——它会在哈希不符时报错并让你走上面的流程。

## 字段表

以下键与 `packages/core/src/policy/policy.ts` 的 schema 一一对应，CI 会比对文档与 schema 的键名。

| 键 | 类型 | 默认 | 允许值 | 含义 |
|---|---|---|---|---|
| `version` | int | 2 | 1–2 | 策略格式版本 |
| `capacity.max_records` | int | 1000 | 1–100000 | 容量硬上限；config.toml 只能收紧 |
| `capacity.max_record_chars` | int | 10000 | 100–200000 | 单条字数硬上限；config.toml 只能收紧 |
| `scan.invisible_unicode` | enum | "reject" | reject | 零宽、双向控制等不可见字符：硬拒绝 |
| `scan.credentials` | enum | "reject" | reject | `sk-`、`AKIA`、私钥头、连接串：硬拒绝 |
| `scan.injection` | enum | "reject" | reject / flag | 提示词注入模式：拒绝（reject）或降为待审提案（flag） |
| `scan.private_tag` | enum | "confirm" | reject / confirm | `<private>…</private>`：整段拒绝（reject），或经确认后写脱敏文本（confirm）；**不静默剥离** |
| `rules.agent_writable` | bool | false | false | agent 对 RULES.md 的写权限；V1.0 恒 false，改 true 会被策略校验拒绝 |
| `sealed_files.soul` | string | "" | "" 或 64 位小写 hex | `SOUL.md` 的规范化哈希（去 BOM、LF、单个结尾换行）；空串表示跳过校验 |
| `sealed_files.user` | string | "" | "" 或 64 位小写 hex | `USER.md` 的规范化哈希；空串表示跳过 |
| `sealed_files.rules` | string | "" | "" 或 64 位小写 hex | `RULES.md` 的规范化哈希；空串表示跳过 |

> `sealed_files` 由 `mem policy seal --accept` 按当时文件内容自动写入；三个文件任一被改动（哪怕只是行尾）都会让启动失败并点名文件。旧版（v1）的 `targets` 与 `approval` 已删除：模型工具没有"目标"参数，T1 恒为人工决定，两者都由接口而不是配置保证。

## 从 v1 迁移到 v2

1. 编辑 `policy.json`：`version` 改 `2`，删除 `targets` 与 `approval` 两段，`scan.private_tag` 由 `"strip"` 改为 `"confirm"`（或 `"reject"`）；
2. `mem policy seal --accept` 重新封存；
3. `mem doctor` 确认通过。旧字段还在时，封存会以 `unknown key "targets"` / `"approval"` 失败并点名——不会带着旧语义启动。

## 为什么不用 config.toml 管这些

因为 config.toml 是"用户想调的东西"，policy.json 是"系统允许的地板"。把两者放一个文件，等于让一次无心（或被诱导）的配置修改关掉门禁。`06` §L3 的原话是：策略本身就是攻击面。

哈希校验不是万能的：agent 若拿到数据目录的写权限，可以连封存记录一起改。所以它还叠了 L0——把数据目录放在 agent 的工具沙箱之外。**但要说清楚这是什么级别的边界**：路径本身不产生权限隔离；在当前 DSH 的 `workspace-write` 策略下，工作区之外的 `write`/`edit`/`bash` 会被拒绝，而插件跑在宿主进程里、不受这个沙箱约束。所以"够不到"成立的前提是 DSH 的工具沙箱确实拦住了这些路径——这一点必须由 S0 兼容性验证实测（见优化版方案 §6.3），不能靠目录命名冒充 OS 级隔离。哈希校验防的是"改文件的人忘了自己在改安全设置"，以及在边界被绕过时留下可检测的痕迹。
