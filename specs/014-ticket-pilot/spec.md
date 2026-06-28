# Feature Specification: SpecKit Pilot — Autonomous Ticket → PR

**Feature Branch**: `014-ticket-pilot`
**Created**: 2026-06-27
**Status**: Draft
**Input**: User description: "Revamp SpecKit Pilot so I can dispatch a Linear/Jira ticket to an autonomous agent that owns the work end to end — design, planning, testing, implementation — using Spec Kit as the orchestration layer, with human gates and feedback through every phase, check-ins for large tickets, a self-review that enforces our constitution, and a seat PR opened for me to review. Replace the existing SpecKit Pilot UI with the new layout."

## Orchestration

Spec Kit is the orchestration layer. Each run drives the existing SDD cycle — `/speckit-specify → clarify → plan → checklist → tasks → analyze → implement` — and extends it with two product phases, **Self-Review** and **Open PR**. The agent runner drives each spec-kit command headless; the human reviews the artifact each phase produces at a gate. The full UI is specified by `renderings.html`; rationale and architecture are in `prd.md`.

## Clarifications

### Session 2026-06-27

- Q: What is the orchestration engine? → A: Spec Kit's SDD cycle. We do not build a parallel pipeline; the runner drives spec-kit commands and gates on the artifacts they produce.
- Q: Keep or replace the existing SpecKit Pilot UI? → A: Replace entirely with the new layout in `renderings.html`. The old sidebar/panel views are retired.
- Q: Is the existing backend a constraint? → A: No. Reuse existing pieces (gate state model, per-feature state file + audit log, artifact detection) only where they fit the flow; rebuild or add whatever the flow needs.
- Q: Surface? → A: The SpecKit project tab.
- Q: Where do the two new phases gate? → A: Self-Review and Open PR are always required gates; they can never be auto-approved into a PR.

### Deferred to `/speckit-clarify` (see prd.md §12)

- Runner mechanism (CLI in worktree vs. embedded Agent SDK).
- One PR per feature vs. per task-batch for large tickets.
- Whether Checklist is required for agent runs.
- Ticket write-back default (auto-transition vs. opt-in).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Dispatch a ticket to a seat PR (Priority: P1)

A developer opens the SpecKit tab, sees their Linear/Jira tickets, picks one, and dispatches it. The agent drives the full spec-kit cycle plus Self-Review and Open PR, pausing at gates, and ends by opening a pull request linked back to the ticket.

**Why this priority**: This is the product. Without the ticket→PR path the feature does not exist.

**Independent Test**: In a repo with `.specify/` initialized and Linear/Jira connected, dispatch a small ticket. Verify a `specs/NNN-slug/` dir is created, `spec.md` is generated from the ticket, each gated phase pauses for approval, and a PR is opened on approval of the Open PR phase.

**Acceptance Scenarios**:

1. **Given** a connected tracker and a repo with `.specify/`, **When** the developer opens the SpecKit tab, **Then** the Tickets view lists their assigned tickets scoped to the repo, with source (Linear/Jira) shown.
2. **Given** a selected ticket, **When** the developer clicks Dispatch and confirms, **Then** a new `specs/NNN-slug/` feature dir is created, a `ticket.md` seed is written, and the runner drives Constitution + Specify.
3. **Given** the Specify phase completes, **When** `spec.md` is produced, **Then** the phase enters awaiting-review and downstream phases stay locked.
4. **Given** all phases through Implement are approved, **When** Self-Review passes and the developer approves Open PR, **Then** `gh pr create` opens a PR linked to the ticket and the generating `spec.md`/`plan.md`, and the URL is written back to the ticket.

---

### User Story 2 - Human gates and feedback every phase (Priority: P1)

At every phase, the developer reviews the artifact the agent produced and can approve, request changes (free-text the runner feeds back into a re-run), comment, edit the artifact directly, reject, or revoke a prior approval.

**Why this priority**: Supervised autonomy is the core safety property. Without per-phase gates this is an unsupervised agent.

**Independent Test**: Dispatch a ticket; at the Specify gate, request changes with a note; verify the runner re-drives `/speckit-specify` with the feedback and returns to review. Then edit `spec.md` inline; verify it re-enters review. Then approve and revoke; verify downstream phases go stale.

**Acceptance Scenarios**:

1. **Given** a phase awaiting review, **When** the developer requests changes with a note, **Then** the runner re-runs that spec-kit command incorporating the note and the phase returns to awaiting-review.
2. **Given** a phase awaiting review, **When** the developer edits the artifact and saves, **Then** the phase is marked modified and re-enters review.
3. **Given** an approved phase, **When** the developer revokes approval, **Then** the phase returns to awaiting-review and all downstream approved phases are marked stale, with history entries appended.
4. **Given** any gate decision, **When** confirmed, **Then** a `history.jsonl` entry records actor, timestamp, phase, and note.
5. **Given** the Self-Review or Open PR phase, **When** any autonomy level is selected, **Then** these two phases always require explicit approval (never auto-approved).

---

### User Story 3 - Autonomous self-review against the constitution (Priority: P1)

Before any PR, the agent runs the same bar a human contributor clears — format, lint, coverage ≥80%, and `/google-review` — and presents the actual results at a gate.

**Why this priority**: A PR that fails the constitution creates review burden and erodes trust. The self-review gate is what makes agent PRs mergeable.

**Independent Test**: Run a ticket through Implement; verify the Self-Review phase runs format/lint/coverage/`/google-review`, shows real numbers (coverage %, lint count, BLOCKER count), and blocks Open PR until the developer approves.

**Acceptance Scenarios**:

1. **Given** Implement is approved, **When** Self-Review runs, **Then** it executes format, lint, `vitest --coverage`, and `/google-review` and displays each result with concrete metrics.
2. **Given** a coverage result below 80% or a `/google-review` BLOCKER, **When** Self-Review completes, **Then** the gate surfaces the failure and offers Send-back-to-Implement.
3. **Given** Self-Review passes, **When** the developer approves, **Then** the run advances to Open PR.

---

### User Story 4 - Check-ins for large tickets (Priority: P2)

For a large ticket, the agent decomposes Implement into task batches by `tasks.md` section and stops at each batch boundary with a partial-diff summary before continuing.

**Why this priority**: Large diffs are the biggest driver of review fatigue; check-ins keep each reviewed slice small. Lower than P1 because the P1 flow works for small/medium tickets without it.

**Independent Test**: Dispatch a large ticket; verify `tasks.md` has multiple sections, Implement runs batch 1 to green, and the run pauses at a check-in offering Continue / Redirect / Pause / Split before batch 2.

**Acceptance Scenarios**:

1. **Given** a ticket exceeding the size thresholds, **When** Tasks completes, **Then** the agent groups tasks into batches by `tasks.md` section.
2. **Given** a batch completes with passing tests, **When** the boundary is reached, **Then** the run pauses at a check-in with a partial-diff summary and Continue / Redirect / Pause / Split actions.
3. **Given** a check-in, **When** the developer chooses Split, **Then** remaining batches are peeled into a follow-up ticket and the current run finishes its completed batches.

---

### User Story 5 - New unified layout replaces the old UI (Priority: P2)

The SpecKit tab presents one coherent flow — ticket inbox → dispatch → 10-phase run dashboard → gates → tasks board → self-review → PR — fully replacing the existing sidebar/panel UI.

**Why this priority**: The flow must feel like one product, not phases bolted onto the old UI. Separable from the orchestration logic, hence P2.

**Independent Test**: Open the SpecKit tab; verify the new inbox/run/settings layout from `renderings.html` is present and the previous sidebar/panel views are gone.

**Acceptance Scenarios**:

1. **Given** the SpecKit tab, **When** opened, **Then** it shows the Tickets/Features/Active-runs views per `renderings.html`, not the old layout.
2. **Given** an active run, **When** viewed, **Then** the 10-phase horizontal rail, run console, and gate panel are shown.
3. **Given** the old UI components, **When** the revamp ships, **Then** they are removed (no dead views) per the code-cleanliness constitution.

### Edge Cases

- Tracker unreachable or token invalid → inbox shows an error state (toast), existing features still usable.
- No `.specify/` in the repo → empty state with an Initialize action.
- Agent run fails or times out mid-phase → phase enters failed; Retry / Edit-and-retry / Cancel offered; no partial artifact left approved.
- App closed mid-run → state restored from `state.json`; resumes at the last gate; worktree checkpoint prevents tree corruption.
- Agent attempts to edit a `disallowedPaths` file → blocked pending explicit confirm.
- Spec-kit command unavailable / version mismatch → run fails fast with a clear message; no silent fallback.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST list the developer's Linear and Jira tickets in the SpecKit tab, scoped to the active repository, with source and key shown.
- **FR-002**: System MUST dispatch a selected ticket by creating the next-numbered `specs/NNN-slug/` feature dir, writing a `ticket.md` seed, and driving the Constitution and Specify spec-kit phases.
- **FR-003**: System MUST orchestrate runs through Spec Kit's SDD cycle (`specify → clarify → plan → checklist → tasks → analyze → implement`) and MUST NOT implement a parallel orchestration pipeline.
- **FR-004**: System MUST drive each spec-kit phase via an autonomous agent runner (headless) and detect the resulting artifact to open the phase's review gate.
- **FR-005**: System MUST present each phase's artifact at a gate with Approve, Request changes, Comment, Edit, Reject, and Revoke actions.
- **FR-006**: On Request changes, system MUST re-drive the phase's spec-kit command incorporating the feedback and return the phase to awaiting-review.
- **FR-007**: On Revoke of an approved phase, system MUST mark all downstream approved phases stale.
- **FR-008**: System MUST add two phases after Implement — Self-Review and Open PR — that are always required gates and can never be auto-approved.
- **FR-009**: Self-Review MUST run format, lint, `vitest --coverage`, and `/google-review`, and MUST display concrete results (coverage %, lint counts, BLOCKER count).
- **FR-010**: Open PR MUST create a PR via `gh`, link it to the ticket and the generating `spec.md`/`plan.md`, and write the PR URL back to the ticket; status transition MUST be configurable.
- **FR-011**: For tickets exceeding configurable size thresholds, Implement MUST execute in task batches by `tasks.md` section and pause at each boundary for a check-in with a partial-diff summary.
- **FR-012**: System MUST support autonomy levels (Guided/Standard/Fast) that set which spec-kit phase gates require human approval, while keeping Self-Review and Open PR always gated.
- **FR-013**: System MUST run Implement and later phases in an isolated git worktree, create a checkpoint before Implement, and never force-push, modify `main`, or merge.
- **FR-014**: System MUST persist per-run state and an append-only audit log (actor, timestamp, action) per feature, and restore in-flight runs on restart.
- **FR-015**: System MUST store tracker credentials in the main process only (never in the repo, the isolated webview, or a PR).
- **FR-016**: System MUST replace the existing SpecKit Pilot UI with the new layout and remove the retired views (no dead code).
- **FR-017**: System MUST hand the opened PR to the existing Code Reviews surface rather than implementing a new review UI.
- **FR-018**: All tracker and agent operations MUST fail gracefully as toasts/error states, never crashing the app (constitution Principle VII).

### Key Entities

- **Ticket**: a Linear/Jira issue — source, key, URL, title, body, acceptance criteria; the input that seeds a run.
- **Run**: a dispatched ticket bound to a `specs/NNN-slug/` feature — autonomy level, worktree/branch, per-phase state, optional PR.
- **Phase**: one of the 10 phases — status in the gate state model (locked/ready/running/awaiting_review/approved/stale/modified/failed/skipped) and its artifact paths.
- **Gate decision**: an audited human action (approve/request-changes/comment/edit/reject/revoke) on a phase.
- **Check-in**: a batch-level pause during Implement at a `tasks.md` section boundary.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A developer can take a small ticket from dispatch to an opened, ticket-linked PR without leaving the SpecKit tab.
- **SC-002**: Median time from dispatch to `spec.md` ready for review is under 5 minutes for small/medium tickets.
- **SC-003**: At least 60% of agent PRs merge without major rework within a quarter of use.
- **SC-004**: At least 70% of runs reach the Open PR phase with no failed Self-Review gate on first pass.
- **SC-005**: Every phase transition and gate decision is recoverable from the audit log; no run loses state across an app restart.
- **SC-006**: The retired SpecKit Pilot UI is fully removed — no old views remain reachable.

## Assumptions

- Spec Kit is installed and initialized (`.specify/`) in the target repo; its commands are available.
- The repo has a constitution at `.specify/memory/constitution.md`.
- `gh` is authenticated; the workspace maps to a GitHub repo.
- The agent runtime is the Claude Agent SDK / `claude` CLI available on the developer's machine.
- Linear/Jira are reachable with developer-provided credentials.
- The new UI reuses Terminator's `--tm-*` design tokens and the SpecKit project-tab surface.
