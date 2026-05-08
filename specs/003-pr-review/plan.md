# Implementation Plan: Unified Pull Request Review

**Branch**: `003-pr-review` | **Date**: 2026-05-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/003-pr-review/spec.md`

---

## Summary

Adds a second project tab labelled **"Code Reviews"** to the existing `git-integration` extension — sitting alongside the existing "Git" tab in the project view. The tab is registered in `extensions/git-integration/src/renderer.tsx` via the same `registry.registerProjectTab` call used for the "Git" tab today.

The "Code Reviews" tab provides a prioritised review queue and a full three-panel PR review surface: dependency-ordered chapter navigation on the left, diff viewer with per-file health chips and inline comment gutter in the centre, and a risk breakdown / comments panel on the right. All GitHub operations go through the `gh` CLI via a new `github:*` IPC channel namespace. Review session state (per-file viewed status, chapter position, manual file order) is auto-saved to `electron-store` on every viewed-state change.

---

## Technical Context

**Language/Version**: TypeScript 5.5 (strict)
**Primary Dependencies**: Electron 30, React 18.3, Zustand 4.5, Zod 3.23, electron-store 8.2, highlight.js 11 (existing); `react-markdown` 9 + `remark-gfm` 4 (new — see research.md §1)
**Storage**: `electron-store` (existing) — new key `pr-review-sessions`
**Testing**: Vitest 2.0 (unit), Playwright 1.45 (e2e)
**Target Platform**: macOS/Windows desktop (Electron)
**Project Type**: Electron desktop app — extension tab
**Performance Goals**: PR queue + file tree renders in < 3 s for up to 200 changed files on warm cache (SC-002)
**Constraints**: All GitHub operations MUST use `gh` CLI via `api.shell.exec` / `github:*` IPC — no direct HTTPS fetch from renderer (consistent with existing sandboxed shell pattern). No new IPC channels are added to `shell:exec`; instead a dedicated `github.ipc.ts` module handles the new channels.
**Scale/Scope**: Up to 500 open PRs in queue, up to 200 changed files per PR, up to 1 000 inline comments per PR

---

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design._

| Principle | Status | Notes |
|---|---|---|
| I. Source Integrity | ✅ PASS | `gh` CLI official docs, `react-markdown` README/unified docs cited in research.md |
| II. Dependency Stewardship | ✅ PASS | `react-markdown` (13k⭐, unified collective, multiple maintainers); `remark-gfm` (same org). All versions pinned. No single-maintainer packages. |
| III. Code Readability & Minimalism | ✅ PASS | No speculative abstractions; risk scorer is a pure function |
| IV. TDD (NON-NEGOTIABLE) | ✅ PASS | Red→Green→Refactor enforced. `chapter-builder`, `risk-score`, `pr-review-service` all have spec files created before implementation |
| V. SOLID & YAGNI | ✅ PASS | Chapter builder and risk scorer are isolated, independently testable services. No cross-feature abstractions. |
| VI. Documentation as First-Class | ✅ PASS | `README.md`, `docs/ARCHITECTURE.md`, `ipc-channels-pr-review.md`, `electron.d.ts`, 3 ADRs all part of this plan |
| VII. ADRs | ✅ PASS | ADR-009, ADR-010, ADR-011 required (see contracts/) |
| VIII. Functional Purity | ✅ PASS | `buildChapters()` and `computeRiskScore()` are pure; side effects isolated to `PrReviewService` and IPC handlers |

**Complexity Tracking**: No violations to justify.

---

## Project Structure

### Documentation (this feature)

```text
specs/003-pr-review/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── contracts/
│   ├── ipc-channels-pr-review.md
│   └── adrs/
│       ├── 009-gh-cli-for-review-ops.md
│       ├── 010-heuristic-file-ordering-v1.md
│       └── 011-react-markdown-for-comments.md
└── tasks.md             ← Phase 2 output (/speckit-tasks)
```

### Source Code

```text
extensions/git-integration/
├── src/
│   ├── renderer.tsx                       ← ADD: registerProjectTab 'code-reviews' (label: "Code Reviews")
│   ├── components/
│   │   └── pr-review/                     ← NEW
│   │       ├── PrReviewTab.tsx            ← root: queue ↔ review view switcher
│   │       ├── ReviewQueue.tsx            ← PR list dashboard with stat cards + sections
│   │       ├── PrReviewView.tsx           ← 3-panel layout shell
│   │       ├── ChapterNav.tsx             ← top chapter tab bar
│   │       ├── ChapterFileList.tsx        ← left panel: ordered, draggable file list
│   │       ├── ReviewDiffPane.tsx         ← centre: diff + health chips + comment gutter
│   │       ├── RiskBreakdownPanel.tsx     ← right panel: score breakdown + importers + comments
│   │       ├── HealthChips.tsx            ← health chip row (7 chips)
│   │       ├── InlineCommentThread.tsx    ← thread display (root + nested replies)
│   │       ├── CommentComposer.tsx        ← new comment / reply input with markdown preview
│   │       ├── RichContent.tsx            ← react-markdown wrapper (shared renderer)
│   │       ├── ReviewSubmitPanel.tsx      ← approve / request-changes / comment form
│   │       └── pr-review.css
│   ├── github/
│   │   ├── gh-service.ts                  ← EXISTING (no changes needed)
│   │   └── pr-review-service.ts           ← NEW: chapter builder, risk scorer, gh call wrappers
│   ├── stores/
│   │   ├── git.store.ts                   ← EXISTING (no changes)
│   │   └── pr-review.store.ts             ← NEW: Zustand store for review session state
│   └── hooks/
│       └── usePrReview.ts                 ← NEW: data-fetching effects for the review view

├── tests/
│   └── unit/
│       ├── chapter-builder.spec.ts        ← NEW (TDD first)
│       ├── risk-score.spec.ts             ← NEW (TDD first)
│       ├── pr-review-service.spec.ts      ← NEW (TDD first)
│       ├── gh-service.spec.ts             ← EXISTING
│       └── git-parser.spec.ts             ← EXISTING

src/
├── main/
│   └── ipc/
│       └── github.ipc.ts                  ← NEW: gh:* IPC handlers
├── shared/
│   └── schemas/
│       └── pr-review.schema.ts            ← NEW: Zod schemas for all PR review types
└── renderer/
    └── electron.d.ts                      ← UPDATE: add github.* namespace
```

---

## Phase 0: Research

See [research.md](./research.md) — all NEEDS CLARIFICATION resolved.

---

## Phase 1: Design

### Data Model

See [data-model.md](./data-model.md).

### Interface Contracts

See [contracts/ipc-channels-pr-review.md](./contracts/ipc-channels-pr-review.md).

### Implementation Notes

**Tab registration** (`extensions/git-integration/src/renderer.tsx`): The existing file already calls `registry.registerProjectTab({ id: 'git', label: 'Git', component: GitFullView })`. One additional call is added directly below it:

```typescript
registry.registerProjectTab({
  id: 'code-reviews',
  label: 'Code Reviews',
  component: PrReviewTab,
})
```

No changes to the core app, the extension host, or any other extension are needed. The `ProjectTabRegistration` interface already supports multiple tabs from the same extension.

**GitHub data access pattern**: All PR review data flows through `gh api` subcommands shelled out via the existing `execShell` / `github:*` IPC pattern. The renderer calls `window.electronAPI.github.*`; the main process handler execs `gh api repos/{owner}/{repo}/pulls/{number}/...`. No direct fetch/HTTPS from renderer. See ADR-009.

**Session auto-save**: The Zustand `pr-review.store.ts` `markFileViewed` action calls `persistSession(repoRoot, prNumber, headSHA, session)` synchronously using `electron-store`. No explicit "save" step. On app restart, `initSession` reads from store before first render.

**Chapter building**: `buildChapters(files: PrChangedFile[]): Chapter[]` is a pure function exported from `pr-review-service.ts`. It applies the heuristic ordering rules (see ADR-010) and groups files by top-level directory segment. The function has no I/O; it is tested exhaustively in `chapter-builder.spec.ts` before any UI work begins.

**Risk scoring**: `computeRiskScore(metrics: FileMetrics): RiskScore` is a pure function. Inputs are populated by `PrReviewService.fetchFileMetrics()` which calls `gh` + `git log` for churn and blast-radius. Complexity delta and patch coverage show as `null` (rendered as "?") in v1. See ADR-010.

**Markdown rendering**: `RichContent.tsx` wraps `react-markdown` + `remark-gfm`. Used for all comment bodies and PR description. Not used for diff content (which uses `highlight.js` as today). See ADR-011.

**Inline comment gutter**: `ReviewDiffPane` renders each diff row as a `<tr>` with a zero-width `<td class="diff-gutter">` that becomes visible on `tr:hover`. Clicking the `+` button in the gutter sets `composerAnchor` state. Multi-line selection tracks `mousedown`/`mouseup` line numbers on the `<tbody>`. No external drag library needed.

**Drag-and-drop file reorder**: `ChapterFileList` uses the browser's native HTML5 drag-and-drop API (`draggable`, `onDragOver`, `onDrop`) — no library. Reorder result dispatches `reorderFiles(chapterId, newOrder)` to `pr-review.store`, which auto-persists.

**Rate-limit banner**: When any `github:*` IPC call returns `{ error: 'RATE_LIMITED', resetAt: number }`, `pr-review.store` sets `rateLimitState`. `PrReviewView` renders a non-blocking `<RateLimitBanner>` and individual unloaded items show a `<RetryButton>`.

---

## Complexity Tracking

No deviations from Constitution principles. All items are within spec scope.
