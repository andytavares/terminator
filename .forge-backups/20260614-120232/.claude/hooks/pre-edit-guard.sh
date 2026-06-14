#!/usr/bin/env bash
# PreToolUse hook on Edit|Write: enforces TDD ONLY for packages that already
# have test coverage. Legacy packages with zero tests are skipped — backfill
# is a separate decision, not something this hook should force.
set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""')

[ -z "$FILE_PATH" ] && exit 0

# Skip non-source files
case "$FILE_PATH" in
  *.md|*.txt|*.json|*.yaml|*.yml|*.toml|*.lock|*.gitignore|*Dockerfile*) exit 0 ;;
  *_test.go|*test_*.py|*.test.ts|*.test.tsx|*.test.js|*.spec.ts|*.spec.tsx|*.spec.js|*_spec.rb) exit 0 ;;
  */tests/*|*/__tests__/*|*/spec/*|*/test/*) exit 0 ;;
esac

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PKG_DIR="$(dirname "$FILE_PATH")"
BASE=$(basename "$FILE_PATH")
STEM="${BASE%.*}"
EXT="${BASE##*.}"

# Determine if the package has ANY existing tests. If not, this is a legacy
# package with zero coverage — don't gate on TDD here. Surface the gap once
# (via stderr in non-blocking mode) and let the human decide whether to
# backfill before changing it.
TEST_PATTERNS=(
  "*_test.go" "*.test.ts" "*.test.tsx" "*.test.js"
  "*.spec.ts" "*.spec.tsx" "*.spec.js"
  "test_*.py" "*_test.py" "*_spec.rb"
)

PKG_HAS_TESTS=0
for pat in "${TEST_PATTERNS[@]}"; do
  if compgen -G "$ROOT/$PKG_DIR/$pat" > /dev/null 2>&1; then PKG_HAS_TESTS=1; break; fi
  if compgen -G "$ROOT/$PKG_DIR/__tests__/*" > /dev/null 2>&1; then PKG_HAS_TESTS=1; break; fi
  if compgen -G "$ROOT/$PKG_DIR/tests/*" > /dev/null 2>&1; then PKG_HAS_TESTS=1; break; fi
done

if [ "$PKG_HAS_TESTS" -eq 0 ]; then
  # Non-blocking warning: log to stderr for visibility, allow the edit.
  echo "pre-edit-guard: package $PKG_DIR has no existing tests; TDD enforcement skipped. Consider backfilling coverage before further changes." >&2
  exit 0
fi

# Package has tests — enforce that a corresponding test exists for THIS file
CANDIDATES=(
  "${PKG_DIR}/${STEM}_test.${EXT}"
  "${PKG_DIR}/${STEM}.test.${EXT}"
  "${PKG_DIR}/${STEM}.spec.${EXT}"
  "${PKG_DIR}/__tests__/${STEM}.${EXT}"
  "${PKG_DIR}/__tests__/${STEM}.test.${EXT}"
  "${PKG_DIR}/tests/test_${STEM}.${EXT}"
)

for c in "${CANDIDATES[@]}"; do
  if [ -e "$ROOT/$c" ]; then exit 0; fi
done

# Allow if a session marker says a test was just written
MARKER="$ROOT/.claude/.tdd-session-tests"
if [ -f "$MARKER" ] && grep -q "$STEM" "$MARKER" 2>/dev/null; then
  exit 0
fi

# Block — package has tests, but this file doesn't. Write one first.
REASON="Package $PKG_DIR has tests but no test covers $BASE. The harness enforces TDD in tested packages. Write a failing test via the test-author subagent first, then retry."
jq -n --arg r "$REASON" '{ decision: "block", reason: $r }'
exit 0
