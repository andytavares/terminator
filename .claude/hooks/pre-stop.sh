#!/usr/bin/env bash
# Stop hook: enforces format + lint + patch coverage before Claude finishes.
# Non-zero exit blocks the stop and feeds output back to Claude as a new message.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

# Only run if TypeScript source files were modified (staged or unstaged).
CHANGED=$(git diff --name-only HEAD 2>/dev/null | grep -E '\.(ts|tsx)$' | grep -v '\.spec\.' | grep -v '\.test\.' || true)
STAGED=$(git diff --cached --name-only 2>/dev/null | grep -E '\.(ts|tsx)$' | grep -v '\.spec\.' | grep -v '\.test\.' || true)

if [ -z "$CHANGED" ] && [ -z "$STAGED" ]; then
  exit 0
fi

FAILURES=()

# 1. Format
if ! npm run format:check --silent 2>/dev/null; then
  FAILURES+=("FORMATTING: run \`npm run format\` to fix")
fi

# 2. Lint
if ! npm run lint --silent 2>/dev/null; then
  FAILURES+=("LINT: run \`npm run lint\` and fix all errors")
fi

# 3. Patch coverage — uses the existing coverage-final.json if present, otherwise runs tests.
# Running full tests here would be too slow; rely on check-patch-coverage against last run.
if [ -f "$ROOT/coverage/coverage-final.json" ]; then
  if ! node scripts/check-patch-coverage.cjs 2>/dev/null; then
    FAILURES+=("COVERAGE: patch coverage below 80% — run \`npm test\` and add tests for uncovered lines")
  fi
else
  FAILURES+=("COVERAGE: no coverage data found — run \`npm test\` before finishing")
fi

if [ ${#FAILURES[@]} -gt 0 ]; then
  echo "🚫 Pre-stop checks failed. Fix these before finishing:"
  for f in "${FAILURES[@]}"; do
    echo "  ✗ $f"
  done
  exit 1
fi
