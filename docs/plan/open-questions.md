# 未决问题

每条标"最晚解决阶段"；阶段门禁时清零，或带标记延续。

| # | 问题 | 最晚阶段 | 现状 |
|---|---|---|---|
| Q1 | M2：压缩后注入段**字节稳定** | S3 | **已解决**：rc.2 压缩后 section 未变（ADR-0003 §5.5）；同会话快照字节一致由 S3 测试锁定 |
| Q2 | `ctx.tokenMeter.estimateMessage` 对四段文本的定价方式 | S3 | **已解决（core 层）**：装配接受 `measure` 回调，无回调按 `chars / 2.5` 估算并标 `estimated`；真实 `tokenMeter` 定价在 S4 接线时复验 |
| Q3 | `recall.min_score` 的 BM25 归一化口径（千分制） | S3 | **已解决**：按查询内最高分归一化到 0..1，`min_score` 千分制；基线见 ADR-0007 |
| Q4 | 锁的 PID 复用风险 | S7 | **顺延（V1.1）**：Node 无跨进程启动时间 API；锁仍保证“超时失败、绝不覆盖” |
| Q5 | `doctor` 的 4（隔离）是否要区分"可 adopt"与"损坏" | S2b | **已解决**：`doctor` 列出每个隔离 id 与原因；可解析但未入账的文件可 `mem adopt`，解析失败则只能人工修 |
| Q6 | `mem inspect --audit` 的渲染格式 | S7 | **已解决（最小可用）**：`mem inspect` 显示最近 N 条 journal；全量 `--audit` 渲染顺延 V1.1 |
| Q7 | Windows 目录项不 fsync 的实际影响 | S7（备份演练） | **已解决（边界确认）**：export/`SHA256SUMS`/恢复校验通过；仍不承诺断电零丢失 |
| Q8 | home 本身是 junction/符号链接 | S7 | **顺延（V1.1）**：未实现 realpath 规范化；当前只校验输入形状与 id 形状 |
| Q9 | `mem delete` 的 agent 通道 | S4 | **已解决**：工具表无 delete；agent 只能 `memory_propose`，人用 `mem decide` 采纳/否决；`decide` 不是工具 |

> 上表每条对应的修复落点与验收，见 [todo.md](todo.md)（T1–T13）。
