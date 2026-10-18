# 发布流程验收记录（0.5.1）

> 日期：2026-10-18 · 环境：Windows / Node 25 · 结论：本地门禁通过，待提交/tag/npm

## 1. 门禁

| 项 | 结果 |
|---|---|
| `npm run ci` | ✅ 294 tests（293 通过 + 1 跳过） |
| `node scripts/stage.mjs S7` | ✅ green / closure ok |
| `npm run smoke` | ✅ smoke ok |
| `npm run build` | ✅ dist + client |
| `npm run pack` | ✅ `release/agent_memory-dsh-0.5.1.tgz` |

## 2. 新功能验证

- S29.1：registry 版本解析 + semver 比较；
- S29.2：一键升级只传 `@agent_memory/dsh@0.6.0` 精确 spec；
- S29.3：没有宿主插件管理服务时 fail-closed，提示手动更新；
- GUI 路由测试包含 `/api/agent-memory/update/check`、`/update/apply`；
- 真实 registry 检查：当前 `0.5.1`，发布前 latest 仍为 `0.5.0`（符合预期）。

## 3. tarball

```text
agent_memory-dsh-0.5.1.tgz
size    227159 bytes
SHA256  F1182197B42F1FA76BDD4EB1FE69C0BB4900A65868B695B3AD9C0E69957C4C22
```

## 4. 已知限制

- Desktop 包操作归 Desktop shell 所有；没有 `pluginManager` 服务时只能手动更新；
- 升级后需要完整重启 DSH；
- 检查更新依赖外网。

## 5. 发布步骤

1. 提交 `Release 0.5.1`；
2. `git tag v0.5.1 && git push origin main v0.5.1`；
3. `npm publish ./packages/dsh --access public`；
4. 轮询 `npm view @agent_memory/dsh@0.5.1 version`，确认 latest；
5. 核对 GitHub Release 附件 SHA256。
