---
description: Research a topic or idea — scans the codebase for context, fetches official sources (canonical-research rules), and writes a structured research document to .forge/NNN-slug/research.md
---

Research topic: $ARGUMENTS

1. Scan `.forge/` for existing `NNN-*` directories to determine the next counter. Slugify the first 4–5 words of `$ARGUMENTS` to form the folder name. Create `.forge/NNN-slug/` if it does not already exist. Write the verbatim topic text to `.forge/NNN-slug/topic.md`.

2. Run the `researcher` subagent with the `research-topic` skill for: $ARGUMENTS

   - The subagent will scan the codebase, fetch official documentation for 2–4 candidate options, analyse each, and assemble a structured `research.md` using the schema in `.claude/skills/research-topic/references/research-doc-schema.md`.
   - All external claims must follow the `canonical-research` protocol (official docs first, `Source:` + `Quote:` citations required).

3. Write the subagent's output to `.forge/NNN-slug/research.md`.

4. Present the completed document via AskUserQuestion:

   - "Accept — research.md is saved. Next step: /forge.tasks NNN to convert to a task list."
   - "Regenerate — Discards this document and re-runs the researcher from scratch."
   - "Extend with more sources — Re-runs Phase 3–5 of the researcher with additional topics or source domains you specify."
   - "Abort — Exits. .forge/NNN-slug/ folder is kept for later."

   On "Regenerate": delete `research.md`, re-run step 2, re-present this menu.
   On "Extend with more sources": ask which additional topics or domains to include, re-run steps 2–3 with that context appended, re-present this menu.
   On "Accept": report `Research NNN ready at .forge/NNN-slug/research.md. Run /forge.tasks NNN to convert to a task list.`
