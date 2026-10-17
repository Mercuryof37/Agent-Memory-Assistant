# 未决问题

每条标"最晚解决阶段"；阶段门禁时清零，或带标记延续。

| # | 问题 | 最晚阶段 | 现状 |
|---|---|---|---|
| Q1 | M2：压缩后注入段**字节稳定** | S3 | **已解决**：rc.2 压缩后 section 未变（ADR-0003 §5.5）；同会话快照字节一致由 S3 测试锁定 |
| Q2 | `ctx.tokenMeter.estimateMessage` 对四段文本的定价方式 | S3 | **已解决（core 层）**：装配接受 `measure` 回调，无回调按 `chars / 2.5` 估算并标 `estimated`；真实 `tokenMeter` 定价在 S4 接线时复验 |
| Q3 | `recall.min_score` 的 BM25 归一化口径（千分制） | S3 | **已解决**：按查询内最高分归一化到 0..1，`min_score` 千分制；基线见 ADR-0007 |
| Q4 | 锁的 PID 复用风险 | S7 | 目前只比较 PID + 心跳；PID 复用且心跳陈旧时会误判存活。备份/恢复演练时再评估加进程启动时间 |
| Q5 | `doctor` 的 4（隔离）是否要区分"可 adopt"与"损坏" | S2b | **已解决**：`doctor` 列出每个隔离 id 与原因；可解析但未入账的文件可 `mem adopt`，解析失败则只能人工修 |
| Q6 | `mem inspect --audit` 的渲染格式 | S7 | journal 已可 `formatJournalEntry`；CLI 入口留 S7 |
| Q7 | Windows 目录项不 fsync 的实际影响 | S7（备份演练） | 已写进 README 的承诺边界；S7 的恢复演练再确认 |
| Q8 | home 本身是 junction/符号链接 | S7 | S2b 只校验输入形状与 id 形状（id 永远是 `mem-...`），不解析 home 的真实路径；V1 接受，备份/发布时再评估 |
| Q9 | `mem delete` 的 agent 通道 | S4 | S2b 只有人直接调用的 CLI；S4 接入提案后，agent 侧只能走 `decide` |

> 上表每条对应的修复落点与验收，见 [todo.md](todo.md)（T1–T13）。
