---
description: Scaffold a managed deprecation (owner, replacement, milestones, removal) using the deprecation-plan skill
---

Run the `deprecation-plan` skill for: $ARGUMENTS

Use the `change-impact-analyst` subagent to size the caller set first. Write the plan to
`.forge/deprecations/NNN-slug.md`. If no argument is given, ask what is being deprecated.
