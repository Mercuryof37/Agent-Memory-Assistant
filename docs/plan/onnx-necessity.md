# ONNX 与本地模型：必要性调研

> 日期：2026-10-18 · 结论：**当前证据不足以把 ONNX 设为默认**；先做“难查询”对照实验，再决定是否投入模型。

## 1. 现状

- V4.0-S2 已提供 sidecar 契约（`AGENT_MEMORY_VECTORIZER`）与向量缓存；插件不内置运行时。
- S2c 的 LongMemEval-style 子集（24 条 / 10 问）结果：**BM25 与 hash-hybrid 都是 recall@5 1.0、MRR 0.7917、弃答误报 0**。
- 这说明夹具太容易，**不能证明语义模型有收益**；hash-hybrid 只是兜底，不代表 ONNX 效果。

## 2. ONNX 能带来什么、代价是什么

| 维度 | 事实 |
|---|---|
| 收益场景 | 同义改写、跨语言（中文记忆/英文查询）、抽象与正文用词不同、长会话中“意思相近但词不同” |
| 运行时 | `onnxruntime-node` 解包约 301MB；`onnxruntime-web` 约 145MB |
| 模型 | `all-MiniLM-L6-v2` FP32 ONNX 约 90MB；INT8 约 23MB；中文 `bge-small-zh-v1.5` 同量级；多语言 e5-small 原模型约 470MB，INT8 后才接近 150MB 上限 |
| 查询延迟 | 进程内 CPU 推理通常几十 ms；当前 sidecar 每次 spawn + 文件 IPC 约 100–300ms，必须做常驻/缓存 |
| 维护 | 模型版本、tokenizer、维度、缓存失效、校验和、许可（Apache-2.0 为主） |
| 默认开启风险 | 安装体积、首次下载失败、离线不可用、平台二进制差异 |

参考：
- [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
- [bge-small-zh-v1.5](https://huggingface.co/BAAI/bge-small-zh-v1.5)
- [multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small)
- [ONNX Runtime quantization](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)
- [FeatherDB 在 LongMemEval 上的嵌入式检索结果](https://huggingface.co/blog/Sri-Vigneshwar-DJ/featherdb-longmemeval-v080)（说明检索质量与数据/任务强相关，不能直接外推）
- [Joplin embedding-models 模型清单](https://github.com/joplin/embedding-models)

> 体积为公开资料的量级估算；落地时以固定 revision + 实际下载校验为准。

## 3. 关键判断

**ONNX 不是“更高级所以必须加”，而是“当 BM25 在真实查询上明显不够时”的补丁。**

- 如果用户查询与记忆用词高度重合（当前夹具），BM25 已足够；
- 如果用户常用“换个说法”提问，或记忆是中文、查询是英文，BM25 会漏；
- 嵌入模型也会引入新失败模式：模型下载失败、向量缓存过期、跨语言模型选错、低分噪声被当成语义相关。

## 4. 先做 Go/No-Go 实验（建议 1–2 天）

1. 增加 30 条**改写/跨语言**查询（不改现有夹具），例如：
   - 记忆“esbuild 在 Linux 的二进制在 bin 下”，查询“为什么 CI 找不到 esbuild”；
   - 记忆中文偏好，查询英文 `Which package manager does the user prefer?`；
   - 记忆“发布失败先看具体步骤”，查询“CI 报错时应该先查什么”。
2. 同一批查询跑 BM25、hash-hybrid、ONNX（MiniLM 或 bge-small）三路。
3. 指标：recall@5、MRR、弃答误报、P95、显存/内存、首次下载耗时。
4. 判定：
   - ONNX recall@5 比 BM25 **高 ≥10 个点**，且弃答误报不升高 → 值得做默认可选；
   - 高 3–10 个点 → 只作为高级开关，不默认；
   - 低于 3 个点 → **不加模型**，优先做同义词/别名/查询扩展。

## 5. 若要做，推荐的最小实现

1. **模型**：中文优先 `bge-small-zh-v1.5`；混合语言用多语言 e5-small 的 INT8 版本；英文可用 MiniLM。固定 revision 与 SHA256。
2. **量化**：动态 INT8，目标模型 ≤150MB；先在 30 条查询上验证掉点。
3. **Sidecar 常驻**：不要让每次 recall 都 spawn；`mem embed serve` 或本地 HTTP/Unix socket，模型只加载一次。
4. **缓存**：
   - 文档向量 `.index/embeddings.json`，按 `model_id + dim + tokenizer_version` 失效；
   - 查询向量内存 LRU（规范化后哈希），避免重复编码；
   - 新增/删除只增量更新，不每次全量重建。
5. **只对 top-k 重排**：BM25 先取 20，ONNX 只重排/融合 top 20，控制成本。
6. **失败回退**：模型/运行时/缓存任一不可用 → 纯 BM25 + warning；绝不静默空结果。

## 6. 结论

- **V4.0 不把 ONNX 设为默认**；保持 sidecar 可选，先把“难查询”实验做完。
- 当前最该投入的不是模型，而是**评测的真实性**：现有夹具已饱和，继续加 hash/ONNX 只会得到 1.0 的假信号。
- 模型是 V4.x 的候选增强，不是 V4.0 发布阻塞项；0.3.0 可以先发，实验通过后再出 `0.3.x` 可选模型包。

## 7. 待拍板

1. 先做 30 条改写/跨语言查询实验（推荐），还是直接上 ONNX？
2. 模型优先级：中文（bge-small-zh）还是混合语言（e5-small INT8）？
3. 是否接受 sidecar 常驻进程（内存常驻约 100–300MB）？
