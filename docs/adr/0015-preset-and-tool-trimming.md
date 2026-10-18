# ADR-0015 · preset 接入与只读工具裁剪（A+C）

- 状态：已实现（preset 模板 + 工具裁剪；预设未在本机激活）
- 日期：2026-10-18
- 阶段：post-V1.0（V2.0 前置）
- 依据：[记忆架构 v2](../plan/memory-architecture-v2.md)、[ADR-0014](0014-memory-v2-p3-p4.md)、[preset 使用说明](../presets/README.md)

## 问题

V1.0 的记忆插件挂在 profile 根，所有会话共享一套工具与提示段；`personalization.mode` 只能全局配置。用户希望按 preset 切换（例如「日常 confirm」「研究 readonly」），且只读时模型不应看到写工具。

## 选择

1. **preset 模板（A）**：新增 `scripts/preset.mjs`。它读取本机安装的 `dsh-web-app/presets/standard.patch.yml`，复制成新 preset 的完整插件列表，并在末尾追加 `@agent_memory/dsh`（带 `mode`）。生成结果同时包含「停用根挂载」的一行，避免重复注册工具。用法与注意事项见 [docs/presets/README.md](../presets/README.md)。
2. **只读工具裁剪（C）**：`registerTools` 在 `personalization.mode === 'readonly'` 时**不注册** `memory_record` / `memory_propose`；`memory_review`（人工决定）与只读工具保留。运行时拒绝逻辑仍作为第二道防线。
3. **不做预设自激活**：生成补丁与 profile 修改是用户动作，仓库只提供模板与命令，不擅自改用户的 profile；升级 DSH 后重新运行脚本即可刷新快照。

## 被否方案

- **在插件代码里自建「预设」概念**：工具集与提示段组合属于宿主 preset 的职责，重复实现会与宿主设置界面对不上。
- **同时保留根挂载与 preset 挂载**：同一插件注册两次工具，宿主直接报重复名。
- **只读时保留写工具、调用再拒绝**：模型仍会尝试调用，浪费一轮且提示词里出现不可用工具。

## 证据

- `ci` 全绿：**228 个测试**；新增 `S12.1 readonly hides write tools from the model`。
- `node scripts/preset.mjs --id memory-ro --mode readonly` 生成的补丁用 YAML 解析验证：2 个顶层补丁项、preset `memory-ro`、20 个插件、末项为 `agent-memory` 且 `mode: readonly`。
- 修正一个日期滚动导致的脆弱用例（`valid_from and as-of recall` 改用固定日期），避免跨天后 CI 变红。

## 偏差与回滚

- 生成的 preset 是 standard 的**快照**；DSH 升级后插件列表可能变化，需要重新生成（脚本每次读当前安装版本）。
- 本机当前仍是根挂载 + `mode: confirm`；preset 未激活，等用户决定何时切换。
- 回滚：删除 profile 补丁中新增的两段（disabled 根挂载 + preset insert），重启恢复根挂载；代码侧回滚 `registerTools` 的条件即可。
