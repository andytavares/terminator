# Phase 0 Research: Declutter the Sidebar, and a Board for the Fleet

**Feature**: `034-declutter-sidebar` | **Date**: 2026-09-05

All findings are grounded in the code on `main` @ `6bfc43b9`. File and line references were read, not inferred.

---

## R-001: The pure layer groups sessions; the sidebar must now list branches

**Decision**: Add a new pure module `src/renderer/sidebar/branch-rows.ts` exporting `buildBranchRows(...)`. Do **not** change `buildGroups`' signature.

**Rationale**: `buildGroups` (`view-model.ts:201`) returns `Group[]` whose leaf is `sessions: TerminalSession[]`. Every consumer — `UnifiedSidebar`, the view chips' counts, `FilterNotice` — reads that shape. Rewriting it in place would change `Group`, `BuildResult`, `GroupScope` and `bucketFor` simultaneously and break `view-model.spec.ts` and `view-model-performance.spec.ts` wholesale, with no green step in between. A sibling function that consumes the same inputs and returns a branch-shaped result lets the row work land under a passing suite, and lets `buildGroups` be deleted in one final commit once nothing imports it.

`buildGroups` is still needed during the transition and for one thing afterwards: it seeds a bucket for every project even when that project has no sessions (`view-model.ts`, the `isNarrowed` block), which is what stops a branch with no terminals from disappearing. `buildBranchRows` must keep that behaviour unconditionally — a branch is a row whether or not a terminal is open on it (FR-001, FR-003).

**Alternatives considered**:

- _Change `Group.sessions` to `Group.branches`._ Rejected: it is the same rewrite with the tests still red for the whole feature.
- _Keep `buildGroups` and derive branches in the component._ Rejected: it puts the "what is shown" decision back in React, which is exactly what ADR-027's pure layer exists to prevent, and makes the aggregate state untestable without a DOM.

---

## R-002: Branch state aggregation belongs beside `agent-state.ts`, not inside it

**Decision**: Add `aggregateBranchState(sessions: TerminalSession[]): AgentState` to a new `src/renderer/sidebar/branch-state.ts`. Reuse the existing `STATUS_ORDER` severity array rather than declaring a second one.

**Rationale**: `view-model.ts` already declares the exact precedence FR-003 asks for:

```ts
const STATUS_ORDER: AgentState[] = ['awaiting-input', 'working', 'idle', 'exited']
```

with the comment that it is "shared by status grouping and status sorting so they never disagree". A third copy in a new module is how the two get out of step. Export it from `view-model.ts` and import it.

The empty case is the part the constant does not answer: FR-003 says a branch with no terminals reads **idle**, not exited. `Math.min` over an empty list of severities would naturally give the last entry (`exited`), so the empty case needs an explicit early return and its own test.

`BellAndBusySource.derive` (`agent-state.ts`) maps one session to one state and is unchanged. Aggregation is a different question — many sessions to one state — so it gets its own module rather than a second method on the `AgentStateSource` interface, which is a published seam with one implementation.

**Alternatives considered**:

- _Store the aggregate on `Project`._ Rejected for the same reason ADR-031 keeps change statistics off the `Project` record: it would make the pure layer a function of when the store last updated, destroying determinism.

---

## R-003: Moving a board card between lanes destroys its live preview

**Decision**: The board is **one CSS grid containing every card**, with a card's lane expressed as `grid-column`. Cards are never re-parented. Lane headers are separate elements in row 1.

**Rationale**: This is the highest-risk finding in the feature. `mountPreview` (`TerminalSession.tsx:471`) does not render a copy — it **moves the one live xterm element** into the container:

```ts
container.appendChild(this.element)
```

and its cleanup does `this.element.parentElement?.removeChild(this.element)`. `SessionTile` calls it from a `useLayoutEffect` keyed on `[session.id, getTerminalInstance]` (`SessionTile.tsx:44-49`).

If a card is rendered inside a per-lane container, then a state change moves it to a different React parent. React unmounts the old subtree and mounts a new one, the layout effect's cleanup runs, the live element is yanked out and re-appended, and the preview flashes empty in the middle of the 180 ms transition the spec asks for (FR-011). Worse, the element is a singleton: there is exactly one per session, so any arrangement that could mount two previews of the same session at once tears it out of the first.

Keeping every card in a single grid and changing only `grid-column` means the DOM node is stable, the layout effect never re-runs, and the preview is untouched while the card moves. It also makes the FLIP animation trivial, because the node identity survives.

**Consequences for the plan**:

- Lane membership is a computed CSS property, not a tree position.
- Empty lanes (FR-009) draw a header and nothing else — with a single grid, "nothing else" is the natural result of no card claiming that column.
- The exited lane hiding while empty (FR-010) is a column-template change, not an unmount.

**Alternatives considered**:

- _Per-lane containers, accept the flash._ Rejected: it breaks FR-020 (preserve the preview) at exactly the moment FR-011 is meant to be legible.
- _Replace the live preview with `captureToDataUrl` snapshots._ (`TerminalSession.tsx:505`.) Rejected: it trades a live surface for a stale JPEG, and FR-020 requires the preview be preserved.

---

## R-004: "Which terminal focuses" already has a store answer

**Decision**: Implement FR-047's ordering as: a terminal in `awaiting-input` → else `getActiveSessionForProject(projectId)` → else most recently active → else offer to start one.

**Rationale**: `session.store.ts:138-139` already exposes `setActiveSessionForProject` / `getActiveSessionForProject` backed by a per-project `projectViews` map. "The one you last had open on that branch" is therefore not new state — it is a read of something the store has kept all along, and the tab bar already uses it (`TabBar.tsx`). Only the needs-you preference and the empty case are new logic.

`UnifiedSidebar` currently calls `selectSession(session.projectId, session.id)` from a terminal row (`UnifiedSidebar.tsx:641`) and `setActiveProject(projectId)` from headers (lines 420, 434, 445). With terminal rows gone, the branch row's click handler becomes `setActiveProject` plus this resolution.

---

## R-005: The tab bar already holds most of what FR-021–024 asks for

**Decision**: Add only the state glyph. Bell, rename, close and move are already there; the note becomes a `title` attribute.

**Rationale**: `TabBar.tsx` already destructures `getBellCountForSession`, `isSessionBusy`, `renameSession`, `closeSession`, and renders `AlertBadge` and `ActivitySpinner`, plus `MoveSessionDialog` and a context menu. So FR-022 (bell) and FR-024 (rename/close/move) are satisfied by code that exists; the gap is FR-021, the four-state glyph, and it is a direct call to the existing `statusPresentationFor(session)` (`session-status.ts:42`) because the tab already has the session object.

The density risk is real and bounded by measurement: `.tab-bar__tab` is `min-width: 90px; max-width: 200px; padding: 0 14px; gap: 7px`, and `.tab-bar--sessions .tab-bar__tab` tightens to `min-width: 100px; padding: 0 10px`. Adding a glyph, a bell and a note to that box is the same move that put ten elements on a 24px row. The note is therefore **not drawn** — it is the tab's `title` — and the tab is capped at four elements: glyph, title, one trailing slot (bell when it has a count), and close on the active tab only.

---

## R-006: Built-in views filter on session state and must be re-expressed

**Decision**: A branch matches a view when **any of its terminals** matches that view's filters. Retire `groupBy: 'status' | 'branch' | 'none'` down to `'workspace' | 'none'`; retire `sortBy: 'status'`'s session semantics.

**Rationale**: `views.ts` ships four built-ins whose filters are session-level: `needs-me` filters `states: ['awaiting-input']` and groups by `status`; `active` filters `states: ['working']`; `stale` sets `staleOnly`. With branches as the listed item, "group by status" means bucketing branches by their aggregate, which is a different and largely redundant view now that the gutter shows state on every row — so it goes (FR-038, FR-023 of the spec's chrome section).

`needs-me`'s comment explicitly justifies status grouping by "one 'Awaiting you' section with a project badge per row beats the same six sessions split across five headings". That reasoning dies with the terminal rows: the branch row _is_ the thing, and the repo grouping is one level, not five. `needs-me` becomes `groupBy: 'workspace'` with a branch-level filter.

**Open consequence**: `loadViews()` re-applies user overrides keyed by view id. A stored override naming a retired `groupBy` must degrade to the default rather than throw — `views.ts` already degrades corrupt storage to the built-ins, and the same guard covers this.

---

## R-007: Stale multi-select and bulk close lose their surface

**Decision**: **Delete** them — `.session-row__select`, `.session-group__select-all`, the bulk bar, `BulkCloseDialog`, and their tests — and say so in the PR.

**Rationale**: These operate on terminal rows and their checkboxes, which FR-001 removes. The three re-homing options were weighed:

- _Move to the board._ The board's job is "what is happening now"; bulk-closing stale terminals is housekeeping, and putting checkboxes on cards re-imports the density this feature is removing.
- _Make it act on branches._ Closing a branch is a different and more dangerous operation than closing a stale terminal, and nothing in the spec asks for it.
- _Delete._ Chosen. FR-025 requires anything that cannot be re-homed to go with its controls and its tests, and `feedback_delete_unreachable_features` is explicit that wired-but-inert reads as shipped.

The `stale` built-in view survives as a **filter** — it still answers "which branches have gone quiet" — it just no longer offers a multi-select.

---

## R-008: Container-query breakpoints must be re-derived, not inherited

**Decision**: Re-measure and re-set the two `@container sidebar` breakpoints against the new row anatomy. Guarantee: a row never drops its branch name or its state glyph (FR-049).

**Rationale**: The current values are tuned to a 13-element header and a 10-element row: `SessionGroup.css` hides change stats below `289px` and the worktree tag below `249px`; `SessionRow.css` hides the activity label below `219px`. With six elements at most, those thresholds are wrong in both directions — they will drop facts that now fit, and they reference elements (`__wt`) that no longer exist. The sidebar's `container-type: inline-size` and `container-name: sidebar` stay as they are.

---

## R-009: Type roles are inverted today and the fix is a token reassignment

**Decision**: Mono for machine facts, sans for human language. Delete the undefined `--font-sans` reference.

**Rationale**: Verified by reading computed style in a real browser, not by reading CSS:

|                               | today           | after           |
| ----------------------------- | --------------- | --------------- |
| Branch name (a machine fact)  | `IBM Plex Sans` | `IBM Plex Mono` |
| Terminal title (a human name) | `IBM Plex Mono` | `IBM Plex Sans` |

`SessionRow.css:10` sets the whole row to `var(--font-mono)`; `SessionGroup.css` declares no family and inherits `--font-ui` from `body` (`styles.css:173`). Both tokens already exist and are correct (`styles.css:3-4`), and `@fontsource/ibm-plex-sans` is already a dependency — so this is an assignment change with no new dependency, satisfying Principle IV by adding nothing.

Separately, `SidebarSearch.css:32` reads `font-family: var(--font-sans)`, and `--font-sans` is **never defined** anywhere in `src/`. The declaration is invalid at computed-value time so it silently inherits and looks correct, which is why it has survived. Delete it (Principle X: dead code is a defect).

---

## R-010: Removing the washes must not remove the contrast guarantee

**Decision**: Retarget `tests/unit/renderer/sidebar-workspace-tint.spec.ts` to the rail and the swatch. Do not delete it.

**Rationale**: That spec reads the real CSS and asserts each wash is shallow enough to keep text on it at WCAG AA for all ten preset colours in both themes. Deleting the washes without retargeting the spec deletes the guarantee with them, and FR-044 keeps it.

There is a defect to fix while retargeting, measured in a browser against the app's real light-theme tokens (`styles.css:118`). Painting a repo name in its own swatch, composited over that swatch's own 10% wash, gives:

| repo colour | contrast today | after    |
| ----------- | -------------- | -------- |
| `#facc15`   | **1.08 : 1**   | 15.0 : 1 |
| `#4ade80`   | **1.23 : 1**   | 15.0 : 1 |
| `#5cc0bb`   | **1.52 : 1**   | 15.0 : 1 |

AA requires 4.5 : 1. Moving the colour into a 7px swatch and the name to `--text-primary` fixes it rather than working around it (FR-043, FR-044).

---

## R-011: The needs-you edge and the repo rail collide (spec contradiction)

**Decision**: The repo rail is the only coloured edge. State emphasis moves into the status gutter — full opacity for `awaiting-input`, dimmed for everything else.

**Rationale**: FR-040 makes the repo colour the only coloured edge, but the needs-you signal is an edge today and deliberately overrides the repo rail:

```css
SessionRow.css:34  box-shadow: inset 2px 0 0 var(--ws-color, var(--accent));
SessionRow.css:92  .session-row--needs-you { box-shadow: inset 3px 0 0 0 var(--accent); }
```

Both cannot own the left edge. This was raised in design review and the spec needs FR-040 amended to say so; the plan implements the resolution either way, since shipping both requirements literally is impossible.

Constitution XII constrains the resolution: icons are flat, inherit `currentColor`, and **never** use colour to differentiate state. So the gutter separates states by shape and opacity only, which is also what makes SC-004 and SC-005 hold in greyscale.

---

## R-012: Coverage and the patch gate

**Decision**: Measure each touched file's current coverage before editing it, and treat any file already below 80% as a blocker to be raised in the same commit.

**Rationale**: The gate is a hard blocker at 80% on lines, functions, branches and statements (`vitest.config.ts:84-88`), and it measures the **whole file**, not the patch — so a pre-existing sub-80% file blocks an unrelated edit to it. `project_patch_coverage_gate_pre_existing_debt` records this biting before.

The specs this feature invalidates or rewrites:

| Spec                                                             | Fate                                          |
| ---------------------------------------------------------------- | --------------------------------------------- |
| `tests/unit/renderer/components/SessionRow.spec.tsx`             | delete with the component                     |
| `tests/unit/renderer/components/WorkspaceRow.spec.tsx`           | delete with the component                     |
| `tests/unit/renderer/components/ViewBar.spec.tsx`                | delete; replaced by Filter/Display menu specs |
| `tests/unit/renderer/components/SessionGroup.spec.tsx`           | rewrite as repo header + branch row           |
| `tests/unit/renderer/components/UnifiedSidebar.spec.tsx`         | rewrite                                       |
| `tests/unit/renderer/components/OverviewScreen.spec.tsx`         | rewrite for lanes                             |
| `tests/unit/renderer/components/SessionTile.spec.tsx`            | rewrite as the card                           |
| `tests/unit/renderer/components/TabBar.spec.tsx`                 | extend for the state glyph                    |
| `tests/unit/renderer/sidebar/view-model.spec.ts`                 | keep until `buildGroups` is deleted           |
| `tests/unit/renderer/sidebar-workspace-tint.spec.ts`             | retarget (R-010)                              |
| `tests/unit/renderer/sidebar-status-colour-independence.spec.ts` | keep — it guards Constitution XII             |
| `tests/e2e/sidebar-branch-first.spec.ts`                         | rewrite                                       |

`feedback_verify_css_by_rendering` applies throughout: jsdom cannot compute `color-mix`, so every claim about a background or a contrast ratio must be verified by rendering in headless chromium, which is already a dev dependency (`playwright 1.61.0`).

---

## Resolved unknowns

Every `NEEDS CLARIFICATION` from Technical Context is answered above. No open questions block Phase 1.
