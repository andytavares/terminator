# Session Surface Repairs

Design document · 2026-09-23 · covers four reported issues on Home, the Overview wall, terminal focus, and issue links.

## Context

Home and the Overview wall (feature 054) are where an operator watches many terminals at once. Four things get in the way:

1. Home draws every state in the same grey, so nothing stands out as needing you.
2. Busy sessions keep swapping places.
3. Opening a session doesn't always put the cursor in it.
4. A ticket linked from Home or the wall never shows on that terminal in the sidebar.

All four are in core renderer code, with one change in main (notifications). No Extension API change.

## Goals

- A session that needs you is visible at a glance on Home, and doesn't depend on colour alone.
- A session's position on Home and the wall changes only when its standing changes (it needs you, it exits, it is new). Output alone never moves it.
- Every way of opening a session (Home, wall, sidebar, tab bar, Quick Actions, notification, extension) leaves keyboard focus in that terminal's input.
- A session's work item is read one way and drawn on every surface that draws the session, including the sidebar terminal row.

## Non-goals

- Colouring the sidebar tree (not reported).
- Merging the project link and the session link into one record (see Options, issue 4).
- Feeding a session-level link into agent context. This is a real gap, listed under Open questions.
- Changing how agent state is detected.

## Evidence

A throwaway Playwright probe against a fresh `npm run build` (exit 0) opened one branch with three terminals. Two ran `while true; do echo tick; sleep 0.4; done`, and the probe sampled the surfaces every 250 ms for 10 s. The probe was run with `E2E_TOOLS=1 npx playwright test tests/e2e/tools/probe-research.spec.ts`, then removed from the tree.

| Measurement                                               | Result                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Home Ledger row order changes in 40 samples               | **10**: `Terminal 2, Terminal 1, Terminal 3` ↔ `Terminal 1, Terminal 2, Terminal 3` |
| Wall tile CSS `order` changes in 40 samples               | **8**: Terminal 1 and Terminal 2 swapping `order` 2 ↔ 3                             |
| Focus after Enter on a Ledger row                         | `TEXTAREA.xterm-helper-textarea` ✓                                                   |
| Focus after "Open Terminal 3" on a wall tile              | `TEXTAREA.xterm-helper-textarea` ✓                                                   |
| Quick Actions → Sessions → Terminal 1, launched over Home | Home **still shown**, focus on `BODY` ✗                                              |
| Sidebar terminal row click, different session             | `TEXTAREA.xterm-helper-textarea` ✓                                                   |
| Sidebar terminal row click, the session already active    | focus on `DIV.terminal-row` ✗                                                        |

The notification path was not driven live; its findings below come from the code.

## Issue 1: Home is monochrome

### Current state

- `src/renderer/components/session/StateIcon.tsx:7` documents the rule: state is drawn as "shape and opacity, never hue". The four glyphs differ by opacity alone (`--state-op-*`, `src/renderer/styles.css:44-47`), and the idle glyph sits at 0.34.
- The only hue on a Ledger row is the workspace rail (`src/renderer/components/home/LedgerView.css:52`: "The workspace's colour is this edge and nothing else.").
- The Ledger groups by workspace/project by default (`src/renderer/sidebar/home-prefs.ts`, `groupBy: 'workspace-project'`). A session that needs you is therefore sorted to the top _of its group_, not the top of the page. The wall already pins a Needs-you band (`wall-order.ts`, `pinNeeds`).
- Constitution XII (`.specify/memory/constitution.md:187-195`) forbids colour **on icons**: "Never use color to differentiate icon states". It says nothing about fills, borders or labels.

### Contrast of the tokens we would use

Measured with the WCAG relative-luminance formula against `--bg-base`, and against a 14% tint of the colour itself. The script is inline in the session. Hex values come from `src/renderer/styles.css`.

| Token         | Dark, on bg | Dark, on own tint | Light, on bg | Light, on own tint |
| ------------- | ----------- | ----------------- | ------------ | ------------------ |
| `--warning`   | 12.75       | 9.73              | 4.48         | 3.74               |
| `--success`   | 11.21       | 8.80              | 7.15         | 5.73               |
| `--accent`    | 4.02        | 3.58              | 4.28         | 3.61               |
| `--agent-clr` | 4.61        | 4.07              | 3.73         | 3.16               |

As text, `--warning` fails AA (4.5:1) in light mode, and `--accent` fails in both themes. All four clear the 3:1 non-text threshold against the ground, which is the rule for fills and borders. This matches a known pre-existing failure, where the workspace colour used as text measures 1.6 to 3.4:1.

### Options

- **A. Colour on fills and borders; text and icons stay neutral.** A state chip holds the glyph (still `currentColor`) and a text label ("Needs you", "Working", "Idle", "Exited") on a state-tinted fill with a state-coloured edge. Needs-you rows also get a full-row tint. This fits XII, passes contrast because the words stay `--text-primary`, and colour is never the only channel.
- **B. Colour the state glyphs.** This is the cheapest change and the one most apps make. It violates XII and needs a constitution amendment. It also fails contrast for the accent hue in both themes.
- **C. More weight, no hue.** Bold names for needs-you rows and larger glyphs. This keeps the current rule, but the operator is asking for colour, and weight alone is what already reads as "all the same".

### Decision

**Option A.** Spend colour on two states only: amber for _needs you_ and green for _working_. Idle and exited stay neutral, because they are the states that ask nothing of you. Colour then means something every time it appears.

### Design

- **Tokens.** Add these to `src/renderer/styles.css`, defined in both theme blocks:
  - `--state-needs: var(--warning)` and `--state-working: var(--success)`.
  - `--state-needs-fill` and `--state-working-fill`, as `color-mix(in srgb, <token> 14%, transparent)`.
  - These are core-only. They do not go into `EXTENSION_BASE_CSS`, because no extension draws session state.
- **`StateIcon` becomes `StateChip`.** Edit `src/renderer/components/session/StateIcon.tsx` and its CSS.
  - The chip holds the lucide glyph (unchanged: `currentColor`, opacity tokens) and a label.
  - The label comes from `statusPresentationForState`, which already exists.
  - The chip has a `border-left: 2px solid var(--state-*)` and a `--state-*-fill` background, and is set in `--text-primary`.
  - A `compact` prop keeps today's glyph-only form for the tab bar and the sidebar, which are out of scope.
- **Ledger.** Edit `src/renderer/components/home/LedgerView.tsx` and `.css`.
  - The state column shows the chip.
  - `.ledger__row--needs` gets a `--state-needs-fill` background.
  - The workspace rail stays as it is.
- **A Needs-you group on top.** Edit `src/renderer/sidebar/ledger-rows.ts`.
  - Under `sort: 'needs-you'`, awaiting-input sessions are lifted out of their workspace groups into a first group labelled "Needs you", as the wall does.
  - Their other groups no longer list them.
  - The group heading carries the needs-fill, so it reads as a band at the top of Home. This follows the rule that input surfaces go front and centre.
- **Logbook and wall** reuse the chip (`LogbookView.tsx`, `WallTile.tsx`). A needs-you tile gets a `--state-needs` border in place of `--border`.
- **Group headings** gain a small workspace swatch, a filled square in the workspace colour. This answers "what is what" without using the workspace colour as text.

## Issue 2: Sessions fight over position

### Current state (root cause)

Every sort that places a session on Home or the wall uses `lastActivityAt` as its first or second key:

- `src/renderer/sidebar/wall-order.ts:18` sorts with `byRecent`, and uses it as the tiebreak under `thenBy: 'state'` (`:27`).
- `src/renderer/sidebar/ledger-rows.ts:36` breaks ties within a state by `lastActivityAt`.
- `src/renderer/sidebar/logbook-groups.ts:34` sorts each state group by `lastActivityAt`.

`lastActivityAt` is rewritten about once a second for every session producing output: `ACTIVITY_STAMP_INTERVAL_MS = 1000` at `src/renderer/terminal/session-controller.ts:35`, stamped from `onBusy` at `:62`. Two sessions that are both printing swap places on every stamp, which is what the probe measured: 10 swaps in 10 s on Home and 8 on the wall.

A second driver, from the code and not measured: `working` ranks above `idle` in `STATUS_ORDER` (`view-model.ts:36`), and a session flips to idle after 1.5 s of quiet (`IDLE_DEBOUNCE_MS`, `TerminalSession.tsx:6`). An agent that pauses to think therefore jumps between the Working and Idle bands.

### Options

- **A. Sort on keys that don't move while a session runs.**
  - Rank on _standing_: needs you, then running (working and idle together), then exited.
  - Then sort by `createdAt`, oldest first, so a new session appears at the end.
  - A session moves only when its standing changes.
  - The ordering stays pure, stateless and testable.
- **B. Sticky order with hysteresis.** Remember the last order and move a row only after its key has been stable for N seconds. This needs state carried between renders. It breaks the purity of the `sidebar/` layer (Constitution XI, `purity.spec.ts`), and it still moves rows, just later.
- **C. Make "recent" mean _recently attended_.** Sort by `lastAttendedAt`, which changes only when you open a session (`session.store.ts`, `setActiveSessionForProject`). This is stable while you watch and answers "what was I just in".

### Decision

**A as the default, and C as the "recent" option.** Output is no longer an ordering key anywhere. The "Recent" choice in the Ledger's Display menu and the wall's _Then by_ becomes "Recently opened", sorted on `lastAttendedAt`.

### Design

- **`view-model.ts`** gains a pure `standingRank(state)`: `awaiting-input` → 0, `working` and `idle` → 1, `exited` → 2. `STATUS_ORDER` stays as it is for display grouping.
- **`wall-order.ts`**:
  - `thenBy('state')` becomes `standingRank`, then `startedAt` ascending.
  - `thenBy('recent')` becomes `lastAttendedAt` descending, then `startedAt`.
  - The Needs-you band orders by the time the session entered awaiting-input. That time needs a new `awaitingSince` on `TerminalSession`, set in `setSessionScreen` and `incrementBellCount` when the state first becomes awaiting.
  - Emission order and the one-grid invariant (ADR 036) are unchanged.
- **`ledger-rows.ts` and `logbook-groups.ts`** use the same comparators.
- **Logbook grouping.**
  - Working and Idle merge into one "Running" group, so a pause no longer moves a row between headings.
  - The chip still says Working or Idle.
- **`SessionFacts`** gains `lastAttendedAt` and `awaitingSince`, passed through in `session-facts.ts`. `WallPrefs.thenBy` and `HomePrefs.sort` keep their stored values: `'recent'` now means recently opened, so no migration is needed.

## Issue 3: Opening a session doesn't always focus it

### Current state (root causes)

- **Focus is a side effect of a remount.** `TerminalInstance.mount()` calls `this.terminal.focus()` (`TerminalSession.tsx:448`). The single-pane effect in `TerminalPane.tsx:43` returns early when the active session hasn't changed. So re-selecting the session that is already active never focuses it, and the sidebar row, which has `tabIndex={0}` (`TerminalRow.tsx:43`), keeps the focus. This was measured.
- **There are seven separate "go to session" paths**, and only some leave Home or the wall:

| Path                                                                       | Where                                           | Clears Home/wall            | Switches workspace |
| -------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------- | ------------------ |
| `navigateToSession`                                                        | `terminal/navigate-to-session.ts`               | yes                         | yes                |
| Extension `terminal:navigate-to-session`                                   | `App.tsx:905-919`                               | yes                         | yes                |
| Sidebar `selectSession`                                                    | `UnifiedSidebar.tsx:457` then `onSelectProject` | yes                         | yes                |
| Scratch row                                                                | `App.tsx:977-982`                               | **no** (workspace tab only) | n/a                |
| Quick Actions `onSelectSession` / `onNextWaiting` / `onCycleRecentSession` | `App.tsx:436-457`                               | **no**                      | **no**             |
| `selectSessionEverywhere` (shortcuts)                                      | `quick-actions/shortcut-behaviors.ts:17`        | **no**                      | **no**             |
| Tab bar                                                                    | `TabBar.tsx:91`                                 | n/a (already in terminals)  | n/a                |

In the Quick Actions row the probe measured Home still shown and focus on `BODY`.

- **Notifications don't lead anywhere.**
  - The bell notification (`session-controller.ts:21-27`) carries no target. `dispatchNotification` has no field for one (`src/renderer/lib/notifications.ts`).
  - In main, a macOS banner's click is wired only when the notification has `actions` (`notification-manager.ts:123`). A notification that has only `onClick` does nothing when its banner is clicked. That includes every extension notification using `onClick` (`extensions/api.ts:1014`).
  - Clicking the app into focus runs `refocusActive` (`TerminalPane.tsx`), which focuses whichever session was _already_ active, not the one that rang.

### Options

- **A. One reveal function with an explicit focus request.**
  - All paths call `revealSession(sessionId)`, which does what `navigateToSession` does and also stamps a `focusRequest` nonce in the session store.
  - The pane's effect keys on the nonce, not on the active id, and focuses after mount.
  - Re-selecting the same session changes the nonce, so it still focuses.
- **B. Focus on every `setActiveSessionForProject`.** Subscribe to the store and focus on each change. This misses the re-select case, which doesn't change the id, and it doesn't fix the paths that never leave Home.
- **C. Patch each call site.** Add `setActiveGlobalTab(null)` and a `.focus()` at the seven sites. This fixes today's symptoms, and the next path added will miss it again.

### Decision

**A.** The bug is that seven paths each decide what "open" means. Collapsing them into one function is the fix, and the nonce makes focus an intent rather than a side effect of mounting.

### Design

- **`src/renderer/terminal/navigate-to-session.ts`**:
  - Rename `navigateToSession` to `revealSession`, keeping the old name as an import alias only until the callers move.
  - It also clears `activeWorkspaceTabId` and `activeProjectTabId`, and ends with `useSessionStore.getState().requestFocus(sessionId)`.
- **`session.store.ts`** adds `focusRequest: { sessionId: string; nonce: number } | null` and `requestFocus(sessionId)`. The store stays a plain reducer; the nonce is a counter.
- **`TerminalPane.tsx` and `LeafPane.tsx`**:
  - One effect on `focusRequest?.nonce` calls `setFocusedSession` in split mode and `terminal.focus()` for the requested session, inside `requestAnimationFrame` so it runs after `mount()`.
  - The existing split-mode focus effect is removed, because this replaces it.
- **Call sites** that move to `revealSession`:
  - `App.tsx`: `onSelectSession`, `onNextWaiting`, `onCycleRecentSession`, `onCycleTab`, the extension bridge handler at `:905`, and the scratch row at `:977`.
  - `UnifiedSidebar.tsx` `selectSession`.
  - `TabBar.tsx:91`.
  - `shortcut-behaviors.ts` `selectSessionEverywhere` and the cycle helpers.
  - `session-controller.ts:140`, for a newly created session.
- **Notifications**:
  - `dispatchNotification` gains an optional `sessionId`. The IPC schema for `notifications:create` gains the same field.
  - In main, a `sessionId` becomes an `onClick` that shows and focuses the window and sends `terminal:navigate-to-session`. That message now ends in `revealSession`.
  - `notification-manager.ts:123` wires the banner click to `onClick` when there is one, and falls back to the first action. This fixes extension notifications too, without changing the Extension API.
  - The bell notification passes its `sessionId`.

## Issue 4: A link made on Home isn't shown in the sidebar

### Current state

There are two link records with two writers, and the surfaces read them differently:

| Record                | Store                                                         | Written from                                                                                               | Shown on                                                                                 |
| --------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Project (branch) link | `issue-link-store.ts` via `integrations.store.ts` `linkIssue` | Sidebar branch menu (`issue-menu-items.ts`), Quick Actions "Link issue" (`App.tsx:466`), `LinkIssueDialog` | Sidebar **branch** row (`UnifiedSidebar.tsx:601`), and Home and the wall via inheritance |
| Session link          | `session-records` via `session-records.store.ts` `setLink`    | `SessionLinkDialog` on Home (`HomeScreen.tsx:93`, `:227`) and on the wall (`OverviewScreen.tsx:215`)       | Home and wall only                                                                       |

- Home and the wall resolve the work item as _session link, else project link_ (`sidebar/work-item.ts`, `resolveWorkItem`).
- The sidebar terminal row has no work item at all. `BranchTerminal` (`branch-rows.ts:14`) carries only id, title, state, bell count and panes. `TerminalRow.tsx` draws name, bell and close.
- The tab bar shows only the description, as a tooltip (`TabBar.tsx:218`).
- Only the project link feeds agent context (`main/integrations/context-sync.ts`, `terminal.ipc.ts:72`).

### Options

- **A. One read path, two link levels.**
  - Every surface that draws a session reads its work item from `SessionFacts.workItem` (`resolveWorkItem`) and draws the same key chip.
  - Every "link this terminal" control opens the same `SessionLinkDialog`.
  - The branch row keeps its own project link.
  - This matches 054's FR-011/FR-012 and is additive.
- **B. One link level: session only.** Drop the branch link. This loses the branch default most sessions rely on, loses the agent context injection keyed by project, and reverses ADR 054.
- **C. One link level: branch only.** Drop the session link. This loses two sessions on one branch serving different tickets, which 054 designed for, and deletes the Home/wall link UI.

### Decision

**A.** "The same mechanism across the board" is met by one reader (`resolveWorkItem` through `SessionFacts`) and one writer per level (`SessionLinkDialog` for a terminal, `LinkIssueDialog` for a branch). Collapsing the levels would be a larger, lossy redesign.

### Design

- **`branch-rows.ts`**: `BranchTerminal` gains `workItem: WorkItem | null`. `buildBranchRows` takes a `workItems: ReadonlyMap<string, WorkItem | null>` built by the caller, so the pure layer stays tracker-agnostic.
- **`UnifiedSidebar.tsx`** builds that map from `useSessionFacts()`. The records store already subscribes to `session-records:changed`, so a link written on Home appears in the sidebar without a reload.
- **`TerminalRow.tsx`**:
  - Shows the key as a small mono chip after the name, when the link is the session's own. An inherited key already shows on the branch row one line up, and repeating it on every terminal would be noise.
  - Adds a context menu with _Link issue…_, _Change linked issue…_ and _Remove session link_, which opens `SessionLinkDialog`.
- **`TabBar.tsx`** (should): the same chip on the tab, and _Link issue…_ in its existing context menu.
- **Quick Actions "Link issue"** keeps linking the branch. _Link issue to this terminal_ is added beside it when a terminal is focused.

## Sequence of changes

One branch, `058-session-surface-repairs`, with one commit per unit. Each commit ships with its failing test first:

1. **Ordering.** `standingRank`, `awaitingSince`, `lastAttendedAt` in facts, comparators in `wall-order.ts`, `ledger-rows.ts` and `logbook-groups.ts`, the Logbook "Running" group, and the Display-menu label.
2. **Reveal and focus.** `revealSession` and `focusRequest`, the pane effect, and all call sites migrated.
3. **Notifications lead to their session.** The `sessionId` target, the banner-click wiring, and the bell.
4. **Work item on the terminal row.** `BranchTerminal.workItem`, the chip, the row context menu, and the tab-bar chip.
5. **Colour.** State tokens, `StateChip`, the Ledger Needs-you group, row tint, wall tile border, and group swatches.
6. **Docs.**
   - ADR `docs/adr/058-standing-orders-sessions-reveal-in-one-place.md`.
   - `docs/ARCHITECTURE.md`: session surfaces and navigation.
   - `docs/user-guide/USER-GUIDE.md` (Home section).
   - `README.md`.

## Testing and verification

Unit tests (failing first):

- `tests/unit/renderer/sidebar/wall-order.spec.ts`, `ledger-rows.spec.ts`, `logbook-groups.spec.ts`:
  - Two running sessions whose `lastActivityAt` changes keep their relative order.
  - A working ↔ idle flip does not move a row.
  - A session entering awaiting-input moves to the Needs-you band.
  - A new session appears last.
- `tests/unit/renderer/terminal/navigate-to-session.spec.ts`: `revealSession` clears the global, workspace and project tabs, switches workspace and scratch, and bumps the nonce even when the session is already active.
- `tests/unit/renderer/components/TerminalPane.spec.tsx`: a nonce change focuses the requested instance, in both single and split mode.
- `tests/unit/notifications/notification-manager.spec.ts`: clicking a banner with only `onClick` calls it.
- `tests/unit/renderer/sidebar/branch-rows.spec.ts` and `components/TerminalRow.spec.tsx`: an own link draws its key, and an inherited one does not.
- `tests/unit/renderer/components/LedgerView.spec.tsx` and `WallTile.spec.tsx`: the chip label per state, and the needs-you class.

E2E (new `tests/e2e/session-surfaces.spec.ts`, addressed by role):

- The ordering probe above, asserting **0** order changes across 40 samples on Home and on the wall with two printing sessions.
- Focus is `xterm-helper-textarea` after each of: a Ledger row, a wall tile, a sidebar row (a different session and the same session), a tab, a Quick Actions session row launched over Home, and next-waiting.
- A link set from Home appears on the sidebar terminal row without a reload.

Commands, all run from the worktree, with exit codes recorded in the PR:

```sh
npm run format && npm run lint                    # 0 errors
npx vitest run --coverage; echo "exit=$?"         # exit=0, patch coverage ≥80%
npm run build && npx playwright test tests/e2e/session-surfaces.spec.ts tests/e2e/session-home.spec.ts tests/e2e/monitor-wall.spec.ts; echo "exit=$?"
```

Colour is verified by rendering, not by reading the CSS:

- Render the Ledger and a wall tile in headless Chromium in both themes.
- Read the computed `backgroundColor` and `borderLeftColor` of each chip.
- Check the chip label's contrast against its composited fill (≥4.5:1) and the edge's contrast against the ground (≥3:1).
- Attach both screenshots to the PR.

## Risks and mitigations

- **Needs-you tint reads as an error.** Mitigated by using amber, not red, and a 14% fill. Check the light theme in the screenshot, where `--warning` is darker.
- **XII is read strictly.** A reviewer may say that a chip tinted by state colours its icon. The glyph itself keeps `currentColor` and opacity, and only the chip's fill and edge change. If that isn't accepted, the chip drops the glyph, and the label plus fill carry state.
- **Focus theft.** `revealSession` focusing the terminal while a dialog is open would steal focus from it. The pane effect skips focusing when `useModalStore` reports an open modal, and re-requests on close.
- **Stable order hides fresh output.** A session that just printed no longer jumps up. The age column and the chip still show activity, and "Recently opened" is one click away.
- **Seven call sites move at once.** The navigate-to-session spec plus the e2e focus matrix cover every entry point listed above, so a missed site fails a test.

## Open questions

All four were answered **yes** on 2026-09-23 and built in ADR 058: a session link feeds agent context, Quick Actions "Link issue" targets the focused terminal, the sidebar uses the compact state chip, and Working is held until 5 s of quiet. The non-goals above that they contradict no longer apply.

1. Should a **session** link also feed the agent's SessionStart context? Today only the branch link does (`context-sync.ts`), so linking a terminal from Home changes what you see but not what Claude is told. Feature 055's `TERMINATOR_SESSION_ID` mapping makes a per-session context file possible. This is a separate feature.
2. Should Quick Actions "Link issue" target the focused **terminal** by default, with the branch as the second option? The recommendation above keeps the branch for now to avoid changing a working shortcut.
3. Should the sidebar tree adopt the state chip too? It isn't in this request, and the glyph-only sidebar is dense on purpose.
4. Does the working ↔ idle flip bother you in the _icons_ as well as the order? That would be a detection change (idle debounce), which is out of scope here.

## Alternatives rejected

- Colouring the state glyphs: violates XII and fails AA for the accent hue.
- Sticky/hysteresis ordering: stateful, breaks the pure `sidebar/` layer, and still moves rows.
- Focus on every active-session change: misses re-selecting the active session and the paths that never leave Home.
- Patching each navigation call site: fixes today, and the next path misses it again.
- Collapsing to one link level: lossy either way, and reverses ADR 054.
