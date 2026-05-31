# Routing Rules Reference

## Priority order for multi-tag tasks

When a task has more than one tag, apply rules in this order:

1. If `production-code` is present → TDD route is mandatory when `Touches tested package: yes`. The `pre-edit-guard` hook enforces this; it will fire and block an `implementer-direct` pass on a tested file.
2. If `Touches documented module: yes` → append `/forge.docs-sync` after the implementation step, regardless of other tags.
3. If `docs-only` → `/forge.docs-sync` only; no implementer step.
4. If `config` or `scaffolding` (without `production-code`) → `implementer` direct + `code-reviewer`. No TDD (no runtime behavior to test-drive).

## The "unknown" resolution rule

`unknown` means the routing file was absent or the task's files could not be matched at planning time. Resolution:

- **`Touches tested package: unknown`** → read `.claude/stack.json` → field `test_entrypoints`. If any entry path-prefix matches the task's likely output files, resolve to `yes`. If not, resolve to `no` and note the gap in the pre-flight report.
- **`Touches documented module: unknown`** → read `.claude/doc-index.json` → field `referenced_code_paths`. Same matching rule. If the index file is absent, resolve to `no` and note.

Resolving `unknown` to `no` is a conservative default: it may under-trigger doc-sync (low risk) and may under-trigger TDD (higher risk, caught by the pre-edit-guard hook at execution time).

## Hook interaction

The `pre-edit-guard.sh` hook fires before any file edit in a package that has test coverage. If the hook fires on a task routed to `implementer-direct`, the task was misclassified:

- Re-tag the task as `production-code`.
- Set `Touches tested package: yes`.
- Re-route to `/forge.tdd`.

This is the intended behavior — the hook acts as a safety net for misclassified tasks.

## Worktree note

All implementation steps run inside the worktree at `.worktrees/NNN-slug/`. When `/forge.tdd` or `/forge.docs-sync` are invoked as sub-commands, they operate on the worktree's working tree, not the main repo. The main repo's `HEAD` is not modified until the user merges the worktree branch.
