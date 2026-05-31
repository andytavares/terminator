---
description: Identify and interactively resolve ambiguities in a feature's spec and task list, writing .forge/NNN-slug/clarifications.md
---

Clarify feature: $ARGUMENTS

If $ARGUMENTS is empty, use the highest-numbered folder in `.forge/`.
If $ARGUMENTS is a number (e.g. `001`), resolve it to the matching `.forge/NNN-*` folder.

1. Read `.forge/NNN-slug/tasks.md`. If it does not exist, stop: "Run /forge.tasks first."
2. Read `.forge/NNN-slug/spec.md` for original context.
3. Run the `clarify-spec` skill to identify all ambiguities.
4. If no ambiguities are found: write `.forge/NNN-slug/clarifications.md` with zero entries and report: "No ambiguities found. Ready to implement."
5. Otherwise, for each ambiguity present one AskUserQuestion call using the structured format:
   - Header: ambiguity title (≤ 8 words)
   - Show the quoted spec/task phrase that is unclear
   - 2–4 options, each with a one-sentence label and tradeoff note
   - Mark the recommended option with "(Recommended)" at the end of its label
   - Include a "Skip / defer this decision" option as the last choice
     Present questions sequentially. Do not batch. After each answer, immediately record the resolution and move to the next question.
6. After all ambiguities are resolved: write `.forge/NNN-slug/clarifications.md`.
7. Report: `N resolved, N deferred. Run /forge.implement NNN to begin.`
