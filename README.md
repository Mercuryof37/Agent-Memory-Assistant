# Agent Memory

给 **DeepSeek Harness（DSH）** 用的本地长期记忆：一条记忆一个 Markdown 文件，索引可随时重建，注入按会话冻结；模型的写入以**提案 → 人审批**为主。

> 零云依赖：数据在本机 `~/.dsh/memory`，不上传、不需要账号。

## 它解决什么

- **AI 记得住你**：偏好、事实、踩过的坑、可复用的经验，跨会话保留。
- **记忆是文件**：可读、可 grep、可 diff、可备份；不锁在数据库里。
- **人保留决定权**：模型可以检索、可以提案，但采纳/驳回由你在界面点击。
- **不靠提示词守边界**：不可变记录、内容哈希、append-only journal、封存校验都在代码与测试里。

## 功能一览

| 功能 | 说明 |
|---|---|
| 侧栏工作台 | 「记忆」按 事实 / 坑 / 经验 分组，搜索、详情、日期排序 |
| 项目工作树 | 项目总览 → 项目树 → 焦点关系图（L0–L2），相似提示不自动合并 |
| 手写新增 | 分组「＋」新增；坑需填 1–3 条错误特征，便于以后匹配 |
| 提案审批 | 模型或回顾指令生成的修改/新增先进「提案」，你采纳后才生效 |
| 整理建议 | 手动「整理」：统计 + 分条 RULES 建议；勾选只进草稿，保存并封存才生效 |
| 修订 / 删除 | 修订保留旧记录并失效；删除是彻底删除（文件移除，journal 只留审计） |
| 偏好与规则 | GUI 编辑 USER.md / RULES.md；RULES 只能由人保存 |
| SOUL 只读 | 只显示路径，插件不改内容；你改完点「一键封存」 |
| 备份 | 导出 JSON / 导入 JSON（按内容去重），换机可恢复 |
| 聊天指令 | `/mem …` 运维；`/mem-fact`、`/mem-pitfall`、`/mem-exp` 回顾本轮并生成提案 |
| MCP 外挂 | Codex 等通过 MCP 读取同一份记忆；默认只读 + 提案，没有 decide/record |
| CLI | `mem`：初始化、doctor、检索、导入导出、发布运维 |

## 安装

**要求**：DSH 桌面 **0.2.1-rc.2+**，Node **24+**（DSH 自带运行时即可）。

### 设置 → 插件（推荐）

1. 打开 DSH → 设置 → 插件（Plugins）；
2. 搜索或输入包名 **`@agent_memory/dsh`**，或选择「从文件安装」并选中 `agent_memory-dsh-<version>.tgz`；
3. 完整重启 DSH（不是关窗口）；
4. 侧栏出现「记忆」即安装成功。

### 命令行

```powershell
dsh plugin add @agent_memory/dsh
```

### 从源码开发

```powershell
npm install
npm run build
npm run plugin:install   # 链接到 desktop profile（会先备份）
npm run plugin:revert    # 还原
```

发布与回滚细节见 [安装与分发](docs/guide/install.md)。

## 第一次使用

1. 点侧栏「记忆」：先看列表与搜索；
2. 点分组右侧「＋」手写一条（事实/坑/经验）；
3. 助手提出修改时，右上角「提案 N」里「采纳」或「驳回」；
4. 「偏好与规则」里写你的偏好；规则由你保存并封存；
5. 换机前用「导出备份」，新机「导入备份」。

详细图文说明：[使用手册](docs/guide/manual.md)。

## 聊天指令

| 指令 | 作用 |
|---|---|
| `/mem proposals` | 查看待审提案 |
| `/mem decide <id> accept\|reject` | 采纳 / 驳回 |
| `/mem recall <关键词>` | 检索记忆 |
| `/mem read <库编号>` | 查看全文（如 `F-01`） |
| `/mem-fact` / `/mem-pitfall` / `/mem-exp` | 回顾本轮，分别生成事实/坑/经验的待审提案 |
| `/mem help` | 全部命令 |

回顾指令基于内置 skill `agent-memory-retro`：只回顾当前轮次、最多 3 条、必须带真实事件出处；生成的是提案，不直接写库。

## 在 Codex / 其他 Agent 里用

```toml
[mcp_servers.agent-memory]
command = "node"
args = ["<仓库或安装目录>\\packages\\cli\\bin\\mem.mjs", "mcp"]
```

MCP 工具：`memory_search`、`memory_read`、`memory_list`、`memory_propose`。没有 `decide`，也没有 `record`；外部提案仍回到 DSH 由人审批。详见 [MCP 指南](docs/guide/mcp.md)。

## 数据与隐私

- 数据目录：`~/.dsh/memory`（可用 `--home` 指定）；
- 记忆是 `memories/<kind>/*.md`；删除是彻底删除，journal 只保留不含正文的审计行；
- 没有遥测、没有云端、没有账号；`doctor` 可本地检查完整性；
- 备份：GUI 导出 JSON，或 `mem export <dir>`；导入会按内容去重。

## 架构

```text
数据域（三层）      人设层：SOUL / USER / RULES / GUIDANCE
                  事实层：不可变记录 + 提案 + journal
                  历史层：DSH 会话检索（只读）
访问层            MemoryService / 工具 / CLI / HTTP / MCP
呈现层            DSH 客户端插件（侧栏 + 工作台 + 聊天卡）
```

核心包不依赖宿主；宿主只做适配；GUI 不直接读写文件；所有写入经 core 的校验、锁、journal 与审批。完整分层、数据模型、扩展点与测试门禁见 [架构总览](docs/architecture/overview.md)。

## 文档

| 面向 | 文档 |
|---|---|
| 使用 | [使用手册](docs/guide/manual.md) · [安装与分发](docs/guide/install.md) · [MCP](docs/guide/mcp.md) · [API v1](docs/guide/api.md) |
| 运维 | [运维手册](docs/ops.md) · [配置](docs/config.md) · [策略](docs/policy.md) |
| 架构 | [架构总览](docs/architecture/overview.md) · [UI 规范](docs/design/ui-guidelines.md) |
| 决策 | [ADR](docs/adr/) |
| 规划 | [V2 方案](docs/plan/v2-gui-and-distribution.md) · [V3 方案](docs/plan/v3-visual-and-workflows.md) · [V4 方向](docs/plan/v4-directions.md) · [ONNX 必要性](docs/plan/onnx-necessity.md) · [架构审核](docs/plan/v2-architecture-review.md) |
| 发布 | [发布检查单](docs/development/release.md) · [验收记录](docs/development/release-verification.md) · [CHANGELOG](CHANGELOG.md) |
| 维护者 | [开发历程](docs/history/rounds.md) · [AGENTS.md](AGENTS.md) · [文档索引](docs/README.md) |

## 兼容与限制

- 目标宿主：DSH 桌面 0.2.1-rc.2（更旧版本未保证）；
- 单用户、单机；不做云同步/多租户；
- 检索为 BM25 + 字面匹配，不含向量检索；
- 发布包名 `@agent_memory/dsh`（npm 组织名为 `agent_memory`）。

## 维护者

- [开发历程](docs/history/rounds.md) · [阶段状态](docs/plan/status.md) · [待办](docs/plan/todo.md) · [开放问题](docs/plan/open-questions.md) · [AGENTS.md](AGENTS.md)

## License

MIT，见 [LICENSE](packages/dsh/LICENSE)。
