#!/usr/bin/env bash
# PostToolUse hook on Edit|Write: advisory test-quality nudges.
# Acts ONLY on test files. Greps the edited test for common smells from the
# Google unit-testing standards (hermeticity, interaction testing, mocking,
# non-determinism) and warns to stderr. NEVER blocks — this is a nudge, the
# test-quality-review skill / test-quality-reviewer agent do the real review.
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""')

[ -z "$FILE_PATH" ] && exit 0

# Only act on test files.
case "$FILE_PATH" in
  *_test.go|*_test.py|test_*.py|*.test.ts|*.test.tsx|*.test.js|*.spec.ts|*.spec.tsx|*.spec.js|*_spec.rb) : ;;
  */tests/*|*/__tests__/*|*/spec/*|*/test/*) : ;;
  *) exit 0 ;;
esac

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
# Resolve to an existing file (FILE_PATH may be absolute or repo-relative).
TARGET="$FILE_PATH"
[ -f "$TARGET" ] || TARGET="$ROOT/$FILE_PATH"
[ -f "$TARGET" ] || exit 0

# Each check: a regex and the concept/rule it maps to. Advisory only.
declare -a HITS=()

add_hit() {
  local label="$1" pattern="$2"
  if grep -Eqn "$pattern" "$TARGET" 2>/dev/null; then
    HITS+=("$label")
  fi
}

add_hit "non-hermetic timing (sleep) — see hermetic-tests / test-flakiness" 'sleep\(|Thread\.sleep|time\.Sleep'
add_hit "non-deterministic clock/random — inject it — see hermetic-tests" 'time\.Now\(\)|new Date\(\)|Math\.random|datetime\.now\(\)'
add_hit "interaction testing (verify/called) — prefer state assertions — see state-vs-interaction-testing" 'verify\(|toHaveBeenCalled|assert_called|\.thenReturn'
add_hit "heavy mocking — prefer a fake (real>fake>stub>mock) — see test-doubles" 'mock\(|@mock|@patch|Mockito|jest\.mock|unittest\.mock'
add_hit "network client call in a test — make it hermetic — see hermetic-tests" 'requests\.(get|post|put|delete)\(|http\.(Get|Post)\(|fetch\(|axios\.'

# Real external URL (POSIX ERE has no lookahead, so filter localhost separately).
if grep -Eqn 'https?://' "$TARGET" 2>/dev/null \
   && grep -E 'https?://' "$TARGET" 2>/dev/null | grep -Evq 'localhost|127\.0\.0\.1|example\.(com|org)'; then
  HITS+=("real external URL in a test — make it hermetic — see hermetic-tests")
fi

[ ${#HITS[@]} -eq 0 ] && exit 0

{
  echo "test-quality (advisory) — $FILE_PATH:"
  for h in "${HITS[@]}"; do echo "  • $h"; done
  echo "  These are nudges, not errors. Run the test-quality-review skill for a full pass."
} >&2

exit 0
