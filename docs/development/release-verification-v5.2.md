# 发布流程验收记录（0.5.2）

> 日期：2026-10-18 · 环境：Windows / Node 25 · 结论：本地门禁通过，待提交/tag/npm

## 1. 门禁

| 项 | 结果 |
|---|---|
| `npm run ci` | ✅ 295 tests（294 通过 + 1 跳过） |
| `node scripts/stage.mjs S7` | ✅ green / closure ok |
| `npm run smoke` | ✅ smoke ok |
| `npm run build` | ✅ dist + client |
| `npm run pack` | ✅ `release/agent_memory-dsh-0.5.2.tgz` |

## 2. 修复验证

- S29.4：registry 返回纯文本 `not found` → 报 `non-JSON`，不再 `SyntaxError`；
- 客户端检查/升级响应先按文本解析，非 JSON 给出 HTTP 状态与片段；
- 检查更新接口未注册时，提示完整重启 DSH，而不是把 `"not found"` 当 JSON。

## 3. tarball

```text
agent_memory-dsh-0.5.2.tgz
size    227408 bytes
SHA256  A23BBB7D91BDA22F55739831C5AC55BC1A20C09BF702A61B4F969B2B8F4AE07D
```

## 4. 发布步骤

1. 提交 `Fix update check error handling`；
2. `git tag v0.5.2 && git push origin main v0.5.2`；
3. `npm publish ./packages/dsh --access public`；
4. 轮询 `npm view @agent_memory/dsh@0.5.2 version`；
5. 核对 GitHub Release 附件 SHA256。
