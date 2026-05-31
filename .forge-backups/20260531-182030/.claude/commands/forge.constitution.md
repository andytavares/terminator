---
description: Create or update the project constitution — the soul file that encodes non-negotiables, architectural principles, and project identity
---

1. Check whether `.forge/constitution.md` exists in the repo root.

2. If it **does not exist** — enter the interactive authoring flow:

   - Run the `researcher` subagent to scan the repo for signals (README, CLAUDE.md, any ADRs in `docs/`, CONTRIBUTING.md, `.forge/` feature history). Extract implicit principles and draft all six H2 sections.
   - Present each section to the user one at a time in this order: Purpose → Non-negotiables → Architectural principles → Risk posture → Team conventions → Out of scope.
   - For each section show the drafted content and ask: **Accept, Edit, or Skip?**
     - Accept: use the draft as-is.
     - Edit: accept free-form replacement text from the user.
     - Skip: record the section body as `(none)`.
   - After all six sections, display the fully assembled file and ask: **Write this? [Y/n]**
   - On confirmation: write `.forge/constitution.md`. Report the path.
   - Remind the user: "Commit this file — it is checked in and loaded every session."

3. If it **already exists** — display the current contents, then ask:
   **"Update a section, regenerate from scratch, or cancel?"**
   - Update a section: ask which section, accept the new text, show the updated section, ask "Write this? [Y/n]", then rewrite only that H2 in the file on confirmation.
   - Regenerate from scratch: run the full authoring flow from step 2 (re-scan repo, re-draft, re-confirm).
   - Cancel: stop with no changes.

The constitution file must always contain all six required H2 headings. Any section may have `(none)` as its body but must not be absent.
