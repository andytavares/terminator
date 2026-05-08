# Tasks: Unified Pull Request Review ("Code Reviews" Tab)

**Input**: Design documents from `specs/003-pr-review/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: Per Constitution Principle IV (TDD — NON-NEGOTIABLE), test tasks MUST be written and confirmed FAILING before their corresponding implementation tasks.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other [P] tasks in the same phase (different files, no shared state)
- **[Story]**: Maps to user story in spec.md (US1–US6)
- Exact file paths are included in every task description

---

## Phase 1: Setup

**Purpose**: Install dependencies, create the shared schema file, and scaffold the component directory structure.

- [X] T001 Add `react-markdown@9` and `remark-gfm@4` to `extensions/git-integration/package.json` and run `npm install` from repo root
- [X] T002 [P] Create `src/shared/schemas/pr-review.schema.ts` with Zod schemas for all types in `specs/003-pr-review/data-model.md`: `ReviewQueuePRSchema`, `SignalDotsSchema`, `PrReviewDetailSchema`, `ChapterSchema`, `PrChangedFileSchema`, `RiskScoreSchema`, `FileMetricsSchema`, `InlineCommentSchema`, `ThreadSchema`, `ReviewSessionSchema`
- [X] T003 [P] Create empty placeholder files for all new components and services listed in `specs/003-pr-review/plan.md` under the `extensions/git-integration/src/components/pr-review/` directory, `extensions/git-integration/src/github/pr-review-service.ts`, `extensions/git-integration/src/stores/pr-review.store.ts`, and `extensions/git-integration/src/hooks/usePrReview.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: IPC plumbing, store scaffold, and tab registration. MUST be complete before any user story phase.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Add `github.*` namespace to `src/renderer/electron.d.ts` per the contract in `specs/003-pr-review/contracts/ipc-channels-pr-review.md` (10 methods: `listOpenPrs`, `prReviewDetail`, `prFileDiff`, `fileMetrics`, `prInlineComments`, `prCommentAdd`, `prCommentReply`, `prReviewSubmit`, `sessionGet`, `sessionSet`)
- [X] T005 Add `github` namespace to `src/main/preload.ts` with `ipcRenderer.invoke` wrappers for all 10 `github:*` channels (including `github:session-get` and `github:session-set`), following the same pattern as the existing `git` namespace
- [X] T006 Create `src/main/ipc/github.ipc.ts` with `registerGithubHandlers()` function containing stub `ipcMain.handle` registrations for all 10 channels: `github:list-open-prs`, `github:pr-review-detail`, `github:pr-file-diff`, `github:file-metrics`, `github:pr-inline-comments`, `github:pr-comment-add`, `github:pr-comment-reply`, `github:pr-review-submit`, `github:session-get`, `github:session-set` — each returning `{ error: 'NOT_IMPLEMENTED' }` initially
- [X] T007 Import and call `registerGithubHandlers()` in `src/main/index.ts` alongside the existing `registerGitHandlers()` call
- [X] T008 Create `extensions/git-integration/src/stores/pr-review.store.ts` as a Zustand store with the `ReviewSession` state shape from `data-model.md`, actions: `initSession`, `markFileViewed`, `unmarkFileViewed`, `setCurrentFile`, `setCurrentChapter`, `reorderFiles`, `setPaused`, `setRateLimitState`, and `reset`
- [X] T009 Create `extensions/git-integration/src/components/pr-review/PrReviewTab.tsx` as the root component (receives `{ repoRoot: string | null }` props per `ProjectTabRegistration` interface) — renders `<ReviewQueue>` when no PR is selected, renders `<PrReviewView>` when a PR is open; reads active PR from `pr-review.store`
- [X] T010 Register the "Code Reviews" project tab in `extensions/git-integration/src/renderer.tsx` by adding `registry.registerProjectTab({ id: 'code-reviews', label: 'Code Reviews', component: PrReviewTab })` directly below the existing `registerProjectTab` call for the "Git" tab

**Checkpoint**: Build passes (`npm run build`), the "Code Reviews" tab appears in the UI (even if blank), TypeScript compilation has no errors on the new types.

---

## Phase 3: User Story 1 — Review Queue Dashboard (Priority: P1) 🎯 MVP

**Goal**: Reviewer opens the "Code Reviews" tab and sees a prioritised, structured list of all open PRs with rich metadata, categorised into sections, filterable by pills.

**Independent Test**: Open the "Code Reviews" tab on a project with a connected GitHub repo. Verify: four stat cards render with real counts; PRs appear in correct sections (read-first / quick-wins / larger); each PR row shows number, title, author, signal dots, estimated time, and an action badge.

### Tests for User Story 1 (write FIRST — confirm FAILING before implementing)

- [X] T011 [US1] Write failing unit tests in `extensions/git-integration/tests/unit/review-queue.spec.ts` covering: `parseReviewQueuePR()` maps `gh pr list` JSON to `ReviewQueuePR`; risk level derived correctly from signal values; `estimatedMinutes` formula (ceil((additions+deletions)/60)); section classification (high-risk → read-first, ≤100 LOC + low-risk → quick-wins)

### Implementation for User Story 1

- [X] T012 [US1] Implement `listOpenPrs(repoRoot: string)` in `src/main/ipc/github.ipc.ts` — replace the stub: exec `gh pr list --state open --limit 500 --json number,title,author,createdAt,headRefName,baseRefName,isDraft,statusCheckRollup,files` and return `{ prs: ReviewQueuePR[] }`
- [X] T013 [US1] Implement `parseReviewQueuePR()` and `classifyRiskLevel()` in `extensions/git-integration/src/github/pr-review-service.ts` — makes the T011 tests pass
- [X] T014 [US1] Create `extensions/git-integration/src/components/pr-review/ReviewQueue.tsx` with the four stat cards: "Awaiting you" (count + Δ since yesterday), "High risk" (count + "read these first"), "Total review time" (est. sum), "In progress" (count + "resume from where you stopped")
- [X] T015 [P] [US1] Add the three labelled PR sections to `ReviewQueue.tsx`: "Read these first" (red left border, high-risk PRs), "Quick wins" (green left border, low-risk ≤100 LOC), "Larger reviews" (all others)
- [X] T016 [P] [US1] Add filter pills to `ReviewQueue.tsx`: All / High risk / Quick wins / In progress / Stale (>3d) — each filters the visible PR list
- [X] T017 [US1] Add the PR row component inside `ReviewQueue.tsx` showing: PR number, title, author, time-since-opened, scope description, file count, additions/deletions, six coloured signal dots (legend: tests / coverage / CI / lint / churn / blast radius), estimated review time, action badge (approve / review / resume Ch N/M)
- [X] T018 [US1] Wire `ReviewQueue` to `window.electronAPI.github.listOpenPrs(repoRoot)` in `usePrReview.ts`, handle loading/empty/error/rate-limited states
- [X] T019 [US1] Add rate-limit banner to `ReviewQueue.tsx`: non-blocking yellow banner when store has `rateLimitState` set, with a per-item retry control on unloaded rows

**Checkpoint**: "Code Reviews" tab shows the live review queue for the current repo. All PR sections, filter pills, and action badges work.

---

## Phase 4: User Story 2 — Dependency-Ordered Chapter Navigation (Priority: P1)

**Goal**: Reviewer opens a PR and sees files grouped into dependency-ordered chapters (not alphabetical), with a chapter nav bar, numbered file list with "why this file is here" labels, diff view, and "Mark viewed → Next" controls.

**Independent Test**: Open a PR with 10+ changed files spanning multiple directories. Verify: files are grouped into named chapters; within each chapter, type/interface files appear before implementation files and test files appear last; "Mechanical" chapter is auto-collapsed; reviewer can mark files viewed and advance through a chapter; drag-and-drop reorder works and persists.

### Tests for User Story 2 (write FIRST — confirm FAILING before implementing)

- [X] T020 [US2] Write failing unit tests in `extensions/git-integration/tests/unit/chapter-builder.spec.ts` for `buildChapters()`: files sorted into four tiers (T0 types, T1 source, T2 tests, T3 mechanical); files grouped by top-level directory segment; Mechanical chapter is last and `tier === 3`; empty PR returns `[]`; single-file PR returns one chapter with one file; drag-drop override (`fileOrderOverrides`) respected when provided

### Implementation for User Story 2

- [X] T021 [US2] Implement `buildChapters(files: PrChangedFile[], overrides?: Record<string, string[]>): Chapter[]` in `extensions/git-integration/src/github/pr-review-service.ts` — makes T020 tests pass
- [X] T022 [US2] Implement `prReviewDetail` handler in `src/main/ipc/github.ipc.ts`: exec `gh pr view <prNumber> --json ...` + `gh pr view <prNumber> --json files`, build chapters via `buildChapters()`, return `PrReviewDetail`
- [X] T023 [US2] Implement `useLoadPrDetail(repoRoot, prNumber)` in `extensions/git-integration/src/hooks/usePrReview.ts` — calls `window.electronAPI.github.prReviewDetail`, populates store, handles loading/error states
- [X] T024 [US2] Create `extensions/git-integration/src/components/pr-review/PrReviewView.tsx` — three-column layout: left `<ChapterFileList>`, centre `<ReviewDiffPane>`, right `<RiskBreakdownPanel>`; reads active chapter/file from `pr-review.store`
- [X] T025 [US2] Create `extensions/git-integration/src/components/pr-review/ChapterNav.tsx` — horizontal tab bar showing all chapters; each tab shows name, file count, estimated time, and status indicator (not started / in progress / complete ✓); clicking a tab switches active chapter in store
- [X] T026 [US2] Create `extensions/git-integration/src/components/pr-review/ChapterFileList.tsx` — renders ordered file list for the active chapter; each row shows: number badge, risk dot placeholder (coloured once US3 is done), filename, +additions/-deletions, "why this file is here" label (always shown per FR-011/FR-043); supports HTML5 drag-and-drop reorder dispatching `reorderFiles` to store
- [X] T027 [US2] Create `extensions/git-integration/src/components/pr-review/ReviewDiffPane.tsx` — loads `FileDiff` via `window.electronAPI.github.prFileDiff` on file selection; renders existing `<FileDiffView>` component; shows filename, change badge, binary-file message; bottom status bar with chapter progress (`2 of 4 files`)
- [X] T028 [US2] Add navigation controls to `ReviewDiffPane.tsx`: "← Previous file" (`[`), "Mark viewed → Next file" (`1`), "Finish chapter" (`↵`) — wire to store actions; keyboard shortcuts registered via `api.keyboard.register`
- [X] T029 [US2] Connect `markFileViewed` store action to auto-save: inside `markFileViewed`, call `window.electronAPI.github.sessionSet(key, session)` via the `github:session-set` IPC channel — electron-store is main-process-only and cannot be called directly from the renderer

**Checkpoint**: Reviewer can open any PR, navigate through dependency-ordered chapters, mark files viewed, and the progress persists correctly in the file tree.

---

## Phase 5: User Story 3 — Per-File Risk Score and Health Chips (Priority: P1)

**Goal**: Every file in the chapter list shows a coloured risk dot. Above the diff, a row of 7 health chips displays real metric values. A right-panel breakdown shows the composite score, per-metric bars, and top importers. Inline complexity hotspot annotations appear within the diff.

**Independent Test**: Open a PR with at least one large, highly-imported file with no adjacent test. Verify: that file shows a red dot and "HIGH RISK" badge; chips row shows correct churn count, blast radius count, and "missing" tests chip; right panel shows composite score and importer list. Open a small config-only file — verify it shows a green dot.

### Tests for User Story 3 (write FIRST — confirm FAILING before implementing)

- [X] T030 [US3] Write failing unit tests in `extensions/git-integration/tests/unit/risk-score.spec.ts` for `computeRiskScore()`: low/medium/high thresholds; all-null metrics returns `{ level: 'low', composite: null }`; `testFileMissing` adds correct weight; `dominantDriver` string set to the highest-contributing metric; `topImporters` capped at 5

### Implementation for User Story 3

- [X] T031 [US3] Implement `computeRiskScore(metrics: FileMetrics, allFilesMetrics: FileMetrics[]): RiskScore` in `extensions/git-integration/src/github/pr-review-service.ts` — min-max normalises across current PR file set, calculates composite score, sets `dominantDriver` — makes T030 tests pass
- [X] T032 [US3] Implement `fileMetrics` handler in `src/main/ipc/github.ipc.ts`: exec `git log --oneline --since="90 days ago" -- <path>` for churn, `git grep -l` for blast radius, `git ls-files -- <spec-pattern>` for test presence; return `FileMetrics` object
- [X] T033 [US3] Add `fetchAllFileMetrics(repoRoot, files)` to `usePrReview.ts` — calls `window.electronAPI.github.fileMetrics` per file (sequential to respect gh rate limits), stores results in `pr-review.store`
- [X] T034 [US3] Create `extensions/git-integration/src/components/pr-review/HealthChips.tsx` — renders 7 chips (tests / complexity-delta / patch-coverage / lint / CI / churn / blast-radius) with value labels; chips show "?" when metric is `null`; chip colour: pass=green, warn=amber, fail=red, unknown=grey
- [X] T035 [US3] Create `extensions/git-integration/src/components/pr-review/RiskBreakdownPanel.tsx` — shows "Why this file is [High/Medium/Low]" heading, composite score (`73 / 100`), per-metric bar visualisations, `Importers (top 5 of N)` list; rendered in the right column of `PrReviewView`
- [X] T036 [US3] Add risk dot and "HIGH RISK why?" badge to `ChapterFileList.tsx` and `ReviewDiffPane.tsx` header — clicking "why?" opens `RiskBreakdownPanel`; dot colours driven by `riskScore.level` from store
- [X] T060 [US3] Write failing unit tests in `extensions/git-integration/tests/unit/risk-score.spec.ts` for `detectComplexityHotspots()`: hunk with 5+ decision-point keywords in added lines is flagged; removed keywords subtract from delta; hunk with hunkDelta < 5 is not flagged; empty diff returns `[]`; per-file `complexityDelta` equals sum of all hunkDeltas
- [X] T061 [US3] Implement `detectComplexityHotspots(diff: FileDiff): Array<{ hunkIndex: number; complexityDelta: number; message: string }>` in `extensions/git-integration/src/github/pr-review-service.ts` — counts decision-point keywords (`if`/`else if`/`for`/`while`/`do`/`switch`/`case`/`catch`/`&&`/`||`/`??`/`? `) in added vs removed lines per hunk; flags hunks where hunkDelta >= 5; message format: "Complexity hotspot — this block adds N decision points (cyclomatic delta +N)."; also returns per-file `complexityDelta` total for the risk score; makes T060 tests pass
- [X] T062 [US3] Render complexity hotspot annotation rows in `ReviewDiffPane.tsx`: after the last line of each flagged hunk, insert a highlighted `<tr>` with amber background and the message from `detectComplexityHotspots()`; populate `FileMetrics.complexityDelta` from the per-file total so the chip and risk score use it

**Checkpoint**: Every file in the chapter list has a coloured risk dot. The health chips row and right-panel breakdown show live metric values. "HIGH RISK why?" badge is visible on high-risk files. Large diff hunks show an inline amber annotation row.

---

## Phase 6: User Story 4 — Pause and Resume (Priority: P2)

**Goal**: Reviewer can pause a review at any time and resume from the exact chapter and file on next open. Progress auto-saves on every "mark viewed" action. Force-push invalidates changed files but preserves unchanged ones.

**Independent Test**: Mark 3 files viewed across 2 chapters, click "Pause review", quit and reopen the app. Verify: the PR shows "Resume Ch N/M" in the queue; opening it restores the exact chapter and file position; the 3 files are still shown as viewed.

### Tests for User Story 4 (write FIRST — confirm FAILING before implementing)

- [X] T037 [US4] Write failing unit tests in `extensions/git-integration/tests/unit/pr-review-service.spec.ts` for session persistence: `persistSession()` writes correct key to electron-store; `loadSession()` returns null for unknown key; session key changes when headSHA changes (force-push invalidation); `viewedFiles` serialises/deserialises correctly as a Set

### Implementation for User Story 4

- [X] T038 [US4] Implement `persistSession()` in `pr-review.store.ts` using `window.electronAPI.github.sessionSet(key, session)` and `loadSession()` using `window.electronAPI.github.sessionGet(key)` with key `"${repoRoot}:::${prNumber}:::${headSHA}"` — makes T037 tests pass; `persistSession` called from `markFileViewed`, `unmarkFileViewed`, `reorderFiles`, and `setPaused` actions
- [X] T039 [US4] Add "Pause review" button to `ReviewDiffPane.tsx` bottom bar — calls `store.setPaused(ISO timestamp)`, navigates back to `<ReviewQueue>` via `PrReviewTab` state
- [X] T040 [US4] Add resume flow to `PrReviewTab.tsx`: on PR selection, call `loadSession()` — if session exists with `currentChapterId` + `currentFilePath`, restore those (and `scrollPosition`) into store and open `<PrReviewView>` at that position; if no session, start fresh
- [X] T063 [US4] Implement `detectChangedFiles(oldFiles: PrChangedFile[], newFiles: PrChangedFile[]): Set<string>` in `extensions/git-integration/src/github/pr-review-service.ts` — compares file paths and blob SHAs; call in `PrReviewTab.tsx` resume flow to mark changed files as needing re-review when headSHA in the loaded session differs from the current PR headSHA (FR-026)

**Checkpoint**: Full pause/resume cycle works. Progress survives app quit. "Resume Ch N/M" badge appears in queue for in-progress PRs. Force-pushed PRs correctly re-flag only changed files.

---

## Phase 7: User Story 5 — Submit a Formal PR Review (Priority: P2)

**Goal**: Reviewer can submit a formal GitHub review (Approve / Request Changes / Comment only) with a text body. Submission posts to GitHub and shows a confirmation toast. Failures preserve the body text for retry.

**Independent Test**: Fill out the review panel, select "Approve", submit — verify the approval appears in GitHub's PR timeline. Test network error path: mock failure — verify error toast appears and text is preserved.

### Tests for User Story 5 (write FIRST — confirm FAILING before implementing)

- [X] T041 [US5] Write failing unit tests in `extensions/git-integration/tests/unit/pr-review-service.spec.ts` for review submission: `prReviewSubmit` IPC handler builds correct `gh api` command for each event type (APPROVE / REQUEST_CHANGES / COMMENT); body is passed correctly; non-zero exit code returns `{ error }`

### Implementation for User Story 5

- [X] T042 [US5] Implement `prReviewSubmit` handler in `src/main/ipc/github.ipc.ts`: exec `gh api repos/{owner}/{repo}/pulls/{prNumber}/reviews --method POST --field event=<event> --field body=<body> --field commit_id=<sha>`, return `{ reviewId }` — makes T041 tests pass
- [X] T043 [US5] Create `extensions/git-integration/src/components/pr-review/ReviewSubmitPanel.tsx` — three-option selector (Approve / Request Changes / Comment), `<textarea>` for body, submit button; submit calls `window.electronAPI.github.prReviewSubmit`, shows success toast via `useToastStore` or failure toast with body preserved

**Checkpoint**: A formal review can be submitted from within the app. Approval/rejection appears on GitHub. Error handling and retry work.

---

## Phase 8: User Story 6 — Inline Comments and Threads (Priority: P2)

**Goal**: Existing inline comments render inside the diff as rich (markdown) formatted content, threaded and anchored to their line(s). Reviewer can add single-line and multi-line comments via a "+" gutter button. Replies thread under the parent. All comment bodies render as rich content (bold, code blocks, lists, etc.).

**Independent Test**: Open a PR with existing inline comments. Verify: all comments appear inline at correct lines; markdown in comment bodies renders (not raw text). Add a new comment via the gutter button, reload — verify it appears. Reply to it — verify nesting. Select 3 lines and comment — verify the range anchor.

### Tests for User Story 6 (write FIRST — confirm FAILING before implementing)

- [X] T044 [US6] Write failing unit tests in `extensions/git-integration/tests/unit/pr-review-service.spec.ts` for `buildThreads()`: groups comments by `threadId`; root comment is always first; replies are in `createdAt` order; `outdated` flag propagates to thread; thread with 4+ comments has `collapsed: true`

### Implementation for User Story 6

- [X] T045 [US6] Implement `buildThreads(comments: InlineComment[]): Thread[]` in `extensions/git-integration/src/github/pr-review-service.ts` — makes T044 tests pass
- [X] T046 [US6] Implement `prInlineComments` handler in `src/main/ipc/github.ipc.ts`: exec `gh api repos/{owner}/{repo}/pulls/{prNumber}/comments --paginate`, parse into `InlineComment[]` using `pr-review.schema.ts`
- [X] T047 [US6] Create `extensions/git-integration/src/components/pr-review/RichContent.tsx` — wraps `react-markdown` with `remark-gfm`; provides a custom `code` component that calls `highlight.js` for fenced code blocks (reusing the existing `hljs.highlight` pattern from `FileDiffView.tsx`)
- [X] T048 [US6] Create `extensions/git-integration/src/components/pr-review/InlineCommentThread.tsx` — renders a `Thread`: root comment + replies in chronological order; "Show N more replies" collapses threads with >3 replies; "Outdated" label on outdated threads; all bodies via `<RichContent>`
- [X] T049 [US6] Create `extensions/git-integration/src/components/pr-review/CommentComposer.tsx` — `<textarea>` with write/preview tabs (preview renders body via `<RichContent>`); submit button calls appropriate IPC (`prCommentAdd` or `prCommentReply`); cancel closes the composer; submit errors show a toast
- [X] T050 [US6] Add "+" gutter column to `ReviewDiffPane.tsx` diff table: `<td class="diff-gutter">` rendered for each `<tr>`; button appears on `tr:hover` via CSS; clicking sets `composerAnchor: { line, side }` state; renders `<CommentComposer>` anchored below the row
- [X] T051 [US6] Add multi-line selection tracking to `ReviewDiffPane.tsx`: `onMouseDown` stores start line, `onMouseUp` stores end line; when selection spans >1 line, the "+" button on any row in the selection opens composer with `startLine` and `line` range
- [X] T052 [US6] Implement `prCommentAdd` and `prCommentReply` handlers in `src/main/ipc/github.ipc.ts`: exec `gh api repos/{owner}/{repo}/pulls/{prNumber}/comments --method POST` with correct fields; return `{ comment: InlineComment }`
- [X] T053 [US6] Wire `usePrReview.ts` to fetch inline comments via `github:pr-inline-comments` and build threads via `buildThreads()`; render `<InlineCommentThread>` components inside `ReviewDiffPane` at correct diff row positions

**Checkpoint**: Full comment workflow works end-to-end. Existing comments visible inline, new comments post to GitHub, replies thread correctly, all content renders as rich markdown.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Keyboard shortcuts, documentation, ADR files, README update.

- [X] T054 [P] Write ADR files to `docs/adr/`: `009-gh-cli-for-review-ops.md`, `010-heuristic-file-ordering-v1.md`, `011-react-markdown-for-comments.md` — copy content from `specs/003-pr-review/contracts/adrs/` as the canonical source
- [X] T055 [P] Register keyboard shortcuts in `extensions/git-integration/src/renderer.tsx`: `[` → previous file, `1` → mark viewed + next file; use `registry.registerKeyboardShortcut` (avoid reserved shortcuts per `RESERVED_SHORTCUTS` set)
- [X] T056 [P] Update `README.md` features list with "Code Reviews tab" entry and brief description
- [X] T057 [P] Update `docs/ARCHITECTURE.md`: add `github:*` IPC namespace, note the new `pr-review` component directory in the git-integration extension, reference `pr-review.schema.ts`
- [X] T058 [P] Add `pr-review.css` styles to `extensions/git-integration/src/components/pr-review/pr-review.css`: 3-column layout, chapter nav tabs, chapter file list, health chip styles, risk dot colours (green/amber/red), gutter button, comment thread indentation, outdated label
- [X] T064 [P] Write a Playwright performance test in `e2e/pr-review-perf.spec.ts` asserting that `ReviewQueue` + chapter file tree for a 200-file mock PR renders in under 3 seconds on warm cache (mocked IPC responses); validates SC-002
- [X] T065 [P] Add test cases to `extensions/git-integration/tests/unit/pr-review-service.spec.ts` asserting that all 10 `github:*` IPC handlers return `{ error: string }` when the underlying `gh`/`git` command exits non-zero; validates FR-040
- [X] T059 Run `npm run lint` and `npm run test` to confirm all tests pass and no TypeScript errors remain

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup) — no dependencies, start immediately
    ↓
Phase 2 (Foundational) — depends on Phase 1; BLOCKS all user story phases
    ↓
Phase 3 (US1 Queue)       ← can start once Phase 2 is done
Phase 4 (US2 Chapters)    ← can start once Phase 2 is done; US1 NOT required
Phase 5 (US3 Risk)        ← depends on Phase 4 (needs file list)
    ↓
Phase 6 (US4 Pause)       ← depends on Phase 4 (needs markFileViewed)
Phase 7 (US5 Submit)      ← can start once Phase 2 is done; independent of US1–US4
Phase 8 (US6 Comments)    ← depends on Phase 4 (needs diff view); US5 NOT required
    ↓
Phase 9 (Polish) — after all desired user stories complete
```

### User Story Dependencies

| Story | Depends on | Notes |
|-------|-----------|-------|
| US1 Queue | Phase 2 only | Fully independent of all other stories |
| US2 Chapters | Phase 2 only | Core review surface; US3–US6 build on it |
| US3 Risk | US2 (needs file list + diff view) | Adds metadata layer on top of US2 |
| US4 Pause/Resume | US2 (needs markFileViewed) | State extension of US2 |
| US5 Submit | Phase 2 only | Independent IPC + UI component |
| US6 Comments | US2 (needs diff view) | US5 not required; comments are independent |

### Within Each User Story

1. Tests written first → confirmed FAILING
2. Pure service functions (schemas, parsers, calculators) → IPC handler implementation
3. IPC handler → store integration → component rendering
4. Component → wired to live data

### Parallel Opportunities (within a phase)

**Phase 1**: T002 and T003 can run in parallel (different files)
**Phase 2**: T004 and T005 and T006 can run in parallel (different files); T007–T010 sequential
**Phase 3**: T015 and T016 can run in parallel once T014 exists
**Phase 4**: T025 and T026 can run in parallel once T024 exists; T027 and T028 can run in parallel
**Phase 9**: T054 through T058 are all parallel

---

## Parallel Example: User Story 2 (Chapters)

```
# Start test spec first:
T020 chapter-builder.spec.ts (write failing tests)

# Once T020 is done, these three are independent:
T021 buildChapters() pure function        ← run against T020 tests
T022 prReviewDetail IPC handler           ← uses buildChapters()
T023 useLoadPrDetail() hook               ← uses IPC handler

# Once T021–T023 complete, start UI in parallel:
T024 PrReviewView layout shell
T025 ChapterNav component
T026 ChapterFileList component
T027 ReviewDiffPane component
```

---

## Implementation Strategy

### MVP First (US1 + US2 = working review surface)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational — tab appears in UI
3. Complete Phase 3 (US1): Review queue with live PR list
4. Complete Phase 4 (US2): Chapter navigation + diff view + mark viewed
5. **STOP and VALIDATE**: Browse PRs, navigate chapters, mark files, progress tracks — core loop works
6. Continue to Phase 5+ for risk scoring, comments, submit

### Incremental Delivery

| After | What works |
|-------|-----------|
| Phase 2 | "Code Reviews" tab exists (blank) |
| Phase 3 | Browse all open PRs with smart queue |
| Phase 4 | Full chapter-based review navigation, mark files viewed |
| Phase 5 | Per-file risk signals and health chips |
| Phase 6 | Pause and resume across sessions |
| Phase 7 | Submit formal reviews to GitHub |
| Phase 8 | Full inline comment workflow with threads |
| Phase 9 | Keyboard shortcuts, docs, polish |

---

## Notes

- All `[P]` tasks touch different files and have no shared mutable state — safe to run in parallel
- Every `[Story]` label maps directly to the user story in `specs/003-pr-review/spec.md`
- Tests MUST fail before implementation — commit the failing test, then the implementation
- `computeRiskScore()` and `buildChapters()` are pure functions — test them exhaustively before any UI work
- `electron-store` writes are synchronous — no async complexity in session persistence
- The "Code Reviews" tab component receives `{ repoRoot: string | null }` per the `ProjectTabRegistration` interface — same as `GitFullView`
- `RichContent.tsx` is the single shared markdown renderer — all comment bodies go through it
