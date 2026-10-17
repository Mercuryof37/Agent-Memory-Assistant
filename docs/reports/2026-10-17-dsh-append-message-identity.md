# DSH 缺陷报告：`Session#append` 接受匿名 message，重放时整段会话不可读

- 报告日期：2026-10-17
- 上游版本：DeepSeek Harness 桌面端 **0.2.1-rc.2**（`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-session-persistence-jsonl`、`@deepseek-ai/dsh-agent-loop` 同批）
- 严重度：中（不丢字节，但整段会话从"能打开"变成"永久打不开"；任何插件/命令都能触发）
- 本地状态：已在 Agent Memory 探针侧绕过并修复被污染的日志；上游修复待确认

## English summary（可直接粘贴给上游）

**Title:** `Session#append` stores a `user/message` without `id` and replay then rejects the whole session.

**Repro:** a command handler calls `agent.followup({ role: 'user', content: [...], source: { kind: 'user' } })` (no `id`). The turn works and the JSONL log records `{"type":"user/message","seq":10,…, "data":{"role":"user","content":[…],"source":{"kind":"user"}}}`. On the next cold open, history fails with:

```text
stored session "session-…" is corrupt: stored session "session-…" failed validation:
Error: session event at seq 10 lacks an identified message
```

**Cause:** write and replay disagree. `Session#append()` runs `validateSessionEventData()` only (it never checks message identity), while `snapshotSessionEvent()` / stored-log replay run `adoptSessionEvent()` → `assertMessageEventShape()`, which requires `data.id` to be a non-empty string and `role` to match the event type. One anonymous event therefore bricks a session that was valid at the moment it was written — the opposite of what `append()`'s own docstring promises ("a bad event fails at the append site rather than later during a backend flush").

**Suggested fix (either):**

1. In `Session#append()`, run `assertMessageEventShape()` for `isMessageEventType(type)` (cheap, symmetric with replay), or
2. Make `agent.followup()/send()` accept only `createUserMessage()` output, or stamp `id`/`role` for a bare input.

**Workaround used here:** the producer supplies `id: crypto.randomUUID()`; existing logs were repaired by adding the missing ids (see below).

## 复现细节

1. 插件注册一个命令，handler 里 `agent.followup()` 一条手工拼的消息（有 `role`/`content`/`source`，无 `id`）。
2. 当轮一切正常：模型收到消息并回复；日志新增一条 `user/message`。
3. 退出应用，重新打开该会话 → 历史加载失败，错误如上；**会话本身没有物理损坏**（所有 zstd 帧可解、`seq` 连续）。

同一版本的探针还遇到过更早的形状：连 `role` 都没有，供应商直接 422（`missing field role`），但那条消息同样被成功写进了日志，事后同样打不开（报 `message must have role "user"`）。两次都说明写入侧不校验消息身份/角色。

## 根因（源码位置）

| 阶段 | 路径 | 行为 |
|---|---|---|
| 写 | `@deepseek-ai/dsh-session` `Session#append` | 调 `validateSessionEventData`，**不**调 `assertMessageEventShape` |
| 快照 | 同包 `snapshotSessionEvent` → `adoptSessionEvent` | 调 `assertMessageEventShape`，无 `id` 即抛 |
| 冷读 | `dsh-session-persistence-jsonl` `validateStoredEvents` → `adoptSessionEvent` | 同上，包成 `SessionPersistenceCorruptionError` |

`assertMessageEventShape` 的判定（节选）：

```js
const message = type === "user/message" ? record : record?.["message"];
if (typeof message !== "object" || message === null || typeof message["id"] !== "string" || message["id"] === "")
  throw new Error(`${subject} lacks an identified message`);
```

## 影响

- 一条坏事件 → 整段会话（本机案例 752 条事件、~50 轮）无法再打开；UI 侧只能删除或人工修文件。
- 触发面不限于第三方插件：任何绕过 `createUserMessage()` 的 followup / steer / inject 调用都会命中，包括未来的命令、定时任务、子 agent 续轮。
- 与「事件日志是唯一真相」的定位冲突：写入成功意味着承诺可回放，实际不可回放。

## 本地修复（供对照）

1. 生产端补身份：`agent.followup({ id: crypto.randomUUID(), role: 'user', content, source })`；单测断言 UUID 且每次不同。
2. 存量日志修复：解析串联 zstd 帧（首帧必须是单独一行 header），只给缺 `id` 的 `user/message` 补 UUID（必要时把 `role` 改成 `user`），其余字节保持；修复后用 `validateStoredEvents` 复核为 `VALIDATION: OK`。

工具：`scripts/repair-dsh-session.mjs`（默认 dry-run）+ `scripts/lib/session-repair.mjs`；流程见 [docs/ops.md §6.5](../ops.md)，决策记录见 [ADR-0003 §5.7](../adr/0003-dsh-compat.md)。

## 建议的回归用例（上游）

- 用一条缺 `id` 的 `user/message` 直接 `session.append()`：期望在 append 抛出；
- 用 `snapshotSessionEvent` 对同一条事件：现有实现会抛，可确认口径一致；
- 用缺 `role` 的 followup 消息：期望在 `followup`/`send` 入口拒绝，而不是让供应商 422 并落盘。
