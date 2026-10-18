# ADR-0026 · V3.0：独立视觉令牌与组件层

- 状态：已实现（V3.0 首版，待真实桌面复验）
- 日期：2026-10-18
- 阶段：V3.0
- 依据：[V3.0 方案](../plan/v3-visual-and-workflows.md) §3

## 问题

V2 的界面直接使用宿主 `--dsw-*` 变量加 fallback，明暗切换与排版都跟着宿主走；没有自己的设计系统，改一处颜色要翻整个文件，也无法做独立视觉。

## 选择

1. **令牌层** `client/src/styles.ts`：`--am-*`（背景/表面/边框/文字/强调/三类型色/圆角/阴影/字体/行高），`[data-am-theme="dark"]` 覆盖；`GLOBAL_CSS` 定义 `.am-root/.am-page/.am-header/.am-toolbar/.am-input/.am-btn/.am-row/.am-badge/.am-card/.am-empty/.am-skeleton/.am-overlay/.am-modal` 与响应式（≤960px 缩边距）。
2. **主题**：默认跟随 `prefers-color-scheme`，用户可在标题右侧 ☾/☀ 切换；选择存 localStorage（键 `agent-memory:theme`），不写宿主配置；根节点 `data-am-theme` 驱动。
3. **组件层** `client/src/components.ts`：`AmButton`（primary/ghost/danger/icon）、`AmBadge`、`AmEmpty`、`AmSkeleton`；先覆盖工具条、徽章、加载态，其余逐页替换。
4. **字体/密度**：标题 24px，正文 14px，元信息 12px；行高 46px；卡片 1px 边框 + 14px 圆角；只给弹层阴影；动效 140–200ms。
5. **接入**：`apply()` 注入 `GLOBAL_CSS`；工作台根节点 `am-root am-memory-scroll`；页面容器 `am-page`；不再在组件里写死宿主变量。

## 被否方案

- **继续跟宿主变量**：无法做独立视觉，也无法保证明暗一致。
- **引入 UI 库/主题框架**：为一个插件引入整套依赖不划算；esbuild + CSS 足够。
- **多套主题/主题市场**：用户已拍板只要一套明/暗。

## 证据

- `ci` 全绿：**249 个测试**。新增 `S16.1` 断言令牌层含暗色选择器、响应式与 `prefers-reduced-motion`；`S13.1` 断言 `am-root/am-page/data-am-theme/am-btn/am-skeleton/--am-accent` 与明暗切换文案。
- 客户端构建成功；V2 的滚动条、8 条折叠、详情置顶、切换收起逻辑保持。

## 偏差与回滚

- 首版只替换工具条/徽章/加载/页面容器；详情内的部分按钮仍用旧 inline 样式，V3.1 统一。
- 暗色依赖 `color-mix`（Electron 新版本支持）；旧宿主会回退到透明滑块。
- 回滚：删除 `styles.ts`/`components.ts`，恢复 `--dsw-*` fallback 与旧按钮样式。
