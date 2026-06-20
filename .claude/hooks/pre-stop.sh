#!/usr/bin/env bash
# Stop hook: enforces format + lint + patch coverage before Claude finishes a turn.
# Exit 1 + stdout blocks the stop. Must ALWAYS exit 0 or 1 — never any other code.
# set -euo pipefail is intentionally absent: we capture individual exit codes so all
# checks run and are reported together, rather than aborting on the first failure.

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 0

# Only run when TypeScript source files were changed.
CHANGED=$(git diff --name-only HEAD 2>/dev/null | grep -E '\.(ts|tsx)$' | grep -vE '\.(spec|test)\.' || true)
STAGED=$(git diff --cached --name-only 2>/dev/null | grep -E '\.(ts|tsx)$' | grep -vE '\.(spec|test)\.' || true)

if [ -z "$CHANGED" ] && [ -z "$STAGED" ]; then
  exit 0
fi

FAILURES=""

# 1. Format
npm run format:check >/dev/null 2>&1
FORMAT_EXIT=$?
if [ "$FORMAT_EXIT" -ne 0 ]; then
  FAILURES="${FAILURES}\n  ✗ FORMATTING: run \`npm run format\` to fix"
fi

# 2. Lint
npm run lint >/dev/null 2>&1
LINT_EXIT=$?
if [ "$LINT_EXIT" -ne 0 ]; then
  FAILURES="${FAILURES}\n  ✗ LINT: errors found — run \`npm run lint\` and fix them"
fi

# 3. Patch coverage
if [ -f "$ROOT/coverage/coverage-final.json" ]; then
  node scripts/check-patch-coverage.cjs >/dev/null 2>&1
  COV_EXIT=$?
  if [ "$COV_EXIT" -ne 0 ]; then
    FAILURES="${FAILURES}\n  ✗ COVERAGE: patch coverage below 80% — run \`npm test\` and add tests"
  fi
else
  FAILURES="${FAILURES}\n  ✗ COVERAGE: no coverage data — run \`npm test\` before finishing"
fi

if [ -n "$FAILURES" ]; then
  printf "🚫 Pre-stop checks failed. Fix before finishing:%b\n" "$FAILURES"
  exit 1
fi

exit 0
