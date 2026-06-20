---
description: Google eng-practices code review with interactive approve/deny per finding
---

Run an interactive Google-style code review on the current uncommitted changes.

## Steps

1. **Run the `google-code-reviewer` subagent** against the current diff. It returns a JSON object with a `findings` array and a `verdict`.

2. **If there are no findings**, report the verdict and stop — nothing to act on.

3. **If there are findings**, group them by severity in the display:
   - BLOCKER findings first
   - WARNING findings second  
   - NIT findings last

   For each finding show: `[severity] category — location: finding`

4. **Present all findings as a multiSelect `AskUserQuestion`**:
   - Question: "Which suggestions do you want applied? (Blockers should all be fixed before committing)"
   - One option per finding, using format: `[F01] BLOCKER — file:line — short description`
   - Include an "Apply all BLOCKERs" convenience option at the top

5. **Apply every selected suggestion** — edit the files, one finding at a time. For each:
   - State which finding you're fixing
   - Make the minimal change that addresses the finding
   - Do not touch anything else

6. **After all fixes are applied**, run `npm run lint` to confirm no lint regressions from the edits.

7. **Report what was fixed and what was skipped** (skipped items remain the author's responsibility before merging).

## Notes

- Do not auto-apply anything — wait for the user's selection
- NITs that aren't selected are noted but do not block
- If the verdict is APPROVE with no BLOCKERs, say so clearly before showing the optional suggestions
