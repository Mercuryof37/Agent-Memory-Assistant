# Changelog

All notable changes to Agent Memory are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows
SemVer.

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
