# Feature Specification: MergeFlow — Merge Conflict Resolver

**Feature Branch**: `006-mergeflow-conflict-resolver`  
**Created**: 2026-05-25  
**Status**: Draft  
**Input**: User description: "Implement the MergeFlow PRD as part of the git integration extension — intent-first, card-based merge conflict resolution UI with AI suggestions, undo, keyboard shortcuts, and commit flow."

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Conflict Hub: See and navigate all conflicts (Priority: P1)

A developer opens MergeFlow after a failed `git merge`. They land on the **Conflict Hub** — a file-by-file overview showing every conflicted file, the number of conflicts per file, the authors who made each change, and an estimated time to resolve. Files are ordered by complexity (most conflicts first). A progress bar shows 0 of N resolved. The "Commit merge" button is disabled until all conflicts are resolved.

**Why this priority**: This is the entry point for every resolution session. Without it, no other flow is reachable.

**Independent Test**: Launch MergeFlow against a repo with staged merge conflicts. Verify the hub renders all conflicted files, sorts them by conflict count descending, shows correct author info, and keeps the commit button disabled.

**Acceptance Scenarios**:

1. **Given** a git repo with 3 conflicted files, **When** MergeFlow opens, **Then** all 3 files are listed with their conflict count badges, author names for both sides, and a complexity indicator.
2. **Given** a conflict hub showing 0% progress, **When** the user resolves all conflicts in one file, **Then** that file moves to the "Resolved" section and the progress bar updates accordingly.
3. **Given** unresolved conflicts remain, **When** the user tries to commit, **Then** the "Commit merge" button is disabled and not clickable.
4. **Given** a conflict hub, **When** the tool loads, **Then** a callout highlights the recommended first file (highest conflict count).

---

### User Story 2 — Conflict Resolver: Decide on each conflict one at a time (Priority: P1)

A developer clicks a file from the hub and enters the **Conflict Resolver**. They see one conflict at a time: two panels (their change left, incoming change right) with author name, branch badge, timestamp, and commit hash. Context lines are dimmed; changed lines are highlighted. There are no `<<<<<<<` markers. A result preview strip at the bottom updates live when they hover over action buttons. They pick "Keep mine," "Keep theirs," "Keep both," or "Edit manually" — and confirm with "Confirm & next."

**Why this priority**: This is the core resolution interaction. All other features support or extend it.

**Independent Test**: Open a single conflicted file with 2 conflicts. Walk through both decisions (one "Keep mine," one "Keep theirs"). Verify result preview updates on hover, confirmation advances to the next conflict, and the file is marked resolved after the last one.

**Acceptance Scenarios**:

1. **Given** a file with multiple conflicts, **When** the resolver opens, **Then** exactly one conflict block is shown, with "your change" on the left and "their change" on the right, each labeled with author name and branch.
2. **Given** a conflict is displayed, **When** the user hovers over "Keep theirs," **Then** the result preview strip shows the merged code using their version — before any confirmation.
3. **Given** a selection is made, **When** the user clicks "Confirm & next," **Then** the tool advances to the next conflict; the progress dots in the top bar update.
4. **Given** the last conflict in a file is confirmed, **When** the user confirms, **Then** MergeFlow navigates back to the hub (or to the completion screen if it was the last file).
5. **Given** no selection has been made, **When** the user presses Enter, **Then** nothing is confirmed and a prompt encourages the user to choose an option.

---

### User Story 3 — Keyboard-first navigation (Priority: P2)

A developer resolves all conflicts without touching the mouse. They use `M` to keep mine, `T` to keep theirs, `B` to open the "Keep both" modal, `E` to edit manually, `Enter` to confirm and advance, `←/→` to navigate between conflicts, and `Cmd+Z` to undo the last decision.

**Why this priority**: Keyboard fluency is a core design principle and a significant differentiator. Missing it blocks power-user adoption.

**Independent Test**: Resolve a 5-conflict file entirely via keyboard. Verify each shortcut triggers the correct action and that `Cmd+Z` restores the previous state.

**Acceptance Scenarios**:

1. **Given** a conflict resolver is open, **When** the user presses `M`, **Then** "Keep mine" is selected and the result preview updates.
2. **Given** a conflict resolver is open, **When** the user presses `T`, **Then** "Keep theirs" is selected.
3. **Given** a selection is active, **When** the user presses `Enter`, **Then** the decision is confirmed and the next conflict is shown.
4. **Given** a decision was just confirmed, **When** the user presses `Cmd+Z`, **Then** the previous conflict is restored to its unresolved state.
5. **Given** the "Keep both" modal is open, **When** the user presses `Esc`, **Then** the modal closes without saving and the conflict remains unresolved.

---

### User Story 4 — Undo any decision from anywhere in the session (Priority: P2)

A developer realizes they made the wrong call three conflicts ago — possibly in a different file. They click the undo button (always visible in the sub-header) or press `Cmd+Z`. The most recent confirmed decision is reversed: the affected conflict returns to its unresolved state, and progress indicators update. There is no redo.

**Why this priority**: Reversibility is a core design principle. Without it, a single wrong click forces manual git intervention.

**Independent Test**: Resolve 3 conflicts, navigate to a second file, then undo. Verify the last decision across any file is reversed and the correct conflict is shown in its unresolved state.

**Acceptance Scenarios**:

1. **Given** the user has confirmed 2 decisions, **When** they press undo, **Then** the second decision is reversed and the conflict returns to its unresolved state.
2. **Given** the user has navigated to a different file after making decisions, **When** they press undo, **Then** the most recent decision (from the previous file) is reversed.
3. **Given** no decisions have been made, **When** the user attempts to undo, **Then** the undo button is disabled and no action occurs.

---

### User Story 5 — Keep Both: choose order for concurrent changes (Priority: P2)

A developer determines both versions of a conflicting block should be kept. They click "Keep both" (or press `B`). A modal overlays the resolver (without hiding the diff context). Two draggable code blocks represent each change. The developer can toggle "Mine first / Theirs first" or drag to reorder. A live merged preview shows the combined result. If the combination creates a problem (e.g., duplicate method signatures), a warning is shown. They confirm with "Use this order →" or delegate to "Let AI merge these."

**Why this priority**: "Keep both" is a common real-world need (e.g., adding new functions to the same file from both branches) and can't be expressed with "mine" or "theirs" alone.

**Independent Test**: Trigger "Keep both" on a conflict. Verify the modal shows both blocks, toggling order updates the preview, and confirming produces the correctly ordered merged output.

**Acceptance Scenarios**:

1. **Given** "Keep both" modal is open, **When** the user toggles "Theirs first," **Then** the merged preview immediately shows their version above mine.
2. **Given** the combined result would produce a duplicate function signature, **When** the preview updates, **Then** a warning is displayed below the preview.
3. **Given** a valid order is chosen, **When** the user clicks "Use this order →," **Then** the modal closes and the conflict is marked resolved with the combined output.

---

### User Story 6 — AI Suggestion: get an AI-reasoned resolution proposal (Priority: P3)

A developer is unsure how to resolve a conflict. They click "Ask AI to suggest" (or press `Cmd+Shift+A`). A right-side panel opens without replacing the diff view. The panel shows plain-language reasoning explaining why one version is preferred, the suggested code, a confidence score, and a label ("Low risk," "High uncertainty"). The developer accepts, edits before accepting, or dismisses the suggestion. The AI runs locally; no data leaves the machine.

**Why this priority**: AI assistance is a power feature. The core resolver must work fully without it — AI is opt-in enhancement.

**Independent Test**: Trigger AI suggestion on a conflict. Verify the panel opens, displays reasoning + confidence + code, and that accepting applies the suggestion as the resolved output.

**Acceptance Scenarios**:

1. **Given** the AI panel is open, **When** the suggestion loads, **Then** it shows a plain-language reasoning section, a code block, and a confidence score with label.
2. **Given** the user clicks "Accept suggestion," **Then** the conflict is resolved with the AI's proposed code and the panel closes.
3. **Given** the user clicks "Edit suggestion before accepting," **Then** the suggestion code is placed in a manual editor pre-populated with the AI's output.
4. **Given** the user clicks "Dismiss," **Then** the panel closes and the conflict remains unresolved, with no selection made.
5. **Given** no internet connection, **When** AI suggestion is requested, **Then** the suggestion is still generated (locally) and the panel opens normally.

---

### User Story 7 — Manual Edit: directly modify the conflict output (Priority: P2)

A developer needs a resolution that is neither "mine" nor "theirs" in full — it requires combining specific lines. They click "Edit manually" (or press `E`). The two-panel view is replaced by a single code editor pre-populated with the heuristically better version (longer block or AI preference). Conflict markers are already removed. The developer edits freely in a minimal editor (syntax highlighting only) and confirms with "Save & next →."

**Why this priority**: Without manual edit, complex conflicts requiring surgical combination cannot be resolved in MergeFlow.

**Independent Test**: Open a conflict, click "Edit manually," modify the pre-populated code, and confirm. Verify the custom output is used as the resolved content.

**Acceptance Scenarios**:

1. **Given** the user clicks "Edit manually," **Then** the two-panel view collapses to a single editor with the better heuristic version pre-filled and no conflict markers.
2. **Given** the user edits the code and clicks "Save & next →," **Then** the edited content is stored as the resolution and the next conflict is shown.
3. **Given** the editor is open, **When** the user makes no changes and clicks "Save & next →," **Then** the pre-filled content is saved as the resolution.

---

### User Story 8 — Completion and commit (Priority: P1)

After resolving the last conflict in the last file, MergeFlow navigates to the **Completion screen**. It shows a success message, total time taken, conflict count, and a breakdown of which resolution strategy was used per conflict per file. A pre-filled commit message is editable. The developer reviews changes (opens a full diff view) or immediately commits with "Commit merge →."

**Why this priority**: The entire resolution workflow is valueless if it can't produce a committed merge.

**Independent Test**: Resolve all conflicts in a test repo, verify the completion screen loads with correct stats, edit the commit message, and confirm a successful `git commit` with the resolved files staged.

**Acceptance Scenarios**:

1. **Given** all conflicts are resolved, **When** the last one is confirmed, **Then** MergeFlow navigates automatically to the completion screen.
2. **Given** the completion screen, **When** it loads, **Then** it shows total conflicts resolved, time taken, and a per-file breakdown of resolution strategies used.
3. **Given** the completion screen, **When** the user edits the commit message and clicks "Commit merge →," **Then** a `git commit` is performed with the staged resolved files.
4. **Given** the completion screen, **When** the user clicks "Review changes," **Then** a read-only diff viewer opens showing the complete merged output.

---

### Edge Cases

- What happens when MergeFlow is opened against a repo with **no conflicts**? The hub should show an empty state with a message and no commit button.
- What happens when a **binary file** is conflicted? MergeFlow shows a placeholder and an "Open in external tool" link; binary files are excluded from the resolution workflow.
- What happens when a file is **modified externally** while MergeFlow is open? The tool detects the change, warns the user, and reloads the conflict data for that file.
- What happens when **git rebase** is in progress instead of a merge? MergeFlow detects rebase context, re-labels "yours" and "theirs" correctly (inverted from merge semantics), and adapts the continue/abort/skip workflow.
- What happens if **undo is triggered immediately after opening** (no decisions made)? The undo button is disabled; the action is a no-op.
- What happens if the developer closes MergeFlow **mid-session**? Session state (resolved conflicts) is persisted to disk and restored when reopened.

---

## Requirements _(mandatory)_

### Functional Requirements

**Conflict Hub**

- **FR-001**: The system MUST detect all conflicted files in the current git repository and display them in a list ordered by conflict count (descending).
- **FR-002**: Each file entry MUST show: file path, file type indicator, conflict count badge, both authors who modified the file (with branch name), and a complexity indicator (red/yellow/green).
- **FR-003**: The system MUST display aggregate statistics: total files conflicted, total conflict count, and estimated resolution time.
- **FR-004**: The system MUST disable the "Commit merge" button until all conflicts across all files are resolved.
- **FR-005**: Previously resolved files MUST appear in a separate "Resolved" section at the bottom of the hub.
- **FR-006**: A progress bar MUST reflect the ratio of resolved conflicts to total conflicts and update in real time as decisions are confirmed.
- **FR-007**: The hub MUST display a recommendation callout identifying the suggested first file.

**Conflict Resolver**

- **FR-008**: The resolver MUST show exactly one conflict block at a time — never two simultaneously.
- **FR-009**: Each conflict view MUST show: a plain-language description of what each side changed, author name, branch badge, timestamp, and commit hash for both sides.
- **FR-010**: The resolver MUST NOT display raw git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
- **FR-011**: Context lines adjacent to the conflicting block MUST be visually de-emphasized (reduced opacity); changed lines MUST be highlighted (green for yours, blue for theirs).
- **FR-012**: The result preview strip MUST update live when the user hovers over any action button, showing what the file will look like with that choice applied.
- **FR-013**: No decision MUST be committed until the user explicitly confirms with "Confirm & next →" or presses Enter.
- **FR-014**: The resolver MUST provide conflict progress dots in the top bar (one per conflict: green=done, blue=current, gray=pending).
- **FR-015**: The resolver MUST always label sides as "Your change" and "Their change" using the author's real name and branch — never "Current" or "Incoming."
- **FR-016**: "Yours" MUST be determined automatically from git HEAD state at the time `git merge` was invoked, with no user configuration required.

**Action Options**

- **FR-017**: The resolver MUST provide four primary resolution actions: Keep mine, Keep theirs, Keep both, Edit manually.
- **FR-018**: "Keep both" MUST open a modal (not a new screen) with both code blocks as draggable cards, a mine-first/theirs-first toggle, and a live merged preview.
- **FR-019**: The "Keep both" modal MUST display a warning when the combined output contains detectable issues (e.g., duplicate identifiers).
- **FR-020**: "Edit manually" MUST replace the two-panel view with a single editor pre-populated with the heuristically better version, with no conflict markers present.
- **FR-021**: The manual editor MUST provide syntax highlighting and no autocomplete, linting, or IDE features.

**AI Suggestion**

- **FR-022**: The AI suggestion panel MUST open as a right-side panel without hiding the diff view.
- **FR-023**: The panel MUST show: plain-language reasoning, the suggested code block, and a confidence score with a plain-language risk label.
- **FR-024**: The AI MUST run locally with no data leaving the machine; internet connectivity MUST NOT be required for AI suggestions.
- **FR-025**: The user MUST explicitly click "Accept suggestion" to apply it — auto-acceptance MUST NOT occur regardless of confidence score.
- **FR-026**: The system MUST support an opt-in setting to route AI requests to a hosted API endpoint (Anthropic, OpenAI, or self-hosted) in place of the local model.

**Undo**

- **FR-027**: Every confirmed decision MUST be stored in a session-scoped undo stack.
- **FR-028**: Undo MUST always reverse the most recently confirmed decision, regardless of which file or conflict it belongs to.
- **FR-029**: The undo button MUST be persistently visible in the sub-header and disabled only when the stack is empty.
- **FR-030**: There is no redo — undone decisions must be re-made by the user.

**Keyboard Shortcuts**

- **FR-031**: The following keyboard shortcuts MUST be functional: `M` (keep mine), `T` (keep theirs), `B` (keep both), `E` (edit manually), `Enter` (confirm & next), `←/→` (previous/next conflict), `Cmd+Z` (undo), `Esc` (close modal/panel), `Cmd+Shift+A` (open AI suggestion panel).

**Naming and Labeling**

- **FR-032**: The system MUST detect rebase context and invert "yours" / "theirs" labeling to match developer expectations (opposite of git's internal rebase semantics).
- **FR-033**: The terms "Current" and "Incoming" MUST NOT appear anywhere in the UI.

**Binary Files**

- **FR-034**: Conflicted binary files MUST be excluded from the resolution UI and shown as a placeholder with an "Open in external tool" link.

**Completion**

- **FR-035**: After the last conflict is confirmed, the system MUST navigate to the Completion screen automatically.
- **FR-036**: The Completion screen MUST show: total conflicts, time taken, a per-file breakdown of resolution strategies (mine / theirs / AI / manual), and a pre-filled editable commit message.
- **FR-037**: Clicking "Commit merge →" MUST stage all resolved files and execute `git commit` with the provided message.
- **FR-037a**: If the commit fails (pre-commit hook rejection, timeout, nothing staged, or any other git error), the system MUST display an error toast with the failure reason and remain on the Completion screen so the user can retry or edit the commit message. The session MUST NOT be cleared on failure.
- **FR-038**: Clicking "Review changes" MUST open a read-only diff view of the complete merged output.

**Session Persistence**

- **FR-039**: Resolution decisions MUST be persisted to disk so that a session interrupted by a crash or close can be resumed.

### Key Entities

- **ConflictSession**: Represents one full merge resolution session — linked to a git repository, contains all ConflictFiles, tracks start time and resolution strategies used.
- **ConflictFile**: One file with one or more unresolved conflict blocks — includes path, file type, both authors, and resolved/unresolved state.
- **ConflictBlock**: A single conflict hunk — includes the base text, "ours" text, "theirs" text, surrounding context lines, and resolution state (unresolved / mine / theirs / both / manual / ai).
- **ResolutionDecision**: A record of one confirmed choice — references the ConflictBlock, stores the resolved content, strategy used, and timestamp. Stacked for undo.
- **AISuggestion**: The AI model's output for one ConflictBlock — includes the suggested text, confidence score (0–100), risk label, and plain-language reasoning.

---

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Developers can complete a full merge resolution session (from hub to commit) in under 10 minutes for a merge with up to 15 conflicts across 5 files — a reduction from the industry-surveyed average of ~30 minutes.
- **SC-002**: 90% of developers successfully resolve all conflicts and commit in their first unassisted session (no documentation lookup required).
- **SC-003**: Users can undo any decision within 2 interactions from the point they realize a mistake — regardless of how many conflicts they have progressed past.
- **SC-004**: AI suggestions are accepted or used as a starting point in at least 60% of cases where they are requested (indicating suggestion quality is high enough to be useful).
- **SC-005**: Zero sessions end in a corrupted merge state — all committed outputs are valid, conflict-marker-free file content.
- **SC-006**: The conflict hub loads within 2 seconds for repositories with up to 50 conflicted files.
- **SC-007**: The rate of developers deferring conflict resolution (currently 56%) decreases measurably — target: fewer than 20% of users abandon a session without resolving all conflicts.

---

## Clarifications

### Session 2026-05-25

- Q: Which platform is MergeFlow targeting in this feature? → A: Terminator Electron desktop app only. MergeFlow renders as a panel within the existing app. VS Code extension wrapper is out of scope for this feature.
- Q: When "Commit merge →" fails (pre-commit hook, timeout, nothing staged), what should happen? → A: Show an error toast with the failure reason; stay on the Completion screen so the user can retry or edit the commit message.
- Q: Should "Ask AI to suggest" have a keyboard shortcut, and if so which key? → A: Cmd+Shift+A (chord to avoid accidental activation).

---

## Assumptions

- MergeFlow is built as an extension within the existing git integration extension of this app — it does not ship as a standalone desktop app for the scope of this specification.
- MergeFlow renders as a panel inside the **Terminator Electron desktop app**. The VS Code extension wrapper described in the PRD is explicitly out of scope for this feature.
- Git is installed and accessible in the user's environment; MergeFlow reads conflict state from the git index via existing git integration tooling in this app.
- The local AI model (Phase 3 in the PRD) is bundled separately and not required for MVP; the AI suggestion button can be shown as a progressive enhancement that degrades gracefully if no local model is present.
- Dark mode only for the initial implementation, consistent with the existing app's theme.
- The "rebase conflict" flow (sequence-based, with continue/abort/skip) is in scope only for correct labeling of "yours" vs. "theirs" — a full rebase-specific flow is a future enhancement.
- Session persistence uses local disk storage within the app's existing storage mechanism.
- Multi-cursor / sub-hunk selection within a single conflict block is out of scope for this feature.
- The "base" (common ancestor) view is hidden by default; it may be added as a power-user toggle in a future iteration.
- Binary file passthrough delegates to the OS default diff tool; MergeFlow does not attempt to resolve binary conflicts.
