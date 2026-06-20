#!/usr/bin/env bash
# Stop hook: enforces format + lint + patch coverage before Claude finishes a turn.
# Exit 1 + stdout output blocks the stop and feeds the message back to Claude.

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

# Only run when TypeScript source files were changed.
CHANGED=$(git diff --name-only HEAD 2>/dev/null | grep -E '\.(ts|tsx)$' | grep -v '\.(spec|test)\.' || true)
STAGED=$(git diff --cached --name-only 2>/dev/null | grep -E '\.(ts|tsx)$' | grep -v '\.(spec|test)\.' || true)

if [ -z "$CHANGED" ] && [ -z "$STAGED" ]; then
  exit 0
fi

FAILURES=""

# 1. Format
if ! npm run format:check 2>/dev/null 1>/dev/null; then
  FAILURES="$FAILURES\n  ✗ FORMATTING: run \`npm run format\` to fix"
fi

# 2. Lint
LINT_OUT=$(npm run lint 2>&1) || {
  ERRORS=$(echo "$LINT_OUT" | grep -c "error" || true)
  if [ "$ERRORS" -gt 0 ]; then
    FAILURES="$FAILURES\n  ✗ LINT: $ERRORS error(s) — run \`npm run lint\` and fix them"
  fi
}

# 3. Patch coverage (only if coverage data exists from the last test run)
if [ -f "$ROOT/coverage/coverage-final.json" ]; then
  if ! node scripts/check-patch-coverage.cjs 2>/dev/null 1>/dev/null; then
    FAILURES="$FAILURES\n  ✗ COVERAGE: patch coverage below 80% — run \`npm test\` and add tests"
  fi
else
  FAILURES="$FAILURES\n  ✗ COVERAGE: no coverage data — run \`npm test\` before finishing"
fi

if [ -n "$FAILURES" ]; then
  printf "🚫 Pre-stop checks failed. Fix before finishing:%b\n" "$FAILURES"
  exit 1
fi
