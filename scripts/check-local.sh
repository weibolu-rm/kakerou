#!/usr/bin/env bash
# Private acceptance check: run diary_digest against a copy of the real vault.
# The copy lives in gitignored fixtures/local/ — real diary content stays private.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/make-local-fixtures.sh"
node "$ROOT/tests/digest-one.ts" "$ROOT/fixtures/local"
