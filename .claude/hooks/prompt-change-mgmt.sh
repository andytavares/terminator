#!/usr/bin/env bash
# UserPromptSubmit hook: detects change-management intent (renaming/removing/
# migrating a contract that other code depends on) and injects a reminder to use
# the change-management tooling. Mirrors prompt-augment.sh. Advisory only.
# Keep it tight — every line is paid for on every turn.
set -euo pipefail

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""')

LOWER=$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]')
HINT=""

# Removal / retirement intent → deprecation discipline.
if echo "$LOWER" | grep -Eq '\b(deprecat|remove|delete|retire|drop|sunset|get rid of)\b'; then
  HINT="REMINDER: This sounds like retiring something with existing callers. Use the deprecation-plan skill (owner, replacement, milestones) and the change-impact-analyst subagent to size the blast radius before removing anything."
# Rename / migrate / breaking-change intent → LSC + Hyrum's Law.
elif echo "$LOWER" | grep -Eq '\b(rename|migrat|breaking change|change.*(signature|interface|api|schema)|bump.*version|refactor.*(public|exported|api))\b'; then
  HINT="REMINDER: This change likely touches a contract other code depends on. Run the change-impact-analyst subagent to find every caller, then the large-scale-change skill to migrate them yourself (expand→migrate→contract). Watch Hyrum's Law: observable behavior is a contract. Record the decision with trade-off-record if it's hard to reverse."
fi

if [ -n "$HINT" ]; then
  jq -n --arg h "$HINT" '{ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: $h } }'
fi
