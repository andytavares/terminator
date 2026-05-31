#!/usr/bin/env bash
# UserPromptSubmit hook: appends a small context block to the user's prompt.
# Keep it tight — every line is paid for on every turn.
set -euo pipefail

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""')
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Detect "build new thing" intent and remind about find-reuse
LOWER=$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]')
HINT=""
if echo "$LOWER" | grep -Eq '\b(add|create|implement|build|introduce|write a|new (helper|function|module|class|util))\b'; then
  HINT="REMINDER: Before writing new code, run the find-reuse skill to look for existing implementations."
fi

# Output as JSON: additionalContext is added to the model's view
if [ -n "$HINT" ]; then
  jq -n --arg h "$HINT" '{ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: $h } }'
fi
