# 发布流程验收记录（0.5.0）

> 日期：2026-10-18 · 环境：Windows / Node 25 · 结论：本地门禁通过，待推送 tag / npm 发布

## 1. 门禁

| 项 | 结果 |
|---|---|
| `npm run ci` | ✅ 290 tests（289 通过 + 1 跳过） |
| `node scripts/stage.mjs S7` | ✅ green / closure ok |
| `npm run smoke` | ✅ smoke ok |
| `npm run pack` | ✅ `release/agent_memory-dsh-0.5.0.tgz` |
| `mem verify --deep`（真实库） | ✅ ok |

## 2. 包内容

`npm publish ./packages/dsh --dry-run` 预期 9 个文件：

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

## 3. tarball

```text
agent_memory-dsh-0.5.0.tgz
size    223669 bytes
SHA256  849174B0FA9F91739D9FC2A8AD2F8E727C12984573D13DBD74DBB6D225C57E28
```

## 4. 10k 性能

| 模式 | 总耗时 | 单条 |
|---|---|---|
| `addMany --batch 1000` | 26.2s | 2.62 ms |
| `addAsync --group` | 24.3s | 2.43 ms |
| 逐条同步 add（1k） | — | 29.9 ms |

## 5. 发布步骤

1. 提交 `Release 0.5.0`；
2. `git tag v0.5.0 && git push origin main v0.5.0`；
3. GitHub Actions 如配置 `NPM_PUBLISH=true` 自动发布；否则
   `npm publish ./packages/dsh --provenance --access public`；
4. 校验 `npm view @agent_memory/dsh version`，轮询具体版本（202 响应不代表完成）；
5. 核对 GitHub Release 附件 SHA256 与上面一致。

## 6. 回滚

- npm：`npm deprecate @agent_memory/dsh@0.5.0 "..."`，不删版本；
- GitHub：tag 重建/标 pre-release；
- 用户侧：插件页卸载重装 0.4.0 `.tgz`，数据目录不动。
