# ADR-0008 · S4 工具、权限与审批

- 状态：已完成
- 日期：2026-10-17
- 阶段：S4（计划 4.5–5.5 人日；实际 1 个工作日，AI 辅助，含测试）
- 依据：[V1.0-开发方案-v1.3.md](../research/V1.0-开发方案-v1.3.md) §5、§6.4；[ADR-0007](0007-s3-recall-inject-rules.md)

## 问题

S3 有了召回与注入，但模型还没有写入口；提案、决定、扫描、来源绑定都只存在于文档里。S4 要把"模型只能从一个门进出"变成可测试的接口：5 个严格工具、T0/T1 权限、扫描不可关闭、来源可核验、删除只能走提案。

## 选择

1. **工具表**：`memory_recall`、`memory_read`、`memory_record`、`memory_propose`、`memory_context`、`rules_list`；schema 严格（`additionalProperties:false`），字段名不含 `path`/`target`/`session`/`approve`，每个工具带 `output {schema, render}`（宿主强制要求）；`decide` 永不注册为工具。`memory_context` 是 S4 收口后补的只读工具：返回最近事件的 `{seq, speaker, preview}`，解决“模型看不到 event_seq”的可用性问题。
2. **权限**：`delegationDepth > 0` 只注册读工具；T0 每会话配额用尽后拒绝并提示改用提案；写工具不暴露删除，删除只能 `memory_propose` + 人 `decide`。
3. **扫描不可关闭**：不可见/双向字符、`sk-`/`AKIA`/私钥/连接串、注入模式、`<private>`；错误只含规则 id 与字段名，不含命中原文；`add` 与 `adopt` 共用同一扫描。
4. **提案账本**：`proposals/pending/<id>.json` + journal `decide`；`base_hash` 缺失/不符 → 拒绝；supersede 一次写多条（`addMany`），写文件失败先删除已写文件再抛错，**不部分提交**；采纳失败保留提案。
5. **来源绑定**：模型只给 `{event_seq, quote}`；适配器解析真实事件、拒绝 assistant 消息、校验 quote 子串与事件哈希。
6. **CLI**：`mem proposals`、`mem decide <id> accept|reject`；accept 需 `--accept`（缺则退出码 3），与工具共用同一 store。
7. **插件接线**：`apply` 优先打开真实 store，注册工具 + 真实注入 section；启动失败（无 store、策略/封存异常）回退到 S0 探针，避免拖垮宿主。core 静态打进 `dist/plugin.mjs`，bundle 契约改为"无第三方 import，Node 内置模块允许"。

## 被否方案

- **注册 `memory_delete` 工具**：等于给模型 T1 直删能力；删除必须经提案与人决定。
- **扫描只做记录不拒绝**：与"不可关闭"矛盾；拒绝记录也不含原文，避免二次泄漏。
- **supersede 逐条独立提交**：中途失败会留下半个替换集；选择 `addMany` + 文件回滚。
- **插件继续用零 import 契约**：真实工具必须读写 store，只能把 core 打进 bundle；用测试约束"无第三方 import"。

## 证据

- **172 个测试**通过；`npm run ci` 含 gates + rules-file + typecheck + build + test。
- S4.1 工具表快照 / S4.2 红队参数表 / S4.3 来源伪造 / S4.4 base_hash 与不部分提交 / S4.5 扫描 / S4.6 子 agent、配额、CLI 一致，均有具名用例。
- **真实宿主验证**：headless 一次性 profile（`link:` 插件）里 `memory_recall`、`rules_list` 均调用成功；桌面会话工具表出现全部 6 个工具（含补上的 `memory_context`）。
- **桌面端端到端写入**：`memory_context` 取到 seq 5676 → `memory_record` 用该 seq 与原文“好了”写入 `mem-20261017-522c1546`；`memory_read` 读回 provenance（session、event_seq、speaker=user、event_sha256），`memory_recall` 命中且 `provenance_verifiable: true`；文件落在 `~/.dsh/memory/memories/fact/`。
- `node scripts/stage.mjs S4` 全绿（ci + smoke + ADR + 验收编号 + 闭环检查）。

## 偏差与回滚

- ~~写工具仍缺来源解析~~：已解决。适配器优先用 `ctx.sessionPersistence`，桌面组合没有该服务时回退到 live session（`ctx.sessions.get(id).eventAt(seq)`），plan §5.3 允许这条回退；`memory_context` 解决模型选不对 seq 的可用性问题。
- **真实桌面重启已做**：桌面端工具表、`memory_context`、`memory_record`、`memory_read`、`memory_recall` 均已实测。
- **bundle 契约放宽**：S3 的"零 import"改为"无第三方 import"；`dist/plugin.mjs` 约 116 KB。
- 回滚：移除 `scan/`、`proposals/`、`actor.ts`、`service/quota.ts`、`dsh/src/tools.ts|service.ts` 的接线，`plugin.ts` 回到探针；数据侧 `proposals/pending` 与 journal `decide` 行可保留，旧代码会忽略。
