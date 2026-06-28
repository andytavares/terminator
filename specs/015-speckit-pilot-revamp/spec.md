# Feature Specification: SpecKit Pilot — Autonomous Ticket → PR

**Feature Branch**: `015-speckit-pilot-revamp`

**Created**: 2026-06-27

**Status**: Draft

**Input**: User description: "you must use the renderings from specs/014-ticket-pilot as the basis for your design NOTHING ELSE is acceptable. Focus only on the extension area though and the settings the sidebars in the main app are fine the way they are!"

## Design Authority

**`specs/014-ticket-pilot/renderings.html` is the sole visual reference for this feature.** No design decision for the extension area may deviate from or extend beyond what is shown in those eight scenes. `specs/014-ticket-pilot/prd.md` is the rationale and architecture document.

## Design Boundaries (what this spec covers and what it does not)

**In scope — the SpecKit Pilot extension area only:**

- The main content panel rendered inside the SpecKit project tab (scenes 1–7 in `renderings.html`): Tickets inbox, Dispatch sheet, Run dashboard (phase rail + console), Gate panel (approve/reject/edit/revoke), Implement kanban + batch check-in, Self-Review quality gates, Open PR card.
- The Settings view for the SpecKit Pilot extension (scene 8): Ticket integrations, autonomy/gate defaults, agent runner configuration.
- The SpecKit Pilot sub-navigation items that the extension adds to the project sidebar: **Tickets**, **Features**, **Active runs**, **History** — these are rendered by the extension inside the sidebar slot Terminator already reserves for project tabs.

**Out of scope — do not modify:**

- The main app workspace rail (left icon strip).
- The main app project sidebar structure: workspace card, repo/branch info, tab switcher (Terminal | SpecKit), and sidebar section labels. These are pre-existing Terminator UI and remain unchanged.
- The app titlebar, traffic-light controls, and window chrome.
- The Terminal tab and all non-SpecKit project content.

## Orchestration

Spec Kit is the orchestration layer. Each run drives the existing SDD cycle — `/speckit-specify → clarify → plan → checklist → tasks → analyze → implement` — and extends it with two tail phases: **Self-Review** and **Open PR**. The agent runner drives each spec-kit command headless; the developer reviews the artifact each phase produces at a human gate. The full UI is specified by `specs/014-ticket-pilot/renderings.html`; rationale and architecture are in `specs/014-ticket-pilot/prd.md`.

## Clarifications

### Session 2026-06-27

- Q: What is the orchestration engine? → A: Spec Kit's existing SDD cycle. No parallel pipeline is built; the runner drives spec-kit commands and gates on the artifacts they produce.
- Q: Keep or replace the existing SpecKit Pilot UI? → A: Replace entirely with the new layout in `renderings.html`. The old sidebar/panel views are retired; no dead views remain.
- Q: Is the existing backend a constraint? → A: Reuse existing pieces (gate state model, per-feature state file, artifact detection, audit log) only where they fit the flow; rebuild or add whatever the new flow needs.
- Q: Surface? → A: The SpecKit project tab (unchanged surface).
- Q: Where do the two new phases gate? → A: Self-Review and Open PR are always required gates and can never be auto-approved regardless of the autonomy level.
- Q: Does this revamp touch the main app sidebar or workspace rail? → A: No. Only the extension content area (scenes 1–8 of `renderings.html`) and the extension's sub-navigation items (Tickets / Features / Active runs / History) are changed. The workspace rail, project sidebar structure, tab switcher, and all other main-app chrome are out of scope.
- Q: Agent runner mechanism — how does the extension execute each spec-kit phase? → A: `claude` CLI subprocess per phase. The runner spawns `claude --headless` in the isolated worktree, captures stdout for the streaming console view, and detects the resulting artifact to transition the phase state. No in-process Agent SDK embedding; no remote Claude Code session.
- Q: Concurrent run limit — how many runs may execute simultaneously per workspace? → A: One active run per workspace. If a second ticket is dispatched while a run is active, it enters a queue and begins when the current run reaches a terminal state (approved, failed, or cancelled). The Active runs sub-view shows queued runs as pending.
- Q: How is the Jira ticket inbox scoped to the active repository? → A: Via user-configurable JQL per workspace. The settings view exposes an editable JQL field under the Jira integration row, defaulting to `assignee = currentUser()`. The extension does NOT attempt to auto-derive a Jira project key from the repository name or remote URL.
- Q: What does the History sub-view show? → A: A read-only log of completed runs. Each entry shows the originating ticket key and source badge, the feature dir created, the PR URL (if one was opened), and the final run status (approved / failed / cancelled). Sourced from per-run state files; not a raw dump of `history.jsonl` entries.
- Q: How should the extension handle Linear/Jira API rate limits (HTTP 429)? → A: Exponential back-off with silent retry. The extension retries up to 3 times with increasing delay before surfacing a toast. The developer sees no interruption for transient rate limiting; only exhausted retries produce a visible error.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Dispatch a ticket to a seat PR (Priority: P1)

A developer opens the SpecKit tab, sees their Linear/Jira tickets assigned to them, selects one, and dispatches it. The agent drives the full spec-kit cycle plus Self-Review and Open PR, pausing at human gates throughout, and ends by opening a pull request linked back to the originating ticket.

**Why this priority**: This is the core product. Without the ticket-to-PR path the feature does not exist.

**Independent Test**: In a repo with `.specify/` initialized and Linear/Jira connected, dispatch a small ticket. Verify a `specs/NNN-slug/` dir is created, `spec.md` is generated from the ticket seed, each gated phase pauses for developer approval, and a PR is opened when the developer approves the Open PR phase.

**Acceptance Scenarios**:

1. **Given** a connected tracker and a repo with `.specify/` initialized, **When** the developer opens the SpecKit tab, **Then** the Tickets view lists their assigned tickets scoped to the active repository with source badge (LINEAR / JIRA) and ticket key shown.
2. **Given** a selected ticket, **When** the developer clicks Dispatch and confirms, **Then** a new `specs/NNN-slug/` feature dir is created, a `ticket.md` seed is written from the ticket's title, body, and acceptance criteria, and the runner drives Constitution then Specify.
3. **Given** the Specify phase completes and `spec.md` is produced, **When** the artifact is detected, **Then** the phase enters `awaiting_review` and all downstream phases remain locked.
4. **Given** all phases through Implement are approved, **When** the developer approves Self-Review and then Open PR, **Then** `gh pr create` opens a PR linked to the ticket and to the generating `spec.md`/`plan.md`, and the PR URL is written back to the tracker.

---

### User Story 2 — Human gates and feedback at every phase (Priority: P1)

At every gated phase, the developer reviews the artifact the agent produced and can Approve, Request changes (feeding free text back into a re-run), Comment, Edit the artifact inline, Reject, or Revoke a prior approval.

**Why this priority**: Supervised autonomy is the essential safety property. Without per-phase gates the product is an unsupervised agent that cannot be trusted.

**Independent Test**: Dispatch a ticket; at the Specify gate, submit a Request-changes note; verify the runner re-drives `/speckit-specify` incorporating the note and the phase returns to `awaiting_review`. Then edit `spec.md` inline; verify the phase is marked `modified` and re-enters review. Then approve the phase and revoke approval; verify downstream approved phases become `stale` and the history log records each action.

**Acceptance Scenarios**:

1. **Given** a phase in `awaiting_review`, **When** the developer requests changes with a note, **Then** the runner re-runs that phase's spec-kit command incorporating the note and the phase returns to `awaiting_review`.
2. **Given** a phase in `awaiting_review`, **When** the developer edits the artifact and saves, **Then** the phase is marked `modified` and re-enters review before the next gate can advance.
3. **Given** an approved phase, **When** the developer revokes approval, **Then** the phase returns to `awaiting_review` and all downstream approved phases are marked `stale`.
4. **Given** any gate action (approve / request-changes / comment / edit / reject / revoke), **When** confirmed, **Then** a `history.jsonl` entry records the actor, timestamp, phase, and any note.
5. **Given** any autonomy level (Guided, Standard, or Fast), **When** the run reaches Self-Review or Open PR, **Then** those two phases always require explicit developer approval and cannot be auto-advanced.

---

### User Story 3 — Autonomous self-review against the engineering constitution (Priority: P1)

Before any PR, the agent runs the same quality bar a human contributor must clear — format, lint, coverage ≥80%, and `/google-review` — and presents the concrete results at a gate.

**Why this priority**: A PR that fails the constitution creates review burden and erodes trust in agent output. The self-review gate is what makes agent PRs fit for human review.

**Independent Test**: Run a ticket through Implement approval; verify the Self-Review phase executes format, lint, `vitest --coverage`, and `/google-review`, displays real numbers (coverage percentage, lint error/warning counts, BLOCKER count), and blocks advancement to Open PR until the developer approves.

**Acceptance Scenarios**:

1. **Given** Implement is approved, **When** Self-Review runs, **Then** it executes `npm run format`, `npm run lint`, `vitest --coverage`, and `/google-review` and displays each result with concrete metrics.
2. **Given** a coverage result below 80% or one or more `/google-review` BLOCKERs, **When** Self-Review completes, **Then** the gate surfaces the failures and offers a Send-back-to-Implement action.
3. **Given** Self-Review passes all gates, **When** the developer approves, **Then** the run advances to Open PR.

---

### User Story 4 — Large-ticket check-ins during Implement (Priority: P2)

For a large ticket, the agent executes Implement in task batches grouped by `tasks.md` sections and pauses at each batch boundary with a partial-diff summary before continuing.

**Why this priority**: Large diffs are the primary driver of review fatigue; batch check-ins keep each reviewed slice small and the developer in control. Lower than P1 because the P1 flow serves small and medium tickets without this mechanism.

**Independent Test**: Dispatch a ticket that produces a `tasks.md` with multiple sections; verify Implement runs the first batch to green, then pauses at a check-in showing the partial diff and offering Continue / Redirect / Pause / Split before beginning the next batch.

**Acceptance Scenarios**:

1. **Given** a ticket whose `tasks.md` has multiple top-level sections, **When** Implement begins, **Then** the runner groups tasks into batches by section and processes them sequentially.
2. **Given** a batch completes with all tests passing, **When** the section boundary is reached, **Then** the run pauses and presents a partial-diff summary with Continue / Redirect / Pause / Split actions.
3. **Given** a check-in where the developer chooses Split, **Then** remaining unstarted batches are peeled into a follow-up ticket and the current run completes only its already-started batches.

---

### User Story 5 — Unified new layout replaces the old SpecKit Pilot UI (Priority: P2)

The SpecKit tab presents one coherent flow — ticket inbox → dispatch → 10-phase run dashboard → gates → tasks board → self-review → PR — fully replacing the existing sidebar/panel UI. The layout matches `specs/014-ticket-pilot/renderings.html`.

**Why this priority**: The end-to-end flow must feel like one product rather than phases bolted onto a legacy shell. Separable from the orchestration logic, hence P2; the P1 orchestration path must work even if the layout ships in a follow-up iteration.

**Independent Test**: Open the SpecKit tab; verify the new inbox/run/settings layout from `renderings.html` is rendered and the previous sidebar/panel views are absent.

**Acceptance Scenarios**:

1. **Given** the SpecKit tab, **When** opened, **Then** it shows the Tickets, Features, Active-runs, and History sub-views per `renderings.html` (screen 1), not the old layout.
2. **Given** an active run, **When** viewed, **Then** the 10-phase horizontal phase rail, streaming run console, and gate panel are shown per `renderings.html` (screens 3–4).
3. **Given** the old SpecKit Pilot UI components (sidebar/panel views), **When** the revamp ships, **Then** they are removed from the codebase with no dead views remaining reachable.

### Edge Cases

- Tracker unreachable or API token invalid → inbox shows an error state as a toast per constitution Principle VII; existing local spec-kit features remain usable.
- Linear or Jira returns HTTP 429 (rate limit) → extension retries up to 3 times with exponential back-off; no toast until all retries exhausted. Inbox displays stale data with a subtle timestamp indicating when it was last successfully fetched.
- No `.specify/` in the repo → empty state with an Initialize action; no crash.
- Agent run fails or times out mid-phase → phase enters `failed` state; Retry / Edit-and-retry / Cancel are offered; no partial artifact is left in an `approved` state.
- App closed mid-run → state is restored from the per-feature `state.json` on next launch; run resumes at the last gate; the git worktree checkpoint prevents tree corruption.
- Agent attempts to write to a `disallowedPaths` file → write is blocked and the developer is prompted for explicit confirmation before proceeding.
- Spec-kit command unavailable or version mismatch → run fails immediately with a clear message; no silent fallback or incorrect phase execution.
- Revoke applied to an upstream phase when downstream phases are already approved → all transitively dependent approved phases are marked `stale`; the developer is shown which phases are affected before confirming.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST list the developer's assigned Linear and Jira tickets in the SpecKit tab Tickets view, showing source badge and ticket key. Linear tickets are scoped by team (configured in settings). Jira tickets are fetched using a user-configurable JQL string (per workspace, defaulting to `assignee = currentUser()`), editable in the Jira integration settings row.
- **FR-002**: System MUST dispatch a selected ticket by creating the next-numbered `specs/NNN-slug/` feature dir, writing a `ticket.md` seed (title, body, acceptance criteria, source URL), and driving the Constitution and Specify spec-kit phases.
- **FR-003**: System MUST orchestrate runs through Spec Kit's SDD cycle (`specify → clarify → plan → checklist → tasks → analyze → implement`) and MUST NOT build a parallel orchestration pipeline outside of Spec Kit.
- **FR-004**: System MUST drive each spec-kit phase by spawning a `claude --headless` subprocess in the isolated worktree, capturing its stdout for the streaming run console, and detecting the resulting artifact to transition the phase to `awaiting_review`.
- **FR-005**: System MUST present each gated phase's artifact with Approve, Request changes, Comment, Edit, Reject, and Revoke actions.
- **FR-006**: On Request changes, system MUST re-drive that phase's spec-kit command incorporating the developer's feedback note and return the phase to `awaiting_review`.
- **FR-007**: On Revoke of an approved phase, system MUST mark all transitively downstream approved phases `stale` and record the revoke in `history.jsonl`.
- **FR-008**: System MUST extend the spec-kit lifecycle with two tail phases — Self-Review (phase 9) and Open PR (phase 10) — that are always required gates and can never be auto-approved regardless of autonomy level.
- **FR-009**: Self-Review MUST run `npm run format`, `npm run lint`, `vitest --coverage`, and `/google-review`, and MUST display concrete results including coverage percentage, lint error/warning counts, and BLOCKER count.
- **FR-010**: Open PR MUST create a pull request via `gh pr create`, link it to the originating ticket and to the generating `spec.md`/`plan.md`, and write the PR URL back to the ticket; tracker status transition on PR open MUST be configurable.
- **FR-011**: For tickets with multi-section `tasks.md` files exceeding configurable size thresholds, Implement MUST execute tasks in batches by section and pause at each section boundary for a check-in presenting a partial-diff summary with Continue / Redirect / Pause / Split actions.
- **FR-012**: System MUST support autonomy levels (Guided / Standard / Fast) that control which spec-kit phase gates require human approval, with Self-Review and Open PR permanently required.
- **FR-013**: System MUST run Implement and later phases in an isolated git worktree, create a checkpoint commit before Implement begins, and MUST NOT force-push, modify `main`, or merge automatically.
- **FR-020**: System MUST enforce one active run per workspace at a time. A dispatched ticket when a run is already active MUST enter a run queue; the queue entry MUST be visible in the Active runs sub-view as a pending item and MUST start automatically when the current run reaches a terminal state (approved, failed, or cancelled).
- **FR-014**: System MUST persist per-run state and an append-only `history.jsonl` audit log (actor, timestamp, phase, action, note) per feature dir, and restore in-flight runs on app restart.
- **FR-015**: System MUST store tracker API credentials in the main process only (electron-store, keychain-backed where available) and MUST NOT write them to the repo, the isolated renderer webview, or any PR.
- **FR-016**: System MUST replace the entire existing SpecKit Pilot extension content area with the new layout from `specs/014-ticket-pilot/renderings.html` (scenes 1–8) and remove all retired extension views so no dead UI code remains. The main app workspace rail, project sidebar structure, and app chrome MUST NOT be modified.
- **FR-021**: System MUST implement the History sub-view as a read-only log of completed runs (status: approved, failed, or cancelled). Each entry MUST show the originating ticket key and source badge, the `specs/NNN-slug/` feature dir, the PR URL when one was opened, and the final run status. The view MUST be sourced from per-run state files, not raw `history.jsonl` entries.
- **FR-017**: System MUST hand the opened PR to the existing Code Reviews tab via an "Open in Code Reviews" action and MUST NOT build a second PR-review UI.
- **FR-018**: All tracker API calls, agent runner invocations, and `gh` operations MUST fail gracefully as toasts or error states per constitution Principle VII; no unhandled rejections or silent swallows. HTTP 429 (rate limit) responses from Linear or Jira MUST be retried with exponential back-off (up to 3 attempts); a toast is surfaced only when all retries are exhausted.
- **FR-019**: Linear and Jira SDK dependencies MUST be added to `extensions/speckit-pilot/package.json` only, not to the root `package.json`, per extension isolation rules.

### Key Entities

- **Ticket**: A Linear or Jira issue — source identifier, key, URL, title, body, and acceptance criteria. The input that seeds a run via a `ticket.md` file.
- **Run**: A dispatched ticket bound to a `specs/NNN-slug/` feature dir — autonomy level, worktree path, branch name, per-phase state, queue position (active or pending), optional PR reference, and an append-only `history.jsonl` audit log. Only one run per workspace may be active at a time; others wait in a queue.
- **Phase**: One of the 10 lifecycle phases (Constitution → Specify → Clarify → Plan → Checklist → Tasks → Analyze → Implement → Self-Review → Open PR), each with a gate status from the state model (locked / ready / running / awaiting_review / approved / stale / modified / failed / skipped) and its artifact paths.
- **Gate decision**: An audited developer action (approve / request-changes / comment / edit / reject / revoke) on a phase, recorded in `history.jsonl`.
- **Check-in**: A batch-level pause during Implement at a `tasks.md` section boundary, presenting a partial-diff summary before the next batch begins.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A developer can take a small ticket from dispatch to an opened, ticket-linked pull request without leaving the SpecKit tab.
- **SC-002**: Median time from dispatch to `spec.md` available for review is under 5 minutes for small and medium tickets.
- **SC-003**: At least 60% of agent-opened PRs merge without major rework within a quarter of regular use.
- **SC-004**: At least 70% of dispatched runs reach the Open PR phase without a failed Self-Review gate on the first pass.
- **SC-005**: Every phase transition and gate decision survives an app restart without lost state; the audit log is complete and queryable.
- **SC-006**: The retired SpecKit Pilot UI is fully absent from the codebase; no old view or dead component is reachable by a developer after the revamp ships.
- **SC-007**: All new production files ship with test coverage ≥ 80%, and the project-wide coverage gate continues to pass.

## Assumptions

- Spec Kit is installed and initialized (`.specify/`) in the target repository; its commands (`/speckit-specify`, etc.) are available and functional.
- The repository has a constitution at `.specify/memory/constitution.md`.
- `gh` (GitHub CLI) is authenticated and the workspace maps to a GitHub repository.
- The Claude Agent SDK or `claude` CLI is available on the developer's machine for the agent runner.
- Linear and Jira are reachable with developer-provided API credentials.
- The new UI reuses Terminator's `--tm-*` design tokens (defined in `renderings.html`) and renders inside the existing SpecKit project-tab content slot. The workspace rail, project sidebar shell, and tab switcher are untouched.
- `specs/014-ticket-pilot/renderings.html` is the definitive visual specification. Any element not shown in the eight scenes is out of scope for this revamp.
- The existing gate state machine, per-feature `state.json`, and `history.jsonl` audit log from the current extension are reused where they fit the new flow; they are rebuilt only where the new flow requires different behavior.
- One PR per feature is the default; per-task-batch PRs for very large tickets are out of scope for this revamp and deferred to `/speckit-clarify`.
