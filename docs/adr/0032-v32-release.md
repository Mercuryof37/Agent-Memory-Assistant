# ADR-0032 · V3.2：正式发布与一键安装

- 状态：已实现（发布动作本身未执行）
- 日期：2026-10-18
- 阶段：V3.2
- 依据：[V3.0 方案](../plan/v3-visual-and-workflows.md) §5、[ADR-0020](0020-v2-p3-distribution-mcp.md)

## 问题

V2 只会 `npm run pack` 出一个本地 tgz，包元数据还是 `private: true`、没有 LICENSE/CHANGELOG，也没有可回滚的一键安装脚本；发布只能靠手工记忆。

## 选择

1. **发布元数据**：`packages/dsh` 升到 `0.2.0`、`private: false`、MIT、repository/homepage/bugs、keywords、`engines.node >=24`、`publishConfig.access=public`；包内带 `README.md`、`LICENSE`。
2. **一键安装脚本** `scripts/setup.mjs`：
   - 默认 dry run；`--apply` 才写；
   - 找到 `release/` 最新 tgz（或 `--tgz`），定位 desktop profile；
   - 把 `package.json` / `cordis.patch.yml` / `pnpm-lock.yaml` 备份到 profile `.backups/agent-memory-<timestamp>/`；
   - `pnpm add <tgz>` → 校验 `node_modules/@agent-memory/dsh` → 追加 `dsh.profile.bundles`；
   - `--revert <backupDir>` 还原并 `pnpm install`。
3. **发布流水线** `.github/workflows/release.yml`：tag `v*` → 安装依赖 → ci → pack → 上传 artifact → GitHub Release；仓库变量 `NPM_PUBLISH=true` 时 `npm publish --provenance`（需 `NPM_TOKEN`）。
4. **发布检查单** `docs/release.md`：版本/CHANGELOG → 门禁 → 干净 profile 演练 → npm → GitHub Release → 回滚；`CHANGELOG.md` 记录 0.2.0 内容。

## 被否方案

- **自研安装器下载/解压**：宿主插件页已支持 tgz/npm；setup 只做"无 UI 的等价动作"。
- **直接改 `node_modules`**：会被下一次 pnpm install 冲掉；必须走依赖 + bundle 列表。
- **发布动作自动化到无人工**：npm token 与 release 变量由人控制；CI 默认只做 dry-run 工件。

## 证据

- `ci` 全绿：**257 个测试**。新增 `S18.1`（包名/0.2.0/private=false/MIT/publishConfig/files）、`S18.2`（setup 的 --revert/add/backups、CHANGELOG 0.2.0、workflow 的 npm publish --provenance）。
- `npm run pack` 产出 `release/agent-memory-dsh-0.2.0.tgz`；`node scripts/setup.mjs` dry run 正确识别 desktop profile、当前 link 依赖与已有 bundle。
- 未执行 `--apply`、`npm publish`、tag：需要用户明确指令与凭据。

## 偏差与回滚

- setup 依赖宿主 profile 的 pnpm 与 Electron 的 bundle 约定；DSH 升级若改 profile 结构需同步调整。
- npm 包名若已被占用，发布会失败；先 `npm view @agent-memory/dsh` 检查。
- 回滚：删除 workflow/setup，恢复 `private: true` 与 0.1.0；已发布版本用 deprecate 而不是删除。
