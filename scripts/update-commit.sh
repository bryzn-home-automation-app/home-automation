#!/usr/bin/env bash
# Writes current git commit hash to .git-commit file.
# Run before committing/pushing so the hash is baked into the repo.
# Falls back gracefully when .git is absent (e.g. NUC file copy).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT_FILE="$REPO_DIR/.git-commit"

if git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    COMMIT=$(git -C "$REPO_DIR" rev-parse --short HEAD)
    echo "  commit: $COMMIT"
else
    COMMIT=$(cat "$COMMIT_FILE" 2>/dev/null || echo "unknown")
    echo "  commit: $COMMIT (no .git — kept existing)"
fi

echo "$COMMIT" > "$COMMIT_FILE"
