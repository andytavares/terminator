# Quickstart: validating the sidebar teardown

**Feature**: `034-declutter-sidebar`

How to prove this feature works. Run from the worktree root. Types and signatures live in [contracts/](./contracts/), the derivations in [data-model.md](./data-model.md); this file is the run guide.

---

## Prerequisites

```bash
npm ci
npm run build:extensions      # extensions/*/src/index.js is a build artifact, never committed
```

---

## The gate, in order

Nothing is done until all four pass, in this order (`feedback_done_checklist`):

```bash
npm run format
npm run lint                  # must be 0 errors — Principle X
npx vitest run --coverage     # all pass, ≥80% on all four metrics
npx playwright test           # the only real app-boot gate
```

`npm run typecheck` is a no-op in this repo — it checks nothing (`files: []` with references and no `--build`). For a real type check, run `tsc -p` per project and diff against `main`.

---

## Pre-flight: the coverage blocker

**Do this before writing any code.** `UnifiedSidebar.tsx` is at **79.2% functions** today, under the 80% threshold on one of the four metrics:

```bash
npx vitest run --coverage tests/unit/renderer/components/UnifiedSidebar.spec.tsx 2>&1 \
  | grep -A 400 "% Stmts" | grep "edSidebar.tsx"
#   ...edSidebar.tsx |   85.26 |    85.93 |    79.2 |    86.9
```

`scripts/check-patch-coverage.cjs` runs on pre-commit and blocks when any **staged** source file is under 80 on any metric. So the first commit that stages `UnifiedSidebar.tsx` is refused before any of this feature's work is judged. The first commit touching that file must also bring its function coverage to ≥80.

Every other touched file is already clear: `SessionGroup.tsx` 93.75, `SessionRow.tsx` 95.23, `SessionTile.tsx` 83.33, `TabBar.tsx` 93.75, `ViewBar.tsx` 100, `WorkspaceRow.tsx` 83.33, `OverviewScreen.tsx` 100 (functions).

---

## Per-story validation

### US1 — the sidebar stops at the branch

```bash
npx vitest run tests/unit/renderer/sidebar/branch-rows.spec.ts
npx vitest run tests/unit/renderer/sidebar/branch-state.spec.ts
```

Then in the app: three repos, four branches each, two or three terminals per branch.

- Sidebar shows **3 repo headers and 12 branch rows**, and no terminal row (FR-001).
- A branch with a waiting terminal reads as waiting; one with working-and-idle reads as working (FR-003).
- A branch with **no** terminals is still listed, and reads idle — not exited (FR-003, and invariant BS-1).
- A scratch terminal appears in its own section (FR-002).
- Collapse a repo holding a waiting branch: the header still signals it (FR-004).

### US2 — the board

```bash
npx vitest run tests/unit/renderer/sidebar/board-lanes.spec.ts
npx vitest run tests/unit/renderer/components/BoardScreen.spec.tsx
```

Eight terminals across three branches, driven into all four states.

- Each appears as a card in the matching lane; every lane header shows glyph, label, count (FR-006–008).
- **Set a lane empty**: it draws a header and nothing beneath — no placeholder, no artwork (FR-009).
- Empty the exited lane: it disappears entirely (FR-010).
- Close every terminal: the board shows one line and one action, not four headers over a dead screen (F6).

**The preview check — do not skip.** Drive one agent from working to waiting and watch its card move lane:

- The card moves in ~180ms, and its **live terminal preview keeps rendering throughout** (FR-020).
- If the preview blanks or flashes, the card was re-parented. See R-003: cards live in one grid and a lane is a `grid-column`. This is the most likely regression in the feature.

Confirm the DOM node survived:

```js
// in devtools, before and after a state change
const before = document.querySelector('[data-session-id="…"]')
// …trigger the change…
before === document.querySelector('[data-session-id="…"]') // must be true
```

### US3 — nothing is lost

Open a branch with four terminals in four states, one with a note, one with unread bells.

- Each tab carries its own state glyph, distinguishable by **shape** (FR-021).
- The tab with bells shows the count (FR-022).
- The note is **not drawn** — it is the tab's tooltip (FR-023 as amended, R-005).
- Rename, close and move all still work from the tab (FR-024).
- No tab draws more than four elements.

### US4 — row anatomy

Count on a screenshot of a populated sidebar:

- No branch row draws more than **six** elements at rest; no repo header more than **three** (FR-026, FR-027).
- A worktree and a plain checkout are distinguishable, and neither carries both a glyph and a word saying the same thing (FR-028).
- A linked issue shows its key as plain text — no badge, no border, no dot (FR-029).
- Hover a row: controls appear and **nothing already on the row moves** (FR-031).

### US5 — chrome

```bash
node scripts/measure-sidebar-chrome.cjs      # added by this feature
```

- At most two bands above the first row of work (FR-033).
- Distance from the sidebar's top to the first row: **165px → ≤99px**, the 40% SC-002 asks for. The design direction measures 81px.
- Every view, grouping, sort and staleness control is reachable from two menus (FR-034).
- With a filter active, the Filter control carries a count and offers clearing it; **no notice strip is drawn** (FR-035).
- Tab through the band: every icon has an accessible name (FR-036, invariant EA-4).

### US6 — colour

Verify by **rendering, not by reading the stylesheet** — jsdom cannot compute `color-mix` (`feedback_verify_css_by_rendering`):

```bash
npx vitest run tests/unit/renderer/sidebar-workspace-tint.spec.ts
```

Retargeted from the washes to the rail and the swatch (R-010). It must assert:

- Every row background at rest computes to `rgba(0, 0, 0, 0)` — no repo tint (FR-041).
- Hover and selection resolve to the same neutral tokens for **every** repo colour (FR-042).
- A repo name is `--text-primary`, never the repo colour (FR-043).
- All ten preset colours, both themes, meet AA. The light-theme case is a **fix**: those names measure 1.08 : 1, 1.23 : 1 and 1.52 : 1 today, against the 4.5 AA requires (R-010).

---

## Extension isolation

```bash
npx vitest run tests/unit/renderer/components/extension-surfaces.spec.tsx
```

Must pass with exactly one edit — the 8px-label assertion becomes an accessible-name assertion. Any other change means a contract moved; see [contracts/extension-api-invariants.md](./contracts/extension-api-invariants.md).

Then the Principle II question: if any extension directory were deleted, does core still build and run? Grep `src/` for any string, import or conditional naming a specific extension — there must be none.

---

## End-to-end

```bash
npx playwright test tests/e2e/sidebar-branch-first.spec.ts
npx playwright test
```

E2E is the only gate that catches a dead app: a missing import passes build, lint and the whole unit suite (`feedback_verify_imports_land`).

Two harness facts worth having up front:

- Extension UI is an overlaid `WebContentsView`. Playwright's `page` cannot see it — read it via `electronApp.evaluate` over `getAllWebContents`, and screenshot with `capturePage` (`project_extension_ui_is_a_webcontentsview`).
- `closeApp()` must stay bounded with a SIGKILL fallback; an unbounded `app.close()` blows the 30s `afterAll` and fails CI as a worker-teardown flake (`feedback_e2e_teardown_bounded`).

If you validate against the packaged app in `/Applications`, check `app.asar`'s mtime first — a stale build has cost a debugging session before (`project_stale_packaged_app`).

---

## Definition of done

- [ ] Four gate commands pass, in order, from the worktree
- [ ] Every user story validated above
- [ ] Deletions listed in [data-model.md §6](./data-model.md) are gone, **with their tests**, and named in the PR (FR-025)
- [ ] `README`, `docs/ARCHITECTURE.md` §"Navigation Chrome — UnifiedSidebar" and `docs/user-guide/USER-GUIDE.md` updated in the same PR (Principle VIII)
- [ ] ADRs written at decision time (Principle IX): the branch-first list, the single-grid board, and one superseding ADR-033 on the colour reduction
