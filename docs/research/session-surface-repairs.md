# Session Surface Repairs

Design document · 2026-09-23 · covers four reported issues on Home, the Overview wall, terminal focus and issue links.

## Context

Home and the Overview wall (feature 054) are where an operator watches many terminals at once. Four problems get in the way:

1. Home draws every state in the same grey, so nothing stands out as needing you.
2. Busy sessions keep swapping places.
3. Opening a session does not always put the cursor in it.
4. A ticket linked from Home or the wall never shows on that terminal in the sidebar.

All four problems are in core renderer code. One change is in main (notifications). The Extension API does not change.

## Goals

- A session that needs you is visible at a glance on Home. The signal does not depend on colour alone.
- A session's position on Home and the wall changes only when its standing changes (it needs you, it exits, it is new). Output alone never moves it.
- Every way of opening a session (Home, wall, sidebar, tab bar, Quick Actions, notification, extension) leaves keyboard focus in that terminal's input.
- The code reads the work item of a session one way. Every surface that draws the session also draws its work item, including the sidebar terminal row.

## Non-goals

- Colouring the sidebar tree (not reported).
- Merging the project link and the session link into one record (see Options, issue 4).
- Feeding a session-level link into agent context. This is a real gap. See Open questions.
- Changing how agent state is detected.

## Evidence

A throwaway Playwright probe ran against a fresh `npm run build` (exit 0). It opened one branch with three terminals. Two terminals ran `while true; do echo tick; sleep 0.4; done`. The probe sampled the surfaces every 250 ms for 10 s. Run the probe with `E2E_TOOLS=1 npx playwright test tests/e2e/tools/probe-research.spec.ts`. The probe was then removed from the tree.

| Measurement                                               | Result                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Home Ledger row order changes in 40 samples               | **10**: `Terminal 2, Terminal 1, Terminal 3` ↔ `Terminal 1, Terminal 2, Terminal 3` |
| Wall tile CSS `order` changes in 40 samples               | **8**: Terminal 1 and Terminal 2 swapping `order` 2 ↔ 3                             |
| Focus after Enter on a Ledger row                         | `TEXTAREA.xterm-helper-textarea` ✓                                                   |
| Focus after "Open Terminal 3" on a wall tile              | `TEXTAREA.xterm-helper-textarea` ✓                                                   |
| Quick Actions → Sessions → Terminal 1, launched over Home | Home **still shown**, focus on `BODY` ✗                                              |
| Sidebar terminal row click, different session             | `TEXTAREA.xterm-helper-textarea` ✓                                                   |
| Sidebar terminal row click, the session already active    | focus on `DIV.terminal-row` ✗                                                        |

The probe did not drive the notification path. The findings below about notifications come from the code.

## Issue 1: Home is monochrome

### Current state

- `src/renderer/components/session/StateIcon.tsx:7` documents the rule: state is drawn as "shape and opacity, never hue". The four glyphs differ by opacity alone (`--state-op-*`, `src/renderer/styles.css:44-47`). The idle glyph sits at 0.34.
- The only hue on a Ledger row is the workspace rail (`src/renderer/components/home/LedgerView.css:52`: "The workspace's colour is this edge and nothing else.").
- The Ledger groups by workspace/project by default (`src/renderer/sidebar/home-prefs.ts`, `groupBy: 'workspace-project'`). A session that needs you therefore sorts to the top _of its group_, not to the top of the page. The wall already pins a Needs-you band (`wall-order.ts`, `pinNeeds`).
- Constitution XII (`.specify/memory/constitution.md:187-195`) forbids colour **on icons**: "Never use color to differentiate icon states". It says nothing about fills, borders or labels.

### Contrast of the tokens we would use

The measurement uses the WCAG relative-luminance formula. It compares each colour against `--bg-base` and against a 14% tint of the colour itself. The script is inline in the session. The hex values come from `src/renderer/styles.css`.

| Token         | Dark, on bg | Dark, on own tint | Light, on bg | Light, on own tint |
| ------------- | ----------- | ----------------- | ------------ | ------------------ |
| `--warning`   | 12.75       | 9.73              | 4.48         | 3.74               |
| `--success`   | 11.21       | 8.80              | 7.15         | 5.73               |
| `--accent`    | 4.02        | 3.58              | 4.28         | 3.61               |
| `--agent-clr` | 4.61        | 4.07              | 3.73         | 3.16               |

As text, `--warning` fails AA (4.5:1) in light mode, and `--accent` fails in both themes. All four clear the 3:1 non-text threshold against the ground. That threshold is the rule for fills and borders. This matches a known earlier failure: the workspace colour used as text measures 1.6 to 3.4:1.

### Options

- **A. Colour on fills and borders; text and icons stay neutral.** A state chip holds the glyph (still `currentColor`) and a text label ("Needs you", "Working", "Idle", "Exited"). The chip has a state-tinted fill and a state-coloured edge. Needs-you rows also get a full-row tint. This fits XII. It passes contrast, because the words stay `--text-primary`. Colour is never the only channel.
- **B. Colour the state glyphs.** This is the cheapest change, and most apps make it. It violates XII and needs a constitution amendment. It also fails contrast for the accent hue in both themes.
- **C. More weight, no hue.** Bold names for needs-you rows and larger glyphs. This keeps the current rule. But the operator asks for colour, and weight alone already reads as "all the same".

### Decision

**Option A.** Use colour for two states only: amber for _needs you_ and green for _working_. Idle and exited stay neutral, because those states ask nothing of the operator. Colour then has a meaning each time it appears.

### Design

- **Tokens.** Add these to `src/renderer/styles.css`, defined in both theme blocks:
  - `--state-needs: var(--warning)` and `--state-working: var(--success)`.
  - `--state-needs-fill` and `--state-working-fill`, as `color-mix(in srgb, <token> 14%, transparent)`.
  - These tokens are core-only. They do not go into `EXTENSION_BASE_CSS`, because no extension draws session state.
- **`StateIcon` becomes `StateChip`.** Edit `src/renderer/components/session/StateIcon.tsx` and its CSS.
  - The chip holds the lucide glyph (unchanged: `currentColor`, opacity tokens) and a label.
  - The label comes from `statusPresentationForState`, which already exists.
  - The chip has a `border-left: 2px solid var(--state-*)` and a `--state-*-fill` background. Its text uses `--text-primary`.
  - A `compact` prop keeps today's glyph-only form for the tab bar and the sidebar. Both are out of scope.
- **Ledger.** Edit `src/renderer/components/home/LedgerView.tsx` and `.css`.
  - The state column shows the chip.
  - `.ledger__row--needs` gets a `--state-needs-fill` background.
  - The workspace rail stays as it is.
- **A Needs-you group on top.** Edit `src/renderer/sidebar/ledger-rows.ts`.
  - Under `sort: 'needs-you'`, the code lifts awaiting-input sessions out of their workspace groups into a first group labelled "Needs you", as the wall does.
  - Their other groups no longer list them.
  - The group heading carries the needs-fill, so it reads as a band at the top of Home. This follows the rule that input surfaces go front and centre.
- **Logbook and wall** reuse the chip (`LogbookView.tsx`, `WallTile.tsx`). A needs-you tile gets a `--state-needs` border in place of `--border`.
- **Group headings** gain a small workspace swatch, a filled square in the workspace colour. The swatch answers "what is what" without using the workspace colour as text.

## Issue 2: Sessions fight over position

### Current state (root cause)

Every sort that places a session on Home or the wall uses `lastActivityAt` as its first or second key:

- `src/renderer/sidebar/wall-order.ts:18` sorts with `byRecent`, and uses it as the tiebreak under `thenBy: 'state'` (`:27`).
- `src/renderer/sidebar/ledger-rows.ts:36` breaks ties within a state by `lastActivityAt`.
- `src/renderer/sidebar/logbook-groups.ts:34` sorts each state group by `lastActivityAt`.

The code rewrites `lastActivityAt` about once a second for every session that produces output: `ACTIVITY_STAMP_INTERVAL_MS = 1000` at `src/renderer/terminal/session-controller.ts:35`, stamped from `onBusy` at `:62`. Two sessions that both print swap places on every stamp. The probe measured this: 10 swaps in 10 s on Home and 8 on the wall.

A second cause comes from the code. Nobody measured it. `working` ranks above `idle` in `STATUS_ORDER` (`view-model.ts:36`). A session flips to idle after 1.5 s of quiet (`IDLE_DEBOUNCE_MS`, `TerminalSession.tsx:6`). An agent that pauses to think therefore moves between the Working and Idle bands.

### Options

- **A. Sort on keys that do not move while a session runs.**
  - Rank on _standing_: needs you, then running (working and idle together), then exited.
  - Then sort by `createdAt`, oldest first, so a new session appears at the end.
  - A session moves only when its standing changes.
  - The ordering stays pure, stateless and testable.
- **B. Sticky order with hysteresis.** Remember the last order. Move a row only after its key has been stable for N seconds. This needs state carried between renders. It breaks the purity of the `sidebar/` layer (Constitution XI, `purity.spec.ts`). It still moves rows, only later.
- **C. Make "recent" mean _recently attended_.** Sort by `lastAttendedAt`, which changes only when the operator opens a session (`session.store.ts`, `setActiveSessionForProject`). This is stable while the operator watches. It answers "what was I just in".

### Decision

**A as the default, and C as the "recent" option.** Output is no longer an ordering key. The "Recent" choice in the Display menu of the Ledger and in _Then by_ on the wall becomes "Recently opened", sorted on `lastAttendedAt`.

### Design

- **`view-model.ts`** gains a pure `standingRank(state)`: `awaiting-input` → 0, `working` and `idle` → 1, `exited` → 2. `STATUS_ORDER` stays as it is for display grouping.
- **`wall-order.ts`**:
  - `thenBy('state')` becomes `standingRank`, then `startedAt` ascending.
  - `thenBy('recent')` becomes `lastAttendedAt` descending, then `startedAt`.
  - The Needs-you band orders by the time the session entered awaiting-input. That time needs a new `awaitingSince` on `TerminalSession`. `setSessionScreen` and `incrementBellCount` set it when the state first becomes awaiting.
  - Emission order and the one-grid invariant (ADR 036) are unchanged.
- **`ledger-rows.ts` and `logbook-groups.ts`** use the same comparators.
- **Logbook grouping.**
  - Working and Idle merge into one "Running" group. A pause no longer moves a row between headings.
  - The chip still says Working or Idle.
- **`SessionFacts`** gains `lastAttendedAt` and `awaitingSince`, passed through in `session-facts.ts`. `WallPrefs.thenBy` and `HomePrefs.sort` keep their stored values. `'recent'` now means recently opened, so no migration is needed.

## Issue 3: Opening a session doesn't always focus it

### Current state (root causes)

- **Focus is a side effect of a remount.** `TerminalInstance.mount()` calls `this.terminal.focus()` (`TerminalSession.tsx:448`). The single-pane effect in `TerminalPane.tsx:43` returns early when the active session has not changed. So re-selecting the active session never focuses it. The sidebar row has `tabIndex={0}` (`TerminalRow.tsx:43`) and keeps the focus. The probe measured this.
- **There are seven separate "go to session" paths.** Only some of them leave Home or the wall:

| Path                                                                       | Where                                           | Clears Home/wall            | Switches workspace |
| -------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------- | ------------------ |
| `navigateToSession`                                                        | `terminal/navigate-to-session.ts`               | yes                         | yes                |
| Extension `terminal:navigate-to-session`                                   | `App.tsx:905-919`                               | yes                         | yes                |
| Sidebar `selectSession`                                                    | `UnifiedSidebar.tsx:457` then `onSelectProject` | yes                         | yes                |
| Scratch row                                                                | `App.tsx:977-982`                               | **no** (workspace tab only) | n/a                |
| Quick Actions `onSelectSession` / `onNextWaiting` / `onCycleRecentSession` | `App.tsx:436-457`                               | **no**                      | **no**             |
| `selectSessionEverywhere` (shortcuts)                                      | `quick-actions/shortcut-behaviors.ts:17`        | **no**                      | **no**             |
| Tab bar                                                                    | `TabBar.tsx:91`                                 | n/a (already in terminals)  | n/a                |

For the Quick Actions row, the probe measured Home still shown and focus on `BODY`.

- **Notifications lead nowhere.**
  - The bell notification (`session-controller.ts:21-27`) carries no target. `dispatchNotification` has no field for one (`src/renderer/lib/notifications.ts`).
  - In main, the code wires the click of a macOS banner only when the notification has `actions` (`notification-manager.ts:123`). A notification that has only `onClick` does nothing when the user clicks its banner. This includes every extension notification that uses `onClick` (`src/main/extensions/api.ts:1014`).
  - Clicking the app into focus runs `refocusActive` (`TerminalPane.tsx`). It focuses the session that was _already_ active, not the session that rang.

### Options

- **A. One reveal function with an explicit focus request.**
  - All paths call `revealSession(sessionId)`. It does what `navigateToSession` does, and it also stamps a `focusRequest` nonce in the session store.
  - The effect of the pane keys on the nonce, not on the active id. It focuses after mount.
  - Re-selecting the same session changes the nonce, so the session still gets focus.
- **B. Focus on every `setActiveSessionForProject`.** Subscribe to the store and focus on each change. This misses the re-select case, which does not change the id. It does not fix the paths that never leave Home.
- **C. Patch each call site.** Add `setActiveGlobalTab(null)` and a `.focus()` at the seven sites. This fixes today's symptoms. The next new path will miss the fix again.

### Decision

**A.** The bug is that seven paths each decide what "open" means. One function replaces them. The nonce makes focus an intent, not a side effect of mounting.

### Design

- **`src/renderer/terminal/navigate-to-session.ts`**:
  - Rename `navigateToSession` to `revealSession`. Keep the old name as an import alias only until the callers move.
  - It also clears `activeWorkspaceTabId` and `activeProjectTabId`. It ends with `useSessionStore.getState().requestFocus(sessionId)`.
- **`session.store.ts`** adds `focusRequest: { sessionId: string; nonce: number } | null` and `requestFocus(sessionId)`. The store stays a plain reducer. The nonce is a counter.
- **`TerminalPane.tsx` and `LeafPane.tsx`**:
  - One effect on `focusRequest?.nonce` calls `setFocusedSession` in split mode. It calls `terminal.focus()` for the requested session, inside `requestAnimationFrame`, so it runs after `mount()`.
  - This effect replaces the existing split-mode focus effect. The change removes that one.
- **Call sites** that move to `revealSession`:
  - `App.tsx`: `onSelectSession`, `onNextWaiting`, `onCycleRecentSession`, `onCycleTab`, the extension bridge handler at `:905`, and the scratch row at `:977`.
  - `UnifiedSidebar.tsx` `selectSession`.
  - `TabBar.tsx:91`.
  - `shortcut-behaviors.ts` `selectSessionEverywhere` and the cycle helpers.
  - `session-controller.ts:140`, for a newly created session.
- **Notifications**:
  - `dispatchNotification` gains an optional `sessionId`. The IPC schema for `notifications:create` gains the same field.
  - In main, a `sessionId` becomes an `onClick`. The `onClick` shows and focuses the window and sends `terminal:navigate-to-session`. That message now ends in `revealSession`.
  - `notification-manager.ts:123` wires the banner click to `onClick` when one exists, and falls back to the first action. This also fixes extension notifications. The Extension API does not change.
  - The bell notification passes its `sessionId`.

## Issue 4: A link made on Home isn't shown in the sidebar

### Current state

There are two link records with two writers. The surfaces read them differently:

| Record                | Store                                                         | Written from                                                                                               | Shown on                                                                                 |
| --------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Project (branch) link | `issue-link-store.ts` via `integrations.store.ts` `linkIssue` | Sidebar branch menu (`issue-menu-items.ts`), Quick Actions "Link issue" (`App.tsx:466`), `LinkIssueDialog` | Sidebar **branch** row (`UnifiedSidebar.tsx:601`), and Home and the wall via inheritance |
| Session link          | `session-records` via `session-records.store.ts` `setLink`    | `SessionLinkDialog` on Home (`HomeScreen.tsx:93`, `:227`) and on the wall (`OverviewScreen.tsx:215`)       | Home and wall only                                                                       |

- Home and the wall resolve the work item as _session link, else project link_ (`sidebar/work-item.ts`, `resolveWorkItem`).
- The sidebar terminal row has no work item at all. `BranchTerminal` (`branch-rows.ts:14`) carries only id, title, state, bell count and panes. `TerminalRow.tsx` draws the name, the bell and the close button.
- The tab bar shows only the description, as a tooltip (`TabBar.tsx:218`).
- Only the project link feeds agent context (`main/integrations/context-sync.ts`, `terminal.ipc.ts:72`).

### Options

- **A. One read path, two link levels.**
  - Every surface that draws a session reads its work item from `SessionFacts.workItem` (`resolveWorkItem`). Every such surface draws the same key chip.
  - Every "link this terminal" control opens the same `SessionLinkDialog`.
  - The branch row keeps its own project link.
  - This matches FR-011/FR-012 of feature 054. The change is additive.
- **B. One link level: session only.** Drop the branch link. This loses the branch default that most sessions rely on. It loses the agent context injection keyed by project. It reverses ADR 054.
- **C. One link level: branch only.** Drop the session link. This loses two sessions on one branch that serve different tickets, which feature 054 designed for. It also deletes the Home/wall link UI.

### Decision

**A.** One reader (`resolveWorkItem` through `SessionFacts`) and one writer per level meet "the same mechanism across the board". The writers are `SessionLinkDialog` for a terminal and `LinkIssueDialog` for a branch. A single level would be a larger redesign that loses data.

### Design

- **`branch-rows.ts`**: `BranchTerminal` gains `workItem: WorkItem | null`. `buildBranchRows` takes a `workItems: ReadonlyMap<string, WorkItem | null>` that the caller builds, so the pure layer stays tracker-agnostic.
- **`UnifiedSidebar.tsx`** builds that map from `useSessionFacts()`. The records store already subscribes to `session-records:changed`, so a link written on Home appears in the sidebar without a reload.
- **`TerminalRow.tsx`**:
  - Shows the key as a small mono chip after the name, when the link is the session's own. An inherited key already shows on the branch row one line up. Repeating it on every terminal adds noise.
  - Adds a context menu with _Link issue…_, _Change linked issue…_ and _Remove session link_. The first two open `SessionLinkDialog`.
- **`TabBar.tsx`** (should): the same chip on the tab, and _Link issue…_ in its existing context menu.
- **Quick Actions "Link issue"** keeps linking the branch. When a terminal has focus, _Link issue to this terminal_ is added beside it.

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

Run all commands from the worktree. Record the exit codes in the PR:

```sh
npm run format && npm run lint                    # 0 errors
npx vitest run --coverage; echo "exit=$?"         # exit=0, patch coverage ≥80%
npm run build && npx playwright test tests/e2e/session-surfaces.spec.ts tests/e2e/session-home.spec.ts tests/e2e/monitor-wall.spec.ts; echo "exit=$?"
```

Colour is verified by rendering, not by reading the CSS:

- Render the Ledger and a wall tile in headless Chromium in both themes.
- Read the computed `backgroundColor` and `borderLeftColor` of each chip.
- Check the contrast of the chip label against its composited fill (≥4.5:1). Check the contrast of the edge against the ground (≥3:1).
- Attach both screenshots to the PR.

## Risks and mitigations

- **Needs-you tint reads as an error.** The mitigation is amber, not red, and a 14% fill. Check the light theme in the screenshot, where `--warning` is darker.
- **XII is read strictly.** A reviewer can say that a chip tinted by state colours its icon. The glyph itself keeps `currentColor` and opacity. Only the fill and edge of the chip change. If the reviewer does not accept this, the chip drops the glyph, and the label plus the fill carry the state.
- **Focus theft.** If `revealSession` focuses the terminal while a dialog is open, it steals focus from the dialog. The pane effect skips focusing when `useModalStore` reports an open modal. It requests focus again on close.
- **Stable order hides fresh output.** A session that just printed no longer moves up. The age column and the chip still show activity. "Recently opened" is one click away.
- **Seven call sites move at once.** The navigate-to-session spec and the e2e focus matrix cover every entry point listed above, so a missed site fails a test.

## Open questions

On 2026-09-23 the answer to all four was **yes**, and ADR 058 records the build. A session link feeds agent context. Quick Actions "Link issue" targets the focused terminal. The sidebar uses the compact state chip. Working is held until 5 s of quiet. The non-goals above that these answers contradict no longer apply.

1. Does a **session** link also feed the SessionStart context of the agent? Today only the branch link does (`context-sync.ts`). Linking a terminal from Home therefore changes what the operator sees, but not what Claude is told. The `TERMINATOR_SESSION_ID` mapping of feature 055 makes a per-session context file possible. This is a separate feature.
2. Does Quick Actions "Link issue" target the focused **terminal** by default, with the branch as the second option? The recommendation above keeps the branch for now, to avoid a change to a working shortcut.
3. Does the sidebar tree adopt the state chip too? It is not in this request. The glyph-only sidebar is dense on purpose.
4. Does the working ↔ idle flip bother the operator in the _icons_ as well as in the order? That would be a detection change (idle debounce), which is out of scope here.

## Alternatives rejected

- Colouring the state glyphs: violates XII and fails AA for the accent hue.
- Sticky/hysteresis ordering: stateful, breaks the pure `sidebar/` layer, and still moves rows.
- Focus on every active-session change: misses re-selecting the active session and the paths that never leave Home.
- Patching each navigation call site: fixes today, and the next path misses the fix again.
- Collapsing to one link level: loses data either way, and reverses ADR 054.
