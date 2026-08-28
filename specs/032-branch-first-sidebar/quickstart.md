# Quickstart: Validating Branch-First Sidebar

**Feature**: `032-branch-first-sidebar` | **Date**: 2026-08-27

How to prove this feature works end to end. Every scenario maps to a success criterion in [spec.md](./spec.md#success-criteria-mandatory).

## Prerequisites

- PR #155 (`032-sidebar-workspace-grouping`) merged, and this branch rebased onto it.
- At least **two repos** added as workspaces, each with a `main` branch — this is what makes SC-002 meaningful. Six matches the audit setup.
- One repo containing **both** a plain checkout and a worktree branch, so SC-003 is testable.
- `git` on `PATH`.

## Setup

```bash
npm install
npm run build:extensions
npm run dev
```

## Automated gates

Run these before any manual pass. All three must be clean; constitution VI and X make each a hard blocker.

```bash
npm run format
npm run lint                    # must report 0 errors
npx vitest run --coverage       # all pass, ≥80% statements/branches/functions/lines
npx playwright test tests/e2e/sidebar-branch-first.spec.ts
```

Two specific regression gates, because this feature is defined partly by what it must _not_ disturb:

```bash
npx vitest run tests/unit/renderer/sidebar/view-model-performance.spec.ts   # unmodified file, must pass
npx vitest run tests/unit/renderer/sidebar/view-model.spec.ts               # unmodified file, must pass
```

If either needed editing, the pure core was changed and the design in [data-model.md](./data-model.md) was not followed.

## Scenario 1 — Four states, nameable from a screenshot (SC-001, US1)

1. Start four terminals in one branch.
2. Put them in different states: leave one idle; run `sleep 60` in one; run something that rings the bell and waits; exit a fourth with `exit`.
3. Screenshot the sidebar. **Render it in greyscale** — macOS: System Settings → Accessibility → Display → Color Filters → Grayscale.
4. Ask someone who has not used the app to name each state.

**Expected**: all four named correctly from shape alone. A filled triangle, a hollow ring, two bars and a crossed ring.

**Also check**: select each session in turn. The glyph must not change when a row becomes selected — only the row's surface does. That is FR-001, and it is the single defect this feature exists to remove.

## Scenario 2 — Branch identity and worktrees (SC-003, US2)

1. In one repo, look at the plain `main` row and the worktree row.
2. Without selecting either, state which is which.
3. Hover the worktree row.

**Expected**: distinct glyphs (`GitBranch` vs `GitFork`), a "worktree" tag on the worktree row, and the worktree path in the tooltip. The repo group header shows its folder path.

4. Create a branch from a ticket via **+ New branch**, picking an issue.

**Expected**: the row leads with the ticket-derived label and still shows its branch name as secondary information — neither is hidden.

## Scenario 3 — One name for one thing (SC-002, SC-004, US3)

1. With six repos each on `main`, press `⌘P`.
2. Type nothing; scroll the whole list.

**Expected**: no two entries read identically. Every new-terminal command names its repo. Every session entry names repo and branch.

3. Search the palette for `project`.

**Expected**: nothing user-facing matches. Then confirm mechanically:

```bash
npm run lint    # the vocabulary rule fails the build on "project" in a user-facing string
```

4. Open the link-issue dialog, the move-session dialog, and a branch's context menu.

**Expected**: all say "branch", and all name the repo.

## Scenario 4 — Statistics never block paint (SC-005)

1. Quit the app. Rename one repo's folder so its git commands will fail.
2. Start the app and open the sidebar.

**Expected**: the list paints immediately with names and states. The unreachable repo's rows render without statistics and without any error affordance. Nothing hangs, nothing blanks.

3. Restore the folder, then use a session in that branch.

**Expected**: statistics appear within a couple of seconds, without a restart.

4. Watch the process list while re-rendering the sidebar repeatedly (switch views, type in search):

```bash
# in a second terminal
while true; do pgrep -fl "git diff --numstat" | wc -l; sleep 1; done
```

**Expected**: at most one `git diff` per branch per 15 seconds. A stream of spawns means the TTL or the in-flight collapsing is not working.

## Scenario 5 — App band (SC-007, US4)

1. Look at the top of the sidebar.

**Expected**: one band with five labelled entries — Overview, Remote Control, Notes, Task Vault, Git Changes — each showing visible text, separated by a rule from the session list. No unlabelled icon row anywhere. The bell and the add-repo `+` sit on the search row.

2. Tab through the sidebar from the top.

**Expected**: every band entry takes focus in order with a visible ring, and a screen reader announces each by its label.

3. Confirm scratch:

**Expected**: scratch sessions appear as a group with a count in the list, not as a pinned footer.

## Scenario 6 — Nothing else moved (FR-020)

1. Switch through every grouping (workspace, project, status, branch, none) and every saved view.
2. Open a workspace-scoped extension surface and a project-scoped tab.
3. Collapse and expand groups; restart; confirm collapse state persisted.

**Expected**: identical to pre-feature behaviour. No extension was rebuilt or modified to get here — verify with `git status` in `extensions/`.

## Rollback

The feature is additive except for two deletions (`ExtensionFooter`, `ScratchSection`) and the vocabulary strings. No stored data changed (FR-021), so reverting the branch is sufficient — an older build reads the same workspace store without migration.

## Known limitations to confirm, not fix

- Untracked files are not counted in change statistics ([contracts/change-stats-ipc.md](./contracts/change-stats-ipc.md)).
- The "waiting on you" state is still inferred from the terminal bell. This feature makes that inference visible, so expect it to be _wrong more visibly_ than before. That is intended and is the input to a later decision — do not patch the inference here.
- Sidebar chip counts can still exceed the rows shown (audit NAV-6). Out of scope by design; see [contracts/app-band.md](./contracts/app-band.md#scratch-as-a-group).
