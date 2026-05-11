---
name: 80% test coverage is mandatory
description: Every new production file must have ≥80% coverage. No file ships at 0%. Constitution VI enforces this.
type: feedback
---

All new code must have test coverage ≥ 80% (statements, branches, functions, lines). This is enforced by vitest.config.ts thresholds.

**Why:** User has called this out multiple times ("we've been through this hundreds of times"). The PR checklist and CLAUDE.md both state `npm run test` must pass coverage ≥ 80%. Previous sessions shipped SpecKitPilotView.tsx (570 lines), markdown.ts, electron.ts, log.ipc.ts, and renderer/logger.ts with 0% coverage.

**How to apply:**

- Run `npx vitest run --coverage` before reporting any session done — it is a hard blocker.
- Every new `.ts`/`.tsx` file gets a corresponding test file in the same PR.
- A file at 0% coverage is a defect, even if the project-wide aggregate is above 80%.
- Write tests BEFORE or alongside implementation (TDD), not after.
