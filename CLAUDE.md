<!-- SPECKIT START -->

For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at specs/002-git-github-integration/plan.md

<!-- SPECKIT END -->

# Error Handling Requirements (Constitution Principle VII — MANDATORY)

Every user-visible operation must fail gracefully. Errors must never crash the app silently or leave the UI in a broken state.

## Rules I must follow

1. **All async IPC calls** must be wrapped in try/catch or have `.catch()` handlers.
2. **User-facing errors** must surface as toasts (via `useToastStore`) — never swallowed silently, never as bare `alert()` calls.
3. **The React error boundary** at `src/renderer/components/ErrorBoundary.tsx` must wrap the root app. If a subtree crashes, the boundary catches it and shows a recoverable error UI.
4. **Main process errors** (git operations, PTY failures, IPC handler throws) must be caught and returned as `{ error: string }` — never unhandled rejections.
5. **Schema validation failures** must return structured `{ error: 'VALIDATION_ERROR', message }` — not thrown exceptions.
6. **Never swallow errors silently.** If you catch and don't surface to the user, add a log entry at minimum.

## Toast usage

```typescript
import { useToastStore } from '../stores/toast.store'
const { addToast } = useToastStore()
addToast({ type: 'error', message: 'Could not create project' })
```

---

# Documentation Requirements (Constitution Principle VI — MANDATORY)

Documentation ships in the same change as the code. A feature is **not complete** until its docs are accurate. Stale or missing docs are treated as bugs.

## What to update for every code change

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

## Documentation files in this project

```
README.md                                       ← Project overview, quick start, scripts
docs/ARCHITECTURE.md                            ← Process model, IPC, data model, extension system
docs/CONTRIBUTING.md                            ← Dev setup, branching, TDD, PR checklist
docs/EXTENSION-DEVELOPMENT.md                  ← Guide for extension authors
docs/adr/                                       ← Architectural Decision Records (immutable)
specs/001-extension-first-terminal/
  ├── quickstart.md                             ← Developer quick-start
  ├── contracts/ipc-channels.md                ← IPC channel contracts
  └── contracts/extension-api.md              ← Extension API contract
```

## Rules I must follow

1. **Never mark a task complete** without checking whether documentation needs updating.
2. **Before finishing any implementation session**, verify README.md and the relevant docs above reflect what was built.
3. **Any new IPC channel** must be in `ipc-channels.md` and `electron.d.ts` before or alongside the handler code.
4. **Any ADR-worthy decision** made during implementation must get a new ADR file immediately.
5. **If the README has no record of a feature I just built**, I must add it before reporting the task done.
