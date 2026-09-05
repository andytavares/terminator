# Declutter the sidebar, and a board for the fleet

Closes feature `034-declutter-sidebar`.

Feature 032 was written as an addition — "put on the row everything the other four surfaces already know" — and 033 then ran each repo's colour down the whole column. Together they produced four bands of chrome, thirteen elements on a group header, ten on a terminal row, and every terminal listed twice. This is the subtractive correction, plus the surface that makes it safe.

## What changed

**The sidebar lists repos and branches.** Terminals are not rows. Each branch is one row carrying a single state folded from its terminals, and a branch is a row whether or not a terminal is open on it. For three repos, twelve branches and thirty terminals the sidebar draws fifteen rows rather than forty-five.

**A board answers "which terminal is in what state"** across every repo at once — lanes by state, over the tiles the Overview screen already drew. A lane is a `grid-column`, not a container, because `mountPreview` moves the single live xterm element into the card's node and re-parenting would tear the preview out mid-transition.

**The tab bar carries what the rows did** — per-terminal state, bell counts, and the note (as a tooltip, never drawn).

**Four bands of chrome become two.** Filter and Display absorbed the view chips, the group and sort menus, the hide-stale toggle and the filter-notice band. Measured against the running app: **165px → 96px**, a 41.8% cut against the 40% SC-002 asks for.

**Repo colour is one 2px rail and a small swatch.** No washes, neutral hover and selection.

## Deletions — FR-025 requires these named

| Removed                                                             | Why                                                                                                                                                                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionRow`                                                        | Terminals are not sidebar rows                                                                                                                                                                                  |
| `WorkspaceRow`                                                      | Its "new branch" strip became the repo header's hover `+`                                                                                                                                                       |
| `SessionGroup`                                                      | Replaced by `RepoHeader` and `BranchRow`                                                                                                                                                                        |
| `ViewBar`, `FilterNotice`                                           | Folded into the Filter and Display menus                                                                                                                                                                        |
| **Stale multi-select and bulk close**, with `BulkCloseDialog`       | **Not re-homed.** They operated on terminal-row checkboxes; the board's job is "what is happening now", and checkboxes on cards would re-import the density this removes. The `Stale` view survives as a filter |
| `ScopeMenu`                                                         | Reachable only from a terminal row's project badge — `setScopeMenu` was never called after the cut                                                                                                              |
| `IssueBadge`                                                        | The issue key is plain text on the row now; it kept its click, not its border                                                                                                                                   |
| `ActivitySpinner`                                                   | The tab's state glyph replaced the busy spinner                                                                                                                                                                 |
| `buildGroups`, `Group`, `GroupScope`                                | Superseded by `buildBranchRows`                                                                                                                                                                                 |
| 21 dead rules in `SidebarHeader.css`, `--font-sans`, 3 unused props | Principle X                                                                                                                                                                                                     |

All with their tests.

## Two spec defects fixed on the way

**FR-003 and FR-040 contradicted each other.** FR-040 made the repo rail the only coloured edge, but the needs-you signal _was_ an edge that deliberately overrode it. State emphasis moved into the status gutter; the edge belongs to the repo. Spec amended.

**A pre-existing WCAG AA failure.** Repo names painted in their own swatch measured **1.08 : 1**, **1.23 : 1** and **1.52 : 1** in the light theme, against the 4.5 AA requires — measured in a browser. Moving the colour to a swatch and the name to `--text-primary` takes all three to **15.0 : 1**.

## Verification

- `npm run format` · `npm run lint` **0 errors** · `npx vitest run --coverage` **7065 tests, 389 files** (statements 95.07%, functions 91.81%, branches 88.52%) · `npx playwright test` **87 passing**
- Every touched file clears the 80% patch gate. `UnifiedSidebar.tsx` was at **79.2% functions before this branch** and had to be raised before anything could be committed.
- Principle II: no file in this feature names any extension. Contribution contracts unchanged — `extension-surfaces.spec.tsx` passes with selector updates only.

## Three things worth a reviewer's attention

1. **`BoardScreen.spec` and `board.spec.ts` assert DOM node identity survives a lane change.** That is the guarantee the whole single-grid design exists for. If a future change re-parents a card, those are the tests that will catch it.
2. **`purity.spec.ts` guards the whole `src/renderer/sidebar/` directory**, so a new module there inherits ADR-027's no-React/no-store/no-clock rule without anyone remembering.
3. **Two bugs were found only by screenshotting the running app** — the scratch header rendering as bare text, and the board preview being height-constrained. Every unit assertion about both was structural and passed.

## One contract addition

`SidebarContribution` gained an optional `icon?: string`, taking the same lucide names a manifest's `contributes.globalTab.icon` uses. This is the one place FR-037's "contracts unchanged" is relaxed, and it is additive: a contribution that omits it behaves exactly as before.

It had to change. A contributed sidebar item previously **could not supply an icon at all** — the field did not exist — so the host drew a placeholder square. That was tolerable while every band entry had a text label under it; removing the labels left Git Changes as an unidentifiable square next to four real icons. `git-integration` now declares `icon: 'git-branch'`, and the host's last-resort fallback is a puzzle glyph rather than a bare square.

## Known, not fixed

- `MetricsBar.tsx` imports the shared types one directory level too high. It only compiles because the import is type-only and erased before vite resolves it. Pre-existing, untouched.
- `CreateWorkspaceDialog.tsx:125` has a pre-existing `useState` narrowing error.
- The app says "workspace" in dialogs and "repo" in the spec. This PR keeps "workspace" everywhere it already appeared rather than renaming half of them; a full rename is out of scope.

## ADRs

- `035-the-sidebar-stops-at-the-branch.md`
- `036-the-board-is-one-grid.md`
- `037-repo-colour-is-one-rail.md` — supersedes 033's colour half
