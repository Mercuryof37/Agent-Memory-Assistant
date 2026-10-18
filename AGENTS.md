# AGENTS.md · 本仓库的工作约定

> 这些是**软约束**：写给参与本项目的人与 agent 看。真正的门禁在 `scripts/gates.mjs` 和测试里。一条"必须"若没有对应检查，就只能待在这里，不许写成"硬"的（见开发方案 §4.3 与 S5）。

## 语言

- 文档、ADR、README、`AGENTS.md`：**中文**；
- 代码、标识符、代码注释、错误信息、日志、提交信息：**英文**（注释跟代码走，解释性长文放 `docs/`）；
- 面向人的诊断信息点名到键、给出行号，不要只说"配置无效"。

## 三条硬纪律（已进 CI）

1. `packages/core` 整棵子树不得出现宿主包字样（`@deepseek-ai/`，CI 扫字符串而非只扫 import）；
2. `packages/dsh` 的 `src` 不得 import `node:fs` / `node:fs/promises` / `fs`，要数据就调 core；
3. `packages/core` 不得出现 `entitled` / `paid` / `tier` 一类商业化分支（词边界、大小写不敏感；V1 没有付费能力）。

## 加一个新配置键（三件套，缺一即红）

1. `packages/core/src/config/config.ts` 的 `configSchema` 与 `Config` 接口；
2. `CONFIG_TEMPLATE`（`mem init` 生成的模板，测试会比对默认值）；
3. `docs/config.md` 键表（`docs-schema-keys` 门禁双向比对）。

policy.json 的字段同理，改 `policySchema` + `docs/policy.md`。

## 数据格式约定（v1.4 起）

- 记忆 frontmatter 是**每行 `key: <JSON 值>`**，解析 = 行切分 + `JSON.parse`；不写 YAML 解析器，也不引 YAML 依赖；
- `mem_schema: 2` 新增可选 `project`/`tags`/`relations`（`relates_to`/`derived_from`；`supersedes` 独立）；解析器仍接受 `1`，旧记录不重写；
- `error_signatures` **只允许字面子串**，不写正则（ReDoS 与不可复现）；
- `supersedes` 是**数组**，文件创建后不可变；删除、决定、入账、审计统一写 `.state/journal/`，不写回旧文件。

## 测试

- 用 `node:test` + `node:assert/strict`，文件放 `packages/*/test/*.test.ts`；
- `npm test` 走 `scripts/test.mjs`；受限会话里用 `node scripts/test.mjs`；
- 验收项写成测试，不写"检查一下"。新阶段的验收清单应逐条对应一个用例名；
- 涉及 DSH 的阶段完成前跑 `npm run compat`（本机、真实安装，结果记 ADR，不进 CI）。

## 失败姿态

- 启动失败**响亮**：非零退出、点名文件与键、给下一步提示（`mem doctor` / `mem init` / `mem policy seal --accept`）；
- 不写"没人问就直接继续"的降级分支；
- 捕获异常时不许 `catch {}` 吞掉后再报成功；
- 环境/权限类问题先看 [docs/ops.md](docs/ops.md)：本机没有 PowerShell 7（`pwsh` 不可用，用 `powershell.exe`），沙箱内不能改 DACL（权限修复与回滚必须非受限运行），回滚是真还原。

## 提交与阶段

- 一个 S 阶段一条主提交，提交信息英文；**不自动提交**，等明确指令；
- 每个阶段在 `docs/adr/` 留一条决策记录（改了什么、为什么、与方案的偏差）；
- **每轮开工前先做对齐**：读 `docs/plan/status.md` 的阶段表、`docs/plan/todo.md`、`docs/plan/open-questions.md`，确认本轮应关闭哪些旧项；把"本轮关闭了 T*/Q*"写进本轮 ADR 的「闭环」段；
- 阶段完成的定义是：`node scripts/stage.mjs <S>` 全绿（ci + smoke + ADR + 验收编号 + **闭环检查**）+ `npm run smoke` 成功；缺一项就别说"完成"；
- **闭环检查**（`scripts/closure.mjs`，已并入阶段门禁）机械地确认：
  - `docs/plan/status.md` 里每个标 ✅ 的阶段都有存在的 ADR 链接与 `docs/history/rounds.md` 中的「第 N 轮」记录；
  - `todo.md` 中阶段不晚于当前的条目不得是 `待办`，`顺延` 必须带括号理由；
  - `open-questions.md` 中"最晚阶段"不晚于当前的条目必须"已解决"或"顺延"；
  - README 仍链接 todo 与 open-questions 两个文件。
- **阶段完成时更新状态与历程**：把 `docs/plan/status.md` 的状态列改成 ✅，并在 `docs/history/rounds.md` 末尾**追加**新一轮（日期、阶段、新增功能、验证方式、ADR）；README 只保留面向用户的内容，只追加不改写历史。

## 数据目录

- 数据目录（`<home>`）在 agent 沙箱之外，只能由宿主侧代码读写；
- 不要为了图方便把测试数据写进真实数据目录，测试用临时目录；
- `mem init` 幂等，不得覆盖已存在的文件。
