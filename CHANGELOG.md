# Changelog

All notable changes to Agent Memory are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows
SemVer.

## [Unreleased]

### Added

- A first-time install guide that needs no pnpm, plus a chat prompt that
  downloads the release tarball and stops before the required restart.

### Changed

- A store directory reached through a junction or symlink is now refused at
  startup unless `--allow-junction` (or `AGENT_MEMORY_ALLOW_JUNCTION=1`) is
  given; once allowed, the canonical real path is used everywhere.

### Fixed

- Each memory kind renders in one capped scroll viewport instead of a split
  list with a "scroll down" hint.

## [0.5.4] - 2026-10-18

### Added

- `memory_propose` now returns a pending reminder and the tool output explicitly
  tells the user to approve in **Memory → Proposals**; it still never decides.

## [0.5.3] - 2026-10-18

### Security

- `memory_propose` now only creates a pending proposal; it no longer opens a
  review card or returns a `review` decision in the same tool call.
- A review answer whose question id does not match the proposal is discarded
  (defer), and a successful decide is re-checked against the pending list before
  reporting acceptance.

## [0.5.2] - 2026-10-18

### Fixed

- Update check no longer surfaces `SyntaxError` when the local GUI route or a
  registry returns plain text; it reports the HTTP status and a short snippet.
- Client parses update responses defensively and tells the user to fully
  restart DSH when the update route is not registered.

## [0.5.1] - 2026-10-18

### Added

- Explicit update check in Preferences (npm registry, npmmirror fallback, 8s
  timeout, semver comparison).
- One-click upgrade through the host plugin manager with an exact
  `@agent_memory/dsh@x.y.z` spec; manual fallback when no manager is available.
- GUI routes `/api/agent-memory/update/check` and `/update/apply`.

### Security

- No background polling, no silent install; upgrade rejects URLs and arbitrary
  specs; only a version greater than the running one is accepted.

## [0.5.0] - 2026-10-18

### Added

- Checkpoint state (`.state/checkpoint.json`) with HMAC, Merkle roots and
  tail-only startup; removing it falls back to the full journal.
- Journal archiving (`mem maintain`) with 50k hot-line threshold, gzip
  segments, archive metadata and root-only retention after 365 days.
- Read-path caches (BM25 index, parsed docs, recall fast path) and incremental
  write path; `addAsync` group commit and `addMany` batch WAL.
- `mem verify [--deep]` for checkpoint/HMAC, journal chain and archived
  sha256/seq/Merkle checks.
- `scripts/bench.mjs` (`--batch`, `--group`) and crash-point tests S24/S25/S26/S27/S28.

### Changed

- Reference derived files are coalesced above 1000 records; checkpoints every
  1000 journal lines.
- HMAC key missing is a read-only error instead of silently regenerating.
- Archive deletes originals only after the archive index is durable.

### Security

- Default HMAC-protected checkpoint root; key stored in
  `.state/checkpoint.key` and included in backups.

## [0.4.0] - 2026-10-18

### Added

- v1.4 memory metadata: `project`, `tags`, `relations` (`relates_to`/`derived_from`);
  `mem_schema: 2` with `mem_schema: 1` read compatibility.
- User-created project registry (`projects.json`) and `mem project list|add`.
- Export bundle v2 (v1 imports still accepted).
- Hybrid recall scaffold: `recall.hybrid`, `recall.embedding_weight`, deterministic
  local embedding fallback (ONNX provider in S2b).
- Sidecar embedding cache (`mem embed --apply`, `AGENT_MEMORY_VECTORIZER`) and
  async hybrid recall with BM25 fallback.
- LongMemEval-style offline subset evaluation (`npm run eval:longmem`).
- Mem0 import (`mem import-mem0`), `source` metadata, Memory API v1 header and
  reconciled MCP documentation.
- Project worktree UI (L0–L2): project cards, project tree, focus relation graph
  and similarity hints.
- Project deletion (memories fall back to 未归类) and multi-select move between
  projects.

### Changed

- Sidebar icon now matches the host's line-icon style.
- Documentation split into a command-free user manual and a technical
  developer manual.

## [0.2.1] - 2026-10-18

### Changed

- npm scope renamed to `@agent_memory/dsh` to match the available npm
  organization; install name and `cordis.patch.yml` updated. No functional
  changes since 0.2.0.

## [0.2.0] - 2026-10-18

### Added

- DSH client workbench: grouped memory list (8 per group + scroll), detail,
  search, JSON export/import, manual create, revise/delete, proposals with
  detail toggle, profile and RULES editors, SOUL path with one-click seal.
- Proposal `create` operation and three retro commands (`/mem-fact`,
  `/mem-pitfall`, `/mem-exp`) backed by the `agent-memory-retro` skill.
- Independent `am-*` visual system (Chrome palette, light/dark, skeleton,
  responsive toolbar), built from TypeScript sources.
- MCP stdio server (`mem mcp`) with read + proposal tools; VS Code/Codex setup
  documented.
- Content-only dedupe, `valid_from` ordering, hard delete (purge with
  superseded ancestors), backup import, one-click tgz packaging.

### Changed

- Deletes are hard deletes; journal keeps an audit line without content.
- Conversation provenance is no longer rendered in the UI.
- Snapshot schema v4 with per-section health.

### Security

- RULES can only be saved from the GUI (human click); SOUL is never edited by
  the plugin. MCP has no decide/record tool.

## [0.1.0] - 2026-10-17

- Initial S0–S14 milestone: local store, injection snapshot, tools, approval
  cards, CLI, profile, session history, doctor/ops, presets.
