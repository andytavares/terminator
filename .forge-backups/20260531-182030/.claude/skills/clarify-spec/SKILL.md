---
name: clarify-spec
description: Use after task-decomposition to surface spec ambiguities as structured questions. Produces entries for .forge/NNN-slug/clarifications.md.
---

# Clarify Spec

## Purpose

Read a task list and the original spec. Find every place where a downstream implementer would be forced to make an arbitrary choice. Return a list of structured questions — do not resolve them; that happens interactively in the `/forge.clarify` command.

## Ambiguity categories to check

1. **Underspecified behavior** — the spec says what to do but not how to handle edge cases (empty input, concurrent access, error/failure modes).
2. **Contradictions** — two parts of the spec or two tasks that cannot both be satisfied simultaneously.
3. **Implicit dependencies** — a task assumes a library, service, schema, or data format that is not established in any earlier task.
4. **Open implementation choices** — multiple valid approaches with meaningfully different trade-offs (e.g. sync vs. async, REST vs. events, stored vs. computed).
5. **Scope ambiguity** — it is unclear whether a behavior belongs in this feature or a future one.
6. **AMBIGUOUS flags** — every task description already prefixed with `AMBIGUOUS:` by the task-decomposition skill must become a question.

## Question format

For each ambiguity, produce:

- **Title** — ≤ 8 words describing the choice
- **Location** — task ID + the quoted phrase that is ambiguous (or "spec, line N")
- **Options** — 2–4 options, each with one sentence of rationale
- **Recommended** — mark one option `[RECOMMENDED]` with a one-sentence justification grounded in the existing codebase patterns (check `.claude/stack.json` and repo conventions)
- **Affects tasks** — comma-separated task IDs whose implementation changes based on the resolution

## Rules

- Return only the question list. Do not resolve or answer the questions.
- Do not invent ambiguities. If the spec is unambiguous, return an empty list.
- If the same ambiguity affects multiple tasks, produce one question and list all affected task IDs in "Affects tasks."
- Order questions by task ID ascending (earlier tasks first).
