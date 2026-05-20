#!/usr/bin/env bash
# Closes all PRs with label 'test-pr-batch', deletes their remote branches,
# and removes the local data directory.

set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

LABEL="test-pr-batch"
DATA_DIR="scripts/test-pr-data"

echo "Fetching PRs with label '$LABEL'..."

PR_NUMBERS=$(gh pr list \
  --label "$LABEL" \
  --state open \
  --limit 200 \
  --json number \
  --jq '.[].number')

if [ -z "$PR_NUMBERS" ]; then
  echo "No open PRs found with label '$LABEL'."
else
  COUNT=$(echo "$PR_NUMBERS" | wc -l | tr -d ' ')
  echo "Found $COUNT PR(s). Closing and deleting branches..."

  for PR in $PR_NUMBERS; do
    BRANCH=$(gh pr view "$PR" --json headRefName --jq '.headRefName')
    echo "  Closing PR #$PR ($BRANCH)..."
    gh pr close "$PR" --delete-branch 2>/dev/null || {
      # --delete-branch may fail if branch already gone; close anyway
      gh pr close "$PR" 2>/dev/null || true
      git push origin --delete "$BRANCH" 2>/dev/null || true
    }
  done

  echo "Closed $COUNT PR(s)."
fi

# Also clean up any leftover local branches from an interrupted generate run
LEFTOVER=$(git branch | grep 'test/pr-batch-' | tr -d ' *' || true)
if [ -n "$LEFTOVER" ]; then
  echo "Deleting leftover local branches..."
  echo "$LEFTOVER" | xargs git branch -D
fi

# Remove data files if directory exists
if [ -d "$DATA_DIR" ]; then
  echo "Removing $DATA_DIR..."
  rm -rf "$DATA_DIR"
  # Remove from git index if tracked
  git rm -r --cached "$DATA_DIR" 2>/dev/null || true
fi

echo "Cleanup complete."
