---
name: agent-memory-retro
description: 回顾当前开发轮次，提炼事实/坑/经验并用 memory_propose 新建提案，等待人审批
whenToUse: 用户要求回顾本轮、沉淀记忆、总结事实/坑/经验，或执行 /mem-fact、/mem-pitfall、/mem-exp 时
user-invocable: true
---

# 本轮回顾 → 记忆提案

把**当前这一轮开发**中真实发生、值得长期保留的内容，写成 Agent Memory 的待审提案。

## 边界

- 只回顾**当前开发轮次**：从本轮用户请求开始，到现在的对话、工具调用与代码改动；不要翻旧会话凑数。
- 只写用户要求的类型：`/mem-fact` → `fact`，`/mem-pitfall` → `pitfall`，`/mem-exp` → `exp`。
- **不直接写库**：不调用 `memory_record`；只调用 `memory_propose` 的 `op: "create"`。是否采纳由人在「记忆 → 提案」决定。
- 没有值得记录的内容就直说「本轮暂无<类型>」，不要编造。

## 步骤

1. 调用 `memory_context`（必要时多取一些，最多 50）拿到本轮事件的 `seq` 与原文。
2. 按要求的类型筛选，最多 3 条；每条写成：
   - `abstract`：一句话，≤ 40 字，能当列表标题；
   - `body`：发生了什么 / 为什么重要 / 怎么复用；
   - `evidence`：1–2 条真实事件 `{ event_seq, quote }`，`quote` 必须来自该事件。
3. 坑（`pitfall`）还要补 1–3 条 `error_signatures`：报错里固定不变的片段，**字面匹配，不写正则**。
4. 调用：

```json
{
  "op": "create",
  "replacements": [
    {
      "kind": "fact | pitfall | exp",
      "abstract": "一句话",
      "body": "正文",
      "evidence": [{ "event_seq": 123, "quote": "原话" }],
      "error_signatures": ["仅坑需要"]
    }
  ],
  "reason": "本轮回顾（/mem-<类型>）"
}
```

5. 只回复一句：创建了几条 + 「去『记忆 → 提案』审批」。不替人采纳，不修改 RULES，不碰 SOUL。

## 质量检查

- 摘要是否单行、≤40 字？
- 是否只含本轮内容？是否与已有记忆重复（内容去重会跳过）？
- 证据的 `event_seq` 是否真实、`quote` 是否来自该事件？
- 坑的错误特征是否是可稳定匹配的字面片段？
