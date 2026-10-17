# ADR-0006 · S2b 完整性

- 状态：已完成
- 日期：2026-10-17
- 阶段：S2b（计划 3–4 人日；实际 1 个工作日，AI 辅助，含测试）
- 依据：[V1.0-开发方案-v1.3.md](../research/V1.0-开发方案-v1.3.md) §4.6–§6.6、§8；[ADR-0005](0005-s2a-store.md)

## 问题

S2a 已经能写、读、重建，但"坏文件、手放文件、被截断的 journal、被人改过的人工文件"还只是零散判定：隔离只做到计数，删除只有 journal 语义没有入口，`SOUL/USER/RULES` 没有哈希约束。S2b 把这些补成可操作、可恢复、可红队验证的完整性层。

## 选择

1. **`adopt` 是人审后的入账动作**：`mem adopt <id>` 读取磁盘上的文件、按 frontmatter 重新校验、把当前规范化哈希写进 journal `adopt` 行；**不重写文件**。解析失败就拒绝 adopt，文件继续隔离。
2. **删除只写 journal**：`mem delete <id> --reason <text>` 追加 `delete` 行（含文件哈希与理由），文件保留；`read` 仍可追溯，`recall`/目录/注入不再出现。重复删除返回 2，不静默成功。
3. **`sealed_files`**：policy v2 **加字段不升版**，`soul/user/rules` 默认空串（跳过）。`mem policy seal --accept` 按当时内容写入规范化哈希；启动时任一不符就 `SEALED_FILE_MISMATCH` 并点名文件。
4. **路径拒绝在写入之前**：`assertSafeHome` 拒绝非绝对路径、Windows 保留名（CON/NUL/COM1…）与带冒号的段；记忆 id 永远是 `mem-YYYYMMDD-8hex`，`read ../..` 只会得到"不存在"，不会碰文件。
5. **`doctor` 完整版**：列出隔离 id + 原因、journal 链状态；有隔离返回 4，链不一致返回 2。
6. **备份演练**：整目录复制后用 `loadConfig` + `MemoryStore` 重新开、`rebuild`，活动集合与源一致。

## 被否方案

- **adopt 时规范化重写文件**：会让"人审后入账"变成隐式改写，破坏"文件即真相"。
- **删除时删文件**：`read` 无法追溯；物理删除留给 S7 的 `mem purge --accept`。
- **对人工文件做宽松比较**（忽略行尾）**或按 mtime 判断**：行尾与 BOM 已由规范化哈希覆盖；mtime 可被回拨，不能当完整性判据。
- **在 `resolveHome` 里做保留名检查**：会误伤"路径是合法相对名"的调用；检查放在启动/init 的绝对路径上。

## 证据

- **114 个测试**通过；在开发机 Node 25.2.1 与目标运行时 **Node 24.21.0** 上各跑一遍，均全绿。
- 新增 S2b.1–S2b.5 用例覆盖 adopt、删除、隔离告警、路径红队、备份复制。
- `npm run smoke` 新增 S2b 段：add → delete → 删除后仍可 read → recall 不再命中。
- `node scripts/stage.mjs S2b`：ci + smoke + ADR-0006 + S2b.1–S2b.5 编号全绿。

## 偏差与回滚

- `mem delete` 在 S2b 是**人直接调用的 CLI**；S4 接入提案后，agent 侧只能走 `decide`，这个命令仍是人的 T2 通道。
- 路径红队只覆盖"输入形状"（保留名、绝对性、id 形状）与常见长路径/中文/空格；**junction/符号链接本身未被拒绝**——home 由人指定，store 不解析其真实路径，V1 接受这一点并写进 ADR。
- `sealed_files` 是 v2 内的加字段；旧 v2 policy（无该字段）按默认空串解析，重新 seal 时会补上。
- 回滚：删除 `adopt`/`remove` 方法与 CLI 分支、把 policy 的 `sealed_files` 从 schema/文档/模板移除；数据侧 journal 的 `adopt`/`delete` 行会被旧代码忽略（S2a 已能解析所有 op）。
