# Research: MergeFlow — Merge Conflict Resolver

**Branch**: `006-mergeflow-conflict-resolver`  
**Date**: 2026-05-25

---

## Decision 1: Conflict Data Source — git CLI vs. libgit2

**Decision**: Use `git` CLI subprocess calls (same pattern as the existing git-service.ts) rather than libgit2 Node.js bindings.

**Rationale**: The PRD mentions libgit2, but the entire existing git-integration extension is built on `execFile('git', [...])`. Introducing a new native binding (nodegit, isomorphic-git, or similar) would require a new npm dependency with native compilation, breaking Constitution Principle IV (Dependency Stewardship) and introducing a meaningfully different operational model. The git CLI provides all three-way merge data via `git show :1:<file>` (base), `git show :2:<file>` (ours), `git show :3:<file>` (theirs) and conflict listing via `git diff --name-only --diff-filter=U`. These commands are stable, well-documented, and already trusted in this project.

**Alternatives considered**:

- **nodegit** (libgit2 Node.js bindings): Ruled out — native compilation, large binary, single-maintainer risk.
- **isomorphic-git**: Ruled out — partial conflict support, no three-way merge index access.
- **simple-git**: Ruled out — adds a dependency for functionality already covered by direct `execFile`.

---

## Decision 2: Session State Persistence — In-memory Zustand store + disk serialisation to electron-store

**Decision**: Session state (decisions, undo stack, progress) is held in a Zustand store for fast reactive UI updates. On every decision confirmation the full session state is serialised and persisted via `electron-store` (already in `extensions/git-integration/package.json`) to a keyed entry, allowing resumption after crash or close.

**Rationale**: Zustand is the existing state management library in this extension (git.store.ts, pr-review.store.ts). `electron-store` is already a declared dependency. No new dependencies are required.

**Alternatives considered**:

- **IndexedDB (via renderer process)**: Ruled out — renderer-side persistence doesn't survive process crashes.
- **Custom file write in main process**: Ruled out — electron-store already handles atomic writes and JSON serialisation.

---

## Decision 3: AI Suggestion Integration — Deferred / opt-in shell-out

**Decision**: The AI suggestion panel (Screen 5, Phase 3 in the PRD) is implemented as a defined IPC channel stub (`git:merge-ai-suggest`) that returns `{ error: 'NOT_IMPLEMENTED' }` in this feature's scope. The UI renders the panel with a "coming soon" placeholder when the local model is not configured. The opt-in hosted-API path (Anthropic/OpenAI) is a settings-gated enhancement, not part of this feature.

**Rationale**: The PRD phases AI as Phase 3 (after core resolver and "keep both"). Building the stub now wires the UI contract without adding the 7B model bundling problem to this scope. Constitution Principle VII (YAGNI) prohibits anticipating future requirements.

**Alternatives considered**:

- **Full local inference via llama.cpp**: Out of scope — 4GB install, model bundling infrastructure, separate feature.
- **Anthropic API call from main process**: Deferred to Phase 3 feature work; auth management is a separate concern.

---

## Decision 4: Conflict Heuristic for "Edit manually" pre-population

**Decision**: When the user chooses "Edit manually," the editor is pre-populated with whichever version is longer by line count. If equal, "theirs" wins (the incoming branch change is usually more intentional in a merge scenario).

**Rationale**: The PRD specifies "longer block wins, or AI's preference if AI was triggered." Since AI is deferred, "longer = better heuristic" is the documented default. This is deterministic, testable, and requires no additional logic.

**Alternatives considered**:

- **Always pre-populate with "ours"**: Predictable but ignores the PRD's stated heuristic.
- **Ask the user which to pre-populate with**: Adds friction to a flow designed to reduce it.

---

## Decision 5: Rebase detection and label inversion

**Decision**: On session start, check `git rev-parse -q --verify REBASE_HEAD 2>/dev/null`. If this path exists, rebase is in progress. In rebase mode, git's internal "ours" is the incoming commit (opposite of merge), so labels are inverted: git `:2:` is shown as "Their change" and `:3:` as "Your change."

**Rationale**: The PRD explicitly requires correct labeling in rebase context (Section 6.4, Open Question 1). This detection is a single git command with no new dependency.

**Alternatives considered**:

- **Check for `.git/rebase-merge/` or `.git/rebase-apply/` directories**: Equivalent signal — either approach is reliable. Chose `REBASE_HEAD` as it is a single command that covers both `rebase --merge` and `rebase --apply` paths.

---

## Decision 6: Entry point in the Git sidebar

**Decision**: The existing `GitSidebarPanel.tsx` / `GitFullView.tsx` checks `status.hasConflicts`. When true, a "Resolve conflicts →" button appears that navigates to `MergeFlowView`. The view replaces the full-view content area (same pattern as `PrReviewView`).

**Rationale**: This matches how PR Review is surfaced — a top-level tab/button in the git panel navigates to a dedicated full view. No new entry-point infrastructure needed.

**Alternatives considered**:

- **Separate panel/window**: Rejected — breaks the extension isolation model and requires new window management IPC.
- **Inline in the staging area**: Rejected — staging area is for pre-commit operations; conflict resolution is post-merge.

---

## Decision 7: Keyboard shortcut handling

**Decision**: `useEffect` with `document.addEventListener('keydown', ...)` scoped to the conflict resolver component, cleaned up on unmount. Shortcuts are disabled when a modal or the AI panel is open (tracked in store).

**Rationale**: The existing PR review components use the same pattern for keyboard-driven review navigation. No new library needed.

**Alternatives considered**:

- **react-hotkeys-hook**: Would add a dependency; the existing approach is sufficient.
- **Global shortcut registration via Electron**: Over-engineered for a panel-level feature.
