# 发布检查单（v0.2.0 起）

> 发布是高风险动作：先 `.tgz` + GitHub Release，再 npm；每一步失败都能回滚。

## 0. 版本与内容

1. 改 `packages/dsh/package.json` 的 `version`（SemVer）；
2. 在 `CHANGELOG.md` 顶部加 `## [x.y.z] - YYYY-MM-DD`；
3. 确认 `private: false`、`license`、`repository`、`files` 完整；
4. `npm run build` 生成 `dist/plugin.mjs` 与 `client/client.js`。

## 1. 本地门禁

```powershell
npm run ci
node scripts/stage.mjs S7
npm run pack
```

`pack` 会检查 tarball 内三件套（宿主/客户端/patch）；内容缺失即失败。

## 2. 干净 profile 演练

在非日常 profile（或备份后）依次验证：

1. 设置 → 插件 → 从文件安装 `.tgz`；
2. 完整重启 DSH；
3. 侧栏「记忆」出现，列表/新建/提案各走一次；
4. 卸载，重启，侧栏消失；
5. 回滚：`node scripts/setup.mjs --revert <backupDir>` 或插件页重装旧版。

## 3. 一键安装（可选）

```powershell
node scripts/setup.mjs            # dry run
node scripts/setup.mjs --apply    # 写入 profile、pnpm add、追加 bundle
node scripts/setup.mjs --revert "<backupDir>"
```

`setup` 会先备份 `package.json` / `cordis.patch.yml` / `pnpm-lock.yaml` 到
profile `.backups/agent-memory-<timestamp>/`，失败按提示回滚；需要普通终端
（沙箱不能写外部路径）。

## 4. npm 发布

```powershell
npm login
npm publish ./packages/dsh --provenance --access public
```

或在 GitHub 仓库设置变量 `NPM_PUBLISH=true` 并推送 tag `v0.2.0`，
`.github/workflows/release.yml` 会跑 ci、打包、上传 GitHub Release，
再执行 `npm publish --provenance`（需要 `NPM_TOKEN` secret）。

## 5. GitHub Release

1. `git tag v0.2.0 && git push origin v0.2.0`；
2. CI 会创建 Release 并附 `release/agent-memory-dsh-0.2.0.tgz`；
3. 手工补 Release Notes（从 CHANGELOG 摘）；
4. 校验 tarball SHA256，写进 Release 说明。

## 6. 回滚

- npm：`npm deprecate @agent-memory/dsh@x.y.z "broken, use x.y.w"`，不要删除版本；
- GitHub：Release 标记 pre-release / 从 tag 重建；
- 用户侧：插件页卸载重装旧 `.tgz`，数据目录不动。
