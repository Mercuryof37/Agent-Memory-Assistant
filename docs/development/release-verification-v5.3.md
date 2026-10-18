# 发布流程验收记录（0.5.3）

> 日期：2026-10-18 · 环境：Windows / Node 25 · 结论：本地门禁通过，待提交/tag/npm

## 1. 门禁

| 项 | 结果 |
|---|---|
| `npm run ci` | ✅ 296 tests（295 通过 + 1 跳过） |
| `node scripts/stage.mjs S7` | ✅ green / closure ok |
| `npm run smoke` | ✅ smoke ok |
| `npm run build` | ✅ dist + client |
| `npm run pack` | ✅ `release/agent_memory-dsh-0.5.3.tgz` |

## 2. 审批门禁验证

- `memory_propose` 只创建 pending，不调用 review hook；
- `memory_review` 才打开审批卡片；
- answer 的 proposal id 不匹配 → defer，不执行 decide；
- decide 后复核 pending；仍存在则返回失败，不报“已采纳”；
- 本机数据：`confirm`，journal 无 `cb219152`，无 `DS-MEM-TEST-01` 记忆文件。

## 3. tarball

```text
agent_memory-dsh-0.5.3.tgz
size    227752 bytes
SHA256  B56C98B4196AFC841B88FC8D482A529444D30C86D67C34F69FBCD86425871D23
```

## 4. 发布步骤

1. 提交 `Harden proposal approval gate`；
2. `git tag v0.5.3 && git push origin main v0.5.3`；
3. `npm publish ./packages/dsh --access public`；
4. 轮询 `npm view @agent_memory/dsh@0.5.3 version`；
5. 核对 GitHub Release 附件 SHA256。
