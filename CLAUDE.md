<!-- SPECKIT START -->

For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at specs/005-task-vault-extension/plan.md

<!-- SPECKIT END -->

# Project Constitution

The full project constitution is at **`.specify/memory/constitution.md`**. It is the authoritative source of all mandatory principles. Read it before starting any work. Key principles with session-level enforcement rules are called out below.

---

# Error Handling (Constitution Principle VII — MANDATORY)

Every user-visible operation must fail gracefully. Errors must never crash the app silently or leave the UI in a broken state.

1. **All async IPC calls** must be wrapped in try/catch or have `.catch()` handlers.
2. **User-facing errors** must surface as toasts (via `useToastStore`) — never swallowed silently, never as bare `alert()` calls.
3. **The React error boundary** at `src/renderer/components/ErrorBoundary.tsx` must wrap the root app.
4. **Main process errors** must be caught and returned as `{ error: string }` — never unhandled rejections.
5. **Schema validation failures** must return `{ error: 'VALIDATION_ERROR', message }` — not thrown exceptions.
6. **Never swallow errors silently.** If you catch and don't surface to the user, log it at minimum.

```typescript
import { useToastStore } from '../stores/toast.store'
const { addToast } = useToastStore()
addToast({ type: 'error', message: 'Could not create project' })
```

---

# Documentation (Constitution Principle VIII — MANDATORY)

Documentation ships in the same change as the code. A feature is **not complete** until its docs are accurate.

| Change type                         | Documentation to update                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| New user-facing feature or behavior | `README.md` features list                                                                               |
| Architecture change                 | `docs/ARCHITECTURE.md`                                                                                  |
| New or changed IPC channel          | `specs/001-extension-first-terminal/contracts/ipc-channels.md` + `src/renderer/electron.d.ts`           |
| Extension API change                | `specs/001-extension-first-terminal/contracts/extension-api.md` + `docs/EXTENSION-DEVELOPMENT.md`       |
| New npm script or setup step        | `README.md` scripts table + `specs/001-extension-first-terminal/quickstart.md` + `docs/CONTRIBUTING.md` |
| Significant architectural decision  | New ADR in `docs/adr/`                                                                                  |
| Data model change                   | `specs/001-extension-first-terminal/data-model.md` + `docs/ARCHITECTURE.md`                             |
| New keyboard shortcut               | `README.md` + `contracts/extension-api.md` reserved list                                                |
| New dependency                      | `README.md` tech stack table + PR justification (community health + official docs link)                 |

Rules:

1. **Never mark a task complete** without checking whether documentation needs updating.
2. **Before finishing any implementation session**, verify README.md and the relevant docs above reflect what was built.
3. **Any new IPC channel** must be in `ipc-channels.md` and `electron.d.ts` before or alongside the handler code.
4. **If the README has no record of a feature I just built**, I must add it before reporting the task done.

---

# Test Coverage (Constitution Principle VI — MANDATORY)

Coverage gate: **80% minimum** on statements, branches, functions, and lines — enforced by `vitest.config.ts` thresholds.

1. **Run `npx vitest run --coverage` explicitly** before reporting any session or PR done. A threshold failure is a hard blocker.
2. **Every new production file must reach ≥ 80% coverage at merge time.** A file at 0% is a defect regardless of the project-wide aggregate.
3. **No new code ships untested.** Write the test first (Red → Green → Refactor).

---

# Code Cleanliness (Constitution Principle X — MANDATORY)

See full rules in `.specify/memory/constitution.md` § X. Enforcement checklist for every session:

- [ ] `npm run lint` passes with **0 errors** (run it explicitly before reporting done)
- [ ] `npx vitest run --coverage` passes with **all thresholds ≥ 80%**
- [ ] `npm run build:extensions` succeeds
- [ ] No unused imports, variables, or dead code introduced
- [ ] No dead exports left from refactors
- [ ] No placeholder comments left without a tracked issue reference
- [ ] Extension TypeScript changes are compiled — never edit `extensions/*/src/index.js` directly
- [ ] Documentation updated per the table above
