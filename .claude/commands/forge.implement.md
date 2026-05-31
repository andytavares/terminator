---
description: Execute a feature's task list in an isolated git worktree at .worktrees/NNN-slug/, routing each task to the correct workflow
---

Implement feature: $ARGUMENTS

If $ARGUMENTS is empty, use the highest-numbered folder in `.forge/`.
If $ARGUMENTS is a number (e.g. `001`), resolve it to the matching `.forge/NNN-*` folder.

1. Read `.forge/NNN-slug/tasks.md`. If it does not exist, stop: "No task list found. Run /forge.tasks first."
2. Read `.forge/NNN-slug/clarifications.md` if it exists. If absent, note it and continue.
3. Run the `implement-plan` skill to validate the dependency graph, resolve routing fields, and confirm no AMBIGUOUS tasks are unresolved. If any check fails, report all blockers and stop.
4. Print the full routing plan (one line per task: ID, title, route).
5. Create a git worktree on branch `forge/NNN-slug` at `.worktrees/NNN-slug/`. All remaining edits happen inside it.
6. Execute ALL tasks in ID order using the routing table — do not pause between tasks:
   - `production-code`, tested package → `/forge.tdd` with task title + acceptance criteria
   - `production-code`, tested package + documented module → `/forge.tdd` then `/forge.docs-sync`
   - `production-code`, untested, documented → `implementer` subagent + `code-reviewer` + `/forge.docs-sync`
   - `production-code`, untested, not documented → `implementer` subagent + `code-reviewer`
   - `docs-only` → `/forge.docs-sync`
   - `config` or `scaffolding` → `implementer` subagent + `code-reviewer`
     If the pre-edit-guard hook fires on a task routed to implementer-direct, re-tag it `production-code` and re-route to `/forge.tdd`.
7. After ALL tasks complete: run `code-reviewer` against the full cumulative diff. Collect all issues.
8. Present an end-of-run summary via AskUserQuestion using the structured format (label + tradeoff note):
   - If no issues: options are "Accept — branch is clean / Next: push or open a PR", "Push and open PR now / Opens a PR against main", "Discard worktree / Removes .worktrees/NNN-slug/, branch preserved"
   - If issues found: first summarise each issue as a bullet, then offer "Fix issues now / Re-runs code-reviewer after fixes", "Accept as-is / Skips fixes, branch ready for review", "Discard worktree / Removes local worktree"
9. On acceptance: report `Branch forge/NNN-slug is ready at .worktrees/NNN-slug/.`
   Note: `.worktrees/` is gitignored. Commit `.forge/NNN-slug/` artifacts separately if desired.
