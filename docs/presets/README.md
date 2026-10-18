# 把 Agent Memory 做成 DSH preset（A+C 的 A 部分）

DSH 的 preset 是一份 **Cordis YAML 子插件列表**，决定一个会话用哪些工具、提示段与技能。默认 preset 是 `standard`，另有 `minimal`、`ptc`。把记忆插件放进 preset，就能做到「不同 preset 用不同的记忆策略」，例如：

- `memory-confirm`：全量工具 + `mode: confirm`（默认）
- `memory-readonly`：只读工具 + `mode: readonly`（不给模型写工具）

## 一条命令生成补丁

```powershell
node scripts/preset.mjs --id memory --mode confirm --out memory.patch.yml
node scripts/preset.mjs --id memory-ro --mode readonly --out memory-ro.patch.yml
```

生成的文件包含两段：

1. `- id: agent-memory` + `disabled: true`：**停用根挂载**，避免和 preset 里的同一插件重复注册工具；
2. 一个 `- insert:` 块：把随 DSH 安装的 `standard` preset 复制一份（保留全部原有插件），并在末尾追加：

```yaml
          - id: agent-memory
            name: '@agent_memory/dsh'
            config:
              mode: confirm
```

## 应用方式

1. 备份 profile 补丁：`%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`；
2. 把生成文件的内容**追加**到该补丁末尾；
3. 重启 DSH；
4. 设置 → 通用 → Agent preset 里选择新 preset（`memory` / `memory-ro`），新建会话生效。

## 注意

- 生成的 preset 是 `standard` 的**快照**：DSH 升级后 `standard` 可能变化，重新运行脚本即可（脚本每次读当前安装的 `standard.patch.yml`）。
- 同一份 profile 里不要同时保留根挂载和 preset 挂载，否则工具名重复、插件加载报错；生成的补丁已经帮你停用根挂载。
- `mode: readonly` 时插件**不注册** `memory_record` / `memory_propose`（不是调用时拒绝），模型看不到写工具；`memory_recall`/`memory_read`/会话检索仍然可用。
- 回滚：删掉追加的两段，重启即可恢复根挂载。
- 这是「preset 级组合」；如果只想临时改权限，改 `config.toml` 的 `[personalization] mode` 更快。
