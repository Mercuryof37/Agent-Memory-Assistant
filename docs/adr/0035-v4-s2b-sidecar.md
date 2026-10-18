# ADR-0035 · V4.0-S2b：Sidecar 向量缓存与异步检索

- 状态：已实现（ONNX 运行时由用户安装，插件不内置）
- 日期：2026-10-18
- 阶段：V4.0-S2b
- 依据：[V4 方向](../plan/v4-directions.md) §6.3、[ADR-0034](0034-v4-s2a-hybrid.md)

## 问题

ONNX 运行时体积远大于插件包（node 301MB / web 145MB），不能塞进 185KB 的插件 tarball；而 hybrid 查询需要查询向量，纯同步 `recall` 无法等待推理。S2a 只做了 hash 兜底，没有真正的本地模型路径。

## 选择

1. **Sidecar 契约**：用户安装任意向量化命令，按
   `cmd <input.json> <output.json>` 调用；
   - 输入：`{ texts: string[] }`
   - 输出：`{ vectors: number[][] }`（每个 text 一个向量，维度一致）
   - 环境变量 `AGENT_MEMORY_VECTORIZER` 指定命令。
2. **派生缓存** `<home>/.index/embeddings.json`：`{schema:1, provider, dimensions, generated_at, docs:{id:vector}}`；`mem embed --apply` 生成，可随时删除重建。
3. **异步检索**：新增 `MemoryStore.recallAsync`；`recall.hybrid=true` 且缓存/命令可用时，查 BM25 + 缓存向量 + sidecar 查询向量，按 `embedding_weight` 融合。缓存/命令缺失或 sidecar 失败 → 回退纯 BM25 并给出 warning，不静默。
4. **调用面**：DSH service、GUI search、CLI recall、MCP search 走 `recallAsync`；同步 `recall` 保留给 CLI/tests/纯 BM25 路径。
5. **文件 IPC**：sidecar 通过临时 input/output 文件交换，不走 stdio 管道，避免沙箱拒绝 piped child。

## 被否方案

- **把 ONNX 运行时打进插件**：包体从 185KB 变数百 MB，跨平台预编译风险高。
- **进程内同步推理**：会阻塞 UI；且模型加载/下载无法在同步路径完成。
- **hash 向量与 ONNX 缓存混用**：向量空间不同，分数不可比；缓存缺失时直接回退 BM25。

## 证据

- S20.4：临时 fake vectorizer 写入缓存，`recallAsync` 融合命中，无 hybrid warning；
- `mem embed --apply` 写入缓存；`recallAsync` 在缓存/命令缺失时回退并提示；
- 原有同步 `recall` 全部测试不变；`npm test` 271 pass / 1 skip。

## 回滚

- `recall.hybrid=false` 回到纯 BM25；删除 `.index/embeddings.json` 无副作用；
- 删除 `recallAsync` 调用点即可回到同步接口；无数据迁移。
