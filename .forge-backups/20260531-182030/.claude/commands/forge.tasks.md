---
description: Decompose a spec into a numbered feature folder and structured task list in .forge/NNN-slug/
---

Create a task list for: $ARGUMENTS

1. Scan `.forge/` for existing `NNN-*` directories to determine the next counter (001, 002, …). Slugify the first 4–5 words of the spec to form the folder name. Create `.forge/NNN-slug/`.
2. Write the verbatim spec text to `.forge/NNN-slug/spec.md`. If `$ARGUMENTS` is a file path, read that file's contents and write them.
3. Run the `researcher` subagent to read the spec and any files it references.
4. Run the `task-decomposition` skill to generate the structured task list.
5. Write the task list to `.forge/NNN-slug/tasks.md`.
6. Present the completed task list via AskUserQuestion using the structured format (label + tradeoff note):
   - "Accept and continue — Writes tasks.md. Next step: /forge.clarify NNN"
   - "Regenerate from scratch — Discards this list. Re-runs researcher + decomposition"
   - "Edit specific tasks — Opens a follow-up to flag task IDs and describe changes"
   - "Abort — Exits. .forge/NNN/ folder is kept for later"
     On "Edit": accept which task IDs to change and what to change, update tasks.md, then re-present this menu.
     On "Regenerate": delete tasks.md, re-run from step 3, re-present this menu.
7. On acceptance: report `Feature NNN ready at .forge/NNN-slug/. Run /forge.clarify NNN to resolve ambiguities, or /forge.implement NNN to begin.`
