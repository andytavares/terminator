# Implementation Plan: Session Home and Monitor Wall

**Branch**: `054-session-home-wall` | **Date**: 2026-09-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/054-session-home-wall/spec.md`

## Summary

- **Overview** becomes a wall of live terminal tiles, with sessions that need input pinned in a band where they can be answered.
- **Home** is a new launch view that shows every session as a Ledger or a Logbook.
- **Records**: a session's description and its own work item link are stored per session in a new main-process record store. Records survive restarts and are kept for 30 days after close.
- **Pure layer**: every surface draws one derived `SessionFacts` view model built by pure functions.
- **Needs you**: detection widens from the bell alone to also include a parsed numbered-choice prompt on the visible screen. Without that, answering in place would never trigger.
- **Removed**: the state-columned board and the in-memory session note.

## Technical Context

**Language/Version**: TypeScript 5.5.4, running in the Electron 42.4.1 main and renderer processes.

**Primary Dependencies**:

- React 18.3.1
- Zustand 4.5.5
- `xterm` 5.3.0
- Zod (IPC schemas)
- lucide-react

No new dependencies.

**Storage**: A new `userData/session-records.json`, in the `issue-link-store` pattern. Preferences are stored in renderer `localStorage`.

**Testing**: Vitest 4.1.9 with jsdom for the renderer. Playwright 1.61.0 with `tests/e2e/helpers.ts` `launchApp` for e2e.

**Target Platform**: macOS arm64 desktop (electron-builder `--mac --arm64`).

**Project Type**: Desktop app (Electron main + renderer).

**Performance Goals**:

- 12 live tiles with typing echo within 50 ms (SC-005).
- A new session on both surfaces within 1 s, and state changes within 2 s (SC-002).

**Constraints**:

- A live preview node must never be re-parented (ADR 036 invariant, R11).
- The buffer is parsed once per busy → idle transition, not per chunk.
- Core only, with no Extension API change.

**Scale/Scope**:

- Tens of open sessions.
- Records capped in practice by 30-day retention: hundreds of rows.
- Two global tabs.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design._

| Principle                   | Status        | How                                                                                                                                                                                       |
| --------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Source Integrity         | Pass          | New code only under `src/` and `tests/`. Nothing generated is committed.                                                                                                                  |
| II. Extension Isolation     | Pass          | All work is core. `session-records:*` is not exposed to extensions. Needs-you detection reads core's own xterm buffer, not any extension's hooks.                                         |
| IV. Dependency Stewardship  | Pass          | No new packages.                                                                                                                                                                          |
| V. Readability & Minimalism | Pass          | Each FR maps to one pure function or one component. No speculative settings: the launch view is fixed at Home.                                                                            |
| VI. TDD (80%)               | Pass, planned | A failing spec is written first for every pure module, the store, the IPC handler and each component. The e2e specs replace `board.spec.ts`.                                              |
| VII. SOLID / YAGNI          | Pass          | Reuses `AgentStateSource`, `registerGlobalTab`, `updateGlobalTab`, `mountPreview` and `integrations:issue-get`. No new abstraction with a single caller.                                  |
| VIII. Documentation         | Pass, planned | In the same PR: the ARCHITECTURE.md Persistence boundaries table, a new "Session Home and Monitor Wall" section replacing the board text, the README feature list, and a user-guide page. |
| IX. ADRs                    | Pass          | `docs/adr/054-overview-is-a-wall-sessions-carry-context.md`, written with this plan. It supersedes ADR 036's board and keeps its one-grid invariant.                                      |
| X. Code Cleanliness         | Pass, planned | Board, lanes, note and their specs are deleted (R9). Lint is at 0.                                                                                                                        |
| XI. Purity                  | Pass          | Derivations are pure, under `purity.spec.ts`. Side effects are confined to the record store, IPC handlers, and the named `load/save` preference functions.                                |
| XII. Icons                  | Pass          | lucide only. State is drawn through `state-icons.tsx` with opacity tokens, and sized in CSS.                                                                                              |

**Post-design re-check**: Still passes. The one deviation from the spec (widening needs-you detection) is a spec correction, now recorded in the spec's Assumptions. It is not a constitution violation.

## Project Structure

### Documentation (this feature)

```text
specs/054-session-home-wall/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── session-records-ipc.md
│   ├── pure-layer.md
│   └── ui-surfaces.md
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks
```

### Source Code (repository root)

```text
src/shared/
├── session-records/retention.ts          # new, pruneRecords
├── schemas/session-records.schema.ts     # new, Zod for session-records:*
└── types/index.ts                        # SessionRecord, WorkItemRef, ChoicePrompt; TerminalSession: −note +shell +choicePrompt

src/main/
├── sessions/session-record-store.ts      # new, load/sweep/prune/set/markClosed/onChange
├── ipc/session-records.ipc.ts            # new
├── ipc/terminal.ipc.ts                   # close → markClosed; create → returns shell (schema lives here)
├── preload.ts                            # electronAPI.sessionRecords
└── index.ts                              # loadRecords + sweep at startup, register IPC

src/renderer/
├── sidebar/                              # pure layer (purity.spec.ts)
│   ├── work-item.ts                      # new
│   ├── session-facts.ts                  # new
│   ├── choice-prompt.ts                  # new
│   ├── session-filter.ts                 # new
│   ├── ledger-rows.ts                    # new
│   ├── logbook-groups.ts                 # new
│   ├── wall-order.ts                     # new
│   ├── home-prefs.ts / wall-prefs.ts     # new
│   ├── agent-state.ts                    # choicePrompt → awaiting-input
│   └── board-lanes.ts                    # DELETED
├── stores/
│   ├── session-records.store.ts          # new, mirrors main records, subscribes to changed
│   ├── session.store.ts                  # −setSessionNote, +shell, +choicePrompt
│   └── integrations.store.ts             # +issueByKey cache
├── components/terminal/TerminalSession.tsx # onIdle → parse visible rows; readVisibleRows()
├── components/terminal/TabBar.tsx        # note editor → description
├── components/session/                   # new, shared by all three surfaces
│   ├── StateIcon.tsx
│   ├── WorkItemCell.tsx                  # ticket | description | describe field + Link
│   ├── ChoiceButtons.tsx
│   └── LivePreview.tsx                   # mountPreview wrapper (from SessionTile)
├── components/home/
│   ├── HomeScreen.tsx                    # layout switch, filters, Display menu
│   ├── LedgerView.tsx
│   ├── LogbookView.tsx
│   └── DisplayMenu.tsx
├── components/overview/
│   ├── OverviewScreen.tsx                # becomes the wall
│   ├── WallTile.tsx                      # from SessionTile
│   ├── BoardScreen.tsx/.css              # DELETED
│   └── SessionTile.tsx/.css              # DELETED (→ WallTile)
├── extensions/registry.ts                # GlobalTabRegistration.badge
├── components/sidebar/AppBand.tsx        # renders tab badge
└── App.tsx                               # register core.home, launch on Home, keep badge current

tests/
├── unit/shared/session-records/retention.spec.ts
├── unit/main/sessions/session-record-store.spec.ts
├── unit/main/ipc/session-records-ipc.spec.ts
├── unit/renderer/sidebar/{work-item,session-facts,choice-prompt,session-filter,ledger-rows,logbook-groups,wall-order,home-prefs,wall-prefs}.spec.ts
├── unit/renderer/components/{HomeScreen,LedgerView,LogbookView,OverviewScreen,WallTile,WorkItemCell,ChoiceButtons}.spec.tsx
├── e2e/session-home.spec.ts              # new
├── e2e/monitor-wall.spec.ts              # new
└── e2e/board.spec.ts + board-lanes/BoardScreen/board-lane-visibility specs  # DELETED

docs/
├── ARCHITECTURE.md                       # persistence table, new section, board text removed
├── adr/054-overview-is-a-wall-sessions-carry-context.md
└── user-guide/session-home.md
README.md
```

**Structure Decision**: This is the existing single Electron project. Pure derivations join the guarded `src/renderer/sidebar/` layer, where `board-lanes.ts` already lived. The components shared by the three surfaces get their own `components/session/` directory, so neither Home nor the wall imports from the other.

## Delivery order

Each step is independently shippable and follows the spec's priorities:

1. **Records and facts (US1 and US2 foundations)**: the retention module, record store and IPC, the `shell` on create, `session-facts`, and `work-item`.
2. **Home, Ledger only, with descriptions (US1, US2)**: registers `core.home`, the launch view and the badge. Removes the note.
3. **Monitor wall (US3)**: replaces the board, and deletes the board, lanes and their specs.
4. **Choice prompt and answering (US4)**: the parser, the needs-you widening, and the buttons on the wall and in the Ledger. Includes the quickstart §5 live run.
5. **Logbook and layout switch (US5)**, then **session links (US6)**, then **the Display menu (US7)**.
6. **Docs and ADR finalised**, then quickstart §1–§6 run, with evidence in the PR.

## Complexity Tracking

No constitution violations to justify.
