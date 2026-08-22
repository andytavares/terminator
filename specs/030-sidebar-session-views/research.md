# Phase 0 Research: Sidebar Session Views

**Branch**: `030-sidebar-session-views` | **Date**: 2026-08-21

All findings below were verified by reading the current source on this branch, not inferred from the
source research document (`~/Desktop/terminator-ux-research/PLAN.md`). Two of that document's load-bearing
claims are wrong; both are corrected here (R1, R2) and both make the feature smaller.

---

## R1 — ~~CORRECTION: the "sidebar buttons" extension surface does not exist~~ (SUPERSEDED)

> **This finding is wrong and is reversed by R1-CORRECTION at the end of this section. Read that before
> acting on anything below.** The observation that nothing _renders_ holds; the explanation and the
> resulting delete decision do not.

**Claim in the source plan**: surface #3 is `sidebarButtons`, contributed by Git Integration ("Git Changes"
panel toggle), rendered by `ExtensionFooter` once per expanded workspace; decision D4 moves it to the
sidebar footer, a visible behaviour change.

**What the source actually says**:

- `registerSidebarButton` exists on the registry (`src/renderer/extensions/registry.ts:88,224-228`) but is
  **called by nothing** — `grep -rn "registerSidebarButton" src extensions` returns only the registry itself.
- It is **not** a member of `ExtensionRendererAPI` (`registry.ts:97-110`), so no extension can call it either.
- `sidebarButtons` is therefore permanently `[]`, and `ExtensionFooter` returns `null` on every render
  (`ExtensionFooter.tsx:39`). Nothing has ever been drawn there.
- Git Integration's "Git Changes" panel is a `sidebarPanel` contribution
  (`extensions/git-integration/manifest.json`), toggled only by the `CmdOrCtrl+Shift+G` accelerator
  registered in `loader.ts:82-91`, and restored from the `openPanels` localStorage key (`App.tsx:346-371`).
  It has no button anywhere.

**Decision** _(superseded — see R1-CORRECTION)_: delete `SidebarButtonRegistration`, `registerSidebarButton`,
`sidebarButtons`, `ExtensionFooter.tsx`, and `ExtensionFooter.css`. Do not move them.

**Rationale**: Constitution X — dead exports and unreachable code are defects, and moving unreachable code
to a new host would ship it as if it were a feature. Removing an interface member that is not part of
`ExtensionRendererAPI` is not an Extension API change, so **no version bump** (this preserves the source
plan's D6 for a different reason than the one it gave).

**Consequence for the spec** _(superseded — see R1-CORRECTION)_: FR-028 ("sidebar-contributed buttons MUST
render exactly once in the sidebar footer") is unsatisfiable and is retired. The Assumptions entry describing D4 as an accepted visible
behaviour change is void — there is no visible change, because nothing was ever visible. There are **three**
extension surfaces to preserve, not four.

**Alternatives considered**: (a) keep `ExtensionFooter` and expose `registerSidebarButton` on
`ExtensionRendererAPI` so extensions could finally use it — rejected: YAGNI (Principle VII), no extension
has asked for it, and it would be a MINOR Extension API addition outside this feature's scope. (b) Leave it
untouched — rejected: it is dead code inside files this feature rewrites.

---

### R1-CORRECTION — the decision above was made on an incomplete reading and is REVERSED

**Found during `/speckit-analyze`.** R1 examined only the renderer registry and concluded no extension could
contribute to this surface. That is wrong. The surface has two halves and only the renderer half is
unreachable:

- `api.sidebar.registerItem` is a **documented public API** — declared at `src/main/extensions/api.ts:214`,
  implemented at `:608-612`, typed in the published SDK at
  `packages/extension-sdk/types/api.d.ts:64-68,145`, and documented with a worked example at
  `docs/EXTENSION-DEVELOPMENT.md:187-203`.
- **It has a live caller**: `extensions/git-integration/src/index.ts:146` registers
  `{ id: 'git-sidebar-toggle', label: 'Git Changes' }` on every activation — exactly the contribution the
  source research document described, which R1 dismissed.
- The registration lands in `globalRegistry.sidebarItems` (`api.ts:351,373`) and is retrievable over the
  declared channel `extension:get-sidebar-items` (`manifest.ts:282`, handler `extension.ipc.ts:61-63`,
  exposed to extension webviews at `preload-webview.ts:123`).
- What is missing is **any host-renderer consumer of that channel**. The renderer's `sidebarButtons` array
  is a second, entirely unconnected mechanism. The surface is broken wiring, not an absent feature.

A second stranded channel compounds it: `extension:toggle-panel` is declared (`manifest.ts:371`) and has
listeners on both the host renderer (`App.tsx:341-343`) and the extension webview
(`preload-webview.ts:152-153`), but **nothing in the main process ever sends on it**. That is why
git-integration's `onClick` shows a toast reading "Toggle git sidebar via View menu or shortcut" instead of
toggling anything — the extension has no way to do it.

**Revised decision (user-selected)**: complete the wiring instead of deleting the API.

1. Add `dispatchSidebarItemClick(itemId)` to `api.ts`, mirroring the existing
   `dispatchContextMenuClick` (`api.ts:476-484`), behind a new invoke channel
   `extension:sidebar-item-click`.
2. Have `src/renderer/extensions/loader.ts` fetch `extension.getSidebarItems()` at init and register each
   through the existing `registry.registerSidebarButton`, with an `action` that invokes the new channel.
   `registerSidebarButton` stays off `ExtensionRendererAPI` — webview extensions register through the main
   API, and the renderer registry remains an internal detail.
3. Render `ExtensionFooter` **once** in the sidebar footer (the source document's D4, now correct for the
   reason D4 originally gave).
4. Add `api.sidebar.togglePanel()` so a sidebar item can perform a real action, and change
   git-integration's `onClick` to call it instead of toasting a hint.

**Rationale**: a documented API with a live caller is not dead code; it is a defect in the host. Deleting it
would break a published SDK surface (MAJOR bump) to remove a capability the app visibly wants — this feature
is adding a sidebar with an obvious place to put those items. Wiring it is additive: SDK 1.0.0 → **1.1.0**,
no contribution type added or changed, no extension forced to change.

**What this reverses**: the deletion decisions in R1 and in R12 items 1 and 2. `ExtensionFooter`,
`SidebarButtonRegistration`, `registerSidebarButton`, and `sidebarButtons` are all **kept and wired**, not
deleted. R12 items 3 and 4 (the dead `TerminalSessionSchema` export and the dead `ProjectRow` git props)
are unaffected and still deleted.

**Process note (Principle I)**: R1 asserted "no extension can contribute to it" after grepping the renderer
only. The claim was checkable in one command against `extensions/*/src` and was not checked. The finding
that nothing _renders_ was correct; the explanation was not.

---

## R2 — CORRECTION: worktree removal on delete is already wired

**Claim in the source plan**: `workspace-store.ts:158-162` deletes a project without ever calling
`git-service.ts:167`'s `removeWorktree` — a leak this feature should close.

**What the source actually says**: `project:delete` in the **main** process resolves the project, and when
`isWorktree && worktreePath` it awaits `removeWorktree(workspace.folderPath, project.worktreePath)` before
deleting the record (`src/main/ipc/workspace.ipc.ts:91-98`). The renderer store correctly delegates
(`workspace.store.ts:210-225`). There is no leak.

**Decision**: bulk cleanup calls the existing `project.delete` IPC for worktree-backed projects and the
existing session-close path for sessions. **No new IPC channel, no new git-service call, no change to
`git-service.ts`.**

**Rationale**: the capability exists and is tested. Adding a second path to the same operation would violate
Principle V.

**Consequence for the spec**: FR-037 is already satisfied by existing code; it becomes a regression test
(assert `project:delete` removes the worktree), not new work. FR-024's on-disk confirmation copy is the only
new part.

---

## R3 — Session records are renderer-only; the new fields need no persistence layer

**Finding**: the main process owns PTYs, not sessions. `TerminalSessionSchema`
(`src/shared/schemas/session.schema.ts:6-15`) is **exported and referenced nowhere** — another dead export.
Sessions live only in the renderer zustand store (`session.store.ts`) and do not survive a restart. The
existing renderer-only view fields `bellCount` and `busy` are on the `TerminalSession` TS type
(`src/shared/types/index.ts:54-57`) but deliberately absent from the zod schema.

**Decision**: `lastActivityAt`, `lastAttendedAt`, `agentState`, and `note` are added to the
`TerminalSession` TS type as renderer-side view state, documented with the same comment convention as
`bellCount`/`busy`. **No zod schema change, no IPC change, no migration.** Delete the dead
`TerminalSessionSchema` export in the same PR.

**Rationale**: the source plan's §1.3 backfill and "no migration file needed" conclusion was right, but for
a stronger reason than it stated — there is nothing to migrate because there is nothing persisted.

**Alternatives considered**: persisting sessions to make staleness meaningful across restarts — rejected,
explicitly out of scope per the spec's Assumptions (that is feature S2).

---

## R4 — `agentState` derivation and the source seam

**Finding**: the only real activity signals are (a) xterm's `onBell`, (b) byte-flow busy/idle with
`IDLE_DEBOUNCE_MS = 1500` (`TerminalSession.tsx:5,144-157`), and (c) PTY exit
(`session.store.ts:398-412`). All three are wired in one place, `session-controller.ts:28-34`. Claude Code
hooks belong to the `speckit-pilot` extension (`extensions/speckit-pilot/src/runtime/claude-launch.ts`) and
Principle II forbids core reading them; shell-launched `claude` emits none.

**Decision**: derive `agentState` from existing signals only —

| State            | Source                                      | Confidence                                   |
| ---------------- | ------------------------------------------- | -------------------------------------------- |
| `exited`         | `handleProcessExit` sets `status: 'closed'` | real                                         |
| `working`        | `busy === true` (bytes in the last 1.5 s)   | real                                         |
| `awaiting-input` | `bellCount > 0`                             | heuristic — bell is the only signal core has |
| `idle`           | complement                                  | real                                         |

Expose one `AgentStateSource` interface with a single implementation (`BellAndBusySource`) so a better
source can replace it without touching the UI, and document the limitation in the README rather than
implying certainty.

**Rationale**: honest and cheap. A single seam with one implementation is the smallest thing that satisfies
"swappable later" without speculative abstraction (Principle VII) — it exists because the spec's SC-003 is
explicitly scoped to detectable sessions and the README must say why.

**Alternatives considered**: parsing prompt frames out of the scrollback to detect a waiting agent —
rejected: unbounded scope, fragile against every agent's output format, and not required by any FR.

---

## R5 — Timestamp representation

**Decision**: `lastActivityAt` and `lastAttendedAt` are **epoch milliseconds (`number`)**, not ISO strings.

**Rationale**: they are compared against `Date.now()` on every render of every row and every staleness
evaluation; ISO strings would mean parsing per comparison. The surrounding persisted fields (`createdAt`,
`closedAt`) stay ISO strings because they are serialised; these two are never serialised (R3). Backfill is
`lastActivityAt ??= Date.parse(session.createdAt)` at construction.

**Alternatives considered**: ISO strings for consistency with `createdAt` — rejected: consistency with a
persisted field is not worth a parse in a hot path, and the mixed representation is contained to two
renderer-only fields with a comment saying so.

---

## R6 — Where staleness threshold and view definitions live

**Finding**: two persistence mechanisms already exist. `GlobalSettings` (`settings.schema.ts`, zod-validated,
electron-store via IPC, has a settings panel). Ad-hoc localStorage keys for sidebar UI state:
`terminator.sidebar.width` (`UnifiedSidebar.tsx:29`), `terminator.workspace.expanded` and
`terminator.project.collapsed` (`workspace.store.ts:229-270`), `openPanels` (`App.tsx:349`).

**Decision**:

- **`staleAfterMs` → `GlobalSettingsSchema`**, in a new `sidebar` group, bounded
  `z.number().int().min(60_000).max(30 * 24 * 3_600_000)`, default `7_200_000` (2h). It is a user-facing
  setting (FR-020) and needs a settings-panel row, which is what that schema is for.
- **View definitions → one localStorage key `terminator.sidebar.views`.** They are UI state, not
  configuration; they never cross the IPC boundary; and this matches the three existing sidebar keys exactly.

**Rationale**: each value goes to the mechanism that already serves its kind. Putting views into
`GlobalSettings` would push renderer UI state through IPC into the main process for no benefit; putting
`staleAfterMs` in localStorage would leave a documented setting outside the settings panel and outside zod
validation.

**Alternatives considered**: both in `GlobalSettings` (one mechanism, but IPC round-trip for pure UI state);
both in localStorage (no schema validation and no settings row for a documented setting). Both rejected.

---

## R7 — Activity stamping and write throttling

**Finding**: `onBusy` fires on **every** PTY output chunk (`TerminalSession.tsx:144-157`), and the store
already guards re-entry — `setSessionBusy` returns the unchanged state when `busy` is already `true`
(`session.store.ts:380-384`). A naive `lastActivityAt` write on the same callback would defeat that guard and
produce a store write, and a full sidebar re-render, per chunk.

**Decision**: throttle in `session-controller.ts`, not in the store. Keep a per-session
`lastStampedAt` map in the controller module and call `stampActivity(sessionId)` at most once per second;
the store setter itself stays a plain pure patch.

**Rationale**: the store must remain a dumb, deterministic, testable reducer (Principle XI). The controller
is already the single owner of "translate terminal events into store state", so throttling belongs there.
Testable by faking the clock — the controller takes `now()` as an injectable rather than calling `Date.now()`
directly.

**Alternatives considered**: `requestAnimationFrame` coalescing (couples renderer state to frame timing,
untestable headlessly); debouncing in the store (hides timing in the reducer).

---

## R8 — Status vocabulary without colour

**Constraint**: Constitution XII — `lucide-react` only, flat, `currentColor`, opacity for state, size via
CSS. Spec FR-004 and SC-011 add WCAG 1.4.1 (never hue alone).

**Decision**: one dot glyph at three opacities for `working` / `idle` / `exited`, plus for
`awaiting-input` a 3px accent left-edge bar on the row **and** a short text pill. No unicode status glyphs
(`◐ ◆ ○ ⊗`) — they font-fallback to a different baseline and are indistinguishable at 12px. The existing
spinning ring for busy (`SessionRow.tsx:71-82`) is retained.

**Rationale**: shape + text carries the one state that matters when colour is unavailable; opacity carries the
rest, which is exactly the differentiation Principle XII permits.

**Out of scope, noted**: `App.tsx:583,600` renders `⬡` and `⌥` as `EmptyState` icons — a pre-existing
Principle XII violation in files this feature does not own. Flagged, not fixed.

---

## R9 — Keyboard: reuse the existing palette, do not add a second one

**Finding**: `useKeyboardShortcuts.ts` is a renderer `keydown` handler and is the established home for app
shortcuts; `globalShortcut` is used only by the main-process Extension API (`api.ts:218,635`). Taken
bindings include `⌘,` `⌘P` `⌘⇧L` `⌘⇧E` `⌘⇧T` `⌘1-9` `⌘=` `⌘-` **`⌘K` (CommandPalette)** `⌘T` `⌘D` `⌘⇧D`
`⌘W` `⌘←` `⌘→`. `CommandPalette` already merges renderer `commands` with extension commands
(`CommandPalette.tsx:52-74`).

**Decision**: the spec's "session palette" is a **session section added to the existing `⌘K` palette**, not a
new overlay. New bindings: `⌘]` / `⌘[` (MRU cycle), `⌘⇧A` (next awaiting-input), `⌘I` (edit note). All in
`useKeyboardShortcuts.ts`. `Escape` is not bound — it is live in Claude Code and vim, and double-Escape
already exits extensions (`useExtensionEscapeExit.ts`, PR #150).

**Rationale**: a second palette would duplicate matching, rendering, and keyboard handling for no user
benefit (Principle V). FR-027's "reachable from the command palette" is satisfied by registering the scope
actions as renderer commands, which the palette already renders.

---

## R10 — Extraction of the duplicated primitives

**Finding, verified**: four hand-rolled HTML5 drag-reorder implementations —
`UnifiedSidebar.tsx`, `WorkspaceCard.tsx`, `ProjectRow.tsx`, `TabBar.tsx`. Four `ctx-menu` implementations
coordinated by a `window` `CustomEvent('close-context-menus')` — `ScratchSection.tsx:37,138`,
`ProjectRow.tsx:92,324`, `WorkspaceCard.tsx:97,255`, `SessionRow.tsx:65,161`. (The source plan said three of
each; it is four.)

**Decision**: extract `useDragReorder` and a `ContextMenu` primitive in Phase 0, migrate the three sidebar
drag sites and all four menu sites, and leave `TabBar.tsx`'s drag site alone.

**Rationale**: the flat list needs both, and adding a fifth and a fifth is the wrong direction. Two concrete
existing cases each is the earned-abstraction bar from Principle V. `TabBar` is outside the sidebar and
outside this feature's blast radius — migrating it would be scope creep with its own regression risk.

**Alternatives considered**: `dnd-kit` or `react-dnd` — rejected under Principle IV: a new production
dependency to replace ~20 lines of native HTML5 drag that already works, in an app with no other drag
requirements.

---

## R11 — Coverage baseline (measured, not assumed)

Full suite on this branch before any change: **354 files, 6121 tests, all passing**; project totals
94.67% statements / 87.75% branches / 91.17% functions / 95.89% lines.

Per-file baseline for every file this feature touches:

| File                      | Stmts     | Branch    | Funcs     | Lines     | Note                                                       |
| ------------------------- | --------- | --------- | --------- | --------- | ---------------------------------------------------------- |
| `UnifiedSidebar.tsx`      | **69.41** | **69.23** | 75        | **71.25** | **below the 80% gate today**                               |
| `WorkspaceCard.tsx`       | 87.5      | 92.59     | 88.88     | 86.76     |                                                            |
| `ProjectRow.tsx`          | 93.93     | 92.95     | 87.5      | 93.4      |                                                            |
| `SessionRow.tsx`          | 94.44     | 92.85     | 90.9      | 95.45     |                                                            |
| `SidebarHeader.tsx`       | 100       | 83.33     | **66.66** | 100       | untouched by this feature (D1)                             |
| `session.store.ts`        | 97.96     | 83.89     | 100       | 98.8      |                                                            |
| `registry.ts`             | 95.45     | 98.07     | 91.8      | 97.19     | lines 225-227 uncovered = the dead `registerSidebarButton` |
| `settings.store.ts`       | 88.33     | 87.5      | 86.36     | 87.93     |                                                            |
| `useKeyboardShortcuts.ts` | 97.61     | 93.54     | 81.81     | 99.13     |                                                            |

**Decision**: `UnifiedSidebar.tsx` is pre-existing debt below the patch-coverage gate and is rewritten by
this feature, so it must land at ≥80% on all four metrics — treat that as a Phase 3 exit condition, not a
surprise at PR time. No other touched file starts below the gate.

---

## R12 — Dead code inventory to remove (Constitution X)

Verified unreferenced, all inside files this feature rewrites:

1. ~~`registerSidebarButton` / `sidebarButtons` / `SidebarButtonRegistration`~~ — **kept and wired**, see
   R1-CORRECTION.
2. ~~`ExtensionFooter.tsx` + `ExtensionFooter.css`~~ — **kept and moved to the sidebar footer**, see
   R1-CORRECTION.
3. `TerminalSessionSchema` (`session.schema.ts:6`) — exported, referenced nowhere — R3.
4. `ProjectRow`'s `gitDirty`, `gitConflict`, `onBranchBadgeClick` props and the `project-row__branch-chip`
   they style: no caller passes any of them, and the chip additionally renders only when `!branchSwitcher`,
   which `WorkspaceCard.tsx:184` always supplies. Unreachable twice over.

Each is deleted with its tests, and the deletion is stated in the PR body.

---

## Confirmed defects to fix before the new rows ship (spec FR-034 to FR-036)

- `ProjectRow.tsx:236` and `:262` pass `bellCount={getBellCountForProject(project.id)}` to **every**
  `SessionRow`, so a single bell shows on all of that project's rows. `getBellCountForSession` already
  exists (`session.store.ts:371`) and is the correct call.
- `ProjectRow.tsx:261` passes `isBusy={isSessionBusy(session.id)}` to the **child** row — the parent's id.
  Must be `child.id`.
- The dead git-status props above (R12 item 4).
