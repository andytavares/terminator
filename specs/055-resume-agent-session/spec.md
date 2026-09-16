# Feature Specification: Resume an agent session

**Feature Branch**: `055-resume-agent-session`

**Created**: 2026-09-15

**Status**: Draft

**Input**: User description: "would be awesome if i could resume sessions where i left off — if i disconnect a terminal claude provides a resume uuid, is there a way we can leverage that to resume a session if it exits or goes to sleep or even between restarts"

**Builds on**: feature 054 (Session Home and Monitor Wall), whose session records already survive restarts. Branch `054-session-home-wall`, PR #182, not yet merged.

## Clarifications

### Session 2026-09-15

- Q: How should resuming be triggered? → A: On demand. A Resume control on sessions whose agent has exited and on closed sessions in Home's history. Nothing resumes automatically at launch, because a restart must not start several agents unasked.
- Q: When resuming a session whose agent exited but whose tab is still open, what happens to that tab? → A: The resumed terminal replaces it. The exited tab closes, so there is one tab per conversation.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Pick a conversation back up after the agent exits (Priority: P1)

My agent hit an error, or I quit it, and its terminal now shows an exited process. Home and the wall offer **Resume** on that session. Choosing it opens a terminal on the same branch, in the same folder, with the same conversation carried on — and the dead tab is gone.

**Why this priority**: This is the common case and the one that loses the most work. It needs nothing to survive a restart.

**Independent Test**: Run an agent, tell it something it can recall, quit it, press Resume, and ask it what you told it.

**Acceptance Scenarios**:

1. **Given** a session whose agent has exited and whose conversation can still be resumed, **When** I look at it in Home or on the wall, **Then** it offers Resume.
2. **Given** I press Resume, **When** the terminal opens, **Then** it is on the same branch, in the same folder, and the agent carries on the same conversation.
3. **Given** the exited session's tab was still open, **When** the resumed terminal appears, **Then** the exited tab is gone and the resumed one is showing.
4. **Given** the exited session had a description or a linked work item, **When** it is resumed, **Then** the resumed session carries both.
5. **Given** a session whose terminal is a plain shell, **When** it exits, **Then** it offers no Resume.

---

### User Story 2 - Pick a conversation back up after a restart (Priority: P1)

I quit Terminator, or my machine restarted. The conversations I had are listed under Closed in Home, and each one that can be resumed offers **Resume**.

**Why this priority**: The restart case is what the operator asked for, and the one where nothing else can recover the work. It depends on the same record as Story 1.

**Independent Test**: Run an agent, quit the app, reopen it, and resume the conversation from Closed.

**Acceptance Scenarios**:

1. **Given** an agent session that was running when the app closed, **When** I open Home after a restart, **Then** it is listed under Closed and offers Resume.
2. **Given** I resume it, **When** the terminal opens, **Then** the conversation carries on and the entry leaves Closed for the open list.
3. **Given** a closed session that was only ever a plain shell, **When** I see it under Closed, **Then** it offers no Resume.
4. **Given** a closed agent session older than the retention period, **When** I open Home, **Then** it is not listed at all, and so offers nothing.

---

### User Story 3 - Know when a conversation can no longer be resumed (Priority: P2)

A conversation I could have resumed is gone — its transcript was deleted, or I am on a different machine. The session says so rather than offering a Resume that fails.

**Why this priority**: Without it, Resume is a button that sometimes does nothing, which is worse than no button.

**Independent Test**: Delete an agent session's transcript, then look at that session in Home.

**Acceptance Scenarios**:

1. **Given** a session whose transcript no longer exists, **When** I look at it, **Then** it does not offer Resume and says the conversation is no longer available.
2. **Given** a resume that fails once the terminal has started, **When** the agent reports the failure, **Then** the terminal stays open showing what it said, and the session keeps its description and link.

---

### User Story 4 - Resume a conversation I started by hand (Priority: P2)

I started the agent myself by typing its command in a terminal, not through any Terminator control. That conversation is resumable in the same way.

**Why this priority**: Most sessions are started by hand. A feature that only covered ones the app launched would miss the common case.

**Independent Test**: Type the agent's command in a terminal, exit it, and resume from Home.

**Acceptance Scenarios**:

1. **Given** I started an agent by hand in a branch's terminal, **When** it exits, **Then** that session offers Resume.
2. **Given** two terminals on the same branch each running their own conversation, **When** both exit, **Then** each offers Resume and each resumes its own conversation, not the other's.
3. **Given** a terminal where I ran an agent, quit it, and ran a second one, **When** I resume that session, **Then** the most recent conversation in it is the one that comes back.

### Edge Cases

- **The branch has gone**: a closed session whose branch was deleted still lists, but Resume opens nothing; it says the branch is gone and offers no other action.
- **Resuming twice**: resuming a session that is already resumed and running shows the running terminal rather than starting a second one on the same conversation.
- **The working folder has gone**: the terminal fails to open the way it does today for any missing folder, and the session stays listed.
- **The agent is still running**: a running agent offers no Resume — there is nothing to bring back.
- **A second agent kind**: only agents whose conversations can be resumed offer it; anything else is treated as a plain shell.
- **The app is killed rather than quit**: the next launch lists the conversation under Closed and offers Resume, exactly as a clean quit does.
- **A resumed conversation exits again**: it offers Resume again, on the same conversation.

## Requirements _(mandatory)_

### Functional Requirements

**Knowing what can be resumed**

- **FR-001**: The system MUST record, for each terminal in which an agent conversation starts, the conversation's identifier, the agent it belongs to, and where the conversation's transcript is kept.
- **FR-002**: The system MUST record this for a conversation the operator starts by hand, not only for terminals the application started.
- **FR-003**: The record MUST name the terminal the conversation ran in, so two conversations on one branch are never confused.
- **FR-004**: When a terminal hosts a second conversation, the record MUST hold the most recent one.
- **FR-005**: These facts MUST survive a restart and MUST be kept for as long as the session's other retained context is kept.
- **FR-006**: The record MUST survive resuming: a resumed conversation keeps the same identifier, and the session remains resumable afterwards.

**Offering Resume**

- **FR-007**: A session MUST offer Resume when its agent has exited, or when it is closed, and its conversation can still be resumed.
- **FR-008**: A session MUST NOT offer Resume when it is running, when no conversation was recorded for it, or when its transcript no longer exists.
- **FR-009**: A session whose conversation was recorded but can no longer be resumed MUST say so where Resume would have been.
- **FR-010**: Resume MUST be offered wherever a session is shown: the Ledger, the Logbook and the Monitor wall.

**Resuming**

- **FR-011**: Resuming MUST open a terminal on the session's branch, in the folder the conversation ran in, and carry that conversation on.
- **FR-012**: Resuming a session whose exited terminal is still open MUST close that terminal, leaving one terminal for the conversation.
- **FR-013**: The resumed session MUST carry the original session's description and work item link.
- **FR-014**: Resuming MUST show the resumed terminal.
- **FR-015**: A resumed session that was listed as closed MUST leave the closed list and appear as an open session.
- **FR-016**: When the terminal cannot be opened, the operator MUST be told why, and the original session MUST be left as it was.
- **FR-017**: Resume MUST be available by keyboard as well as pointer, like every other control on these surfaces.

### Key Entities

- **Agent conversation**: what an agent remembers of a session's work. Identified by the agent's own identifier for it, held in a transcript outside the application, and resumable while that transcript exists.
- **Session record** (from feature 054): the retained context of one session — description, work item link, and where it ran. Gains the conversation's identifier, the agent it belongs to, the folder it ran in, and where its transcript is kept.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An agent conversation started in any terminal — by the application or by hand — is recorded as resumable within 5 seconds of the agent starting.
- **SC-002**: A conversation resumed after its agent exits answers a question about what was said before it exited.
- **SC-003**: A conversation resumed after the application restarts answers that same question.
- **SC-004**: Resuming takes one action from Home or the wall, and the resumed terminal is showing within 5 seconds.
- **SC-005**: 100% of sessions that offer Resume actually resume; a session whose conversation cannot be resumed never offers it.
- **SC-006**: Two conversations on one branch resume independently, with no crossover, in 100% of attempts.
- **SC-007**: No agent starts on its own: after a restart with any number of resumable sessions, the number of running agents is zero until the operator resumes one.

## Assumptions

- **Claude Code is the only agent supported.** Its resume mechanism is its own, and no other agent in use here has one. The design names the agent rather than assuming every session is that agent, so a second one can be added without reshaping the record.
- **The conversation's identifier is captured from the agent itself**, through the session hook Terminator already installs per branch, so a conversation started by hand is covered. Verified live on Claude Code 2.1.273: the hook receives the conversation id, its transcript path, the folder and whether it is a fresh start or a resume; a per-terminal environment variable set when Terminator opens the terminal is visible to that hook, which is what ties the conversation to the terminal.
- **Resuming carries the whole conversation**, not a summary. Verified live: a session told to remember a number, exited, then resumed, answered with that number.
- **Nothing resumes automatically**, including at launch, by the operator's decision.
- **Sessions still do not survive a restart**: what survives is the record of the conversation, which is what Resume uses to start a new terminal.
- **Retention follows feature 054**: a closed session is kept 30 days, and a conversation that outlives its record is no longer offered.
- **Out of scope**: resuming a plain shell, re-running a shell command, forking a conversation into a second branch of itself, and resuming on a different machine from the one the transcript is on.
- **Constitution constraints apply**: flat lucide icons with state by opacity only; core only, with no dependency on or from any extension; test-first with 80% coverage; README, ARCHITECTURE.md and an ADR ship in the same PR.
