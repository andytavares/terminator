# Feature Specification: SpecKit Pilot Extension

**Feature Branch**: `004-speckit-pilot-extension`
**Created**: 2026-05-10
**Status**: Draft
**Input**: User description: "Implement the SpecKit Pilot PRD as a new extension for Terminator to orchestrate speckit/claude workflow with human-in-the-loop gates"

## Clarifications

### Session 2026-05-10

- Q: Should the SpecKit Pilot be built as a Terminator extension (ExtensionAPI), a core built-in feature, or a hybrid? → A: Terminator extension using the existing ExtensionAPI v1.1.0 — same pattern as existing extensions.
- Q: How should the extension invoke a Spec-Kit phase in Terminator? → A: Inject the slash command (e.g., `/speckit-specify`) into the active Claude Code terminal session running in Terminator.
- Q: What is the v1 delivery scope? → A: Full PRD — all 8 phases (Constitution through Implement), artifact editing with diff view, per-file implement gate, history panel, and settings page.
- Q: How should artifact change detection work? → A: Reuse Terminator's existing file watching infrastructure via IPC — the extension registers artifact paths with the main process and receives change events rather than managing its own file watchers.
- Q: How should the extension recover phase state on Terminator startup? → A: Read `state.json` then verify each artifact's current on-disk hash against the recorded approved hash; auto-mark stale any phase whose artifact hash has diverged since last session.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Lifecycle View & Phase Navigation (Priority: P1)

A developer opens the SpecKit Pilot sidebar inside Terminator and sees the full 8-phase Spec-Kit lifecycle (Constitution → Specify → Clarify → Plan → Checklist → Tasks → Analyze → Implement) for the current feature. Each phase shows its current status at a glance — pending, running, awaiting review, approved, stale, modified, failed, or locked. The developer can click any phase to see its detail panel.

**Why this priority**: Without a visible lifecycle state, developers cannot know where a feature stands in the pipeline. This is the foundational read-only view everything else builds on.

**Independent Test**: Open Terminator in a repo with an existing Spec-Kit feature. The sidebar renders all 8 phases with accurate status glyphs and no actions required to see state.

**Acceptance Scenarios**:

1. **Given** a workspace with `.specify/` initialized and a feature in `specs/`, **When** the user opens the SpecKit Pilot sidebar, **Then** all 8 phases are listed with correct status glyphs and the active feature is selected.
2. **Given** a phase has an approved artifact, **When** the user clicks the phase in the sidebar, **Then** the detail panel shows the artifact path, last-approved timestamp, and input hashes.
3. **Given** a workspace with no `.specify/` folder, **When** the user opens the sidebar, **Then** an empty state is shown with an "Initialize Spec-Kit" action and a link to documentation.
4. **Given** upstream phases are not yet approved, **When** the user views a downstream phase, **Then** it is shown as locked with a clear explanation of what must be approved first.

---

### User Story 2 - Human-in-the-Loop Approval Gates (Priority: P1)

After a Spec-Kit phase completes, the developer is presented with the generated artifact and must explicitly approve, request changes, or reject before any downstream phase can run. No phase auto-advances. Every gate decision is recorded in the audit log with a timestamp and an optional note.

**Why this priority**: The core value proposition of this extension is enforcing checkpoints. Without approval gates, it is just a phase launcher. This story is what makes it safe to use in practice.

**Independent Test**: Run `/speckit-specify` from the sidebar. Verify that the Clarify phase cannot start until the user explicitly approves the Specify output, and that the approval is recorded in `history.jsonl`.

**Acceptance Scenarios**:

1. **Given** a phase has just completed, **When** the output appears, **Then** the phase status changes to "awaiting review" and downstream phases remain locked.
2. **Given** a phase is awaiting review, **When** the user clicks "Approve & continue", **Then** the phase status becomes "approved", downstream phases unlock, and a history entry is appended.
3. **Given** a phase is awaiting review, **When** the user clicks "Reject & rerun", **Then** a confirmation dialog appears requiring a rejection reason, the output artifacts are discarded, and the phase re-enters "ready" state.
4. **Given** a phase is approved, **When** the user chooses "Revoke approval", **Then** the phase returns to "awaiting review", all downstream phases are marked stale, and a history entry is appended.
5. **Given** any approval action, **When** it is confirmed, **Then** a `history.jsonl` entry is written with actor identity, timestamp, phase, artifact hash, and note.

---

### User Story 3 - Run Phase with Prompt Input (Priority: P2)

The developer can trigger any unlocked Spec-Kit phase directly from the sidebar by clicking "Run". A prompt dialog lets them review or edit the input prompt, select the AI model, and confirm before execution. During execution, streamed output appears in a run console. The developer can pause or stop a run at any time.

**Why this priority**: Triggering phases from the sidebar is the primary interaction pattern. Without it, the extension is read-only.

**Independent Test**: Click "Run /speckit-plan" in the sidebar. Verify the prompt dialog appears, the slash command is injected into the Claude Code terminal session, the sidebar shows a "running" status panel, and when `plan.md` appears on disk the phase transitions to "awaiting review" automatically. The Stop button halts monitoring without deleting any already-written artifacts.

**Acceptance Scenarios**:

1. **Given** a phase is in "ready" state, **When** the user clicks "Run", **Then** a prompt dialog appears showing the resolved inputs and an editable prompt field.
2. **Given** a run is in progress, **When** the user clicks "Stop", **Then** the run halts, any partially written artifacts are preserved on disk, and the phase returns to "ready" state.
3. **Given** a run completes successfully, **When** output artifacts are written to disk, **Then** the phase automatically transitions to "awaiting review" and the approval panel opens.
4. **Given** a run fails with an error, **When** the error occurs, **Then** the last lines of output are shown along with Retry and Edit prompt options, and no artifacts are left in an inconsistent state.
5. **Given** a dirty git tree, **When** the user attempts to run Implement, **Then** the run is refused with a clear explanation and options to stash or cancel.

---

### User Story 4 - Artifact Editing with Diff View (Priority: P2)

The developer can edit any Spec-Kit artifact (spec.md, plan.md, tasks.md, etc.) inline within the extension. Edits are shown as a diff against the last approved version. Saving an edit marks the phase as "modified — re-approve required" and automatically marks all downstream phases as stale.

**Why this priority**: Editing artifacts without re-running the AI is a key workflow for small corrections. Without this, developers must use external editors and lose pipeline traceability.

**Independent Test**: Edit `plan.md` through the artifact editor. Verify the diff view appears, saving marks the Plan phase as "modified", and the Tasks and Analyze phases change to "stale".

**Acceptance Scenarios**:

1. **Given** an approved artifact, **When** the user opens it for editing, **Then** a diff view shows the current content compared to the last approved version.
2. **Given** the user edits an artifact and saves, **When** the save is confirmed, **Then** the artifact is written to disk, the phase status changes to "modified — re-approve required", and all downstream phases are marked stale.
3. **Given** a modified artifact, **When** the user clicks "Approve in same step", **Then** the edit is saved and the phase transitions directly to "approved" in one action.
4. **Given** unsaved edits, **When** the user clicks "Discard changes", **Then** the artifact reverts to the last saved version with no phase state change.

---

### User Story 5 - Implement Run with Per-File Gate (Priority: P2)

When running the Implement phase, each proposed file write is shown as a diff before it is written to disk. The developer can approve each file, skip it, or stop the run entirely. A pre-run checkpoint commit is created automatically so any run can be fully undone via a single git reset.

**Why this priority**: Implement is the highest-risk phase — it writes source code. Per-file review prevents unwanted writes while still automating the bulk of the work.

**Independent Test**: Start an Implement run. Verify each proposed file write is presented for approval before writing, and that stopping mid-run leaves already-written files intact while blocking remaining writes.

**Acceptance Scenarios**:

1. **Given** an Implement run starts, **When** the agent proposes a file write, **Then** execution pauses and the developer sees the full diff of the proposed file before it is written.
2. **Given** a proposed write is shown, **When** the developer approves it, **Then** the file is written to disk and the run continues to the next task.
3. **Given** a proposed write is shown, **When** the developer skips it, **Then** the file is not written and the run continues, recording the skip in the task log.
4. **Given** a disallowed path glob matches a proposed write, **When** the agent attempts the write, **Then** the write is blocked, the run pauses, and the developer sees which disallowed rule was triggered.
5. **Given** a checkpoint commit was created before the run, **When** the developer wants to undo the entire run, **Then** they can revert all written files in one git operation.

---

### User Story 6 - Stale Propagation & Partial Re-Run (Priority: P3)

When an approved artifact is modified (by a re-run or direct edit), all downstream phases are automatically marked stale. The developer sees a stale propagation modal explaining which phases are affected and can choose which ones to re-run, defer, or skip.

**Why this priority**: Stale detection prevents the pipeline from running on outdated inputs. It is important for correctness but only relevant after several phases have been approved.

**Independent Test**: Approve Specify and Plan, then re-run Specify. Verify that Plan, Tasks, Analyze, and Implement are all marked stale, and the stale modal offers targeted re-run options.

**Acceptance Scenarios**:

1. **Given** Plan is approved, **When** spec.md is modified and re-approved, **Then** Plan, Checklist, Tasks, Analyze, and Implement are all marked stale.
2. **Given** downstream phases are stale, **When** the stale propagation modal is shown, **Then** the developer can individually select which phases to re-run and which to defer.
3. **Given** a stale phase, **When** the developer re-runs it, **Then** it is generated against the latest approved inputs and stale status is cleared upon approval.

---

### User Story 7 - Audit History (Priority: P3)

The developer can view a full chronological history of all phase transitions, approvals, rejections, and revocations for a feature. The history is stored in `.specify/.pilot/history.jsonl` and is viewable inside the extension as a filterable timeline.

**Why this priority**: Audit history is important for team accountability and debugging, but does not block primary workflows.

**Independent Test**: Complete several phase cycles including a rejection and re-run. Verify `history.jsonl` contains accurate entries for every event, viewable in the history panel with correct timestamps, actors, and hashes.

**Acceptance Scenarios**:

1. **Given** any phase event occurs (run start, completion, approval, rejection, revocation), **When** the event completes, **Then** a structured entry is appended to `history.jsonl` with timestamp, actor, action, phase, and artifact hash.
2. **Given** a feature with history entries, **When** the developer opens the history panel, **Then** entries are shown in reverse chronological order with filterable columns for phase, actor, and date range.
3. **Given** the history panel is open, **When** the developer clicks a run entry, **Then** they can compare the artifact output of any two runs side-by-side as a diff.

---

### Edge Cases

- What happens when a Spec-Kit command writes no output files (e.g., Clarify produces no questions)? Phase should still require a gate decision, defaulting to auto-approve with a recorded note.
- What happens when the user edits an artifact file outside the extension (e.g., in the file tree)? The file watcher recomputes the hash and marks the phase "modified — re-approve required" automatically.
- What happens when `history.jsonl` is corrupted or missing? The extension reconstructs phase state from artifact hashes on disk and warns the user that history is incomplete.
- What happens when a Spec-Kit phase exceeds the configured timeout? The run is killed gracefully, output is preserved, and the phase moves to "failed" with the timeout error shown.
- What happens when the extension is opened in a workspace with multiple features? The sidebar shows a feature picker and defaults to the most recently modified feature.
- What happens when the user batch-approves multiple file writes during Implement? Each approved file is written sequentially and recorded individually in the run log.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The extension MUST display all 8 Spec-Kit phases (Constitution, Specify, Clarify, Plan, Checklist, Tasks, Analyze, Implement) in a sidebar with real-time status glyphs.
- **FR-002**: The extension MUST enforce a human approval gate between every phase — no phase may start unless all upstream phases are in "approved" state.
- **FR-003**: The extension MUST allow the user to run any unlocked phase via a prompt dialog that shows resolved inputs, an editable prompt, and a model selector.
- **FR-004**: When a phase is running, the extension MUST show a run status panel indicating the command has been injected into the Claude Code terminal session. Live output is visible in the Terminator terminal tab where Claude Code is running. The sidebar transitions to "awaiting review" automatically when the phase's output artifact is detected on disk. _(Note: real-time output streaming into the sidebar is not implemented — see plan.md AD-2 for rationale.)_
- **FR-005**: The extension MUST transition a phase to "awaiting review" automatically when its command completes, displaying the output artifacts for review.
- **FR-006**: The extension MUST support Approve, Reject & rerun, Request changes, and Revoke approval actions on any phase in "awaiting review" or "approved" state.
- **FR-007**: Every gate decision (approve, reject, revoke) MUST write a structured entry to `.specify/.pilot/history.jsonl` including timestamp, actor identity, phase, artifact hash, and optional note.
- **FR-008**: The extension MUST detect when an artifact file is modified on disk (by any means) by registering artifact paths with Terminator's existing file watching infrastructure via IPC, and automatically mark the corresponding phase as "modified — re-approve required" upon receiving a change event.
- **FR-009**: When a phase's artifact is modified or re-approved, the extension MUST automatically mark all downstream phases as stale.
- **FR-010**: The extension MUST provide an inline artifact editor with a diff view comparing the current working copy against the last approved version.
- **FR-011**: During the Implement phase, the extension MUST present a per-file review gate after each file is written to disk by Claude Code. The gate shows a diff of the written file against git HEAD and offers Approve (keep), Skip (revert via `git checkout --`), or Stop run actions. _(Note: writes are reviewed post-write, not pre-intercepted — see plan.md AD-3 for rationale.)_
- **FR-012**: The extension MUST block Implement runs on a dirty git working tree by default, with an option to stash and retry.
- **FR-013**: The extension MUST create an auto-squashable checkpoint git commit before each Implement run begins.
- **FR-014**: The extension MUST enforce a configurable list of disallowed path globs that no agent write may target during Implement.
- **FR-015**: The extension MUST provide a history panel showing all phase events in filterable chronological order.
- **FR-016**: The extension MUST allow the user to compare any two runs of the same phase as a side-by-side artifact diff.
- **FR-017**: The extension MUST support a settings page with configurable gates (per-phase auto-approve toggles), path disallow list, token limits, run console position, and reviewer identity source.
- **FR-018**: The extension MUST be implemented as a Terminator extension using ExtensionAPI v1.1.0 — registering a sidebar panel, contributing items to the native View menu and project top bar, registering keyboard shortcuts, and communicating with the main process via the established IPC pattern.
- **FR-019**: The extension MUST invoke Spec-Kit phases by injecting the appropriate slash command (e.g., `/speckit-specify`) into the active Claude Code terminal session running in Terminator. The extension MUST surface a clear error if no active Claude Code session is detected when a run is attempted.
- **FR-020**: The extension MUST surface a Clarify Q&A interactive view where each clarifying question is answered inline before the phase can be approved.
- **FR-021**: The extension MUST surface an Analyze findings table categorized by severity (HIGH, MED, LOW), where HIGH findings block approval.
- **FR-022**: The extension MUST support a "new feature" dialog that creates the feature branch and spec directory and optionally runs Specify immediately.
- **FR-023**: The extension MUST handle the case where Spec-Kit is not installed by surfacing a clear setup prompt with installation instructions.
- **FR-024**: Phase state MUST be persisted to `.specify/.pilot/state.json` and restored on Terminator startup by reading the file and verifying each artifact's on-disk hash against the recorded approved hash. Any phase whose artifact hash has diverged since the last session MUST be automatically marked stale.

### Key Entities

- **Feature**: A single trip through the Spec-Kit pipeline, identified by its `specs/<NNN>-<name>/` directory. Has a name, current phase states, and associated history entries.
- **Phase**: One step in the pipeline (Constitution through Implement). Has a status, input artifact hashes, output artifact paths, and a gate configuration.
- **PhaseState**: The current status of a phase — one of: locked, ready, running, awaiting_review, approved, stale, modified, failed.
- **GateDecision**: A recorded human decision on a phase — action (approve/reject/revoke), actor, timestamp, phase, artifact hash, and note.
- **Artifact**: A file produced by a Spec-Kit command (e.g., `spec.md`, `plan.md`, `tasks.md`). Tracked by its file path and content hash.
- **RunRecord**: A record of a single phase execution — run ID, start time, end time, model used, token counts, exit code, and output artifacts.
- **HistoryEntry**: One event in `history.jsonl` — references a GateDecision or RunRecord with full provenance.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A developer can complete the full Specify → Approve → Plan → Approve → Tasks → Approve flow for a new feature without typing a single slash command directly.
- **SC-002**: No downstream phase runs without an explicit user approval click — verified by audit log showing no run_start entry without a preceding approved entry.
- **SC-003**: Artifact modifications (by any means) are detected and phase status updated within 2 seconds of the file being saved.
- **SC-004**: After stopping an Implement run, every file that was not explicitly approved by the user can be reverted via `git checkout --` (individual skip) or `git reset --hard` against the pre-run checkpoint commit (full rollback). No unapproved file survives the run without a revert path available.
- **SC-005**: Less than 30% of phase outputs require manual edits before approval in pilot usage, indicating the AI output quality is acceptable without heavy rework.
- **SC-006**: The median time from phase completion to user approval is under 2 minutes for Clarify and Plan phases, indicating the review experience is low-friction.
- **SC-007**: Over 70% of features started through the extension reach the Implement-approved state, indicating the pipeline is completing end-to-end.
- **SC-008**: Every rejected Implement run can be fully reverted in a single git operation using the pre-run checkpoint commit.
- **SC-009**: The extension loads and renders accurate phase state within 3 seconds of opening a workspace with an existing Spec-Kit feature.

## Assumptions

- The Terminator application supports a VS Code-compatible extension model (activity bar, sidebar webviews, command palette, status bar, file system watchers).
- Spec-Kit commands (`/speckit-specify`, `/speckit-plan`, etc.) are invocable either via chat injection or shell-out to a CLI binary already installed on the developer's machine.
- A single developer is using the extension at a time — concurrent multi-user approval workflows are out of scope for v1.
- The audit log (`history.jsonl`) is checked into git alongside artifacts, providing version-controlled provenance.
- The extension ships as a Terminator extension using ExtensionAPI v1.1.0 — it follows the same architecture as existing Terminator extensions (sidebar UI, IPC to main process, registered via the extension manifest). It is not a standalone VS Code marketplace extension.
- Actor identity for audit entries defaults to `git config user.name` + `git config user.email`, which is assumed to be configured in the developer's environment.
- The extension manages one feature at a time in the sidebar; a portfolio view of multiple features in parallel is out of scope for v1.
- v1 scope is the full PRD: all 8 phases, artifact editing with diff view, per-file implement gate, history panel, and settings page. No phased delivery — the complete feature ships as one extension.
- Auto-approve is allowed for low-risk phases (Clarify, Checklist) via settings, but Implement always requires explicit per-file confirmation.
