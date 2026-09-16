---
description: 'Task list for Resume an agent session'
---

# Tasks: Resume an agent session

**Input**: Design documents from `specs/055-resume-agent-session/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: REQUIRED. Constitution VI (TDD, 80% patch coverage). A failing spec comes before the code it covers, in every phase.

**Conventions**:

- Test paths follow the existing layout: `tests/unit/ipc/`, `tests/unit/sessions/`, `tests/unit/agents/`, `tests/unit/shared/`, `tests/unit/renderer/{sidebar,components,stores,terminal}/`, `tests/e2e/`, `tests/e2e/live/`.
- E2E addresses UI by role and name (`contracts/ui-surfaces.md`), never by CSS class.
- Icons are lucide only, sized in CSS, state by opacity.
- This branch is cut from `054-session-home-wall`; its PR lands after #182.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: the user story the task serves (US1–US4)

---

## Phase 1: Setup

- [x] T001 Record the current line coverage of every existing file this feature edits in `specs/055-resume-agent-session/coverage-baseline.md`, from `npx vitest run --coverage`:

  - `src/main/sessions/session-record-store.ts`
  - `src/main/ipc/session-records.ipc.ts`
  - `src/main/ipc/terminal.ipc.ts`
  - `src/main/index.ts`
  - `src/renderer/sidebar/session-facts.ts`
  - `src/renderer/terminal/start-session.ts`
  - `src/renderer/components/home/LedgerView.tsx`
  - `src/renderer/components/home/LogbookView.tsx`
  - `src/renderer/components/overview/WallTile.tsx`

  Name any file below 80% as debt the phase touching it must pay.

- [x] T002 Confirm the pre-commit gate runs here: `git config core.hooksPath` resolves to an existing `.husky/_`, else `npm run prepare`.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: capture a conversation and keep it. Nothing can be offered or resumed until a conversation is recorded against a session.

### Tests first

- [x] T003 [P] Write failing specs for the report parser in `tests/unit/shared/agent-sessions/report.spec.ts`:
  - A full payload plus `TERMINATOR_SESSION_ID` becomes a report.
  - A payload with no session id, no transcript path, or no terminal yields `null`.
  - An unknown `hook_event_name` yields `null`.
  - `source` is carried through, and anything not `startup` or `resume` is carried as given rather than rejected.
- [x] T004 [P] Write failing specs for the hook script in `tests/unit/agents/agent-session-hook.spec.ts`. Run the script as a child process, as `tests/unit/integrations` does for the context hook:
  - Given a payload on stdin and `TERMINATOR_SESSION_ID` set, it writes `<dir>/<terminal>.json` with the report and exits 0 printing nothing.
  - A second conversation in the same terminal replaces the file.
  - With no `TERMINATOR_SESSION_ID`, it writes nothing and exits 0.
  - Malformed stdin, an unwritable directory, or no stdin at all: exits 0, prints nothing, writes nothing.
- [x] T005 [P] Write failing specs for the user-settings install in `tests/unit/agents/agent-session-hook.spec.ts` (same file, its own describe), with `HOME` pointed at a tmp dir:
  - Creates `~/.claude/settings.json` with one `SessionStart` entry when there is none.
  - Merges into an existing file: other `SessionStart` entries and every other key survive.
  - Installing twice leaves exactly one entry of ours (idempotent, matched on our script path).
  - A settings file that cannot be parsed is left untouched and the failure is reported, never overwritten.
- [x] T006 [P] Write failing specs for the watcher in `tests/unit/agents/agent-session-watcher.spec.ts`:
  - A report file appearing calls the record store with the session it names.
  - A replaced file updates that session's conversation.
  - A file naming a session with no record creates one.
  - A malformed file is ignored and the watcher keeps running.
  - Stopping the watcher removes the listener.
- [x] T007 [P] Extend `tests/unit/sessions/session-record-store.spec.ts`:
  - `setAgent` creates a record for a session with no description and no link.
  - Clearing the description and link on a record that has a conversation keeps the record.
  - Clearing everything, conversation included, deletes it.
  - A second conversation replaces the first.
  - `markClosed` and the startup sweep leave the conversation intact.
  - Pruning removes a closed record with a conversation like any other.
  - `transfer` moves description, link and conversation to the new session and deletes the old record, in one write.
  - `transfer` from a session with no record returns `null` and writes nothing.
- [x] T008 [P] Extend `tests/unit/ipc/session-records.ipc.spec.ts`:
  - `list` reports `resumable: true` when the transcript exists, `false` when it does not, and `false` when there is no conversation.
  - `changed` carries the conversation and `resumable`.
  - `session-records:transfer` calls the store and returns the new record; a bad payload is `VALIDATION_ERROR`.
- [x] T009 [P] Extend `tests/unit/ipc/terminal.ipc.spec.ts`:
  - `terminal:create` puts `TERMINATOR_SESSION_ID` in the spawned environment, beside the issue variables, for a project with and without a link.
  - With `initialCommand`, the line is written into the PTY once, followed by a newline.
  - An `initialCommand` containing a newline is refused with `VALIDATION_ERROR` and nothing is spawned.
- [x] T010 [P] Extend `tests/unit/renderer/sidebar/session-facts.spec.ts`: facts carry `agent` and `resumable` from the record, and both are absent for a session with no record.
- [x] T011 [P] Extend `tests/unit/renderer/stores/session-records.store.spec.ts`: `transfer` calls the channel and applies the returned record, dropping the old one.

### Implementation

- [x] T012 Add `AgentConversation` to `src/shared/types/index.ts`, put `agent: AgentConversation | null` on `SessionRecord`, and add `resumable` to what the list and change events carry. Shapes in `data-model.md`.
- [x] T013 [P] Implement the pure report parser in `src/shared/agent-sessions/report.ts` (T003).
- [x] T014 [P] Add `TransferInputSchema` and the conversation shape to `src/shared/schemas/session-records.schema.ts`.
- [x] T015 Implement `src/main/agents/agent-session-hook.ts` (T004, T005): the script source as a string, `installHookScript`-style write into `userData/integrations/agent-session-hook.cjs`, and `installUserHook()` merging one entry into `~/.claude/settings.json` in the shape of `installProjectHook`. The script reads stdin, uses the parser, writes one file, prints nothing, exits 0.
- [x] T016 Implement `src/main/agents/agent-session-watcher.ts` (T006): `startAgentSessionWatcher()` watches `userData/agent-sessions/`, folds each report into the record store, returns a stop function.
- [x] T017 In `src/main/sessions/session-record-store.ts` (T007): add `setAgent`, widen the delete-when-empty rule to include the conversation, and add `transfer(fromSessionId, session)`.
- [x] T018 In `src/main/ipc/session-records.ipc.ts` (T008): stat transcripts to report `resumable` on `list` and on `changed`, and register `session-records:transfer`.
- [x] T019 In `src/main/ipc/terminal.ipc.ts` (T009): add `TERMINATOR_SESSION_ID` to the spawn environment, and accept `initialCommand`, written into the PTY after spawn. Reject a command containing a newline in the schema.
- [x] T020 In `src/main/index.ts`: write the hook script, install the user hook, and start the watcher at startup, beside the existing integrations wiring. A failure to install is logged and does not stop startup.
- [x] T021 [P] Expose `sessionRecords.transfer` in `src/shared/electron-api/manifest.ts` and `src/renderer/electron.d.ts`, and add it to the expected remote surface in `src/shared/electron-api/__tests__/manifest.spec.ts`.
- [x] T022 [P] Carry `agent` and `resumable` through `buildSessionFacts` in `src/renderer/sidebar/session-facts.ts` (T010).
- [x] T023 [P] Add `transfer` to `src/renderer/stores/session-records.store.ts` (T011).

**Checkpoint**: run quickstart §3 by hand — start `claude` in a terminal, see the report file appear, and the record gain a conversation.

---

## Phase 3: User Story 1 - Pick a conversation back up after the agent exits (P1) 🎯 MVP

**Goal**: an exited agent session offers Resume on every surface, and resuming brings the conversation back in a terminal that replaces the dead one.

**Independent Test**: tell an agent a number, quit it, press Resume, ask for the number.

### Tests first

- [x] T024 [P] [US1] Write failing specs for the pure layer in `tests/unit/renderer/sidebar/resume.spec.ts`:
  - `resumeCommand` builds `claude --resume <id>` for `provider: 'claude'`, and `null` for anything else.
  - `planResume` returns a plan for an exited, resumable session, with its branch and recorded folder.
  - `null` for a running session, one with no conversation, or one that is not resumable.
  - The session id is quoted or rejected so nothing but an id can reach the command line.
- [x] T025 [P] [US1] Write failing specs in `tests/unit/renderer/components/ResumeButton.spec.tsx`:
  - Renders `button` named `Resume <name>` when a plan exists, and calls `onResume` with it.
  - Renders `Conversation no longer available` when the session had a conversation and is not resumable.
  - Renders nothing when the session never had one, and nothing while it is running.
- [x] T026 [P] [US1] Extend `tests/unit/renderer/terminal/start-session.spec.ts` for `resumeSession`:
  - Creates a terminal on the session's branch, in the recorded folder, with the resume command.
  - Transfers the record to the new session, then closes the old terminal when one is open.
  - Shows the resumed terminal.
  - A create that fails leaves the old session and its record alone, and closes nothing.
  - A session already resumed and running shows that terminal instead of starting a second one.
- [x] T027 [P] [US1] Extend the surface specs so each shows Resume where it applies:
  - `tests/unit/renderer/components/LedgerView.spec.tsx`
  - `tests/unit/renderer/components/LogbookView.spec.tsx`
  - `tests/unit/renderer/components/WallTile.spec.tsx`

### Implementation

- [x] T028 [P] [US1] Implement `src/renderer/sidebar/resume.ts` (T024).
- [x] T029 [P] [US1] Implement `src/renderer/components/session/ResumeButton.tsx` and its CSS (T025), with a flat lucide icon.
- [x] T030 [US1] Implement `resumeSession` in `src/renderer/terminal/start-session.ts` (T026): create with `initialCommand`, `transfer`, close the old terminal, navigate.
- [x] T031 [US1] Render `ResumeButton` in `LedgerView`, `LogbookView` and `WallTile`, wired to `resumeSession` (T027).
- [x] T032 [US1] Write `tests/e2e/resume-session.spec.ts` (first block): with a fake agent — a script that reports a conversation through the same hook path — a session that exits offers Resume, resuming opens a terminal in the same branch, the old tab goes, and the description and link move with it.
- [x] T033 [US1] Write `tests/e2e/live/resume-live.spec.ts`: quickstart §4 against a real `claude` — remember a number, `/exit`, press Resume on the wall, ask for the number, assert the answer. Scrub `CLAUDE*` from the environment first. Record the Claude Code version in the run's report.

**Checkpoint**: US1 is demoable, and the live run has passed once.

---

## Phase 4: User Story 2 - Pick a conversation back up after a restart (P1)

**Goal**: conversations from the last run are listed under Closed with Resume, and nothing starts on its own.

**Independent Test**: run an agent, quit the app, reopen, resume from Closed.

### Tests first

- [x] T034 [P] [US2] Extend `tests/unit/sessions/session-record-store.spec.ts`: a swept-closed record keeps its conversation and stays resumable.
- [x] T035 [P] [US2] Extend `tests/unit/renderer/components/LedgerView.spec.tsx` and `LogbookView.spec.tsx`: a closed session offers Resume, and still shows its description read-only.

### Implementation

- [x] T036 [US2] Make sure a resumed closed session leaves the Closed group: the transferred record belongs to an open session, so `buildLedger` and `buildLogbook` place it with the open ones. Cover it in `tests/unit/renderer/sidebar/ledger-rows.spec.ts`.
- [x] T037 [US2] Extend `tests/e2e/resume-session.spec.ts`: relaunch onto the same profile, assert the session is under `Closed` with Resume, resume it, and assert it is no longer under Closed.
- [x] T038 [US2] Assert in the same spec that no agent ran before Resume was pressed: after the relaunch, no terminal exists (SC-007).

---

## Phase 5: User Story 3 - Know when a conversation can no longer be resumed (P2)

**Goal**: a conversation whose transcript has gone says so, and never offers a button that fails.

**Independent Test**: delete a transcript, look at the session.

### Tests first

- [x] T039 [P] [US3] Extend `tests/unit/ipc/session-records.ipc.spec.ts`: a record whose transcript is deleted between two lists flips `resumable` to false.
- [x] T040 [P] [US3] Extend `tests/unit/renderer/components/ResumeButton.spec.tsx`: the unavailable message replaces the button, and is not shown for a session that never had a conversation.

### Implementation

- [x] T041 [US3] Make the unavailable state visible on all three surfaces, reusing `ResumeButton`, and cover it in the surface specs.
- [x] T042 [US3] Extend `tests/e2e/resume-session.spec.ts`: delete the transcript the record names, reopen Home, and assert the message and the absence of Resume.

---

## Phase 6: User Story 4 - Resume a conversation started by hand (P2)

**Goal**: a `claude` typed by the operator is captured and resumable, and two conversations on one branch never cross.

**Independent Test**: type the agent's command in a terminal, exit, resume from Home.

### Tests first

- [x] T043 [P] [US4] Extend `tests/unit/agents/agent-session-watcher.spec.ts`: two reports naming two terminals update two records, and neither takes the other's conversation.
- [x] T044 [P] [US4] Extend `tests/unit/agents/agent-session-hook.spec.ts`: the script keys its file on the terminal, so two terminals write two files.

### Implementation

- [x] T045 [US4] Extend `tests/e2e/resume-session.spec.ts`: two terminals on one branch, each with its own fake conversation, exit both, resume both, and assert each resumed the right one.
- [x] T046 [US4] Confirm capture needs nothing from the way the agent was started: the e2e types the command rather than using any Terminator control, and the spec says so in a comment.

---

## Phase 7: Polish & Cross-Cutting

- [x] T047 [P] Update `docs/ARCHITECTURE.md`: the persistence table gains the conversation and the report directory; a "Resuming an agent session" section covers the hook, the terminal variable, the watcher and transfer; the Terminal Session Lifecycle notes the environment variable.
- [x] T048 [P] Update `README.md` and `docs/user-guide/USER-GUIDE.md`: what Resume does, that only Claude Code sessions have it, that nothing resumes on its own, and **how to remove the hook entry from `~/.claude/settings.json`**.
- [x] T049 [P] Finalise `docs/adr/055-a-conversation-outlives-its-terminal.md` with anything the build taught, including the Claude Code version the live run proved.
- [x] T050 Accessibility pass: Resume is reachable by keyboard with a visible focus ring on all three surfaces, and its accessible name says which session it resumes.
- [x] T051 Verify reachability: every export this feature adds has a caller outside tests. Delete anything that does not.
- [x] T052 Screenshot the running app: an exited session offering Resume, and the unavailable state. Look at the images.
- [ ] T053 Run `quickstart.md` §1–§6 and put each command and its exit code in the PR description, including the live run's answer.
- [ ] T054 Open the PR from `055-resume-agent-session`, noting it depends on #182. The body names the settings file the feature writes into, how to remove it, and what is out of scope. Check `git log --oneline -1` after the last commit to confirm the gate did not refuse it.

---

## Dependencies & Execution Order

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup. Blocks every story — nothing is resumable until conversations are captured.
- **US1 (Phase 3)**: after Foundational. The MVP.
- **US2 (Phase 4)**: after US1; it reuses the same control and path across a restart.
- **US3 (Phase 5)**: after US1, since it is the negative case of the same control.
- **US4 (Phase 6)**: after Foundational; its e2e needs US1's Resume to prove the pairing end to end.
- **Polish (Phase 7)**: after every story.

```
Setup → Foundational ─┬─► US1 ─┬─► US2 ─┐
                      │        └─► US3 ─┼─► Polish
                      └─► US4 ──────────┘
```

## Parallel Opportunities

- **Foundational**: T003–T011 are separate spec files and run together. T013, T014, T021, T022 and T023 run in parallel once T012 lands.
- **US1**: T024–T027 in parallel; T028 and T029 in parallel.
- **US4 early**: T043 and T044 need only Foundational.

### Example: the Foundational tests together

```text
T003 tests/unit/shared/agent-sessions/report.spec.ts
T004 tests/unit/agents/agent-session-hook.spec.ts
T006 tests/unit/agents/agent-session-watcher.spec.ts
T007 tests/unit/sessions/session-record-store.spec.ts
T008 tests/unit/ipc/session-records.ipc.spec.ts
T009 tests/unit/ipc/terminal.ipc.spec.ts
```

## Implementation Strategy

### MVP (Foundational + US1)

1. Phases 1–2: capture a conversation and keep it on the record.
2. Phase 3: Resume on every surface, and the live run.

That is the whole feature for the case that loses the most work — an agent that exits — and it is what the live run proves.

### Incremental delivery

1. MVP.
2. US2 (restart).
3. US3 (no longer available).
4. US4 (hand-started, two on a branch).
5. Polish, docs and the PR.

Every step leaves `npm test` at exit 0, lint at 0, and patch coverage ≥ 80%.
