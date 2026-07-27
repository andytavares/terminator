# Feature Specification: Agent Supervision Console

**Feature Branch**: `021-agent-supervision-console`

**Created**: 2026-07-26

**Status**: Draft

**Input**: User description: Terminator — Engineering PRD (27 Jul 2026 draft). End-to-end flow from ticket to merged PR, covering UI concepts 01 (Attention Queue), 02 (Ticket Board), 04 (Command Deck), 06 (Ticket × Repos), 07 (Standup Feed), 08 (Review Inbox), 10 (Keyboard HUD). Split: the SpecKit Pilot plugin owns the work item (intake, spec, plan, tasks, and the structured state those produce); Terminator owns every surface and the runtime supervision layer. The app never re-implements spec generation; it reads plugin state and renders it.

## Overview

Terminator becomes a **supervision console** for a small number (2–6) of long-running coding agents. The product bet rests on two claims:

1. **Review is the bottleneck.** A human cannot review agent output as fast as agents produce it, so the console must actively throttle the number of agents in flight against the size of the unreviewed queue.
2. **The uninstrumented failure is the silent stall.** An agent that is stuck but never asks for help produces no notification, because there is nothing to notify on. That state must be _derived_ from observed activity, not reported by the agent.

Everything else in this specification — worktree provisioning, kanban board, feed, palette — is table stakes that exists to make those two capabilities usable.

### Explicit Non-Goals

- **Not an editor.** Handing off a worktree path to an external editor is a first-class action, not a gap to be filled.
- **Not a cloud or multiplayer service.** Local-first, single-operator. No shared team state, no @-mentions, no server-side history.
- **Not agent-agnostic.** Claude Code only for this feature. Support for other agent runtimes is a separate future decision.
- **No terminal-output scraping for state.** Runtime state MUST NOT be derived by parsing rendered terminal output. Terminal output remains a display surface only.
- **No single agent session spanning multiple repositories.** Multi-repository work is decomposed into one session per repository ("lane").
- **Not a replacement for the existing terminal.** Ordinary (non-supervised) terminal sessions are unchanged by this feature.
- **No coupling between core and any extension.** Nothing in this specification may be satisfied by the core application calling into, importing from, reading the files of, or knowing the internals of a specific extension — nor by an extension reaching into core internals. The only permitted coupling is the published Extension API and the console-owned publication directory.

## Clarifications

### Session 2026-07-26

- Q: What is the console ↔ work-item-plugin boundary mechanism? → A: Read-only file inbound, Extension API outbound. The console reads the producer's published contract file and never writes it; lane→session bindings live in console-owned storage keyed by work item ID; gate approvals and phase triggers go through published Extension API commands the producer registers.
- Q: Do the supervision surfaces live in core or in an extension? → A: Core substrate, core surfaces. The event bus, runtime state machine, stall detector, worktree manager, session registry, review queue and all seven surfaces ship in the core application. The Extension API exposes read access to runtime state and to worktree provisioning; no supervision surface lives in, or depends on, any extension.
- Q: How is agent-runtime-specific knowledge contained in core? → A: One internal adapter. Every agent-runtime specific — how a session is started, the permission callback, the location and shape of the durable activity record, lifecycle hooks — sits behind a single internal boundary with exactly one implementation. The state machine, stall detector, review queue, and all surfaces consume a runtime-neutral session-event shape. It is a seam, not a plugin point and not a public API.
- Q: Where does code-host and CI-check knowledge come from? → A: Core owns its own code-host client. Core obtains check status, pull-request state, and merge directly from the code host — the same class of external-CLI dependency it already accepts for git — and never relies on an extension for them. The existing git-integration extension keeps its own review surfaces unchanged.
- Q: Where does the published contract file live? → A: A console-owned publication directory. The console defines the directory and the contract schema and documents both in the Extension API; producers write into it. The console never reads, writes, or watches any path inside a producer's own directory, and holds no knowledge of any producer's internal file layout.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Real runtime state for every supervised session (Priority: P1)

As an operator running several agents at once, I want each supervised session to carry an accurate, continuously updated runtime state — starting, working, needs input, stalled, ready, failed, merged — derived from what the agent actually did, so that I never have to open a session to find out whether it is alive.

Today every session shows the same undifferentiated "running" indicator. This story replaces that with observed truth.

**Why this priority**: Every other surface in this feature is a rendering of this state. Nothing else can be built or trusted until this exists, and it is independently valuable on its own: it upgrades the existing session list from a green dot to a real status.

**Independent Test**: Start a supervised agent session, drive it through a permission request, an idle period, and a completion. Verify the session's displayed state transitions through `working` → `needs_input` → `working` → `ready` without the operator opening the session, and that the state survives restarting the console.

**Acceptance Scenarios**:

1. **Given** a supervised session where the agent has requested permission to run a command, **When** the operator looks at any surface listing sessions, **Then** that session shows `needs_input` within 2 seconds of the request and names what is being requested.
2. **Given** a supervised session that has just recorded a tool call, **When** the operator looks at the session list, **Then** the session shows `working` with the time since its last observed activity.
3. **Given** a supervised session whose agent has finished its turn and produced a non-empty diff, **When** the turn ends, **Then** the session shows `ready` and is added to the review queue.
4. **Given** a supervised session whose setup step exited non-zero, **When** the operator looks at the session list, **Then** the session shows `failed` together with the failing step and its exit status.
5. **Given** the console is closed and reopened while a supervised session is still running, **When** the console starts, **Then** the session's state is reconstructed from the agent's own durable activity record and matches reality.
6. **Given** two independent state sources disagree about a session, **When** state is reconciled, **Then** the agent's durable activity record wins.

---

### User Story 2 - Detect the silent stall (Priority: P1)

As an operator, I want to be told when an agent has stopped making progress _without asking for anything_, so that I stop losing hours to agents looping on the same file or waiting on nothing.

**Why this priority**: This is the differentiating capability. It is separable from Story 1 only in that it consumes Story 1's activity record; it must ship immediately after.

**Independent Test**: Run an agent, then induce a stall (e.g. an unsatisfiable instruction that makes it re-read the same file repeatedly, or a hang with no tool activity). Verify a stall is recorded within the configured window while shadow mode leaves the session's visible state untouched, that turning shadow mode off makes the same condition produce a `stalled` state and a notification, and that a long-running legitimate command (a 12-minute test suite) produces no firing in either mode.

**Acceptance Scenarios**:

1. **Given** a supervised session with no observed tool activity for longer than the configured silence threshold, **When** the detector next evaluates, **Then** a stall firing is recorded naming the silence signal.
2. **Given** a supervised session whose recent tool calls all touch a single file and produce no net change, **When** the no-progress threshold elapses, **Then** a stall firing is recorded naming the looping behaviour.
3. **Given** a supervised session that has reverted its own edits two or more times within its last ten edits, **When** the detector next evaluates, **Then** a stall firing is recorded naming the revert signal.
4. **Given** a supervised session that is blocked inside a single long-running command it started (e.g. a test run), **When** the silence threshold elapses, **Then** no stall firing is recorded.
5. **Given** shadow mode is off and a session has been marked `stalled`, **When** the operator views it, **Then** they are offered at minimum: ask the agent what is wrong, view the activity record, interrupt and redirect, and discard the session and its worktree.
6. **Given** the detector is in shadow mode, **When** a stall condition fires, **Then** the firing is recorded with the signal that triggered it and the input values that satisfied it, and the session's state, the feed, and every notification path are left untouched.
7. **Given** the detector fired on a session, **When** the operator later judges that firing correct or incorrect, **Then** they can record that judgement against the recorded firing so precision can be measured.
8. **Given** recorded firings and the operator's judgements of them, **When** the operator asks for detector precision, **Then** the proportion judged incorrect over a chosen period is reported.
9. **Given** the operator turns shadow mode off, **When** a stall condition next fires, **Then** the session enters `stalled`, a feed entry attributed to the console is posted, and the operator is notified.
10. **Given** a repository defines its own thresholds, **When** the detector evaluates a session in that repository, **Then** the repository's thresholds are used in place of the defaults.

---

### User Story 3 - One screen that answers "does anything need me?" (Priority: P2)

As an operator returning to the machine, I want a single ranked list of everything that needs my attention — permission requests, stalls, failures, finished work — ordered by how much it needs me rather than by which project it belongs to, plus an always-visible summary I can read without switching screens.

**Why this priority**: This is the smallest thing that changes the operator's day. It depends on Stories 1 and 2 but on nothing else, and it makes both of them visible.

**Independent Test**: With a mix of sessions in every runtime state across two or more repositories, open the attention surface. Verify the ranking, verify that acting on the top item (approving a permission request) removes it from the list, and verify that when nothing needs attention the surface says so explicitly rather than simply being empty.

**Acceptance Scenarios**:

1. **Given** sessions in several states across several repositories, **When** the operator opens the attention surface, **Then** items are ordered by attention need — blocking requests first, then stalls, then failures, then finished work awaiting review — and not grouped by repository.
2. **Given** the top item is a permission request, **When** the operator approves or denies it inline, **Then** the decision reaches the agent without opening the session and the item leaves the list.
3. **Given** nothing requires the operator, **When** the attention surface is shown, **Then** it explicitly states that everything is fine rather than presenting a blank screen.
4. **Given** any surface is open, **When** the operator glances at the persistent status summary, **Then** it shows counts of sessions needing input, working, awaiting review, and failed, plus the age of the oldest blocked session.
5. **Given** the operator presses the palette shortcut, **When** they type any fragment of a session, work item, repository, worktree, or command name, **Then** matching entities of every type appear in one ranked result list and can be opened or actioned directly.
6. **Given** the operator opens a session they last looked at some time ago, **When** the session view loads, **Then** it summarises what changed since they last looked at it.

---

### User Story 4 - Review queue with risk grading and backpressure (Priority: P2)

As an operator, I want finished agent work queued worst-first by risk rather than by arrival, reviewed through a flow that starts with intent rather than diff order, and I want the console to refuse to start new agents while my unreviewed queue is over the limit.

**Why this priority**: The backpressure gate is meaningless without a queue to count, and the queue is meaningless without state from Story 1. Together they address the measured failure this product exists to prevent: work merging unreviewed because review capacity was exceeded.

**Independent Test**: Produce four finished sessions with deliberately different risk profiles (one touching authentication, one a large refactor, one ordinary, one lockfile-only). Verify the queue order, walk one item through the review flow, accept some changes and reject others within a single file, and verify that attempting to start a fifth agent is refused with a stated reason.

**Acceptance Scenarios**:

1. **Given** finished sessions with differing risk profiles, **When** the operator opens the review queue, **Then** items are ordered highest-risk-first, each showing its grade and the specific trigger that produced it.
2. **Given** a session's changes touch a path on the repository's designated critical-path list, or touch authentication, payments, secrets, data migrations, or a public interface, **When** the grade is computed, **Then** the item is graded highest risk and routed to the full review flow.
3. **Given** a session's changes are confined to formatting, lockfiles, or dependency version bumps and all automated checks passed, **When** the grade is computed, **Then** the item receives the lowest risk grade.
4. **Given** an item in the full review flow, **When** the operator reviews it, **Then** they are taken through intent first — the original request set against the agent's own account of what it did, with any work outside the request called out — before risk, structure, and tests.
5. **Given** a reviewed change containing multiple independent edits within one file, **When** the operator accepts some and rejects others, **Then** only the accepted edits are retained.
6. **Given** the number of finished-but-unreviewed sessions is at or above the configured limit, **When** the operator tries to start another agent, **Then** the start is refused, the reason and the current count are stated, and the refusal can be overridden in one action.
7. **Given** the operator overrides a backpressure refusal, **When** the agent starts, **Then** the override is recorded with its timestamp and the queue depth at the time.
8. **Given** a repository with unattended merging of the lowest grade left at its default, **When** a lowest-grade item is queued, **Then** it waits for an operator decision like any other item.
9. **Given** a repository where unattended merging of the lowest grade has been enabled, **When** a lowest-grade item is queued and all automated checks have reported success, **Then** it is merged without operator action and the merge is recorded with its change summary, grade trigger, and check state.
10. **Given** a repository where unattended merging is enabled, **When** a lowest-grade item's automated checks have not reported, have failed, or are unavailable, **Then** it is not merged unattended and waits for an operator decision.
11. **Given** changes have been merged unattended, **When** the operator asks what merged while they were away, **Then** those merges are listed with enough detail to review them after the fact.

---

### User Story 5 - Provision an isolated, immediately usable workspace per lane (Priority: P2)

As an operator, I want each agent to get its own working copy that is ready to build and run — dependencies present, ports allocated, environment files in place, project setup already executed — with no manual step, and I want provisioning failures surfaced immediately rather than discovered inside the agent's transcript.

**Why this priority**: Provisioning is the most common practical failure in this product category and it blocks every session from starting cleanly. It is independently testable and independently valuable.

**Independent Test**: On the operator's largest repository, provision a fresh working copy for a work item. Verify the agent can build and run tests immediately with no manual intervention, that its allocated port range does not collide with another concurrent working copy, and that a deliberately failing setup command surfaces as a failed session with the command's output attached.

**Acceptance Scenarios**:

1. **Given** a repository with declared heavy ignored directories, **When** a working copy is provisioned, **Then** those directories are shared from the primary checkout rather than re-created, and the working copy is usable without a full dependency install.
2. **Given** a repository declares files to copy (local environment files, certificates), **When** a working copy is provisioned, **Then** those files are present in the new working copy.
3. **Given** two working copies are active at once, **When** each runs the project's dev server, **Then** their allocated port ranges do not overlap and each session's environment identifies its own port base, working copy path, and work item.
4. **Given** the repository declares a setup command, **When** provisioning runs it and it exits non-zero, **Then** the session is marked `failed`, the command output is retained and shown, and no agent is started.
5. **Given** a session is finished with and its work merged or discarded, **When** the operator archives it, **Then** the declared teardown command runs and the working copy is removed.
6. **Given** a session is still running, **When** the operator attempts to archive it, **Then** the archive is refused until the session is stopped.

---

### User Story 6 - Work items from ticket to merged, gated by human approval (Priority: P3)

As an operator, I want to bring in work from a ticket tracker, a code-host issue, or a local document; watch it move through specification, planning, and task breakdown with my explicit approval at the specification and plan gates; and see at a glance which gates each item has passed.

**Why this priority**: This is the intake and orchestration layer. It has real value but depends on the supervision substrate being trustworthy first, and it is the part most constrained by the producer contract.

**Independent Test**: Paste a ticket URL, confirm a work item is created in an unstarted state, advance it through specification, withhold approval and send it back with notes, then approve and verify it advances. Verify implementation cannot begin until both the specification and plan gates are approved.

**Acceptance Scenarios**:

1. **Given** the operator supplies a ticket URL, a code-host issue reference, or a local specification document, **When** intake runs, **Then** one work item is created with a common shape regardless of source, retaining a link back to the source.
2. **Given** a newly created work item, **When** intake completes, **Then** no agent is started; the item waits until the operator or an explicit rule promotes it.
3. **Given** a work item on the board, **When** the operator looks at its card, **Then** the card shows which of its artefacts (specification, plan, tasks) exist and which approval gates have passed.
4. **Given** a work item whose specification has been produced, **When** the operator rejects it with notes, **Then** the item returns to the specification stage carrying those notes and the plan gate remains unapproved.
5. **Given** a work item whose specification or plan gate is unapproved, **When** an attempt is made to begin implementation, **Then** the attempt is refused and the missing gate is named.
6. **Given** no producer of work items is installed, or none has published anything for a session, **When** the console renders, **Then** the session is still shown and supervised as ad-hoc work without a specification, and no surface fails.
7. **Given** a producer writes an updated contract file into the console's publication directory, **When** the change lands, **Then** the console reflects the new state without the operator refreshing or restarting.
8. **Given** two producers publish contract files carrying the same work item identifier, **When** the console reads them, **Then** it reports the conflict rather than silently choosing one.
9. **Given** the console binds a session to a lane, **When** the binding is stored, **Then** it is written only to console-owned storage and the producer's contract file and state directory are byte-for-byte unchanged.
10. **Given** the operator approves a gate, **When** the console acts on it, **Then** it invokes a command the producer registered through the published Extension API, and does not write to producer-owned state.
11. **Given** a producer has not registered the command an action requires, **When** the operator attempts that action, **Then** the console states the action is unavailable and the item remains readable.

---

### User Story 7 - Coordinate one work item across several repositories (Priority: P3)

As an operator, I want a work item that spans several repositories to be broken into ordered lanes with one agent per repository, to be warned when two lanes will touch the same shared file, and to be prevented from merging lanes out of order when a shared contract is involved.

**Why this priority**: Multi-repository coordination is a genuine differentiator but affects only multi-repository work, and single-repository work must remain unaffected.

**Independent Test**: Take a work item spanning three repositories with one shared contract file. Verify the lanes render in order with the shared file flagged in every lane that touches it, and that attempting to merge a downstream lane before its upstream lane is refused.

**Acceptance Scenarios**:

1. **Given** a work item whose plan covers several repositories, **When** the lane view is shown, **Then** each repository appears as its own lane with its merge position, its role, and its assigned tasks.
2. **Given** a file appears in more than one lane's declared shared files, **When** the lane view is shown, **Then** that file is flagged as a predicted collision on every lane that touches it.
3. **Given** a downstream lane's work is finished, **When** the operator attempts to merge it before its upstream lane has merged and a shared file is involved, **Then** the merge is refused and the blocking lane is named.
4. **Given** a work item resolves to a single lane, **When** the lane view is shown, **Then** it renders as one row and adds no ceremony to single-repository work.

---

### User Story 8 - Catch up on what happened while away (Priority: P3)

As an operator returning after time away, I want a chronological written account of what each agent did, with milestone summaries I can read instead of transcripts, the ability to reply to an agent inline, and clear attribution when an entry was written by the console rather than by an agent.

**Why this priority**: A refinement over data that already exists once earlier stories ship. Valuable for the "away for hours" case, but the ranked attention surface covers the urgent case.

**Independent Test**: Leave several agents running for a period, return, and read the feed top to bottom. Verify each session's activity is represented as readable prose, that a stall entry is visibly attributed to the console rather than the agent, and that a reply typed into the feed reaches the intended agent.

**Acceptance Scenarios**:

1. **Given** agents have been working, **When** the operator opens the feed, **Then** entries appear in chronological order with a written summary per milestone rather than raw transcript output.
2. **Given** an entry was generated by the console rather than authored by an agent (for example a stall), **When** it appears in the feed, **Then** it is attributed to the console.
3. **Given** an entry from a specific session, **When** the operator replies inline, **Then** the reply is delivered to that session.
4. **Given** an operator has muted a session or a class of event, **When** matching events occur, **Then** they are recorded in the feed but produce no notification.
5. **Given** an event occurs, **When** the notification policy is applied, **Then** only a blocking permission request may interrupt the operator modally; every other event uses a non-blocking indicator, and routine progress is deferred to the periodic digest.

---

### Edge Cases

- **Long-running commands.** A session executing a single long command must not be read as stalled. The detector must know a command is in flight and exclude that interval.
- **Compaction and context limits.** When an agent compacts its own context or approaches its context limit, activity records may gap or restart. State must not be lost, and a compaction gap must not be read as a stall.
- **Agent runtime upgrades.** The supervised agent runtime is updated frequently and independently of this application. State reporting must survive an upgrade; a change in the agent's terminal output format must have no effect on reported state.
- **Console restart with agents running.** Sessions started before a restart must be re-adopted with correct state, or explicitly marked as unknown — never silently reported as working.
- **Concurrent worktrees on one repository.** Port ranges, shared directories, and setup commands must not collide across simultaneously provisioned working copies of the same repository.
- **Shared directory sharing breaks the build.** Sharing an ignored directory from the primary checkout can be wrong when the primary checkout is mid-install or on a different dependency set. The failure must surface as a failed setup, not as a mysteriously broken agent.
- **Provisioning succeeds but the repository has no setup command.** Provisioning must complete without one, and the session must start.
- **Work item file is malformed or partially written.** A half-written or invalid work item file must not crash any surface; the affected item degrades to unknown state and the problem is reported.
- **Session finishes with an empty diff.** A session that ends having changed nothing must not enter the review queue as work to review; it must be distinguishable from work that produced changes.
- **Code host unreachable or unauthenticated.** Check state must resolve to unavailable rather than to passing, so a queue item degrades to a manual review decision instead of becoming eligible for unattended merge.
- **Automated checks are still running when a session finishes.** The item's grade and review readiness must account for checks that have not yet reported, rather than assuming success.
- **Backpressure limit is already exceeded when the console starts.** The gate must apply on the next start attempt, not retroactively kill running agents.
- **Rejecting every change in a review.** Rejecting all changes must leave the branch in a coherent state and mark the session as discarded rather than merged.
- **Merged upstream lane whose shared contract changed after downstream lanes started.** Downstream lanes must be flagged as needing to rebase or re-run before merge.
- **Two sessions bound to the same lane.** The binding must be single-valued; a second binding attempt must be refused or must explicitly replace the first.

## Requirements _(mandatory)_

### Functional Requirements

#### Session supervision and runtime state

- **FR-001**: The system MUST maintain, for every supervised session, exactly one runtime state drawn from: `starting`, `working`, `needs_input`, `stalled`, `ready`, `failed`, `merged`, together with the time that state was entered.
- **FR-002**: The system MUST confine all agent-runtime-specific knowledge — how a session is started, how permission decisions are exchanged, the location and shape of the durable activity record, and lifecycle hook handling — to a single internal boundary, and MUST expose only a runtime-neutral session-event shape beyond it.
- **FR-003**: The runtime state machine, the stall detector, the review queue, and every surface MUST consume only that runtime-neutral shape, and MUST NOT reference any agent-runtime-specific structure.
- **FR-004**: The agent-runtime boundary MUST have exactly one implementation and MUST NOT be exposed through the Extension API or made pluggable.
- **FR-005**: The system MUST derive runtime state from observed agent activity — permission requests, tool activity, turn completion, process exit status — and MUST NOT derive it by parsing rendered terminal output.
- **FR-006**: The system MUST continue to track a session's state from the agent's durable activity record even when the process that started the session is no longer available, and MUST reconcile in favour of that record when sources disagree.
- **FR-007**: The system MUST reflect a session entering `needs_input` on every listing surface within 2 seconds of the agent requesting permission, and MUST state what is being requested.
- **FR-008**: The system MUST record, per session, at minimum: the time of last observed tool activity, the time of last net change to the working copy, elapsed turns, accumulated cost, remaining context proportion, any outstanding permission request, and a summary of changed files with lines added and removed.
- **FR-009**: The system MUST re-adopt still-running supervised sessions on restart and restore their state, or mark them explicitly as unknown; it MUST NOT report a session as `working` without evidence.
- **FR-010**: The system MUST NOT depend, for detection of a blocked session, on any agent notification mechanism that does not fire for permission requests.

#### Stall detection

- **FR-011**: The system MUST evaluate every active supervised session for stall conditions on a fixed recurring interval no longer than 30 seconds.
- **FR-012**: The system MUST fire a stall when the time since a session's last observed tool activity exceeds the configured silence threshold (default 8 minutes).
- **FR-013**: The system MUST fire a stall when the time since a session's last net working-copy change exceeds the configured no-progress threshold (default 15 minutes) **and** its recent tool activity is confined to a single file with no net change.
- **FR-014**: The system MUST fire a stall when a session has reverted its own edits two or more times within its last ten edits.
- **FR-015**: The system MUST exclude intervals during which the session is blocked on a single long-running command it started from the silence calculation.
- **FR-016**: The system MUST allow stall thresholds to be configured per repository, falling back to defaults when unset.
- **FR-017**: The system MUST record every stall firing with the signal that triggered it, the input values that satisfied it, the session, and the time — in every mode.
- **FR-018**: The system MUST provide a global shadow mode, **on by default**, in which stall firings are recorded but produce no change to session state, no feed entry, and no notification of any kind.
- **FR-019**: The system MUST allow the operator to turn shadow mode off, after which a firing MUST set the session to `stalled`, post a feed entry attributed to the console, and notify.
- **FR-020**: The system MUST let the operator mark a recorded stall firing as correct or incorrect, and MUST report the proportion judged incorrect over an operator-chosen period.
- **FR-021**: When a stall is surfaced (shadow mode off), the system MUST offer at minimum: ask the agent what is wrong, view the activity record, interrupt and redirect, and discard the session and its working copy.

#### Attention, status, and navigation

- **FR-022**: The system MUST provide a single ranked view of every session requiring operator attention, ordered by attention need and not grouped by repository or project.
- **FR-023**: The system MUST allow a pending permission request to be approved or denied from that ranked view without opening the session.
- **FR-024**: The system MUST explicitly state that nothing requires attention when the ranked view is empty, rather than presenting a blank surface.
- **FR-025**: The system MUST display a persistent status summary on every surface showing counts of sessions needing input, working, awaiting review, and failed, plus the age of the oldest blocked session.
- **FR-026**: The system MUST provide a keyboard-invoked search over sessions, work items, repositories, working copies, and commands in one ranked result list, from which the operator can open or act on any result.
- **FR-027**: The system MUST show, when a session is opened, a summary of what changed in it since the operator last viewed it.
- **FR-028**: The system MUST restrict modal interruption to blocking permission requests; all other events MUST use non-blocking indication, and routine progress events MUST be deferred to a periodic digest.
- **FR-029**: The system MUST allow the operator to mute notifications for a session or class of event without suppressing the corresponding feed entries.

#### Working copy provisioning

- **FR-030**: The system MUST provision an isolated working copy per lane on its own branch, without disturbing the operator's primary checkout.
- **FR-031**: The system MUST share repository-declared heavy ignored directories from the primary checkout rather than duplicating them.
- **FR-032**: The system MUST copy repository-declared files (such as local environment files and certificates) into each new working copy.
- **FR-033**: The system MUST allocate a non-overlapping port range per active working copy and expose the allocated base, the working copy path, and the work item identifier to the session's environment.
- **FR-034**: The system MUST run the repository-declared setup command during provisioning, and on non-zero exit MUST mark the session `failed`, retain and display the command output, and not start an agent.
- **FR-035**: The system MUST run the repository-declared teardown command and remove the working copy when a session is archived.
- **FR-036**: The system MUST refuse to archive a session that is still running.
- **FR-037**: The system MUST read provisioning configuration — shared directories, copied files, port base and span, setup, teardown, and verification commands — from a per-repository configuration file.
- **FR-038**: The system MUST NOT attempt to provision or branch databases; it MUST expose the setup and teardown commands as the supported extension point for that concern.

#### Running an agent

- **FR-039**: The system MUST start a supervised agent with its lane's assigned tasks and the paths to the work item's specification and plan when those exist.
- **FR-040**: The system MUST surface every agent permission request as console state that can be acted on from any listing surface, rather than only as a prompt inside a terminal.
- **FR-041**: The system MUST require an autonomy level to be chosen when an agent is assigned, from an ordered ladder in which each level auto-approves a strictly larger set of actions: read-only inspection; plus edits confined to the working copy; plus dependency installation and local build and test commands; plus pushing branches and opening pull requests. Destructive operations always prompt.
- **FR-042**: The system MUST prompt for approval, regardless of autonomy level, for any action targeting a network host not on the repository's declared allowlist.
- **FR-043**: The system MUST allow the operator to interrupt a running session and redirect it with new instructions.
- **FR-044**: The system MUST provide a one-action handoff that opens a session's working copy in the operator's configured external editor.

#### Review and backpressure

- **FR-045**: The system MUST add a session to the review queue when it finishes with a non-empty diff, and MUST NOT add sessions that finished with no changes.
- **FR-046**: The system MUST assign each queued item a risk grade and MUST order the queue highest-risk-first rather than by arrival time.
- **FR-047**: The system MUST assign the highest grade when a change touches authentication, payments, secrets, data migrations, a public interface, or any path on the repository's declared critical-path list.
- **FR-048**: The system MUST assign the second grade when a change alters a data schema, alters a declared shared contract file, or exceeds 300 changed lines.
- **FR-049**: The system MUST assign the lowest grade only when a change is confined to formatting, lockfiles, or dependency version bumps and all automated checks have reported success.
- **FR-050**: The system MUST show, for every graded item, the specific trigger that produced its grade.
- **FR-051**: The system MUST present the full review as an ordered flow beginning with intent — the original request set against the agent's own account of what it did, with work outside the request explicitly called out — followed by risk, structure, and tests.
- **FR-052**: The system MUST allow individual changes within a file to be accepted or rejected independently, retaining only accepted changes.
- **FR-053**: The system MUST refuse to start a new agent when the count of finished-but-unreviewed sessions is at or above the configured limit (default 3), stating the reason and the current count.
- **FR-054**: The system MUST allow that refusal to be overridden in one action, and MUST record each override with its timestamp and the queue depth at the time.
- **FR-055**: The system MUST treat a repository's critical-path file list as operator-supplied configuration and MUST NOT infer it.
- **FR-056**: The core application MUST obtain automated check status, pull-request state, and merge from its own code-host client, and MUST NOT obtain them from any extension.
- **FR-057**: The system MUST report check state as unavailable — never as passing — when the code host is unreachable, unauthenticated, or does not report checks for a change.
- **FR-058**: The system MUST NOT merge any change without an explicit operator decision, except where unattended merging of the lowest risk grade has been enabled for that repository.
- **FR-059**: The system MUST expose unattended merging of the lowest risk grade as a per-repository setting that defaults to off, and MUST NOT provide a way to enable it for all repositories at once.
- **FR-060**: The system MUST record every unattended merge with the session, the change summary, the grade trigger, the state of automated checks at the time, and the time of merge.
- **FR-061**: The system MUST provide a view of changes merged unattended, so the operator can review after the fact what merged while they were not looking.
- **FR-062**: The system MUST NOT merge unattended when any automated check has not yet reported, has failed, or is unavailable.

#### Core and extension boundary

- **FR-063**: The supervision substrate — event ingestion, the runtime state machine, the stall detector, the session registry, the worktree manager, and the review queue — MUST be part of the core application.
- **FR-064**: Every surface in this specification MUST be part of the core application and MUST remain fully functional with no extensions installed.
- **FR-065**: The core application MUST NOT import from, read files belonging to, call into, or hold knowledge of any specific extension in order to satisfy any requirement in this specification.
- **FR-066**: The core application MUST expose read access to session runtime state, and access to working-copy provisioning, through the published Extension API, so extensions can consume supervision data without core depending on them.
- **FR-067**: Where a capability in this specification would otherwise require data an extension holds, the core application MUST obtain that data itself, and any extension-supplied enrichment MUST be optional and degrade to a stated "unavailable" rather than disabling the capability.

#### Work items and gates

- **FR-068**: The system MUST create one work item of a common shape from any of: a ticket-tracker URL, a code-host issue reference, or a local specification document, retaining a link to the source.
- **FR-069**: The system MUST NOT start any agent as a consequence of intake; a new work item MUST wait for explicit promotion.
- **FR-070**: The system MUST define and own a publication directory and the schema of the contract files written into it, one file per work item, and MUST document both as part of the published Extension API.
- **FR-071**: The system MUST read work item state — phase, artefact paths, gate status, shared contract, and lanes — only from contract files in its own publication directory, and MUST reflect changes to them without operator refresh.
- **FR-072**: The system MUST NOT read, write, or watch any path inside a producer's own directory or private state, and MUST NOT hold knowledge of any producer's internal file layout.
- **FR-073**: The system MUST treat contract files as read-only input. It MUST NOT write, amend, or delete a contract file, and it MUST NOT write into producer-owned state anywhere.
- **FR-074**: The system MUST accept contract files from more than one producer in the publication directory at once without collision, and MUST report a conflict rather than silently choosing when two producers publish the same work item identifier.
- **FR-075**: The system MUST store its own lane→session bindings in console-owned storage, keyed by work item identifier and lane position, so that binding a session requires no write to producer-owned state.
- **FR-076**: The system MUST NOT generate or modify specification, plan, or task artefacts itself.
- **FR-077**: The system MUST perform every action directed at a producer — approving or rejecting a gate, triggering the next phase, sending back notes — by invoking a command the producer has registered through the published Extension API, and MUST NOT invoke a producer's internals by any other means.
- **FR-078**: The system MUST render a work item as read-only when no producer has registered the commands an action requires, stating which action is unavailable rather than failing.
- **FR-079**: The system MUST provide working-copy provisioning, session concurrency, and the backpressure gate as core capabilities exposed through the published Extension API, and MUST NOT depend on any extension's internal implementation of them.
- **FR-080**: The system MUST derive the work item board entirely from the published contract, behaving identically regardless of which producer wrote it, and MUST NOT special-case any particular producer.
- **FR-081**: The system MUST function when no producer is installed or none has published anything, supervising such sessions as ad-hoc work with no specification.
- **FR-082**: The system MUST display, per work item, which artefacts exist and which approval gates have passed.
- **FR-083**: The system MUST require the specification gate and the plan gate to be approved by the operator before implementation may begin, and MUST name the missing gate when refusing.
- **FR-084**: The system MUST allow the operator to reject a specification or plan with notes, returning the item to the corresponding phase carrying those notes.
- **FR-085**: The system MUST tolerate a malformed or partially written work item file without failing any surface, reporting the item as unreadable.

#### Multi-repository lanes

- **FR-086**: The system MUST render a work item's lanes in merge order, each showing its repository, role, assigned tasks, bound session, and blocking relationships.
- **FR-087**: The system MUST flag any file declared as shared by more than one lane as a predicted collision on every lane that touches it.
- **FR-088**: The system MUST refuse to merge a lane before the lanes that block it have merged when a shared file is involved, naming the blocking lane.
- **FR-089**: The system MUST render a single-lane work item as one row without additional multi-repository ceremony.
- **FR-090**: The system MUST flag downstream lanes as requiring re-basing or re-running when an upstream lane merges changes to a shared file after those lanes started.

#### Activity feed

- **FR-091**: The system MUST maintain a chronological feed of session milestones with written summaries rather than raw transcript output.
- **FR-092**: The system MUST attribute feed entries generated by the console — such as stall notices — to the console rather than to the agent.
- **FR-093**: The system MUST allow the operator to reply to a feed entry and deliver that reply to the originating session.

### Key Entities

- **Work Item**: One unit of requested work, originating from a ticket, an issue, or a local document. Carries a source link, a phase, the paths of its specification, plan, and task artefacts, the status of its approval gates, an optional shared contract description with shared file paths, and one or more lanes. Published by its producer as one contract file in the console's publication directory; strictly read-only to the console.
- **Publication Directory**: The console-owned location, with a console-defined schema, into which any producer writes work item contract files. The sole inbound boundary between producers and the console.
- **Lane Binding**: The console's own record of which session is running which lane, keyed by work item identifier and lane position. Console-owned storage; never written into producer state.
- **Lane**: One repository's share of a work item, as declared by the producer. Carries a merge position, a role (producing or consuming the shared contract), a branch, a set of assigned tasks, and the lanes it blocks and is blocked by. Its bound session is held separately, in the console's own Lane Binding record.
- **Session**: One supervised agent run against one lane in one working copy. Carries a stable identity, its runtime state and when that state began, the times of its last observed activity and last net change, turn count, accumulated cost, remaining context proportion, any outstanding permission request, and a change summary.
- **Runtime State**: The derived condition of a session — starting, working, needs input, stalled, ready, failed, or merged.
- **Stall Firing**: A recorded instance of a stall condition being satisfied, capturing the triggering signal, its input values, the session, the time, whether shadow mode was on, and the operator's later judgement of whether it was correct. Recorded in every mode; surfaced only when shadow mode is off.
- **Unattended Merge Record**: A change merged without an operator decision under an enabled per-repository setting, carrying the session, change summary, grade trigger, the state of automated checks at merge time, and the time of merge.
- **Working Copy**: An isolated checkout provisioned for one lane, carrying its path, branch, allocated port range, shared directories, copied files, and the result of its setup command.
- **Repository Configuration**: Per-repository operator-supplied settings governing shared directories, copied files, port allocation, setup/teardown/verification commands, stall thresholds, the critical-path file list, and the network host allowlist.
- **Review Item**: A finished session's changes awaiting operator review, carrying a risk grade, the trigger that produced that grade, the state of automated checks, and per-change accept or reject decisions.
- **Autonomy Level**: The pre-selected ceiling on what a session may do without prompting, chosen when the agent is assigned.
- **Feed Entry**: A chronological record of a session milestone, carrying its author (agent or console), a written summary, a timestamp, and the session it belongs to.
- **Backpressure Override**: A record that the operator started an agent despite the unreviewed-queue limit, carrying the timestamp and the queue depth at the time.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A session blocked awaiting the operator's permission is identifiable within 2 seconds of becoming blocked, from any listing surface, without opening the session.
- **SC-002**: A session that stops making progress without asking for anything is detected within 10 minutes. Precision is measured from recorded firings and the operator's judgements of them; fewer than 10% of firings are judged incorrect over one week of the operator's real work before shadow mode is turned off.
- **SC-003**: After 45 minutes away, the operator can determine the state of every session from one surface in under 30 seconds.
- **SC-004**: Starting an additional agent while the unreviewed-work limit is met requires an explicit, recorded override in 100% of attempts.
- **SC-005**: A freshly provisioned working copy on the operator's largest repository is buildable and runnable with zero manual steps, and provisioning failures are visible on a listing surface without opening the session.
- **SC-006**: A work item spanning three repositories with a shared contract cannot be merged out of order — 100% of out-of-order merge attempts are refused with the blocking lane named.
- **SC-007**: Upgrading the supervised agent runtime across a released version boundary causes no regression in reported runtime state, verified by pinning an older version, upgrading, and re-running the state test suite. Any change required to absorb such an upgrade is confined to the agent-runtime boundary and its own tests, with no edit to the state machine, the stall detector, the review queue, or any surface.
- **SC-008**: Two concurrently provisioned working copies of the same repository never collide on allocated ports.
- **SC-009**: Every unreviewed finished session appears in the review queue ordered by risk, and no change reaches the default branch without one of three recorded justifications: an operator review decision, a recorded backpressure override, or an unattended merge under an explicitly enabled per-repository setting with all checks green.
- **SC-011**: With every extension removed from the installation, the core application still builds, starts, and delivers every capability in this specification except work-item intake and gate actions, which state that no producer is installed. No supervision surface is missing or degraded.
- **SC-012**: Every unattended merge is retrievable after the fact with its change summary, grade trigger, and check state — 100% of them, with no operator action required at merge time to make them retrievable.
- **SC-010**: The console's reported state matches the agent's own durable activity record after a console restart in 100% of cases where that record is intact.

## Assumptions

- **Supervised sessions are a new session type.** The application's existing terminal sessions are unaffected. "Supervised session" means an agent run started and observed by the console; the two coexist.
- **The agent-runtime boundary is a seam, not an abstraction layer.** It exists to satisfy SC-007 — absorbing frequent upgrades of an independently released runtime in one place — not to anticipate a second runtime, which remains an explicit non-goal. It has one implementation, no registry, and no public surface, so it does not constitute speculative abstraction under Constitution VII.
- **The agent is driven programmatically, not by scraping a terminal.** The console starts and observes agents through the agent runtime's programmatic interface, with the agent's on-disk activity record as the always-on secondary source and its lifecycle hooks as a supplementary source. Rendered terminal output is presentation only. This is a hard constraint carried from the source PRD, restated here because it bounds what "runtime state" can mean.
- **The console knows nothing about any specific producer.** Work items reach the console through one published contract: producers write contract files into a publication directory the console owns and whose schema the console defines, and register Extension API commands for the actions the console invokes. The console never names, imports from, special-cases, reads inside, or writes into any extension. Any producer that satisfies the contract works identically: the existing SpecKit Pilot extension, a shell script, or a hand-written file.
- **The publication directory is a boundary, not a database.** It holds the current published state of each work item and nothing else. Producer working state, transcripts, comment logs, and audit history stay entirely inside the producer and are never read by the console.
- **The existing SpecKit Pilot extension becomes one such producer.** It keeps the specification pipeline — running its phases and authoring the specification, plan, and task artefacts — and publishes the contract file plus the commands the console invokes. What it does with its own board, its own worktree handling, and its own concurrency cap is the extension's business, not this specification's: the console provides provisioning, concurrency, and backpressure as core capabilities on the Extension API, and the extension may adopt them or not. Migrating the extension onto them is separate work, not a requirement of this feature.
- **A "repository" corresponds to an existing Workspace.** Repository-scoped configuration attaches to the workspace that maps to that repository's primary checkout.
- **The backpressure limit is counted globally, not per repository.** The bottleneck being modelled is one human's review capacity, so the limit spans every supervised session regardless of repository.
- **Repository configuration lives in a version-controllable file inside each repository**, so that provisioning settings, thresholds, critical paths, and host allowlists travel with the repository.
- **Core owns its code-host access outright.** Check status, pull-request state, and merge come from a code-host client inside the core application, reached the same way core already reaches git: an external command-line tool, not an extension. The `git-integration` extension's existing pull-request and review surfaces are untouched by this feature and are not consumed by it; some code-host calls will therefore be made from both places, which is accepted as the price of the boundary.
- **The critical-path file list starts empty.** Until an operator declares it, highest-grade classification relies solely on the built-in triggers (authentication, payments, secrets, migrations, public interfaces).
- **Milestone summaries for the feed are generated by a small, cheap model call per milestone**, not by the supervised agent itself, so summarisation cost does not scale with transcript length.
- **Delivery is sequenced by the source PRD's build order**, reflected in the story priorities above: supervision substrate first, stall detection second, attention surfaces third, review and backpressure fourth, work items and lanes last.
- **Shadow mode is a real, global, default-on mode — not a per-repository toggle.** The detector runs and records from the first release, but leaves session state, the feed, and every notification path untouched until the operator explicitly turns shadow mode off. Turning it off is an operator decision informed by the recorded precision, not a fixed calendar gate. Consequently, the attention surface (Story 3) ships showing permission requests, failures, and finished work, and begins showing stalls only once shadow mode is off.
- **Artefact paths are reported by the producer, not discovered by the console.** The contract carries the paths of the specification, plan, and task artefacts; the console opens what it is told and never infers a layout. This removes the PRD's stated risk of hard-coding an unverified directory convention.
- **Single-operator, local-only.** No shared state, no team visibility, no remote access to supervision state beyond the application's existing remote-control surface.
