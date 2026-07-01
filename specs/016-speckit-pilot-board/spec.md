# Feature Specification: SpecKit Pilot Quill-style Workflow Board

**Feature Branch**: `016-speckit-pilot-board`

**Created**: 2026-06-30

**Status**: Draft

**Input**: User description: "Transform the speckit-pilot extension from a linear, single-run, tab-based UI into a Quill-style (heyquill.io) kanban workflow-management board that lets the user control feature implementation end-to-end when offloading to agents."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - See and manage all work on one board (Priority: P1)

As someone offloading feature work to coding agents, the user opens SpecKit Pilot and
immediately sees a single board with columns representing the stages work moves
through — Backlog, Spec, Plan, Implement, In Review, Done. Every piece of work is a
card that sits in the column matching its current stage, so the user can grasp the
state of everything at a glance without drilling into individual runs.

**Why this priority**: The board is the central organizing surface the user asked
for. Without it, none of the other capabilities have a home. It is the smallest
slice that delivers the "control everything at a glance" value.

**Independent Test**: Open the extension with several pieces of work in different
stages and confirm each appears as a card in the correct column, with its stage
updating as the underlying work progresses.

**Acceptance Scenarios**:

1. **Given** work exists in various stages, **When** the user opens SpecKit Pilot, **Then** the board is the home surface showing six ordered columns (Backlog → Spec → Plan → Implement → In Review → Done) with each item shown as a card in the column matching its current stage.
2. **Given** a card is being worked by an agent, **When** the underlying work advances from one phase to the next, **Then** the card automatically moves to the column that corresponds to its new stage without the user refreshing.
3. **Given** the user is looking at the board, **When** they view any card, **Then** the card shows enough summary information (title, type, a short scope line, and a compact progress indicator) to understand its state without opening it.

---

### User Story 2 - Create a card and offload it to an agent (Priority: P1)

The user creates a new card directly on the board by writing a brief (a title, a work
type, a scope statement, and an optional checklist). The card starts in Backlog. When
the user is ready, they hand the card off to an agent — which begins working it
through the spec-kit phases in an isolated workspace. The user does not have to leave
the board to start work.

**Why this priority**: Authoring work and offloading it is the core "one card, one
handoff" loop. It is what makes the board actionable rather than a passive display.

**Independent Test**: Create a card with a brief, confirm it lands in Backlog, hand
it off, and confirm an agent begins working it in an isolated workspace while the
card moves out of Backlog.

**Acceptance Scenarios**:

1. **Given** the user is on the board, **When** they choose to create a card and fill in a brief, **Then** a new card appears in the Backlog column carrying that brief.
2. **Given** a card in Backlog, **When** the user hands it off (or moves it out of Backlog), **Then** work begins on it in an isolated workspace and the card leaves Backlog for the appropriate active stage.
3. **Given** a card that has not yet been handed off, **When** the user views it, **Then** no isolated workspace or agent run has been created for it yet.

---

### User Story 3 - Import work from an issue tracker as a card (Priority: P2)

The user pulls an assigned issue from their external tracker into the board as a card,
pre-filled from the issue. From there it behaves like any other card.

**Why this priority**: Many work items originate in a tracker. Importing keeps the
board the single source of truth without forcing manual re-entry. It builds on the
existing tracker connection, so it is valuable but secondary to native authoring.

**Independent Test**: With a tracker connected, import an assigned issue and confirm a
card appears in Backlog pre-filled from that issue.

**Acceptance Scenarios**:

1. **Given** a connected issue tracker, **When** the user chooses to import, **Then** they can pick from their assigned issues and a card is created in Backlog seeded from the selected issue (title, description, and a marker of its origin).
2. **Given** an imported card, **When** it is handed off and worked, **Then** it behaves identically to a natively authored card.

---

### User Story 4 - Run several cards in parallel (Priority: P2)

The user hands off more than one card and multiple agents work concurrently, each in
its own isolated workspace, so parallel work does not interfere. A configurable limit
caps how many run at once; work requested beyond the limit waits and starts
automatically as capacity frees up.

**Why this priority**: The user explicitly wants to offload many items at once — this
is the core differentiator from today's one-at-a-time behavior. It depends on the
board and handoff loop existing first.

**Independent Test**: Hand off two cards while a first is already running and confirm
they work concurrently up to the limit, with any excess waiting and then starting
automatically when a slot frees.

**Acceptance Scenarios**:

1. **Given** the concurrency limit is not reached, **When** the user hands off an additional card, **Then** it begins working immediately alongside the others, in its own isolated workspace.
2. **Given** the concurrency limit is reached, **When** the user hands off another card, **Then** it is marked as waiting and starts automatically once an active card finishes or is stopped.
3. **Given** multiple cards running concurrently, **When** the user reviews the board, **Then** each running card is clearly indicated and its work does not interfere with the others.

---

### User Story 5 - Control and review a card end-to-end from its detail view (Priority: P1)

Opening a card reveals its detail view with everything needed to steer and review the
work: its brief, its phase-by-phase progress with the existing approval gates, an
activity feed of comments and events, and the artifacts the agent has produced. The
user can leave a comment that steers the next phase, approve or request changes at
each gate, and inspect generated artifacts (specification, plan, task list, self-
review, code diff, resulting pull request) including how they changed over time.

**Why this priority**: This is where the user actually exercises end-to-end control.
The board shows state; the detail view is where decisions are made. It reuses the
existing phase/gate machinery, so the incremental value is high relative to effort.

**Independent Test**: Open a running card, post a steering comment, act on a phase
gate, and view an artifact with its revision history — confirming each action affects
the work or reflects it accurately.

**Acceptance Scenarios**:

1. **Given** a card, **When** the user opens it, **Then** they see its brief, its phase progress with approval gates, an activity/comments feed, and a list of its artifacts.
2. **Given** an open card at a phase awaiting review, **When** the user approves or requests changes, **Then** the work proceeds or re-runs accordingly (identical to today's gate behavior).
3. **Given** an open card, **When** the user posts a comment intended to steer the work, **Then** the comment is recorded in the activity feed and is taken into account by the agent on the next phase it runs.
4. **Given** a card that has produced artifacts, **When** the user opens the artifacts view, **Then** they can read each artifact and see its earlier revisions.

---

### User Story 6 - Search workspace knowledge to inform a card (Priority: P3)

The user searches across the repository's documentation and existing card briefs by
keyword and attaches a relevant result to a card's brief, so the agent working that
card has that context.

**Why this priority**: Useful for grounding agents in existing project knowledge, but
the board, handoff, parallelism, and control loop deliver value without it. Lowest
priority and deliberately scoped to keyword search for this version.

**Independent Test**: Search a known term, get matching locations with snippets, and
attach one to a card brief.

**Acceptance Scenarios**:

1. **Given** the user is on the board, **When** they search a keyword, **Then** they get a list of matching locations across repository documentation and card briefs, each with a readable snippet.
2. **Given** a search result, **When** the user attaches it to a card, **Then** it is recorded as context on that card's brief.

---

### Edge Cases

- **Handing off a card with an empty or incomplete brief**: The system must require at least a title before a card can be handed off, and surface a clear message otherwise.
- **Reaching the concurrency limit**: Excess handoffs must queue visibly rather than fail silently, and start in a predictable order as slots free.
- **Moving a card backward to Backlog**: Must clearly define whether this stops/parks in-flight work, and must confirm before discarding progress.
- **Manually dragging a card across non-adjacent stages**: Skipping phases must be prevented; the in-card phase progression remains the authoritative controller.
- **A card's underlying run fails or is stopped**: The card must reflect the failed/stopped state on the board and remain openable for inspection.
- **Losing the tracker connection during import**: Import must fail gracefully with a clear message and not create a broken card.
- **Two work items resolving to the same identity/workspace**: The system must keep each card's workspace isolated and avoid collisions.
- **Searching with no matches**: Must return an explicit "no results" state, not an error.

## Requirements _(mandatory)_

### Functional Requirements

**Board & stages**

- **FR-001**: The system MUST present a board as the primary surface, with six ordered stage columns: Backlog, Spec, Plan, Implement, In Review, Done.
- **FR-002**: The system MUST represent each piece of work as a card placed in the column matching its current stage.
- **FR-003**: The system MUST derive a card's active stage from its underlying phase progress and update the card's column automatically as that progress changes, without requiring a manual refresh.
- **FR-004**: The system MUST show, on each card face, at minimum: title, work type, a short scope summary, and a compact indicator of phase progress and run status.
- **FR-005**: The system MUST prevent manual moves that would skip stages/phases; the in-card phase progression remains the authoritative controller of advancement.

**Cards & authoring**

- **FR-006**: Users MUST be able to create a card directly on the board by authoring a brief consisting of a title, a work type (one of: feature, bug, chore, spike), a scope statement, and an optional checklist; attachments MAY be added.
- **FR-007**: A newly authored card MUST start in Backlog with no isolated workspace and no agent run created until it is handed off.
- **FR-008**: Users MUST be able to edit a card's brief (including its checklist and attachments) after creation.
- **FR-009**: Users MUST be able to import an assigned issue from a connected external tracker as a card in Backlog, pre-filled from the issue and marked with its origin.
- **FR-010**: The system MUST require at least a title before a card can be handed off, and MUST surface a clear message when this precondition is not met.

**Handoff & execution**

- **FR-011**: Users MUST be able to hand off a Backlog card to an agent, which begins working it through the spec-kit phases in an isolated workspace.
- **FR-012**: The system MUST support multiple cards being worked concurrently, each in its own isolated workspace, without cross-interference.
- **FR-013**: The system MUST enforce a configurable maximum number of concurrently running cards; handoffs beyond the limit MUST wait and start automatically as capacity frees up, in a predictable order.
- **FR-014**: The system MUST reflect each card's run status (waiting, running, awaiting review, completed, failed, stopped) on the board.

**Card detail: control & review**

- **FR-015**: Opening a card MUST reveal a detail view containing its brief, its phase-by-phase progress with the existing per-phase approval gates, an activity/comments feed, and its artifacts.
- **FR-016**: Users MUST be able to approve or request changes at each phase gate, with the same effect on the work as the current per-phase gate behavior.
- **FR-017**: Users MUST be able to post a comment on a card; comments MUST be recorded in the activity feed and MUST be taken into account by the agent on the next phase it runs.
- **FR-018**: The activity feed MUST combine user comments with the card's recorded activity/events in chronological order.
- **FR-019**: Users MUST be able to view the card's artifacts (including specification, plan, task list, self-review results, code diff, and resulting pull request reference) and see earlier revisions of each artifact.

**Workspace knowledge search**

- **FR-020**: Users MUST be able to search across repository documentation and card briefs by keyword and receive matching locations with readable snippets, including an explicit empty state when there are no matches.
- **FR-021**: Users MUST be able to attach a search result to a card's brief so it is available as context to the agent working that card.

**Continuity & isolation**

- **FR-022**: The system MUST keep every card's workspace isolated so parallel work cannot collide.
- **FR-023**: The system MUST preserve today's approval-gate semantics, including that the final review and pull-request steps always require explicit human approval and are never auto-approved.
- **FR-024**: The change MUST be contained within the SpecKit Pilot extension and MUST NOT alter behavior of the surrounding application.

### Key Entities _(include if feature involves data)_

- **Board**: The ordered set of six stages through which work moves; the primary surface. Presents cards grouped by stage.
- **Card**: A single unit of work and the "one handoff" to an agent. Carries a brief, an origin (natively authored or imported from a tracker), a current stage, a run status, an activity history, and a set of produced artifacts. Unifies what were previously separate notions of a feature, a ticket, and a run.
- **Brief**: The human-authored description of a card — title, work type, scope, optional checklist, optional attachments, and any attached knowledge-search context.
- **Stage**: One of Backlog, Spec, Plan, Implement, In Review, Done. Derived from the card's underlying phase progress (except Backlog, which precedes any run).
- **Phase progression**: The card's internal, ordered set of spec-kit phases with approval gates (the existing mechanism), surfaced inside the card detail view; the authoritative driver of stage.
- **Comment**: A user- or agent-authored entry in a card's activity feed; user comments influence the agent's next phase run.
- **Artifact**: A work product the agent produces for a card (e.g., specification, plan, task list, self-review, code diff, pull-request reference), viewable with revision history.
- **Knowledge search result**: A matched location (with snippet) from repository documentation or card briefs that can be attached to a brief as context.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: From opening the extension, the user can identify the current stage of every active piece of work at a glance on a single board, without opening any individual item.
- **SC-002**: A user can author a card and hand it off to an agent entirely from the board, without navigating to a separate screen to start the work.
- **SC-003**: A user can have at least three cards being worked concurrently, each isolated, with any additional handoffs waiting and starting automatically as slots free.
- **SC-004**: When a card's underlying work advances a phase, its position on the board reflects the new stage within a few seconds and without a manual refresh.
- **SC-005**: From a single card's detail view, a user can steer the work (via a comment), act on an approval gate, and inspect a produced artifact with its revision history — covering the full control-and-review loop in one place.
- **SC-006**: A user can find an existing piece of project documentation by keyword and attach it to a card as agent context in under one minute.
- **SC-007**: All existing per-phase approval and safety guarantees remain in force, with the final review and pull-request steps still requiring explicit human approval.

## Assumptions

- The existing spec-kit phase engine, per-phase approval gates, isolated-workspace mechanism, tracker connections, artifact comparison, and audit history are reused as the foundation; this feature reframes and extends them rather than replacing them.
- "Isolated workspace" reuses the project's existing per-run isolated working-copy mechanism.
- The default concurrency limit is a small number (assumed 3) and is user-configurable.
- Workspace knowledge search is limited to keyword search over repository documentation and card briefs for this version; semantic/vector search, external URL ingestion, and indexing of tracker issues or pull requests are explicitly out of scope for this version.
- The tracker import reuses the existing external issue-tracker integration and its stored credentials; no new tracker integrations are introduced.
- The previous separate navigation areas for listing work items, active runs, and history are consolidated into the board (e.g., completed work appears in the Done stage and via filters); no capability is lost, only reorganized.
- The change is scoped to the SpecKit Pilot extension and introduces no changes to the surrounding application's files or contracts.
- Backward moves and stopping in-flight work require explicit user confirmation before any progress is discarded.
