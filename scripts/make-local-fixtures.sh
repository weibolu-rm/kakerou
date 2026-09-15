#!/usr/bin/env bash
# Copy the real diary vault into fixtures/local/ for private, gitignored testing.
# Read-only on the vault: copies files out, never writes or deletes anything there.
set -euo pipefail

VAULT="${DIARY_VAULT_DIR:-$HOME/Documents/diary-vault}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/fixtures/local"

if [ ! -d "$VAULT" ]; then
  echo "Vault not found: $VAULT" >&2
  echo "Set DIARY_VAULT_DIR to override." >&2
  exit 1
fi

mkdir -p "$DEST"
rm -f "$DEST"/*.md
cp "$VAULT"/*.md "$DEST/"
echo "Copied $(ls "$DEST" | wc -l | tr -d ' ') markdown files to $DEST"
