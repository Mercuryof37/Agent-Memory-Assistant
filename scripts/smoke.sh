#!/usr/bin/env bash
# Success path that must actually run before anyone says "done" (R4 in RULES.md).
# The work lives in smoke.mjs so it also runs where bash is unavailable (this
# machine has no bash); this wrapper keeps the documented `scripts/smoke.sh`
# entry point for POSIX shells.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$root/scripts/smoke.mjs"
