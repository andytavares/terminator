#!/usr/bin/env bash
# Heuristic stack detection. Walks the repo and writes .claude/stack.json.
# Idempotent. Conservative — only records signals it can verify.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

has() { [ -e "$1" ]; }
LANGS=()
BUILD_CMDS=()
TEST_CMDS=()
LINT_CMDS=()
FORMAT_CMDS=()

has package.json && {
  LANGS+=("javascript")
  grep -q '"typescript"' package.json && LANGS+=("typescript")
  TEST_CMDS+=("npm test")
  BUILD_CMDS+=("npm run build")
  grep -q '"lint"' package.json && LINT_CMDS+=("npm run lint")
  grep -q '"format"' package.json && FORMAT_CMDS+=("npm run format")
}

has pyproject.toml || has setup.py || has requirements.txt && {
  LANGS+=("python")
  has pytest.ini || grep -q "\[tool.pytest" pyproject.toml 2>/dev/null && TEST_CMDS+=("pytest")
  grep -q "ruff" pyproject.toml 2>/dev/null && LINT_CMDS+=("ruff check .")
  grep -q "black" pyproject.toml 2>/dev/null && FORMAT_CMDS+=("black .")
}

has go.mod && {
  LANGS+=("go")
  TEST_CMDS+=("go test ./...")
  BUILD_CMDS+=("go build ./...")
  LINT_CMDS+=("golangci-lint run")
  FORMAT_CMDS+=("gofmt -w .")
}

has Cargo.toml && {
  LANGS+=("rust")
  TEST_CMDS+=("cargo test")
  BUILD_CMDS+=("cargo build")
  LINT_CMDS+=("cargo clippy")
  FORMAT_CMDS+=("cargo fmt")
}

has pom.xml && { LANGS+=("java"); BUILD_CMDS+=("mvn -B verify"); TEST_CMDS+=("mvn -B test"); }
has build.gradle || has build.gradle.kts && { LANGS+=("java/kotlin"); BUILD_CMDS+=("./gradlew build"); TEST_CMDS+=("./gradlew test"); }
has Gemfile && { LANGS+=("ruby"); TEST_CMDS+=("bundle exec rspec"); LINT_CMDS+=("bundle exec rubocop"); }
has composer.json && { LANGS+=("php"); TEST_CMDS+=("composer test"); }
has mix.exs && { LANGS+=("elixir"); TEST_CMDS+=("mix test"); }

# Makefile wins as the canonical entrypoint if present
has Makefile && {
  grep -E '^test:' Makefile >/dev/null && TEST_CMDS=("make test")
  grep -E '^build:' Makefile >/dev/null && BUILD_CMDS=("make build")
  grep -E '^lint:' Makefile >/dev/null && LINT_CMDS=("make lint")
  grep -E '^fmt:|^format:' Makefile >/dev/null && FORMAT_CMDS=("make format")
}

AST_TOOL=null
command -v ast-grep >/dev/null 2>&1 && AST_TOOL='"ast-grep"'
[ "$AST_TOOL" = "null" ] && command -v semgrep >/dev/null 2>&1 && AST_TOOL='"semgrep"'

LANGS_JSON=$(printf '%s\n' "${LANGS[@]}" | jq -R . | jq -s 'unique')
BUILD_JSON=$(printf '%s\n' "${BUILD_CMDS[@]}" | jq -R . | jq -s 'unique')
TEST_JSON=$(printf '%s\n' "${TEST_CMDS[@]}" | jq -R . | jq -s 'unique')
LINT_JSON=$(printf '%s\n' "${LINT_CMDS[@]}" | jq -R . | jq -s 'unique')
FMT_JSON=$(printf '%s\n' "${FORMAT_CMDS[@]}" | jq -R . | jq -s 'unique')
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)

mkdir -p .claude
jq -n \
  --argjson langs "$LANGS_JSON" \
  --argjson build "$BUILD_JSON" \
  --argjson test "$TEST_JSON" \
  --argjson lint "$LINT_JSON" \
  --argjson fmt "$FMT_JSON" \
  --argjson ast "$AST_TOOL" \
  --arg sha "$COMMIT" \
  '{
    languages: $langs,
    build: { commands: $build },
    test: { commands: $test, command: ($test[0] // null) },
    lint: { commands: $lint, command: ($lint[0] // null) },
    format: { commands: $fmt },
    ast_search_tool: $ast,
    detected_at_commit: $sha,
    detected_at: (now | todate)
  }' > .claude/stack.json

echo "wrote .claude/stack.json"
cat .claude/stack.json | jq '.'
