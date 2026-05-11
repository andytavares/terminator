# Feature Specification: Unified Pull Request Review

**Feature Branch**: `003-pr-review`
**Created**: 2026-05-07
**Status**: Draft
**Input**: User description + PRD (PRD-modern-pr-review.md) + UI reference screenshots

---

## Overview

GitHub's default PR view sorts files alphabetically and treats every file as equally important. Research with 1,355 developers found only 10.2% considered alphabetical ordering optimal; 57.6% said it increases context-switching and review fatigue; 63.9% worried it causes them to miss bugs.

This feature replaces the alphabetical wall-of-files with a **dependency-ordered, risk-flagged, chapter-based, progress-aware** review surface directly inside Terminator. The reviewer reads a PR like a story — entry points first, then interfaces, then implementations, then tests — with each file decorated by a risk score derived from objective health metrics. Large PRs are split into resumable "chapters" so a context switch costs minutes, not the whole session.

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Review Queue Dashboard (Priority: P1)

A reviewer clicks the Pull Requests tab in the project nav and lands on a **review queue** — a prioritised, structured overview of all open PRs awaiting their attention, not a flat alphabetical list. The queue surfaces the most important information at a glance: how many PRs are waiting, how many are high-risk, the total estimated review time, and which reviews are already in progress.

The queue is divided into labelled sections:

- **Read these first** — high-risk PRs flagged with a red left border
- **Quick wins** — low-risk PRs under 100 LOC that can be cleared in under 5 minutes, flagged with a green left border
- **Larger reviews** — multi-chapter PRs that benefit from a scheduled focus block
- **In progress** — PRs the reviewer has already started

Each PR row shows: PR number, title, author, time opened, a brief description of the hotspot or scope, file count, additions/deletions, six colored signal dots (representing tests, coverage, CI, lint, churn, and blast radius), estimated review time, and a contextual action badge (Approve, Review, Resume Ch N/M).

Filter pills at the top let the reviewer narrow the list: All, High risk, Quick wins, In progress, Stale >3d.

**Why this priority**: The queue is the entry point for the entire feature. It frames every review decision and directly reduces time spent triaging.

**Independent Test**: Open the PR tab and verify the queue populates with the correct sections, that each section contains the right PRs, and that all per-row metadata is accurate.

**Acceptance Scenarios**:

1. **Given** a project with a connected GitHub repository is open, **When** the reviewer opens the Pull Requests tab, **Then** a review queue dashboard is shown with four stat cards: "Awaiting you" (count + delta since yesterday), "High risk" (count + "read these first"), "Total review time" (estimated aggregate), and "In progress" (count + "resume from where you stopped").
2. **Given** the queue is visible, **When** any PR in the list is clicked, **Then** the reviewer enters the review view for that PR.
3. **Given** a PR was previously paused mid-review, **When** it appears in the queue, **Then** it shows a "Resume Ch N/M" action badge indicating the exact chapter where the reviewer left off.
4. **Given** the queue has high-risk PRs, **When** they are displayed, **Then** they appear in a "Read these first" section with a red left accent, ahead of other sections.
5. **Given** filter pills are visible, **When** the reviewer selects "Quick wins", **Then** only PRs that are low-risk and under 100 LOC are shown.
6. **Given** the repository has no open PRs, **When** the reviewer opens the tab, **Then** an empty-state message is displayed.

---

### User Story 2 — Dependency-Ordered, Chapter-Based File Navigation (Priority: P1)

When a PR is opened, the reviewer does not see a flat alphabetical list of files. Instead, files are grouped into **chapters** — thematically coherent sets of roughly 200–400 lines — and ordered so that each file appears after the code it depends on. Within each chapter, entry points come first, interfaces before implementations, and tests last. A "Mechanical" chapter at the bottom auto-collapses lockfile churn, generated code, and formatting-only changes.

A **chapter navigation bar** spans the top of the review view, showing all chapters as labelled tabs with their file count, estimated time, and completion status. The reviewer can jump to any chapter or proceed linearly. The left panel shows the ordered files within the current chapter, numbered, with each file's risk dot and a short "why this file is here" explanation. The bottom status bar shows chapter progress, keyboard shortcuts, and navigation controls.

**Why this priority**: Ordering is the core differentiator. A wrongly-ordered file list produces wrong reading order; this is the feature that makes large PRs tractable.

**Independent Test**: Open a known multi-file PR and verify files appear in dependency order (not alphabetical), grouped into sensibly-named chapters, with the Mechanical chapter auto-collapsed.

**Acceptance Scenarios**:

1. **Given** a PR with more than 5 changed files is opened, **When** the file view renders, **Then** files are grouped into named chapters rather than a flat list, with each chapter showing its file count and estimated review time.
2. **Given** a chapter is visible, **When** the reviewer looks at the file list within it, **Then** files follow caller→callee order: entry points first, interfaces before implementations, tests last.
3. **Given** a PR includes lockfile, generated, or formatting-only changes, **When** the review view renders, **Then** those files are grouped into a "Mechanical" chapter that is auto-collapsed by default with a one-line summary.
4. **Given** a chapter nav bar is visible, **When** the reviewer clicks a chapter tab, **Then** the file panel and diff view switch to that chapter.
5. **Given** the reviewer is viewing a file, **When** they look at the left panel, **Then** each file shows a numbered position, a colored risk dot, and a short explanation of why it is in this chapter and position.
6. **Given** the reviewer presses the "Mark viewed → Next file" control, **Then** the current file is marked viewed and the view advances to the next file in the chapter order.
7. **Given** the last file in a chapter is marked viewed, **When** the reviewer presses "Finish chapter", **Then** the chapter is marked complete and the view advances to the first unviewed file in the next chapter.
8. **Given** a single file or 1-chapter PR is opened, **When** the view renders, **Then** the chapter nav is hidden and the user goes directly to the diff — the experience is identical to the simpler reviews of today.

---

### User Story 3 — Per-File Risk Score and Health Chips (Priority: P1)

Every changed file in the PR is annotated with a **risk level** (Low / Medium / High) displayed as a colored dot (green / amber / red) in the file tree. Above the diff for each file, a row of **health chips** shows the six contributing signals at a glance: Tests, Complexity delta, Patch coverage, Linter status, CI status, Churn, and Blast radius.

Clicking any chip reveals its detail. Clicking the risk dot — or the "why?" link next to a HIGH badge — opens a right-panel breakdown showing each metric's individual contribution to the composite score (0–100), a bar visualisation per metric, and the top importers of the file (up to the top 5, with a count of additional ones).

**Why this priority**: Risk signals before reading a single line of diff is the second core differentiator. Without this, the reviewer has no way to calibrate how carefully to read each file.

**Independent Test**: Open a PR with known high-complexity and low-coverage files and verify they receive a High risk rating with a matching breakdown; verify a trivial config-only file receives Low.

**Acceptance Scenarios**:

1. **Given** a file is shown in the chapter file tree, **When** the reviewer sees it, **Then** a colored dot (green = low, amber = medium, red = high) is displayed next to the filename.
2. **Given** a file diff is open, **When** the reviewer views the header area above the diff, **Then** a row of health chips is shown for: Tests (missing/unmodified/modified), Complexity delta (e.g. "14 → 31"), Patch coverage (e.g. "42%"), Linter status (e.g. "clean"), CI status (e.g. "passing"), Churn (e.g. "47x/90d"), and Blast radius (e.g. "81 importers").
3. **Given** a file is rated High risk, **When** the header is visible, **Then** a "HIGH RISK" badge with a "why?" link is shown prominently next to the filename.
4. **Given** the reviewer clicks "why?" or the risk dot, **Then** a right-side panel opens showing: a "Why this file is High/Medium/Low" heading, a breakdown of all six metrics with individual values and a bar chart showing each metric's contribution, a composite score (e.g. "73 / 100"), and an "Importers (top 5 of N)" list showing which files in the repo import this one.
5. **Given** the reviewer looks at the diff, **When** a specific function or block has unusually high cognitive complexity, **Then** an inline annotation (complexity hotspot) is shown within the diff at that location with a plain-language explanation (e.g. "Complexity hotspot — this function has cognitive complexity 31 (was 14). Consider extracting the lock-acquire/retry block into a helper.").
6. **Given** a file has no associated test file, **Then** the Tests chip is red and labeled "missing".

---

### User Story 4 — Pause and Resume a Review Session (Priority: P2)

A reviewer can stop mid-review at any time by pressing the "Pause review" button (or keyboard shortcut). When they return — even days later — the review reopens at the exact file and scroll position where they left off. Per-chapter and per-file viewed state is preserved across sessions. A force-push to the PR invalidates line-level position but preserves the per-file "I read this revision" record so the reviewer only re-reads what changed.

**Why this priority**: Context switches are inevitable. Without pause/resume, a reviewer who is interrupted effectively restarts the entire review, which the PRD identifies as the fourth most painful problem in code review.

**Independent Test**: Start a review, mark several files viewed, close the application, reopen, and verify the queue shows "Resume Ch N/M" and the review reopens at the correct file.

**Acceptance Scenarios**:

1. **Given** a review is in progress, **When** the reviewer clicks "Pause review", **Then** all current progress (viewed files, current file, scroll position) is already saved and the reviewer returns to the queue.
2. **Given** a PR was previously paused, **When** the reviewer opens it again from the queue, **Then** the review resumes at the exact chapter and file where they paused, with previously-viewed files still marked as viewed.
3. **Given** a force-push updates the PR after a pause, **When** the reviewer resumes, **Then** per-file "viewed" state for unchanged files is preserved; changed files are shown as needing re-review.
4. **Given** a review is in progress with all files in Chapter 1 marked viewed, **When** the reviewer pauses and resumes, **Then** the chapter nav shows Chapter 1 as complete and the current position is at the start of Chapter 2.

---

### User Story 5 — Submit a Formal PR Review (Priority: P2)

After reviewing, the user submits a formal review to GitHub with one of three outcomes: Approve, Request Changes, or leave a general Comment. They write a summary, then submit. The review is posted to GitHub, and the app confirms the submission.

**Why this priority**: Closes the review loop — without this, the reviewer can read and annotate but cannot formally act on the PR.

**Independent Test**: Submit an Approve review on a test PR and verify it appears in GitHub's PR timeline.

**Acceptance Scenarios**:

1. **Given** the reviewer is in the PR review view, **When** they open the submit panel, **Then** they see three options (Approve, Request Changes, Comment) and a free-text summary field.
2. **Given** the reviewer selects "Approve", writes a summary, and submits, **Then** the PR is approved on GitHub and a success toast is shown.
3. **Given** the reviewer selects "Request Changes" and submits, **Then** GitHub records a changes-requested review.
4. **Given** the reviewer selects "Comment" and submits, **Then** a comment-only review (no approval/rejection) is posted.
5. **Given** the submission fails, **Then** an error notification is shown, the review text is preserved, and the reviewer can retry without data loss.

---

### User Story 6 — Inline Line Comments and Threads (Priority: P2)

While reviewing a diff, the reviewer sees existing inline comments anchored to specific lines or line ranges, rendered as rich formatted content. They can leave new comments on a single line or a selected range of consecutive lines. All comments support threading — replies are nested under the root comment in chronological order and collapsed when a thread grows long.

**Why this priority**: Inline comments are the primary mechanism for communicating specific concerns to the author.

**Independent Test**: Leave a single-line and a multi-line comment on a test PR; reload and verify both appear at the correct positions with correct formatting.

**Acceptance Scenarios**:

1. **Given** a diff has existing inline comments, **When** the reviewer views it, **Then** comments appear inline below their anchor line(s) with author name, avatar, timestamp, and rich-rendered body.
2. **Given** the reviewer hovers or focuses a diff line, **When** they click the comment affordance, **Then** a comment composer opens anchored to that line.
3. **Given** the reviewer selects a range of consecutive lines, **When** they open the comment affordance, **Then** a comment composer opens anchored to the entire selection.
4. **Given** the reviewer types a comment with markdown, **When** they preview it, **Then** bold, italic, inline code, fenced code blocks, ordered/unordered lists, and blockquotes are all rendered correctly.
5. **Given** the reviewer submits a comment, **Then** it appears immediately in the diff and is posted to GitHub.
6. **Given** an inline comment exists, **When** the reviewer clicks "Reply", **Then** a composer opens inline under the thread.
7. **Given** a thread has more than 3 replies, **When** it is displayed, **Then** a "Show N more replies" control collapses older replies, expandable on demand.
8. **Given** a comment is anchored to lines that no longer exist in the latest diff, **When** the diff is shown, **Then** the comment is displayed with an "Outdated" label and remains visible.

---

### Edge Cases

- What happens when the GitHub API rate limit is hit during queue load or diff fetch?
- How does the dependency-ordering algorithm degrade for languages where it cannot build a call graph — does it fall back to a heuristic order (e.g. interface-before-implementation by file extension) rather than silently using alphabetical?
- What if a single chapter exceeds 400 LOC — is the reviewer warned and offered a split?
- How does the risk score display when a metric cannot be computed (e.g. no coverage report exists) — shown as "?" rather than red/green?
- What happens when a comment is submitted but the network drops mid-request?
- What if the user has no write permission on the repository — can they still view diffs and leave comments, or is the submit path disabled?
- How does the file tree render for PRs with 200+ changed files — is the list virtualised to avoid performance degradation?
- What happens when a force-push invalidates the diff after the reviewer has left pending (unsaved) comments?

---

## Requirements _(mandatory)_

### Functional Requirements

**Review Queue**

- **FR-001**: The project navigation MUST include a second tab labelled "Code Reviews" alongside the existing "Git" tab, registered by the git-integration extension, visible when a GitHub repository is configured.
- **FR-002**: The Code Reviews tab MUST display a review queue dashboard with four stat cards: total PRs awaiting review (with delta since yesterday), count of high-risk PRs, estimated total review time across all PRs, and count of in-progress reviews.
- **FR-003**: The review queue MUST group PRs into labelled sections: "Read these first" (high-risk), "Quick wins" (low-risk, ≤ 100 LOC), "Larger reviews" (multi-chapter), and implicitly show in-progress PRs with resume badges.
- **FR-004**: Each PR row in the queue MUST show: PR number, title, author, time since opened, a brief scope description, file count, additions/deletions count, six colored signal dots (tests / coverage / CI / lint / churn / blast radius), estimated review time, and a contextual action badge.
- **FR-005**: The queue MUST be filterable via pills: All, High risk, Quick wins, In progress, Stale (>3 days old).
- **FR-006**: A PR with a prior paused session MUST show a "Resume Ch N/M" badge identifying the chapter where the reviewer stopped.

**File Ordering and Chapters**

- **FR-007**: When a PR is opened, changed files MUST be presented in dependency order — entry points and public interfaces first, implementations after, tests last — not alphabetical order.
- **FR-008**: For PRs with more than 5 changed files or more than 200 lines changed, files MUST be grouped into named chapters of roughly 200–400 lines each.
- **FR-009**: Each chapter MUST show: a generated name reflecting the dominant theme or directory, the count of files, and an estimated review time.
- **FR-010**: A chapter navigation bar MUST be visible at the top of the review view showing all chapters with their status (not started / in progress / complete).
- **FR-011**: Within each chapter, the file list MUST show each file with: a numbered position, a colored risk dot, addition/deletion counts, and a one-line "why this file is here" explanation, regardless of whether the order is system-generated or manually overridden.
- **FR-012**: Mechanical changes (lockfiles, generated code, formatting-only, snapshot files) MUST be grouped into a final "Mechanical" chapter that is auto-collapsed by default with a summary line.
- **FR-013**: The reviewer MUST be able to mark a file as viewed using a "Mark viewed → Next file" control that advances to the next file in chapter order.
- **FR-014**: A "Finish chapter" control MUST be available on the last file of a chapter, advancing to the first file of the next chapter.
- **FR-015**: When the dependency graph cannot be built for a language, the file order MUST fall back to a heuristic (interface/type files first, then by size, then tests) rather than alphabetical.
- **FR-043**: The reviewer MUST be able to manually reorder files within a chapter by dragging and dropping them. Manual order overrides the system-generated order and is persisted as part of the review session state.

**Risk Score and Health Chips**

- **FR-016**: Every changed file MUST receive a risk rating — Low, Medium, or High — displayed as a colored dot (green / amber / red) in the file tree.
- **FR-017**: The risk rating MUST be derived from six metrics: cyclomatic complexity delta (computed by counting decision-point keywords in added vs removed diff lines), change size, patch coverage on changed lines, code churn (90-day), blast radius (count of files that import this file), and presence of a test file.
- **FR-018**: Above the diff for each file, a horizontal row of health chips MUST display all six signals with their current values.
- **FR-019**: Files rated High risk MUST show a "HIGH RISK" badge with a "why?" link adjacent to the filename in the diff header.
- **FR-020**: Clicking "why?" or the risk dot MUST open a right-panel breakdown showing: a label explaining the dominant risk driver, individual metric values with bar visualisations, a composite score (0–100), and the top 5 importers of this file with a count of additional importers.
- **FR-021**: Where a specific code block is identified as a complexity hotspot, an inline annotation MUST appear within the diff at that location with a plain-language explanation.
- **FR-022**: When a metric cannot be computed (e.g. no coverage report available), its chip MUST display "?" rather than a misleading green or red value.

**Pause and Resume**

- **FR-023**: A "Pause review" control MUST be available throughout the review session; it returns the reviewer to the queue. It does NOT gate saving — progress is already saved by this point.
- **FR-024**: Review progress — per-file viewed state, current chapter, current file — MUST be saved immediately and automatically whenever the reviewer marks a file as viewed. Progress MUST survive application restarts, keyed per repository and PR, without requiring any explicit save action.
- **FR-025**: When a PR is resumed, the view MUST restore the reviewer to the exact chapter and file where they paused, with previously-marked files still showing as viewed.
- **FR-026**: A force-push to the PR MUST preserve per-file viewed state for files whose content has not changed; files whose content changed MUST be shown as needing re-review.

**Diff View**

- **FR-027**: The diff view MUST highlight added lines in green and removed lines in red with line numbers visible.
- **FR-028**: Binary files MUST show a message stating the file is binary and cannot be diffed.

**Inline Comments and Threads**

- **FR-029**: Existing inline comments from GitHub MUST be displayed within the diff, anchored to their line or line range, with author, timestamp, and rich-rendered body.
- **FR-030**: The reviewer MUST be able to leave a new inline comment on a single diff line by clicking a "+" icon that appears in the diff gutter when hovering over that line.
- **FR-031**: The reviewer MUST be able to select a consecutive range of lines and leave an inline comment anchored to that range; the "+" icon on any line within an active selection opens a composer anchored to the full selection.
- **FR-032**: All comment bodies MUST be rendered as rich content supporting: bold, italic, inline code, fenced code blocks, ordered lists, unordered lists, and blockquotes.
- **FR-033**: The reviewer MUST be able to reply to any existing inline comment, creating or extending a thread.
- **FR-034**: Threaded replies MUST be displayed in chronological order, visually grouped under their root comment.
- **FR-035**: Threads with more than 3 replies MUST collapse older replies behind a "Show N more replies" control.
- **FR-036**: Inline comments anchored to lines no longer present in the latest diff MUST be shown with an "Outdated" label and remain visible.

**Review Submission**

- **FR-037**: The reviewer MUST be able to submit a formal GitHub review with outcome: Approve, Request Changes, or Comment (no vote).
- **FR-038**: The review submission panel MUST include a free-text summary field.
- **FR-039**: On successful submission, a confirmation notification MUST be shown.

**Error Handling**

- **FR-040**: All GitHub operation failures (load queue, load diff, submit review, post comment) MUST surface as non-blocking error notifications with an actionable message; review text and progress MUST be preserved so the user can retry.
- **FR-041**: When the GitHub API rate limit is hit, the view MUST display whatever data has already loaded and show a non-blocking banner indicating the rate-limit state. Individual items that failed to load MUST show a per-item retry control rather than blocking the entire view.

### Key Entities

- **Pull Request**: GitHub PR — number, title, author, state, base/head branches, creation timestamp, CI check rollup, risk summary, chapter count, estimated total review time.
- **Review Session**: The reviewer's progress on a specific PR at a specific commit SHA — current chapter, current file, per-file viewed/unviewed state. Persisted locally.
- **Chapter**: A named grouping of 1–N related changed files — name, file list (ordered), estimated time, viewed/in-progress/unstarted state.
- **Changed File**: A file modified by the PR — path, change type, addition/deletion counts, risk rating (Low/Medium/High), risk score (0–100), six health metric values, viewed state, "why this file is here" label.
- **Risk Breakdown**: The computed detail behind a file's risk rating — individual metric values (complexity delta, change size, patch coverage, churn, blast radius, test presence), composite score, importer list.
- **Diff Hunk**: A contiguous block of changed lines — hunk header, lines tagged as context/addition/removal, inline annotations (complexity hotspots).
- **Review Submission**: A formal review action — type (approve/request-changes/comment), body text, associated pending inline comments.
- **Inline Comment**: A comment anchored to a line or line range in a specific file diff — author, body (rich content), timestamp, thread ID, anchor (file path, start line, end line, diff side), outdated flag.
- **Thread**: A root inline comment plus its ordered replies — resolved/unresolved state.

---

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The reviewer can open the PR tab, identify the highest-priority PR, and begin reviewing its first file in under 30 seconds.
- **SC-002**: The review queue and file tree for a PR with up to 200 changed files load within 3 seconds on a warm cache.
- **SC-003**: A reviewer can pause a review session, close and reopen the application, and resume from the exact chapter and file where they stopped — with no manual navigation required.
- **SC-004**: 100% of inline comments appear at the correct line positions as shown on GitHub; no comments are anchored to the wrong line.
- **SC-005**: All comment bodies and PR descriptions are rendered as formatted rich content; no raw markdown syntax is visible to the reviewer in any rendered view.
- **SC-006**: A reviewer can complete a full review cycle — open PR, read all chapters, leave inline comments, submit formal review — without leaving the application.
- **SC-007**: Self-reported "I had to restart this review" incidents decrease by 50% compared to using the GitHub web interface, measurable after 30 days of use.
- **SC-008**: The percentage of PRs over 400 LOC where the reviewer reaches the halfway point improves by 30 percentage points compared to the GitHub web baseline.
- **SC-009**: All failures surface as actionable error notifications; no operation fails silently or leaves the UI in an unrecoverable state.

---

## Assumptions

- GitHub authentication (OAuth token or PAT) is already available via the existing Git integration; no new auth flow is required.
- The feature targets the single repository linked to the open project; multi-repository review is out of scope.
- Only open pull requests are shown; closed and merged PRs are out of scope for v1.
- Per-file "viewed" state is stored locally and is not written to GitHub (GitHub has no API for this). It is keyed per repo + PR number + head commit SHA so a force-push correctly invalidates stale line positions.
- Coverage metrics require a coverage report (e.g. lcov/cobertura) to already exist from CI; the application does not run the test suite. If no report is available, the coverage chip shows "?" rather than a value.
- The dependency-ordering algorithm degrades gracefully to a heuristic order when a call graph cannot be built for a given language; the user always sees _some_ logical ordering, never silently falls back to alphabetical.
- Comment editing and deletion are out of scope for v1; submitted comments are treated as immutable in this view.
- The feature targets the desktop application viewport; mobile/responsive layout is out of scope.
- Self-hosted GitHub Enterprise support is a stretch goal, not a v1 requirement.
- "Quick wins" in the review queue are defined as: low risk rating, ≤ 100 lines changed, estimated review time ≤ 5 minutes.
- The "My team" filter pill is out of scope for v1; team membership lookup via the GitHub teams API is deferred to a future release.

---

## Clarifications

### Session 2026-05-07

- Q: When the reviewer marks a file as viewed and then closes the app without clicking "Pause review" — should their progress be saved? → A: Auto-save immediately on every "mark viewed" action; Pause just returns to queue.
- Q: When the GitHub API rate limit is hit mid-session, what should happen? → A: Show partial data with a non-blocking banner; unloaded items show a per-item retry control.
- Q: How does the reviewer initiate a new inline comment on a diff line? → A: A "+" gutter icon appears on hover; clicking it opens the comment composer.
- Q: If the auto-generated chapter/file order looks wrong, can the reviewer manually reorder files? → A: Yes — drag-and-drop reordering within a chapter, persisted to session state. The "why this file is here" label is always shown regardless of order.
- Q: Should "viewed" or "reviewed" be the canonical term for per-file state? → A: "Viewed" is canonical for file-level state; "reviewed" is reserved for the formal PR-level review submission action only.
