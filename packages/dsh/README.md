# @agent-memory/dsh

Local, human-approved long-term memory for **DeepSeek Harness** (DSH).

每个 Agent Memory 是本地 Markdown 文件；注入是每会话冻结一次的快照；模型的写入以「提案 → 人审批」为主，没有自动改写规则的通道。

## Install

推荐在 DSH 内安装：

1. DSH → 设置 → 插件（Plugins）→ 从文件安装；
2. 选择 `agent-memory-dsh-<version>.tgz`；
3. 完整重启 DSH，侧栏出现「记忆」。

或：

```powershell
dsh plugin add "path\to\agent-memory-dsh-<version>.tgz"
```

开发期可用源码链接：`npm run plugin:install` / `npm run plugin:revert`。

## First use

- 打开侧栏「记忆」：按 事实 / 坑 / 经验 浏览、搜索、新建、修订、删除；
- 「提案」展示模型想改/想加的记忆，采纳后才生效；
- 「偏好与规则」编辑 USER.md / RULES.md；SOUL.md 只显示路径，改完点「一键封存」；
- 数据目录默认 `~/.dsh/memory`，可用 `mem doctor` 检查。

## Commands

```text
/mem proposals       待审提案
/mem decide <id> accept|reject
/mem-fact /mem-pitfall /mem-exp   回顾本轮并生成对应提案
/mem help
```

## License

MIT.
