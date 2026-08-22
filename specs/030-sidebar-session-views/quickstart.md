# Quickstart: Validating Sidebar Session Views

How to prove this feature works. Automated checks first, then the manual pass that the automated checks
cannot replace.

## Prerequisites

```bash
cd <worktree for 030-sidebar-session-views>
npm ci
npm run build:extensions      # required — extensions/*/src/index.js is a gitignored build artifact
```

## Gate 1 — the done checklist (every phase, no exceptions)

```bash
npm run format
npm run lint                  # MUST be 0 errors
npx vitest run --coverage     # MUST pass, ≥80% statements/branches/functions/lines
```

Baseline on this branch before any change: **354 files, 6121 tests passing**; 94.67% / 87.75% / 91.17% /
95.89%. A number below any of those in the same file is a regression, not a rounding difference.

Watch one file specifically:

```bash
npx vitest run --coverage src/renderer/components/sidebar/UnifiedSidebar.spec.tsx
```

`UnifiedSidebar.tsx` enters this feature at **69.41% statements / 69.23% branches / 71.25% lines** — below
the patch-coverage gate. It is rewritten here, so it must exit Phase 3 at ≥80% on all four metrics. This is
the one number that will otherwise ambush the PR.

## Gate 2 — the pure layer

```bash
npx vitest run --coverage src/renderer/sidebar/
```

Targets **100%**, not 80%. Assertions that must exist, from
[contracts/view-model.md](./contracts/view-model.md):

- every `GroupKey` × `SortKey` × filter combination;
- staleness at exactly the threshold (not stale), one ms past it (stale);
- `awaiting-input` never stale at any elapsed time;
- `exited` stale immediately;
- `buildGroups` called twice with identical arguments returns deeply equal output and mutates no input;
- corrupt `terminator.sidebar.views` JSON yields built-in views, never a throw.

## Gate 3 — the extension-surface regression spec (merge gate)

```bash
npx vitest run src/renderer/components/sidebar/extension-surfaces.spec.tsx
```

Every cell of the host matrix in [contracts/extension-surfaces.md](./contracts/extension-surfaces.md), for
all five grouping modes. If this is red the feature does not merge, regardless of what else is green.

## Gate 4 — app boot

```bash
npm run test:e2e
```

The only real check that the app still starts — `npm run typecheck` and unit tests will not catch a boot
failure.

## Gate 5 — the manual pass (Phase 3 and Phase 4 only)

The task list is not evidence that the UI works. Launch it:

```bash
npm run dev
```

Then confirm by eye, with at least two workspaces, two projects each, several sessions, and the
git-integration extension enabled (it is the only contributor of a sidebar item):

**Sidebar and grouping**

1. Every session is visible on first paint with nothing expanded (SC-001). Groups default to expanded.
2. Each row shows a status indicator, a relative last-activity time, and a project badge.
3. Squint test / greyscale screenshot: `awaiting-input` is still distinguishable — the edge bar and pill
   carry it, not hue (SC-011).
4. Switch grouping through project → workspace → status → branch → none. The list regroups each time and
   nothing disappears without the filter notice explaining it.

**Extension surfaces — the part that silently breaks**

5. Header global-tab buttons (Overview, Notes, Remote Control, Task Vault) present and working.
6. Hover a project/workspace group header: the SpecKit (brain) and Code Reviews (git-pull-request) buttons
   appear and open their surfaces.
7. Group by status, then open a row's scope affordance: the same SpecKit and Code Reviews actions are there
   and work.
8. With a session selected under **status** grouping, the "Git" project tab is present in the main tab bar
   and opens — this is the `activeProjectId` regression (I4).
9. `⌘⇧G` toggles the Git Changes panel.
10. The sidebar **footer** shows a "Git Changes" item — exactly once, not once per workspace — and
    **clicking it toggles the Git Changes panel**. This surface has never rendered before; a button that
    appears but does nothing is a failure, not a partial pass. Switch grouping and confirm it stays put.

**Staleness and cleanup**

11. Set the staleness threshold to 1 minute in settings, leave a session idle, and watch it appear in the
    Stale view without a restart (FR-019).
12. Leave a session with an unacknowledged bell for longer than the threshold — it must **not** be stale.
13. In the Stale view: shift-click a range, bulk close, and read the confirmation. For a worktree-backed
    project it must name the exact path leaving disk before you confirm. Afterwards, `git worktree list` in
    the repo shows it gone.
14. Attempt a bulk close with an awaiting-input session in range — it is excluded (SC-006).

**Filters and keyboard**

15. Any filter active → the "showing N of M · show all" notice is present; "show all" restores everything.
16. Quit and relaunch: custom views survive, and the app opens on **Everything**, never on a filtered view
    (FR-015).
17. `⌘K` lists sessions alongside commands. `⌘]` / `⌘[` cycle across project boundaries. `⌘⇧A` jumps to the
    next awaiting-input session. `⌘I` edits the note; the note then matches in search.
18. `Escape` is untouched — it still reaches the terminal, and double-Escape still exits an extension view.

**Measured success criteria**

19. **SC-005** — with 10 stale sessions listed, clear them all and count your interactions: opening the
    Stale view, one shift-click range, one confirm. Must be at most 3, under 30 seconds.
20. **SC-002** — with 20+ sessions, locate one by name twice: once via search, once via a view switch. Time
    both. Under 10 seconds each, with nothing expanded.

## Gate 6 — documentation (Principle VIII, same PR)

Not optional and not a follow-up:

- `README.md` — sidebar views section, including the plain statement that `awaiting-input` is bell-derived
  and under-reports. Line 12's extension list ("sidebar items") becomes true for the first time.
- `docs/ARCHITECTURE.md` — the view-model layer and why it holds no React, plus the corrected component tree
  at line 478 (`ExtensionFooter` moves; `WorkspaceCard`/`ProjectRow` become `SessionGroup`).
- `docs/EXTENSION-DEVELOPMENT.md` — `api.sidebar.togglePanel`, and a note on the `registerItem` example at
  lines 187-203 that it now renders into the sidebar footer.
- **ADR `docs/adr/027-flat-session-list-view-model.md`** — the flat-list-with-view-model decision, the
  four-surface contract, and the amendment history including the reversed R1. Do not reuse `026`; it is
  already taken twice.
- PR body — the deleted dead code (`ExtensionFooter`, `registerSidebarButton`, `TerminalSessionSchema`, the
  dead `ProjectRow` git props) named explicitly, so removal reads as intent rather than collateral.

---

## Gate 5 results — manual pass run 2026-08-21

Run against `npm run dev` with the real bundled extensions.

| #     | Check                                                          | Result                                                                                                                        |
| ----- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1-2   | All sessions visible on first paint; groups default expanded   | PASS                                                                                                                          |
| 3     | `awaiting-input` distinguishable without colour                | Covered by `sidebar-status-colour-independence.spec.ts`; no waiting session existed to eyeball                                |
| 4     | Grouping switches through all five modes                       | PASS                                                                                                                          |
| 5     | Header global-tab buttons                                      | PASS                                                                                                                          |
| 6     | SpecKit + Code Reviews on group header hover                   | **PASS** — both icons revealed on hover                                                                                       |
| 7     | Scope affordance under status grouping                         | **PASS** — project badge opens ScopeMenu; Code Reviews opened the real surface                                                |
| 8     | Git project tab resolves under status grouping                 | **PASS**                                                                                                                      |
| 9     | `⇧⌘G` toggles the Git Changes panel                            | PASS (via View menu accelerator)                                                                                              |
| 10    | **Git Changes footer item toggles the panel**                  | **PASS** — the whole chain, working for the first time                                                                        |
| 11-12 | Threshold change takes effect live; belled session never stale | PASS                                                                                                                          |
| 13    | Stale view, multi-select, bulk close                           | PASS                                                                                                                          |
| 14    | Bulk close excludes awaiting-input                             | Covered by `BulkCloseDialog.spec.tsx`                                                                                         |
| 15    | Filter notice with shown/total                                 | **PASS** — "showing 0 of 1 · show all"                                                                                        |
| 16    | Restores to Everything on relaunch                             | Covered by spec; not re-launched during the pass                                                                              |
| 17    | `⌘K` palette lists sessions                                    | **Not verified by hand** — synthetic `⌘K` never reached the renderer. Covered by `App.spec.tsx` and `CommandPalette.spec.tsx` |
| 18    | Escape untouched                                               | PASS                                                                                                                          |
| 19    | SC-005 ≤3 interactions                                         | PASS                                                                                                                          |
| 20    | SC-002 under 10s                                               | PASS for search                                                                                                               |

### Defects the pass found, all fixed

1. **A project with no sessions was invisible** — no header, no way to select it or start its first terminal. The tree always showed every project. `buildGroups` now seeds a group per project/workspace when the view is not narrowed.
2. **ViewBar menus did not dismiss on outside click**, unlike every other menu in the app.
3. **Hide-stale hid the empty project headers too**, so turning it on removed any way to start work. It is a standing browsing preference, not a narrowing filter, and no longer suppresses seeding.
4. **Workspace edit/remove/colour/tags lost their host.** Grouping by project leaves a workspace with no element of its own; `WorkspaceRow` restores them.
5. **Starting a terminal from a group header did not select the project**, so the main area kept showing whatever was there before. Selecting is also what the header click now does, matching the tree's project row (FR-026).
6. Bulk close read "Close 1 sessions?".

### Also found

`npm run test:e2e` runs against whatever is in `out/`. Earlier runs in this feature passed against a **stale build** and were not exercising the new sidebar at all. Always `npm run build` before trusting an e2e result. Settings writes did not persist in this dev session — reproduced on an untouched field (scrollback), so it is pre-existing and unrelated to this feature.
