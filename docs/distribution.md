# 分发与安装（V2 P3）

> 目标：一个 `.tgz` 包，双击/插件页安装，失败可回滚。npm 正式发布留到下一版。

## 1. 打包

```powershell
npm run pack
```

产物：`release/agent-memory-dsh-<version>.tgz`（当前 `0.1.0`）。

包内必须包含三部分（`scripts/pack.mjs` 会检查）：

| 路径 | 作用 |
|---|---|
| `package/dist/plugin.mjs` | 宿主半层（工具、注入、API 路由、审批） |
| `package/client/client.js` | 客户端半层（侧栏「记忆」+ 工作台） |
| `package/cordis.patch.yml` | 插件挂载补丁 |

其余：`locale/*.json`、`dist/plugin.mjs.map`。

## 2. 安装

### 2.1 图形界面（推荐）

1. DSH → 设置 → 插件（Plugins）；
2. 选择「从文件安装」/ Install from file，选中 `.tgz`；
3. 重启 DSH（完整退出，不是关窗口）；
4. 侧栏出现「记忆」图标即成功。

### 2.2 命令行

```powershell
dsh plugin add "D:\Ai Agent\Agent Memory\release\agent-memory-dsh-0.1.0.tgz"
```

DSH 会写入当前 profile 的 `package.json` 并执行安装；用 `dsh plugin list` 确认。

### 2.3 开发期链接（不用打包）

```powershell
npm run plugin:install     # 链接 packages/dsh 到 desktop profile
npm run plugin:revert      # 还原 profile 备份
```

## 3. 升级

1. 打新包（版本号先改 `packages/dsh/package.json`）；
2. 插件页卸载旧版 / 安装新 tgz；
3. 重启，`mem doctor` 检查数据与注入预算。

数据在 `~/.dsh/memory`，升级不迁移、不覆盖；包只换代码。

## 4. 回滚

- 安装脚本在修改 profile 前会备份 `package.json` 与 `cordis.patch.yml`（见 `scripts/install-desktop-plugin.mjs`）；
- 插件页卸载后，用备份还原并重启；
- 或 `npm run plugin:revert`（开发链接模式）。

## 5. 卸载

1. 插件页卸载；
2. 数据目录**不会**被删除；确认要删时手动处理 `~/.dsh/memory`；
3. 重启。

## 6. 已知限制

- 当前包 `private: true`，只出 tgz，不发 npm；正式发布时改 `private` 并补 README/LICENSE。
- 客户端半层是手写 loader bundle；P3 之后迁到 TS 构建，包的 `client/client.js` 路径保持不变。
- 安装后若侧栏不出现：先在插件页确认「已启用」，再完整重启；仍不行看 DSH 日志里的模块加载错误。
