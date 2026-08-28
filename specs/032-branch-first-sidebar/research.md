# Phase 0 Research: Branch-First Sidebar

**Feature**: `032-branch-first-sidebar` | **Date**: 2026-08-27

Five unknowns were carried out of the plan's Technical Context. All five are resolved below; none remain marked NEEDS CLARIFICATION.

---

## R1 — Which icons express the four session states

**Decision**

Four lucide components, one per state, each rendered flat with `currentColor` and no colour class or inline colour. Verified present in the installed `lucide-react@^0.475.0`.

| State          | Component | Why this shape                                                                                       |
| -------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| Running        | `Play`    | A filled directional triangle. The only solid, asymmetric mark in the set — reads as motion at 11px. |
| Idle           | `Circle`  | A hollow ring. Maximum silhouette distance from the filled triangle.                                 |
| Awaiting input | `Pause`   | Two vertical bars. Reads as "stopped, by request" rather than "stopped, finished".                   |
| Exited         | `CircleX` | A ring with a cross. Shares the ring silhouette with idle but is unmistakably terminated.            |

The existing busy spinner and bell-count treatments are unchanged; they already win over the state glyph when present, and that precedence stays.

**Rationale**

Constitution XII forbids colour on icon elements and permits opacity only. FR-002 requires four states distinguishable by shape rather than hue. The two constraints are satisfied by the same choice: differentiate by component, never by fill. `Pause` and `Play` are a conventional, learned pair, and `Circle`/`CircleX` share a silhouette family so that "quiet" and "dead" read as related rather than arbitrary.

Colour is not abandoned — it moves to where the constitution allows it. The awaiting-input row keeps its amber edge bar, which is a row-level element and already exists (`session-row--needs-you`). That satisfies FR-004's requirement for a second non-colour cue _and_ keeps the visual urgency the audit's mockups reached for.

**Alternatives considered**

- _Tinting the glyphs green/amber/grey_, as the audit mockups drew them — **rejected**, direct violation of XII. The mockups were illustrative; the constitution is binding. This is stricter and makes SC-001 a harder test to pass, which is the right direction.
- _Opacity-only differentiation on a single shape_ — permitted by XII, but rejected against FR-002: three opacities of one dot is exactly the failure the audit found (SESS-1), and opacity is not a shape.
- _`Loader` or `LoaderCircle` for running_ — rejected. It implies an animation, and animating a glyph on every row at 200 sessions is a repaint cost for no information the spinner does not already carry.
- _Text labels instead of glyphs_ — rejected on width; the row is already carrying branch, stats and age.

**Source**: component availability verified directly against `node_modules/lucide-react/dist/esm/icons/` (`play.js`, `circle.js`, `pause.js`, `circle-x.js` all present). `LayoutGrid`, `Bell` and `X` are already imported elsewhere in the renderer, so the import style is established.

---

## R2 — How change statistics are fetched without blocking paint

**Decision**

A new main-process function `getChangeStats(cwd)` returning `{ added, removed, files }`, exposed over IPC as `git:change-stats`, consumed by a new renderer store `change-stats.store.ts` with:

- **Keyed by branch id**, value `{ stats, fetchedAt, state: 'idle' | 'loading' | 'error' }`.
- **Lazy** — a branch's stats are requested the first time its row renders, never eagerly for the whole tree.
- **TTL of 15 seconds** — a repeat request inside the window returns the cached value without touching git.
- **Invalidated** on: a session in that branch stamping activity, a git operation completing in that branch, and the window regaining focus.
- **Never awaited by render** — the row renders without stats and fills them in. A branch whose stats are `error` or absent renders exactly as it does today.

`getChangeStats` runs `git diff --numstat HEAD` in the branch's own working directory (the worktree path when present, the repo root otherwise) and sums the columns, matching the `execFile` + `GIT_TIMEOUT` + `GIT_ENV` pattern every other function in `git-service.ts` already uses.

**Rationale**

The sidebar renders on every session state change. Any synchronous or render-coupled git call would put a process spawn on that path — at six repos that is six spawns per keystroke-driven re-render. Caching by branch with a short TTL bounds it to one spawn per branch per 15s, and lazy fetching means collapsed groups cost nothing.

Keeping the stats out of the `Project` record is what preserves constitution XI: `buildGroups` remains a pure function of its arguments, and its existing performance spec keeps passing unchanged. This is the deviation recorded in the plan's Complexity Tracking, and it is the cheaper side of that trade.

`--numstat` against `HEAD` covers staged and unstaged work in one call, which is the number a user reading a sidebar row actually wants ("how much have I changed on this branch"). It does not count untracked files; that is a documented limitation, consistent with how `git diff` behaves everywhere else in the app.

**Alternatives considered**

- _Reuse the existing `getStatus()`_ — it returns a file list, not line counts, and caps at 500 files. Deriving `+n/−m` from it is impossible without a second call per file. Rejected.
- _Store `added`/`removed` on the branch record_ — rejected, see Complexity Tracking: it makes the pure view model depend on I/O timing.
- _A file-system watcher per branch_ — rejected as premature (constitution VII). Six worktrees × recursive watchers is real cost for a number that is decorative. Revisit only if the 15s TTL proves visibly stale in use.
- _Fetch eagerly for all branches on mount_ — rejected; it reintroduces the startup cost the lazy path exists to avoid, for rows the user may never look at.

---

## R3 — Sidebar width, and how the row degrades

**Decision**

- Default width **300px** (from 260). Minimum stays **200px**; maximum stays **480px**.
- Existing stored widths are respected — a user who has already dragged the sidebar keeps their value. Only the default for a fresh profile changes.
- The row degrades by dropping metadata in a fixed order as width falls, never by wrapping or by hiding the name:

| Below | Drops                                   |
| ----- | --------------------------------------- |
| 300px | change statistics                       |
| 260px | the worktree tag text (the glyph stays) |
| 230px | the relative activity time              |
| —     | name and state glyph never drop         |

**Rationale**

Building all four sidebar mockups showed every direction needed more than 260px to seat branch name plus state plus metadata without truncating the branch name to uselessness — the branch names in this repo run to 30 characters (`032-sidebar-workspace-grouping`). 300px seats a 30-character monospace branch name at 11.5px with room for the state glyph and count.

The degradation order is by information value, cheapest first: statistics are decorative, the worktree glyph carries the safety-relevant bit (FR-007) so its text can go but its shape cannot, and activity time is already a secondary cue. The name and state are the two things FR-001 and FR-005 exist to guarantee, so they are unconditional.

**Alternatives considered**

- _Keeping 260px and truncating harder_ — rejected; a truncated branch name is the ambiguity the feature exists to remove.
- _A two-line row_ — rejected on density. At 200 sessions the list is already long; doubling row height halves what fits on screen, which is the complaint the flat sidebar was built to fix.
- _A user-facing density setting_ — rejected as speculative under constitution VII. The automatic degradation covers the real cases; add a setting only if someone asks.

---

## R4 — Whether the rename touches stored data

**Decision**

**UI-only.** Every user-visible string becomes "branch". The stored entity, its TypeScript type, its IPC channel names and its Extension API surface all keep the name `Project`.

The seam is held in place by a lint rule: user-facing string literals under `src/renderer/components/` may not contain the word "project" (case-insensitive), with an allowlist for identifiers and imports. A violation is a lint error, which constitution X already makes a blocker.

**Rationale**

FR-021 forbids a stored-data change an older build cannot read, and FR-020 forbids requiring extension changes. Renaming the persisted entity would touch the workspace store schema, every `project:*` IPC channel, and the published `api.project.*` Extension API that installed extensions call — which is exactly the compatibility break both requirements rule out. The user-visible benefit of renaming the internal type is zero, because the UI controls its own labels.

The honest cost is a permanent translation seam: a reader of the code sees `Project` where the product says "branch". That is recorded in Complexity Tracking, and the lint rule converts "someone will forget" from a certainty into a build failure.

**Alternatives considered**

- _Full end-to-end rename with a migration_ — rejected against FR-020/FR-021. Revisit only if the Extension API takes a major version bump for other reasons, at which point the rename rides along for free.
- _Rename the type but keep the wire format_ — rejected as the worst of both: the same translation seam, plus a diff across every file that touches a project, plus no compatibility gain.
- _No lint rule, rely on review_ — rejected. The audit found "project" in the palette, three dialogs and the README simultaneously; review already failed at this once.

---

## R5 — How one app band absorbs two contribution points

**Decision**

`AppBand.tsx` renders a single labelled strip from two existing sources, unchanged:

1. **Global tabs** — the `contributes.globalTab` manifest entry (`{ label, icon, view }`), already used by Remote Control, Notes and Task Vault, plus core's own Overview entry.
2. **Contributed sidebar items** — the existing `api.sidebar.registerItem()` registrations, today rendered by `ExtensionFooter` (Git Changes).

Both are read through the extension registry the renderer already consumes. Every entry renders icon-above-label with a visible text label and an accessible name taken from the contribution's `label`. `ExtensionFooter.tsx` is deleted. The notification bell and the add-repo control move down onto the search row.

The two API surfaces stay distinct in the contract — extensions keep registering exactly as they do today, and nothing in the manifest or the API changes. What changes is only where core chooses to draw them.

**Rationale**

Constitution II forbids core knowing about specific extensions, and this respects it: `AppBand` iterates registry data and never names an extension. Merging the _render target_ is core's own layout decision, which is core's to make.

The audit's NAV-7 finding is that an API distinction (global tab vs sidebar item) is leaking into layout — a user has no way to know why Notes is at the top and Git Changes at the bottom, because the reason is an implementation detail. Keeping both registration paths while unifying presentation fixes the user-visible problem without touching the contract, which is what FR-020 requires.

Icon fallback: a contribution whose `icon` string does not resolve to a lucide component renders a generic `Square` with its label. Labels are mandatory in both contracts already, so no entry can be unlabelled — which is the actual fix for NAV-5.

**Alternatives considered**

- _Collapse the two contribution points into one API_ — rejected under FR-020; it would require every installed extension to change.
- _Keep the footer and only label the top strip_ — rejected; it fixes NAV-5 and leaves NAV-7 exactly as found.
- _Move everything to the footer instead_ — rejected. Overview is the most-used destination of the five and belongs above the fold, not below a 200-row list.

---

## Resolved unknowns summary

| #   | Unknown                                  | Resolution                                                                            |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| R1  | State icons under constitution XII       | `Play` / `Circle` / `Pause` / `CircleX`, flat `currentColor`; colour stays on the row |
| R2  | Change statistics without blocking paint | New `getChangeStats` + IPC + lazy TTL'd store; never awaited by render                |
| R3  | Sidebar width and degradation            | Default 300px, fixed drop order, name and state never drop                            |
| R4  | Scope of the rename                      | UI-only, enforced by a lint rule; stored entity unchanged                             |
| R5  | One band, two contribution points        | Unified render target, both contracts untouched                                       |
