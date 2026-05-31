---
name: task-decomposition
description: Use when decomposing a feature spec into an ordered task list. Produces entries for .forge/NNN-slug/tasks.md.
---

# Task Decomposition

## Purpose

Convert a feature spec (prose, bullet list, or file path) into a sequence of discrete, independently-verifiable tasks. Each task must be small enough for one implementer pass (rough rule: ≤ 200 lines of change).

## Output schema

Each task entry must have all of the following fields (see `references/task-schema.md`):

- **ID** — sequential, zero-padded: T-001, T-002, …
- **Title** — verb-noun phrase, ≤ 10 words
- **Description** — one paragraph, no implementation details, no file names
- **Acceptance criteria** — ≥ 2 explicit, testable behaviors (not file changes; behaviors observable from outside the implementation)
- **Depends on** — comma-separated IDs, or `(none)`
- **Tags** — one or more of: `production-code` | `docs-only` | `config` | `scaffolding`
- **Touches tested package** — `yes` | `no` | `unknown` (check `.claude/stack.json`; use `unknown` if the file is absent)
- **Touches documented module** — `yes` | `no` | `unknown` (check `.claude/doc-index.json`; use `unknown` if absent)

## Before generating tasks

Call the `find-reuse` skill on any behavior described in the spec. If it returns a matching implementation, do not generate a task for it — note the existing implementation in a comment at the top of the task list instead.

## Ordering rules

- Tasks must be ordered so no task depends on a task with a higher ID.
- Infrastructure and scaffolding tasks come first.
- Schema/data model tasks precede behavior tasks that use them.
- Tests are not separate tasks — they are part of the `production-code` task they cover.

## When to split a task

- It touches more than one production package.
- It requires both a schema change and a behavior change.
- Its acceptance criteria describe more than one distinct user-visible behavior.

## When to merge tasks

- Two tasks differ only in trivial variation (e.g. add field A and add field B to the same struct with no behavior difference).
- One task is a direct, mechanical consequence of another with no independent acceptance criterion.

## Ambiguity handling

Do not resolve ambiguities silently. If a spec section is unclear, prefix the affected task's description with `AMBIGUOUS: <description of what is unclear>`. The `/forge.clarify` command will surface these to the user.
