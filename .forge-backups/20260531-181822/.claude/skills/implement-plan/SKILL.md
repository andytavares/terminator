---
name: implement-plan
description: Use before executing a task list to validate dependencies, resolve routing fields, and produce a per-task routing plan. Pre-flight for /forge.implement.
---

# Implement Plan

## Purpose

Validate `.forge/NNN-slug/tasks.md` and produce a concrete routing decision for every task before any code is written. Catch structural problems early.

## Pre-flight checks

Run all four checks. Report pass/fail for each. Stop on any failure and list all blockers before execution starts.

1. **Dependency graph is a DAG** — scan every "Depends on" field. If T-003 depends on T-005, that is a cycle violation. Report the specific IDs.
2. **No missing dependencies** — every ID referenced in a "Depends on" field must exist in the task list.
3. **Routing fields are resolved** — every task must have `Touches tested package` and `Touches documented module` set to `yes` or `no`, not `unknown`. Resolve `unknown` by:
   - Reading `.claude/stack.json` → check `test_entrypoints` for paths matching the task's likely files.
   - Reading `.claude/doc-index.json` → check `referenced_code_paths` for matching paths.
   - If neither file exists or the path cannot be matched, set to `no` and flag the assumption in the pre-flight report.
4. **AMBIGUOUS tasks are resolved** — every task description prefixed `AMBIGUOUS:` must have a matching non-DEFERRED entry in `.forge/NNN-slug/clarifications.md`. If the clarifications file is absent or the entry is DEFERRED, list the blocking task IDs.

## Routing decision table

| Tags                      | Touches tested pkg | Touches documented module | Route                                                |
| ------------------------- | ------------------ | ------------------------- | ---------------------------------------------------- |
| `production-code`         | yes                | yes                       | `/forge.tdd` → `/forge.docs-sync`                    |
| `production-code`         | yes                | no                        | `/forge.tdd`                                         |
| `production-code`         | no                 | yes                       | `implementer` + `code-reviewer` + `/forge.docs-sync` |
| `production-code`         | no                 | no                        | `implementer` + `code-reviewer`                      |
| `docs-only`               | —                  | yes                       | `/forge.docs-sync`                                   |
| `config` or `scaffolding` | —                  | —                         | `implementer` + `code-reviewer`                      |

See `references/routing-rules.md` for priority rules when a task has multiple tags.

## Output format

Return a pre-flight report with two sections:

**Checks:** pass/fail + one line of detail for each check.

**Routing plan:**

```
T-001  Add user schema migration      config           → implementer + code-reviewer
T-002  Implement login endpoint       production-code  → /forge.tdd
T-003  Update auth docs               docs-only        → /forge.docs-sync
```

If any check fails, end the report with `BLOCKED: <list of issues>` and do not produce the routing plan.
