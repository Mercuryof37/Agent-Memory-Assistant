# 发布流程验收记录（0.5.4）

> 日期：2026-10-18 · 环境：Windows / Node 25 · 结论：本地门禁通过，待提交/tag/npm

## 1. 门禁

| 项 | 结果 |
|---|---|
| `npm run ci` | ✅ 296 tests（295 通过 + 1 跳过） |
| `node scripts/stage.mjs S7` | ✅ green / closure ok |
| `npm run smoke` | ✅ smoke ok |
| `npm run build` | ✅ dist + client |
| `npm run pack` | ✅ `release/agent_memory-dsh-0.5.4.tgz` |

## 2. 提醒验证

- `memory_propose` 返回值含 `status: "pending"` 与 `reminder`；
- 渲染文本明确写“请到【记忆 → 提案】查看并点击采纳/驳回”；
- 不弹卡、不 decide；
- S9.1 断言 reminder 含“记忆 → 提案”和提案编号。

## 3. tarball

```text
agent_memory-dsh-0.5.4.tgz
size    228231 bytes
SHA256  751C597B3FCEC63E7B24203DE9B134C5F8DF5FB932517B008D03143DED7E5A83
```

## 4. 发布步骤

1. 提交 `Remind users to review proposals`；
2. `git tag v0.5.4 && git push origin main v0.5.4`；
3. `npm publish ./packages/dsh --access public`；
4. 轮询 `npm view @agent_memory/dsh@0.5.4 version`；
5. 核对 GitHub Release 附件 SHA256。
