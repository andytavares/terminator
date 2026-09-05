# Implementation Plan: One UI Floor for Every Extension

**Branch**: `036-extension-ux-remediation` | **Date**: 2026-09-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/036-extension-ux-remediation/spec.md`

## Summary

Build the interface layer the Extension API never had, move the whole product onto it, then
redesign the four extension main views that fail to answer the question they exist for, and
write the house rules down with enforcement.

The technical approach that falls out of Phase 0: a new runtime workspace package,
`packages/extension-ui`, holding one dialog, one confirmation, one toast, one empty state, one
icon-button and a named layer scale, consumed as an ordinary dependency by the core renderer
and by each of the five extensions. Dialogs render inside the calling document, so modal depth
is tracked per-document and the double-escape detector — extracted once into
`src/shared/double-escape.ts` and used by both the host window and `preload-webview.ts` —
reads the counter belonging to the document it runs in. No new IPC channel is required.

Delivery follows the spec's priority order: P1 stops the data loss and fixes the behaviour
matrix, P2–P3 are four independent screen redesigns, P4 is the style and theme sweep.

## Technical Context

**Language/Version**: TypeScript 5.x, React 18.3.1, Node 22 (`.nvmrc`)

**Primary Dependencies**: Electron, Vite / electron-vite, Zustand, lucide-react. One addition:
`qrcode.react` (pinned exact, declared in `extensions/remote-control/package.json` only — see
research R3)

**Storage**: N/A — this feature introduces no persisted entities. Existing extension SQLite
stores are untouched.

**Testing**: Vitest + Testing Library for units; Playwright (`_electron`) for end-to-end;
headless Chromium for the theme-contrast harness (research R5)

**Target Platform**: Electron desktop (macOS primary), plus the browser remote renderer

**Project Type**: Desktop application with a first-party extension host

**Performance Goals**: Dialog open-to-interactive within one frame of the click; connected-device
list reflects a join or leave without a manual refresh (research R8)

**Constraints**: No more than 100px of chrome above the first item on the SpecKit board and the
Code Reviews queue (SC-014). WCAG AA text contrast in both themes (FR-041). Extension views are
`WebContentsView`s composited above the host window, which is why dialogs must render in-view
(spec Clarifications, Q1). Offline — no network at runtime.

**Scale/Scope**: 5 bundled extensions + the core renderer; 19 extension modal surfaces plus the
core's own dialogs to migrate; 4 main-view redesigns; ~19,900 lines of extension CSS in range,
of which a substantial share is deleted rather than edited.

## Constitution Check

_GATE: evaluated before Phase 0 and re-evaluated after Phase 1. Constitution v1.4.0._

| Principle                             | Verdict                                              | Basis                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **I. Source Integrity**               | PASS                                                 | The one new dependency was verified against vendor documentation during Phase 0, not from memory (research R3). Every other decision is grounded in code read in this repository.                                                                                                                                                                                                                            |
| **II. Extension Isolation (NON-NEG)** | PASS — improves                                      | The feature _removes_ the five existing runtime imports of core renderer source. The replacement is a published package each extension declares in its own `package.json`, which is the sanctioned route. `packages/*` must be added to root `workspaces`; no extension-only package is added to the root manifest. Deleting any extension directory must still leave the core building (SC-004).            |
| **IV. Dependency Stewardship**        | PASS                                                 | One addition, `qrcode.react`: High source reputation, benchmark 96.92, actively maintained, pinned exact, declared in the consuming extension only. Focus trapping is hand-rolled rather than taking a dependency, following the precedent ADR 027 set.                                                                                                                                                      |
| **V. Readability & Minimalism**       | PASS                                                 | Net-deleting: five bespoke modal implementations, seven Task Vault pickers/drawers, `ExtensionToastContainer`, and the superseded overlay CSS all go. The abstraction is earned — six concrete call sites, well past the "two or more" bar.                                                                                                                                                                  |
| **VI. TDD (NON-NEG)**                 | PASS with a named risk                               | Red→green→refactor is mandatory and every finding here is a bug fix, so each needs a failing test first. **The risk is specific**: the sidebar drag defect fixed earlier survived a full unit suite because the test asserted a mocked store was called, never that the list rendered. FR-042 exists for this. Modal behaviour, Escape, contrast and drag order are only observable after a real render.     |
| **VII. SOLID & YAGNI**                | PASS                                                 | Primitives are limited to the five shapes with existing duplicate call sites. No speculative surface: no theming API, no animation config, no slot system.                                                                                                                                                                                                                                                   |
| **VIII. Documentation**               | GATE                                                 | README, `docs/ARCHITECTURE.md`, `docs/EXTENSION-DEVELOPMENT.md`, `packages/extension-sdk/README.md` and the user guide must be updated in the same PR, not after.                                                                                                                                                                                                                                            |
| **IX. ADRs**                          | GATE                                                 | Two decisions warrant records, written at decision time: **ADR 038** — dialogs render inside the extension's own view (and why core-hosted was rejected: `WebContentsView` composites above the host DOM, so `useModalEffect` hides the extension, which would break the scrim FR-002 promises). **ADR 039** — the shared UI layer is one implementation published outward, with the core migrating onto it. |
| **X. Code Cleanliness (NON-NEG)**     | GATE                                                 | FR-007 requires the superseded implementations be removed, not left dormant. A migrated surface whose old code still exists fails this gate.                                                                                                                                                                                                                                                                 |
| **XI. Functional Purity**             | PASS                                                 | The layer scale, the contrast maths and the double-escape decision are pure functions taking their inputs as parameters — the detector must not read the clock directly, matching how `isStale` takes `now`.                                                                                                                                                                                                 |
| **XII. UI Icons (NON-NEG)**           | **PRE-EXISTING VIOLATION — see Complexity Tracking** | 185 `size={n}` props across the extensions against 2 in core, plus three git-integration files using unicode characters as visual elements. Not created by this feature, but in files it edits.                                                                                                                                                                                                              |

**Post-Phase 1 re-evaluation**: unchanged. The Phase 1 contracts introduce no new dependency,
no new IPC channel, and no new persisted state. The `packages/*` workspace addition is the only
structural change and it is what makes Principle II satisfiable.

## Project Structure

### Documentation (this feature)

```text
specs/036-extension-ux-remediation/
├── plan.md              # This file
├── research.md          # Phase 0 — 9 decisions, all unknowns resolved
├── data-model.md        # Phase 1 — the runtime shapes (no persistence)
├── quickstart.md        # Phase 1 — how to prove each story works
├── contracts/
│   ├── extension-ui-api.md    # The published api.ui surface
│   └── layer-scale.md         # Named stacking contract
├── checklists/
│   └── requirements.md  # Spec quality checklist (16/16)
└── tasks.md             # Phase 2 — NOT created by /speckit-plan
```

### Source Code (repository root)

```text
packages/
├── extension-ui/                    # NEW — the shared floor, runtime
│   ├── package.json                 # react/react-dom as peerDependencies
│   └── src/
│       ├── Dialog.tsx               # Esc, focus trap, role, aria-modal, scrim, outside-click
│       ├── ConfirmDialog.tsx        # the core's existing dialog, generalised
│       ├── Toast.tsx                # + queue; core's toast.store migrates onto it
│       ├── EmptyState.tsx           # Notepad's pattern, made the house pattern
│       ├── IconButton.tsx           # label is a required prop (FR-005)
│       ├── layers.ts                # panel | overlay | modal | toast
│       └── useModalDepth.ts         # per-document counter (research R2)
└── extension-sdk/                   # types only; re-exports extension-ui types

src/
├── shared/
│   └── double-escape.ts             # EXISTS — becomes the single detector (FR-009)
├── main/
│   ├── preload-webview.ts           # loses its private copy of the detector
│   └── extensions/api.ts            # gains the `ui` namespace (FR-001)
└── renderer/
    ├── components/ConfirmDialog.tsx # migrates onto extension-ui (FR-007a)
    └── stores/{modal,toast}.store.ts

extensions/
├── remote-control/                  # US3 — status-first main view
├── speckit-pilot/                   # US4 — named phases, board chrome, drawer
├── task-vault/                      # US5 — empty states, weekly review, calendar
├── git-integration/                 # US6 — queue, risk, git panel
└── notepad/                         # migration + NP-2 copy fixes

tests/
├── e2e/
│   ├── extension-escape.spec.ts     # US1 — the guard, driven in the real app
│   ├── extension-dialogs.spec.ts    # US2 — the behaviour matrix, all surfaces
│   └── extension-themes.spec.ts     # US8 — contrast, rendered not parsed
└── unit/…                           # per-package units alongside
```

**Structure Decision**: A new runtime workspace package (`packages/extension-ui`) beside the
existing types-only `packages/extension-sdk`, with `packages/*` added to the root `workspaces`
array so extensions can declare it in their own manifests. This is the only structure that
satisfies Principle II — extensions get the components through a declared dependency rather
than by importing `src/renderer/` — while keeping a single implementation shared with the core
app, which is what the spec's Q4 clarification requires. Everything else stays where it is.

## Complexity Tracking

| Violation                                                                                 | Why Needed                                                                                                                                                                              | Simpler Alternative Rejected Because                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Principle XII: 185 `size={n}` icon props and 3 files using unicode as visual elements** | Pre-existing, not introduced here. The feature edits most of the affected files, so leaving them untouched perpetuates a NON-NEGOTIABLE violation in code this PR is already rewriting. | Sweeping all 185 in this feature was rejected: it would put ~185 unrelated line changes into a PR about dialogs and screens, breaking Constitution V's rule that every changed line traces to the request, and making the review unreadable. **Position taken**: components this feature rewrites adopt CSS-controlled sizing as part of that rewrite; the untouched remainder is recorded as follow-up work rather than swept silently or ignored. The three unicode-as-icon files are in git-integration surfaces US6 touches and are fixed here. |
| **A new workspace package rather than reusing `extension-sdk`**                           | `extension-sdk` is types-only (`types` field, no `main`, no build) and is the artifact third parties install for type definitions alone.                                                | Adding runtime React to it was rejected: it changes what a published package _is_ and forces a build step onto consumers who want only `.d.ts` files.                                                                                                                                                                                                                                                                                                                                                                                               |
