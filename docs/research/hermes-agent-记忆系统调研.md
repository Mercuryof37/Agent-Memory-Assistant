# Hermes Agent 记忆系统调研

> **主体来源**：Hermes Agent 官方文档 `website/docs/user-guide/features/memory.md`（仓库 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)），经 GitHub API 抓取原文。
> **补充来源**：DSH 插件 [dsh-memento](https://github.com/PerryLink/dsh-memento) README 中对 Hermes 的对比记录（含一条 Hermes issue 引用）。
> **标注约定**：`【原文】` = 官方文档明确写出；`【插件作者记录】` = 第三方对其行为的描述，未在官方文档逐字核对。

---

## 一、它是什么

Hermes Agent 的记忆是**有界、人工策展（bounded, curated）、跨会话持久**的。它让 agent 记住你的偏好、项目、环境，以及它自己学到的东西。`【原文】`

关键定位：**记忆不是"存得越多越好"，而是"固定预算内放最关键的少数事实"**。整个设计围绕这个约束展开。

## 二、两个文件，两套预算

| 文件          | 装什么                                      | 字符上限     | 约合 token | 典型条数   |
| ----------- | ---------------------------------------- | -------- | -------- | ------ |
| `MEMORY.md` | agent 的私人笔记：环境事实、项目约定、踩过的坑、已完成任务日志、有效的技巧 | **2200** | ~800     | 8–15 条 |
| `USER.md`   | 用户画像：偏好、沟通风格、期望、雷区、工作流习惯、技术水平            | **1375** | ~500     | 5–10 条 |

- 存放位置：`~/.hermes/memories/`（多 profile 时是 `~/.hermes/profiles/<name>/memories/`）
- 两者合计约 1300 token，**每次请求都付这个成本**
- 条目由 `§`（section sign）分隔，**条目可以是多行的**

## 三、注入方式：冻结快照（frozen snapshot）

会话开始时，记忆从磁盘载入，作为**冻结块**渲染进系统提示词：

```
════════════════════════════════════════
MEMORY (your personal notes) [67% — 1,474/2,200 chars]
════════════════════════════════════════
User's project is a Rust web service at ~/code/myapi using Axum + SQLx
§
This machine runs Ubuntu 22.04, has Docker and Podman installed
§
User prefers concise responses, dislikes verbose explanations
```

格式包含四件事：**哪个 store**（MEMORY / USER PROFILE）、**用量百分比与字符数**（让 agent 知道还剩多少容量）、**以 `§` 分隔的独立条目**、条目可多行。

**冻结的含义（重点）**：注入内容在会话开始时捕获一次，**会话中途永不变化**。这是**有意为之——为了保住 LLM 的前缀缓存（prefix cache）**。

> agent 在会话中新增/删除记忆时，变更**立即落盘**，但**不会出现在系统提示词里，直到下一个会话开始**。工具响应始终显示实时状态。

这条设计的代价是：**你在当前会话里存的记忆，这个会话看不见。**

## 四、记忆需要会话边界

整个记忆系统建立在会话**结束**的那一刻：`MEMORY.md` 和 `USER.md` 把要点带进下一个会话，`session_search` 在旧上下文消失后补上缺口。

**在单个会话内部，这套机制没有理由运转**——重要信息都还在活上下文里，所以 agent 很少去查 `session_search`，更多是**压缩**记忆条目而不是**策展**它们。

这在消息平台上尤其重要（Telegram、Discord 等）：一个聊天被刻意设计成**一个连续的会话**，能扛住重启、网关崩溃、机器重启。**关机过夜并不会结束会话**——下一条消息无缝接上。如果从不重置，一个聊天可以跑好几周：

- 越来越贵（压缩反复在越来越长的历史上运行）
- **`忘掉 → 从记忆召回 → 搜索过去会话` 这个学习闭环几乎永远不会触发**
- 新记忆条目对正在运行的会话不可见（因为冻结快照）

**实践建议**：在自然边界上运行 `/new`——一个任务做完、换个话题、一天开始。每个边界都是记忆兑现价值的时刻：agent 重读更新后的 `MEMORY.md` / `USER.md` 快照、从廉价的短上下文起步、真正需要历史时才去够 `session_search`。CLI 上这基本自动（每次调用都是新会话）；**在网关上，边界由你创造**。

## 五、memory 工具的三个动作

- **`add`** — 新增一条记忆
- **`replace`** — 用更新后的内容替换既有条目（靠 `old_text` 做子串匹配）
- **`remove`** — 删除不再相关的条目（同样靠 `old_text`）

> **没有 `read` 动作。** 记忆内容在会话开始时已自动注入系统提示词，agent 看到的记忆就是它对话上下文的一部分。

### 子串匹配的语义（容易踩）

`replace` / `remove` 用**短的唯一子串**匹配——你**不需要**给出完整条目文本。`old_text` 只需是一个**唯一标识某一条**的子串：

```python
# 若记忆含 "User prefers dark mode in all editors"
memory(action="replace", target="memory",
       old_text="dark mode",
       content="User prefers light mode in VS Code, dark mode in terminal")
```

**若子串匹配到多条，返回错误并要求更精确的匹配。**

**关键陷阱**：`replace` 会用 `content` **覆盖整个被匹配到的条目**——`old_text` 只负责**定位**，不是"把这段挖掉再替换"。

> 新的 `content` 必须是**完整的新条目**，包含所有你想保留的旧内容。（当 `old_text` 恰好等于整条条目本身时，按整条精确匹配，优先于子串匹配。）

## 六、两个 target 的边界

**`memory` — agent 的私人笔记**，用于它需要记住的环境、工作流和经验：

- 环境事实（操作系统、工具、项目结构）
- 项目约定与配置
- 工具怪癖与已发现的绕法
- 已完成任务的日志条目
- 有效的技巧与方法

**`user` — 用户画像**，用于用户的身份、偏好、沟通风格：

- 姓名、角色、时区
- 沟通偏好（简洁还是详细、格式偏好）
- 雷区与要避免的事
- 工作流习惯
- 技术水平

## 七、什么该存、什么不该存

### 应当主动保存（不需要用户开口）

| 类型 | 例子 | 存到 |
|---|---|---|
| 用户偏好 | "我更喜欢 TypeScript 而不是 JavaScript" | `user` |
| 环境事实 | "这台服务器跑 Debian 12 + PostgreSQL 16" | `memory` |
| 纠正 | "别用 `sudo` 跑 Docker，用户在 docker 组里" | `memory` |
| 约定 | "项目用 tab、120 列宽、Google 风格 docstring" | `memory` |
| 已完成工作 | "2026-01-15 把数据库从 MySQL 迁到 PostgreSQL" | `memory` |
| 明确要求 | "记住我的 API key 每月轮换" | `memory` |

### 不该存

- **琐碎/显而易见的信息**："用户问了 Python 的问题" —— 太模糊，没用
- **容易重新查到的事实**："Python 3.12 支持 f-string 嵌套" —— 可以搜
- **原始数据倾倒**：大段代码、日志文件、数据表 —— 对记忆来说太大
- **会话级临时信息**：临时文件路径、一次性的调试上下文
- **已经在上下文文件里的信息**：`SOUL.md` 和 `AGENTS.md` 的内容

## 八、容量管理：满了会怎样

**记忆不会自动压缩。** 当一次写入会超限时，`memory` 工具**返回错误**，而不是静默丢弃条目。而且 `replace` 同样受上限约束——用更长的内容换掉一条仍然可能溢出。

错误形如：

```json
{
  "success": false,
  "error": "Memory at 2,100/2,200 chars; adding this entry (250 chars) would exceed the limit by 153 chars. Retry as ONE 'operations' batch that removes or shortens (replace) stale entries from current_entries below to free at least 153 chars AND adds this entry — the limit is checked only on the batch result.",
  "current_entries": ["..."],
  "usage": "2,100/2,200"
}
```

**然后 agent 重新提交一个 `operations` 批次**：释放至少错误里说明的字符数（删除，或用更短的版本 `replace`）+ 加入新条目。**上限只在批次的最终结果上检查。**

若 `replace`/`remove` 的 `old_text` 匹配不到任何条目，同样失败，并在 `closest_entries` 下列出最相似的条目。

**最佳实践**：当记忆超过 80% 容量（系统提示词头部可见）时，**先整合再新增**。例如把三条分散的"项目用了 X"合并成一条完整的项目描述条目。

### 好条目的例子

```
# 好：把多个相关事实打包
User runs macOS 14 Sonoma, uses Homebrew, has Docker Desktop and Podman. Shell: zsh with oh-my-zsh. Editor: VS Code with Vim keybindings.

# 好：具体、可执行的约定
Project ~/code/api uses Go 1.22, sqlc for DB queries, chi router. Run tests with 'make test'. CI via GitHub Actions.

# 好：带上下文的经验
The staging server (10.0.1.50) needs SSH port 2222, not 22. Key is at ~/.ssh/staging_ed25519.

# 坏：太模糊
User has a project.

# 坏：太啰嗦
On January 5th, 2026, the user asked me to look at their project which is located at ~/code/api. I discovered it uses Go version 1.22 and...
```

## 九、去重与安全扫描

- **去重**：记忆系统**自动拒绝完全重复的条目**。若加入的内容已存在，返回成功并附 "no duplicate added" 消息。
- **安全扫描**：因为是注入系统提示词的，条目在被接受前会**扫描注入与外泄模式**。命中威胁模式（提示词注入、凭据外泄、SSH 后门）或**包含不可见 Unicode 字符**的内容会被拦下。

## 十、session_search：另一条独立的检索路径

除了两个 md 文件，agent 还能用 `session_search` 搜过去的对话：

- 所有 CLI 与消息平台会话都存在 SQLite（`~/.hermes/state.db`），带 **FTS5 全文检索**
- 查询返回 **DB 里的真实消息**——**不做 LLM 摘要、不做截断**
- agent 能找到几周前讨论过的东西，即使不在活跃记忆里
- agent 还能在找到的任意会话内**向前/向后滚动**

```bash
hermes sessions list    # 浏览过去的会话
```

### 记忆 vs 会话搜索

| 维度 | 持久记忆 | 会话搜索 |
|---|---|---|
| 容量 | 合计约 1300 token | 无上限（全部会话） |
| 速度 | 即时（在系统提示词里） | FTS5 查询约 20ms，滚动约 1ms |
| 成本 | 每个 prompt 都付 token | 免费——不调 LLM |
| 用途 | 关键事实，始终可用 | 找具体的过去对话 |
| 管理 | agent 人工策展 | 自动——所有会话都存 |
| token 成本 | 每会话固定（约 1300 token） | 按需（需要时才搜） |

**记忆**放的是"应该始终在上下文里的关键事实"。**会话搜索**放的是"我们上周是不是讨论过 X？"这类需要回忆具体细节的查询。

## 十一、配置

```yaml
# ~/.hermes/config.yaml
memory:
  memory_enabled: true
  user_profile_enabled: true
  memory_char_limit: 2200    # ~800 tokens
  user_char_limit: 1375      # ~500 tokens
  write_approval: false      # false = 自由写入（默认）| true = 需要批准
  prefetch_spill_enabled: false
```

**同时**把 `memory_enabled` 和 `user_profile_enabled` 设为 `false` 会完全关掉内置存储：`memory` 工具从 schema 里移除，它的指引块也从系统提示词里移除，**所以模型永远不会被告知一个它用不了的工具**。

只设 `memory_enabled: false`（用户画像仍开）时工具保留——它背后是 profile store——但系统提示词把完整记忆指引换成更窄的"仅画像"块，工具 schema **只暴露 `user` target**，对已禁用的 `MEMORY.md` 的直接或暂存写入会被拒绝。反过来同理。

## 十二、写入审批（`write_approval`）

**默认 `false`：agent 自由保存记忆**——**包括回合结束后运行的后台自我改进回顾（background self-improvement review）**。

| `write_approval` | 行为 |
|---|---|
| `false`（默认） | 自由写入——门是关的（即"门之前"的行为） |
| `true` | 保存前需要批准。在交互式 CLI 里，前台写入**内联提示**你（条目小到可以完整阅读）。**其他地方**——消息平台、脚本、以及后台自我改进回顾——写入被**暂存**，用 `/memory pending` 复核 |

审查暂存写入：

```
/memory pending             # 列出暂存写入（自动的会标 [auto]）
/memory approve <id>        # 批准一条（或 'all'）
/memory reject <id>         # 丢弃一条（或 'all'）
/memory approval on         # 打开门（或 'off'）并持久化
```

> 这就是"agent 对我存了一个错误假设"的答案：设 `write_approval: true`，**每一次保存**——尤其是**未经提示的后台保存**——都要先过你的 yes/no 才会进入你的画像。

**暂存 `replace`/`remove` 会记录它瞄准的完整条目**，`/memory pending` 会显示出来。批准**只对那一条生效**：如果条目在暂存之后被改过，**该写入被拒绝并保持 pending 等你驳回**。在这个 pinning 机制出现之前暂存的 `replace`/`remove` 没有可验证的目标，同样被拒——驳回它并重新创建变更。

## 十三、后台回顾与通知

【原文】回合结束后的后台自我改进回顾可能**静默保存一条记忆或更新一个技能**。这是 Hermes 的**同意感知学习回路**：重复的纠正和持久的工作流经验变成紧凑的记忆条目或程序性技能，而 `write_approval` 可以在这些写入影响未来会话之前把它们暂存待审。默认会在聊天里浮出一行 `💾 Memory updated`。

```yaml
display:
  memory_notifications: on    # off | on（默认）| verbose
```

| 值 | 行为 |
|---|---|
| `off` | 无聊天通知。**回顾仍然运行、仍然写入**——你只是看不到那一行 |
| `on`（默认） | 通用行，如 `💾 Memory updated`、`💾 Skill 'foo' patched` |
| `verbose` | 附带变更的紧凑预览，如 `💾 Memory ✎ User prefers terse replies` 或 `"old" → "new"` 的技能 diff 片段 |

> 这只管**网关的聊天通知**。回顾本身、以及对记忆/技能存储的写入**不受这个设置影响**。可按平台设 `display.platforms.<platform>.memory_notifications`。

### 回顾跑在哪个模型上（`auxiliary.background_review`）

**默认跑在你的主聊天模型上**，并重放整段对话——而这段对话在 prompt cache 里还是热的，所以是便宜的缓存读取。主模型很贵时，可以换便宜模型：

```yaml
auxiliary:
  background_review:
    provider: openrouter
    model: google/gemini-3-flash-preview   # auto（默认）= 主聊天模型
```

指向**不同**模型时，回顾在那边运行，成本显著更低（benchmark 里约 3–5×）。因为不同模型本来就用不了主模型的缓存，这个分支会**自动重放一份紧凑的对话 digest（近期回合原文 + 更早回合的摘要）**而不是完整转录，以最小化写入新缓存的内容。捕获效果：测试中记忆捕获**完全一致**，技能捕获**近乎一致**。

### 关掉自动回顾（`enabled`）

回顾分支在繁忙主机上可能占掉可观 token：

```yaml
auxiliary:
  background_review:
    enabled: true              # false = 跳过自动的回合后分支
```

设为 `false` 后自动分支不再产生，**手动 `/refine` 仍然可用**。

### 给回顾限制成本（`max_input_tokens`）

回顾循环在它发出的每个 provider 请求上都重放对话，所以**单次回顾可能把输入 token 翻好几倍**。`max_input_tokens` 给单次回顾重放的输入 token 总量封顶，超限前循环就停。`<= 0` 表示不限。

```yaml
auxiliary:
  background_review:
    max_input_tokens: 48000   # <= 0 = 不限
```

未设时，预算从回顾模型解析出的上下文窗口推导：**窗口的 75%，上限 600,000 token**——所以它对小本地模型也生效（65,536 token 的模型拿到 49,152），而固定的云规模默认值在那种场景下永远不会触发。窗口解析不出来时回退到保守的 120,000 token。（注意键在 `auxiliary:` 下；顶层 `background_review:` 块不会被读取。）

### 本地模型：回顾等 GPU 空闲（`defer`）

云 provider 上回顾几秒就完事。**托管本地 llama-server** 上，同一个分支会占用你下一条 prompt 要用的 GPU——大模型上要几分钟——而且**发新 prompt 会取消它、丢弃这次学习**。所以在托管本地运行时，回顾**默认延迟**：回合结束时入队，等机器安静一小段结算窗口后再执行。

```yaml
auxiliary:
  background_review:
    defer: auto            # auto（默认）| never
    defer_max_age_s: 1800  # 排队超过这么久就无论如何都跑
```

队列**按会话合并**（更新回合的快照替换旧的——回顾重放整段对话，所以什么都没丢），被新 prompt 抢占的回顾**重新入队**而不是丢弃，等待超过 `defer_max_age_s` 的回顾即使机器从没空闲也会跑。显式 `/refine` 总是立即运行。队列在内存里：**应用退出时仍待处理的回顾会被丢掉**，和正在飞行中的分支一样。

### 给回顾放宽工具白名单（`extra_tools`）

后台回顾**默认可以用记忆、技能管理和只读文件工具**。若某个 profile 提供了另一个对无人值守回顾安全的工具，按名字选入：

```yaml
auxiliary:
  background_review:
    extra_tools:
      - propose_shared_memory
```

工具必须**已经对父 agent 可用**；这个设置只是把它加进回顾分支的运行时白名单，**不会启用任意工具**，未列出的工具仍然被拒。**保持列表窄**，并优先选那些"提交提案待人工审"而不是直接施加外部或破坏性变更的工具。**默认是空列表。**

## 十四、技能写入审批（`skills.write_approval`）

技能用同样的 on/off 门，但复核体验不同，因为 `SKILL.md` 太大、没法在聊天气泡里读：

```yaml
skills:
  write_approval: false     # false = 自由写入（默认）| true = 需要批准
```

`write_approval: true` 时，技能写入（create / edit / patch / write_file / delete）**无论来源一律暂存**。你内联复核一行要点，完整 diff 走带外：

```
/skills pending           # 列出暂存技能写入 + 每个一行要点
/skills diff <id>         # 完整 unified diff（最好在 CLI 或 dashboard 看）
/skills approve <id>      # 应用（或 'all'）
/skills reject <id>       # 丢弃（或 'all'）
/skills approval on       # 打开门（或 'off'）并持久化
```

在消息平台上，可以凭要点 + 元数据批准，或者在 CLI / dashboard / `~/.hermes/pending/skills/<id>.json` 下的暂存文件里打开 `/skills diff` 读完整变更。

## 十五、学习旅程视图（`/journey`）

`/journey` 是 Hermes 学到的一切的时间线视图——已保存的技能与记忆条目按时间铺开（最旧在上、最新在下），带一个可播放的"星座"擦除动画重放积累过程。同一份图数据驱动三个界面：

- **经典 CLI / 独立** — `hermes journey`（别名 `hermes learning`、`hermes memory-graph`）。标志：`--play` 播放积累（`--fps` 调速）、`--width`/`--height` 覆盖渲染尺寸、`--no-color`、`--json` 导出原始图数据
- **TUI** — `/journey`（别名 `/learning`、`/memory-graph`）以浮层打开时间线
- **桌面应用** — `/journey` 打开星图 / 记忆图面板

一个技能只要有学习信号就出现在时间线上：在本 profile 内被创建（`/learn` 的结果，或前台 `skill_manager` create）、由后台回顾创建、或**至少被用过一次**。**内置技能和从未被用过的手写技能不会进入时间线。**

除了看，`/journey` 也是你**修剪和纠正** Hermes 所学的地方：

| 命令 | 作用 |
|---|---|
| `hermes journey list` | 列出 node id——技能名，以及记忆块的 `memory:<source>:<index>:<fingerprint>` id（原样传回） |
| `hermes journey delete <node> [-y]` | 删除一个节点。技能被**归档**（可恢复），记忆块被移除。`-y` 跳过确认 |
| `hermes journey edit <node>` | 用 `$EDITOR` 打开节点内容（技能的 `SKILL.md` 或记忆块） |

同样的 `list` / `delete <id>` / `edit <id>` 子命令在 CLI 的会话内 `/journey` 命令里也能用，桌面面板直接在节点上提供编辑/删除。

## 十六、外部记忆 provider

除了 `MEMORY.md` 和 `USER.md`，Hermes 还随附 **2 个外部记忆 provider 插件——RetainDB 和 ByteRover**——以及更多可从[插件目录](plugins.md)通过 `hermes plugins install <name>` 安装的，例如 **Honcho、Hindsight、Supermemory、Mem0、OpenViking、Holographic**。

**外部 provider 与内置记忆并行运行（从不替换它）**，并增加知识图谱、语义检索、自动事实抽取、跨会话用户建模等能力。

```bash
hermes memory setup      # 选一个 provider 并配置
hermes memory status     # 查看当前生效的是什么
```

**外部召回的大小**：外部 provider 默认返回它们**完整的预取上下文**，上限是 10× `hooks.output_spill.max_chars` 的安全天花板（至少 100,000 字符）；超过该值仍然会溢出，所以**失控的 provider 无法撑爆上下文窗口**。`memory.prefetch_spill_enabled: true` 让**活跃 profile** 把超大召回替换成头/尾预览加文件路径。这会减少重放的上下文，但**按相关性排序的中间部分就不再对模型立即可见**。provider 自带召回预算时优先用它的。这个可选项用的是共享的 `hooks.output_spill` 阈值、预览长度和目录；`hooks.output_spill.enabled: false` 仍会禁用它。常规插件钩子继续默认溢出，与本可选项无关。设置在 provider 注册时被捕获：**改完要重启 Hermes**。

## 十七、故障排查：「我让它记住，下个会话它忘了」

最常见的报告长这样：你告诉 agent 某个东西在哪（一个 Obsidian vault、一个项目目录、一台服务器），它回答"Done, I'll remember that"，然后新会话完全不知道你在说什么。**按顺序**排查——**第一条解释了绝大多数情况**：

1. **检查写入是否真的发生了。** 记忆**只有在模型调用 `memory` 工具时才持久化**；一句"我已经把它加进记忆了"只是文本。打开文件确认：

   ```bash
   cat ~/.hermes/memories/MEMORY.md
   cat ~/.hermes/memories/USER.md
   ```

   如果事实不在里面，**模型只是声称保存了**。小本地模型（大致 30B 参数以下）和工具调用能力弱的模型经常这样——**它们产出确认语，却没有工具调用**。显式要求（"用 `memory` 工具保存 vault 路径 `/srv/vault`"）并确认条目落进文件。若反复发生，**解法是给 setup 换个更强的模型，而不是加更多指令**；条目一旦存在，小模型读起来没问题，因为它们是随系统提示词到达的。

2. **检查写入是否被暂存了。** `write_approval: true` 时，交互式 CLI 之外的写入被扣下待审，批准前永不落盘——跑 `/memory pending` 和 `/memory approve all`。

3. **检查你读的是不是同一份记忆。** 记忆是**按 profile** 的：`hermes -p work`（或 `work chat` / `work gateway start`）读 `~/.hermes/profiles/work/memories/`，不是 `~/.hermes/memories/`。默认 profile 的 CLI 会话和另一个 profile 上的 Telegram 机器人**不共享笔记**。`hermes profile list` 显示存在哪些。

4. **检查记忆是否启用。** `memory.memory_enabled: false`（或把 `memory` 列进 `agent.disabled_toolsets`）会**完全移除工具**——模型什么都存不了，无论它说什么。

5. **记住快照在会话开始时冻结。** 在当前会话存的事实**对下一个会话可见**，**对另一个已经在运行的会话不可见**。写入之后开个新会话（`/new`，或一次全新的 CLI 调用）。

**两件不会让 agent记住的事**：`.env` 里的变量（那是凭据和设置，不是记忆），以及**随口提到但没要求保存**的事实。

**对于需要每次运行都用到的位置，技能通常是比记忆条目更好的归宿**——技能只在相关时加载，也不跟 2,200 字符预算抢位置。

---

## 十八、触发条件的量级（补充核实）

后台回顾不是每回合都跑，靠两个计数器触发：

| 机制 | 默认阈值 | 关掉的方式 |
|---|---|---|
| 记忆 nudge | `memory.nudge_interval` = **10 个用户回合** | 设为 `0` |
| 技能创建 nudge | `skills.creation_nudge_interval` = **15 次工具调用迭代** | 设为 `0` |
| 后台回顾 fork | 上述 nudge 命中后，**回合结束时**在守护线程里派生 | `auxiliary.background_review.enabled: false` |

`cli-config.yaml.example` 原文（解码后）：

```
  # Periodic memory nudge: remind the agent to consider saving memories
  # every N user turns. Set to 0 to disable. Only active when memory is enabled.
  nudge_interval: 10        # Nudge every 10 user turns (0 = disabled)
  creation_nudge_interval: 15
  # Post-turn memory/skill self-improvement review fork. Runs after a turn
  # when the nudge intervals fire; writes skills/memories in a daemon thread.
  background_review:
    enabled: true            # false = skip automatic forks (/refine still works)
```

**源码级佐证**：PR [#92423](https://github.com/NousResearch/hermes-agent/pull/92423) 引用 `agent_init` 原始代码 `agent._memory_nudge_interval = int(mem_config.get("nudge_interval", 10))`。该 PR 同时暴露一个值得警惕的失效模式：这行 `int()` 抛错时，外层 `except Exception: pass` 会**静默吞掉异常，导致整个记忆子系统失效且不报任何错**。

## 十九、待核实与不成立的传言

流传较广的中文对比文（如[华为云社区](https://bbs.huaweicloud.com/blogs/477076)《OpenClaw、Claude Code、Hermes Agent 记忆系统比较》）把 Hermes 描述成"三层架构：瞬时层 = Redis(100MB/Session)、工作层 = SQLite + FTS5 + 向量索引(10 万条召回率 92.3%)、长期层 = MEMORY.md + USER.md"。

| 该文说法 | 核实结果 |
|---|---|
| 2200/1375 字符上限、超限 add 失败交模型自裁、冻结快照、自动写入 + nudge | ✅ 与官方一致 |
| "Redis 瞬时记忆层" | ❌ **官方文档未找到任何出处** |
| "92.3% 召回率 + 向量索引" | ❌ **官方文档未找到任何出处** |
| "Nudge Engine" 这个术语 | ⚠️ 非官方命名，官方是 `nudge_interval` |

**引用中文二手资料时请避开这三点。**

另有一条**未找到官方来源**的说法：社区帖称 background review 有"工具循环 16 次封顶"。官方只说明 review 的输入预算默认取模型上下文窗口的 75%、上限 600,000 token，未见"16 次"这一限制的出处。

## 二十、官方并未提供记忆导出的 MCP server

**【调研结论】** 官方**没有**导出记忆的 MCP server。可以确认的是社区需求存在——issue [#10835](https://github.com/NousResearch/hermes-agent/issues/10835)《Expose Hermes memory (MEMORY.md/USER.md) via MCP server》（仅能确认标题，正文未能读取）。

**真正可复用的是 Memory Provider Plugin SDK**：实现 `MemoryProvider` ABC（`name` / `is_available` / `initialize` / `get_tool_schemas` / `handle_tool_call`，以及可选的 `prefetch` / `queue_prefetch` / `sync_turn` / `on_session_end` / `on_pre_compress` / `on_memory_write`），支持目录安装与 `hermes_agent.memory_providers` entry point 打包。文档：https://hermes-agent.nousresearch.com/docs/developer-guide/memory-provider-plugin

两个独特设计值得注意：provider 可用 `ctx.register_skill(...)` 注册**只读技能**；`compression.checkpoint_required` 有**失败关闭（fail-closed）契约**——压缩前必须先落地持久化 checkpoint，否则阻塞有损重写。

技能格式遵循 agentskills.io 开放标准，支持 `skills.external_dirs` 跨工具共享。

---

## 二十一、与本项目的关键差异（对照分析，非原文）

| 维度 | Hermes Agent | 本项目（Amadeus / DSH 记忆系统） |
|---|---|---|
| 存储 | 2 个 md 文件，2200 + 1375 字符 | `USER.md` + `MEMORY.md`，单文件 10000 字符 |
| 读取 | **无 read 动作**，靠冻结快照注入 | **有读动作**，且强制"改前先读" |
| 写入确认 | **默认自由写入**，`write_approval` 可开 | **默认全程确认**（`memory_confirm`） |
| 并发控制 | 无（官方警告：一个 home 只能一个 agent 进程） | 服务端版本冲突检测，版本号不经过模型 |
| 写入失败处理 | 返回错误 + 全部现有条目，让模型自己腾地方 | 说明未保存，需精简/合并/删除后重试 |
| 自动学习 | **有后台回顾分支**（`nudge_interval` 触发） | **明确不做后台学习** |
| 历史检索 | `session_search`（FTS5，真实消息，无摘要） | 5 个工具分三层（定位/会话内/展开 + trace） |
| 去重 | 自动拒绝完全重复 | 靠"优先更新旧条目"的规范约束 |
| 安全扫描 | 有（注入/外泄模式 + 不可见 Unicode） | 未在原文提及 |

**【插件作者记录】** dsh-memento README 称：Hermes 的记忆审批门**只在工具层实现，因此可被 late tool injection 绕过**，并引用了 [Hermes issue #48181](https://github.com/NousResearch/hermes-agent/issues/48181)。dsh-memento 因此把门放在 `ctx.memory` 的写方法**内部**，而不是工具层。此说法**未在 Hermes 官方 memory.md 中逐字核对**，引用时请标注来源。

**【插件作者记录】** dsh-memento 也采用了 Hermes 文档中"两个进程共享一个 home 目录会互相污染记忆"这条注意事项。
