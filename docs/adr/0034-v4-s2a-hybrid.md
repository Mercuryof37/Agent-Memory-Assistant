# ADR-0034 · V4.0-S2a：混合检索骨架（ONNX 延到 S2b）

- 状态：S2a 已实现；S2b（ONNX 推理）待定
- 日期：2026-10-18
- 阶段：V4.0-S2
- 依据：[V4 方向](../plan/v4-directions.md) §6.3

## 问题

检索只有 BM25，V4 要求本地 embedding + hybrid。但直接把 ONNX 运行时塞进插件会改变发布形态：

- `onnxruntime-node` 解包约 **301 MB**，`onnxruntime-web` 约 **145 MB**；
- 插件 tarball 目前 185 KB、运行时零依赖；把原生运行时打进包会破坏安装体验；
- 模型（≤150MB）还需要下载、校验、缓存与版本固定。

所以先做不依赖模型的检索骨架，把接口和评测固定下来，再决定 ONNX 以何种形态交付。

## S2a 选择

1. **Provider 接口**：`EmbeddingProvider.embed(text) -> Float32Array`；`HashEmbeddingProvider` 是确定性、零依赖的兜底（词 + 字符 n-gram 哈希到 256 维），用于 CI/离线，不冒充语义模型。
2. **融合**：`fuseScores` 对 BM25（已归一化）与向量余弦做加权；`recall.hybrid` 默认 **false**，`recall.embedding_weight` 默认 400（千分制）。
3. **存储**：开启 hybrid 时 `recall` 在同一活动集上算 BM25 + 向量并融合；关闭时行为与 V3 完全一致。
4. **评测**：保留既有 `scripts/eval.mjs` 基线；S2b 接入 ONNX 后在同一 fixture 上比对，不先改分数口径。

## 被否方案

- **直接把 301MB `onnxruntime-node` 放进插件包**：安装体积与跨平台预编译风险过大；用户接受的是“模型 ≤150MB”，不是“运行时 300MB”。
- **用假语义分数冒充 ONNX**：会把“记得准”变成不可验证的宣传；S2a 明确标注 hash 兜底。
- **立即改 `mem_schema`/索引格式**：S2a 不落盘向量，零迁移；S2b 再把向量缓存放进 `.index/` 派生目录。

## S2b 待定选项（需要拍板）

1. **Sidecar CLI**：`mem embed` 用可选安装的 `onnxruntime-node` + 模型目录，插件只读向量缓存；插件包保持小。
2. **Optional dependency**：`@agent_memory/dsh` 加 optionalDependencies，首次安装拉运行时；包体积变为数百 MB。
3. **WASM**：`onnxruntime-web`（约 145MB）跨平台，但 Node 下性能与兼容性需实测。

推荐 1：本地优先、插件包不膨胀；模型/运行时由用户显式安装或首次下载。

## 证据

- 新增 S20.1（hash 确定性/归一化）、S20.2（融合权重）、S20.3（hybrid recall 走同一活动集）；
- `npm test` 270 pass / 1 skip；`npm run ci` 全绿。
- 配置新增两键，`docs/config.md`、模板、测试同步（26 键）。

## 回滚

- `recall.hybrid = false` 即回到纯 BM25；配置键可保留，读取无副作用。
- 删除 embedding/hybrid 模块与测试即可；无数据迁移。
