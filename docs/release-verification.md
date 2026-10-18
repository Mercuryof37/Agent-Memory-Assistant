# 发布流程验收记录（0.2.0）

> 日期：2026-10-18 · 环境：Windows / Node 24 · 结论：**本地可发布；对外发布动作待人工执行**

## 1. 门禁

| 项 | 结果 |
|---|---|
| `npm run ci` | ✅ 257 个测试（256 通过 + 1 跳过） |
| `node scripts/stage.mjs S7` | ✅ green（closure 通过） |
| `npm run pack` | ✅ 产出 `release/agent-memory-dsh-0.2.0.tgz` |

## 2. 包内容

`npm publish ./packages/dsh --dry-run` 显示 `@agent-memory/dsh@0.2.0`、9 个文件：

```text
client/client.js
cordis.patch.yml
dist/plugin.mjs
dist/plugin.mjs.map
LICENSE
locale/en.json
locale/zh.json
package.json
README.md
```

元数据：`private:false`、`license: MIT`、`publishConfig.access: public`、repository/homepage/bugs 指向 GitHub；`files` 含 README/LICENSE（S18.1 覆盖）。

## 3. tarball 校验

```text
agent-memory-dsh-0.2.0.tgz
SHA256 526FD7AF6703F516FFA1B41A1E079E48E5628903633E4EC70118B7D87BA89E79
```

把 tarball 安装到临时目录（`.tmp/pkg-install`）成功，解出 `client/`、`dist/`、`locale/`、`README.md`、`LICENSE`、`cordis.patch.yml`、`package.json`。

## 4. 一键安装

- 对真实 profile 的 **dry run** 正确识别：依赖将由 `link:D:\Ai Agent\Agent Memory\packages\dsh` 替换为 `file:agent-memory-dsh-0.2.0.tgz`，bundle 已存在；
- 对临时 profile（`.tmp/fake-profile`）执行 `--apply`：
  - 备份到 `.backups/agent-memory-<timestamp>/`；
  - pnpm add 成功，安装 `@agent-memory/dsh@0.2.0`；
  - dependency 写成 `file:...tgz`，`dsh.profile.bundles` 追加成功；
- `--revert <backup>` 还原 `package.json`/patch/lock 并重新 pnpm install，成功；
- 修复：`setup.mjs` 读取 `package.json` 时去掉 UTF-8 BOM（Windows 工具写出的文件可能带 BOM）。

**未对真实 desktop profile 执行 `--apply`**——那会把开发期 link 换成 tgz，需你确认。

## 5. GitHub / npm 流水线

- `.github/workflows/release.yml`：tag `v*` → ci → pack → 上传 artifact → GitHub Release；
- 发布 job：仓库变量 `NPM_PUBLISH=true` 时 `npm publish --provenance`，已加 `id-token: write`（provenance 必需）与 `NPM_TOKEN`；
- **2026-10-18 CI 结果**：run #5（`f3a69a3` / tag `v0.2.0`）**Success**，21s；artifact `agent-memory-tgz` 181 KB，`sha256:a3eff4398b8105927e84546ac1faeef6285a988c4b81ce17e6162bf7cde047f8`；
- npm publish job 未运行（未设 `NPM_PUBLISH=true`）。

### CI 平台修复记录（三次失败 → 通过）

1. `package-lock.json` 的 workspace 版本仍是 0.1.0 → 刷新到 0.2.0；
2. `startup.test.ts` 写死 Windows 路径 → 改为按平台取绝对路径；
3. `build.mjs` 在 Linux 上找错 esbuild 位置（实际在 `@esbuild/linux-x64/bin/esbuild`）→ 依次探测 `bin/`、包根、`.bin`；`pack.mjs` 的 npm 解析同时改为 `npm_execpath`/PATH，兼容 Linux。

## 6. 待人工完成

1. 设置 → 插件 用 0.2.0 tgz 在干净 profile 装/卸/回滚各一次（最终 UX 验收）；
2. `npm login` 后 `npm publish ./packages/dsh --provenance --access public`（或配 `NPM_TOKEN` + `NPM_PUBLISH=true`）。

## 7. 已知限制

- `pack.mjs` 的 tar 内容检查在沙箱内因 `spawnSync tar EPERM` 跳过；`npm publish --dry-run` 已替代确认内容。
- setup 写入的 dependency 是绝对 `file:` 路径，适合本机，不适合共享；正规安装仍走插件页/npm。
- 包版本 0.2.0，但 CLI/MCP 的版本输出仍是 0.1.0（仅影响 `--version` 文案）。
