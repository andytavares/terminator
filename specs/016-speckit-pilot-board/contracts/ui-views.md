# Contract: UI Views (SpecKit Pilot Board)

All components live under `extensions/speckit-pilot/src/renderer/components/`. Colors
via inherited `--tm-*` tokens only; icons `lucide-react`, flat, `currentColor`, size
via CSS (Constitution XII).

## App shell — `App.tsx` (CHANGED)

- Home surface is `BoardView` (replaces the Tickets/Features/Active-runs/History tab bar).
- Header contains: workspace title, **New card**, **Import ticket**, a `KnowledgeSearch` box, and **Settings** (opens `SettingsView`).
- Import ticket opens a modal reusing `TicketsView` + `DispatchSheet`.
- Subscribes to `speckit:state-changed` / `speckit:dispatch-started` to keep the board live.

## `BoardView.tsx` (NEW)

- Renders six columns in `STAGE_ORDER`; buckets `card-list` results by `stage`.
- `@dnd-kit` drag between **adjacent** columns; Backlog→next confirms handoff (dispatch), active→Backlog confirms park/cancel. Non-adjacent drops are rejected with a toast.
- Empty column shows a quiet placeholder; empty board shows a "Create your first card" affordance.
- Clicking a card opens `CardDetail`.

## `CardTile.tsx` (NEW)

- Shows: type badge, title, one-line scope, compact `PhaseRail` (10 dots), run-status chip (waiting / running / awaiting review / failed / done), and comment/artifact counts.
- Draggable handle; keyboard-movable via dnd-kit sensors.

## `CardDetail.tsx` (NEW)

- Slide-over drawer with tabs: **Brief | Phases | Activity | Artifacts**.
  - **Brief** → `CardBriefEditor`.
  - **Phases** → existing `RunDashboard` (unchanged) — phase rail, `RunConsole`, `GatePanel` variants, `BatchCheckIn`.
  - **Activity** → `ActivityFeed`.
  - **Artifacts** → `ArtifactsPanel`.
- For a Backlog card, the Phases tab shows a "Hand off to agent" call-to-action instead of a running dashboard.

## `CardBriefEditor.tsx` (NEW)

- Fields: title (required), type (segmented feature/bug/chore/spike), scope (textarea), checklist (add/toggle/remove), attachments (paths), attached knowledge refs (read-only list, removable).
- Used both for native creation (via `card-create`) and later edits (via `card-update`).
- Disables handoff and shows a validation message when title is empty (FR-010).

## `ActivityFeed.tsx` (NEW)

- Merges `comment-list` + `history-load`, sorted chronologically.
- Composer posts via `card-comment`; shows a note that the comment will steer the next phase run.

## `ArtifactsPanel.tsx` (NEW)

- Lists `artifact-list` results; selecting one renders markdown (via existing `marked`) or a diff (reusing `GatePanel`'s `diff` rendering).
- Revision dropdown per artifact (from `ArtifactRef.revisions`); PR artifact links out.

## `KnowledgeSearch.tsx` (NEW)

- Search input → `knowledge-search`; results show `file:line` + snippet; explicit "no results" state.
- Each result has an "Attach to card" affordance (adds a `KnowledgeRef` to the open/target card brief).

## `SettingsView.tsx` (CHANGED)

- Adds a **maxConcurrentRuns** control (min 1, default 3) alongside existing integration/autonomy/runner settings.

## Reused unchanged

`RunDashboard`, `PhaseRail` (+ compact mode), `RunConsole`, `GatePanel`,
`SelfReviewGate`, `OpenPrGate`, `BatchCheckIn`, `TicketsView`, `DispatchSheet`.

## Accessibility & behavior notes

- Drag operations must be operable via keyboard (dnd-kit keyboard sensor).
- All async IPC calls wrapped; failures surface via `useToastStore` (Constitution VII).
- Board updates are event-driven (`speckit:state-changed`), not polled.
