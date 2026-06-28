# Tasks: SpecKit Pilot Revamp

**Input**: Design documents from `specs/015-speckit-pilot-revamp/`

**Prerequisites**: plan.md ✓ · spec.md ✓ · research.md ✓ · data-model.md ✓ · contracts/ ✓ · quickstart.md ✓

**Tests**: Included — constitution mandates TDD; every new production file requires a companion spec with ≥ 80% coverage.

**Organization**: Grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no shared dependencies)
- **[Story]**: User story label — US1 through US5 per spec.md priorities
- Paths relative to `extensions/speckit-pilot/src/` unless otherwise noted

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add new npm dependencies and create empty module stubs so TypeScript compiles before any logic is written.

**API corrections applied from /speckit-analyze:**

- Runner uses `api.pty.spawn` (Extension API) — NOT `child_process.spawn` (no new dep)
- Shell commands use `api.shell.exec({ command: 'git'|'gh', args, cwd })` — NOT `api.shell.run`
- Credentials use `electron.safeStorage` + JSON file — NOT `electron-store` (resolves CRITICAL C2)
- Push events use `api.window.broadcast(channel, data)` — NOT `BrowserWindow.getAllWindows()`
- `KanbanBoard.tsx` already exists — extend, do NOT create

- [x] T001 Add ONLY `@linear/sdk` to `extensions/speckit-pilot/package.json` dependencies; run `npm install` from repo root to hoist. Do NOT add `electron-store` — credentials use Electron's built-in `safeStorage` API (zero new deps for credentials).
- [x] T002 [P] Create empty stub files: `extensions/speckit-pilot/src/runner/agent-runner.ts`, `extensions/speckit-pilot/src/api/linear.ts`, `extensions/speckit-pilot/src/api/jira.ts`, `extensions/speckit-pilot/src/api/credentials.ts`, `extensions/speckit-pilot/src/utils/retry.ts`
- [x] T003 [P] Verify `npm run build:extensions` passes with zero errors after stubs are in place

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extended type system, 10-phase state machine, agent runner, and credential store. All user story phases depend on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Types & state machine

- [x] T004 Write failing tests for 10-phase state machine in `extensions/speckit-pilot/tests/state/phase-state-machine.spec.ts`: assert `self-review` and `open-pr` are in `PHASE_ORDER`; assert `shouldAutoApprove('self-review', 'fast', anyGateConfig)` returns false; assert `shouldAutoApprove('open-pr', 'fast', anyGateConfig)` returns false; assert revoke on phase 8 ('implement') marks phase 9 ('self-review') stale
- [x] T005 Extend `extensions/speckit-pilot/src/types/speckit.types.ts`: (a) add `PhaseId` values `'self-review'` and `'open-pr'`; (b) add interfaces `Ticket { source, key, sourceUrl, title, body, acceptanceCriteria, priority?, size? }`, `TicketRef { source, key, sourceUrl, title }`, `RunMeta { status, startedAt, completedAt?, autonomyLevel }`, `SelfReviewResult { format, lint, coverage, googleReview, summary }`, `LinearSettings { teamFilter? }`, `JiraSettings { domain, email, jql }`; (c) add `AutonomyLevel = 'guided' | 'standard' | 'fast'`; (d) bump `PilotState` version to 2 and add fields `ticket: TicketRef | null`, `run: RunMeta | null`, `queuePosition: 'active' | 'pending' | null`, `worktreePath: string | null`, `branchName: string | null`, `prUrl: string | null`; (e) extend `PhaseState` with `feedback: string | null`, `batchIndex: number | null`; (f) extend `PilotSettings` with `defaultAutonomy: AutonomyLevel`, `batchCheckinsEnabled: boolean`, `writeStatusBackOnPrOpen: boolean`, `linear: LinearSettings | null`, `jira: JiraSettings | null`; (g) extend `HistoryEntry.action` with `'request_changes' | 'run_cancelled' | 'pr_opened' | 'comment' | 'artifact_modified'`; (h) update `PHASE_ORDER` to 10 entries; update `DEFAULT_SETTINGS`
- [x] T005b Write failing tests for `shouldAutoApprove` (T004 depends on this — add to same test file): assert `shouldAutoApprove('self-review', 'fast', { autoApprove: true })` → false; assert `shouldAutoApprove('open-pr', 'fast', { autoApprove: true })` → false; assert `shouldAutoApprove('specify', 'fast', { autoApprove: true })` → true
- [x] T006 Update `extensions/speckit-pilot/src/state/phase-state-machine.ts`: (a) extend `TRANSITIONS` to cover `'self-review'` and `'open-pr'` with same status transitions as other phases; (b) add exported `shouldAutoApprove(phase: PhaseId, autonomy: AutonomyLevel, gate: PhaseGateConfig): boolean` — returns `false` unconditionally for `'self-review'` and `'open-pr'`; for all other phases returns `gate.autoApprove && autonomy !== 'guided'`; (c) ensure `computeStalePhases` works over all 10 phases
- [x] T007 Update `extensions/speckit-pilot/src/state/state-persistence.ts`: (a) extend `defaultArtifactPaths` switch for `'self-review'` → `['.pilot/self-review.json']` and `'open-pr'` → `[]`; (b) update `createInitialState` to set `version: 2`, initialize new v2 null fields (`ticket`, `run`, `queuePosition`, `worktreePath`, `branchName`, `prUrl`) in returned state object
- [x] T007b Write failing restart-recovery test in `extensions/speckit-pilot/tests/state/state-persistence.spec.ts`: assert that a state written with `writeState` (with `run.status: 'running'`, `queuePosition: 'active'`) is correctly read back by `readState` with all fields preserved; assert `readState` returns null for missing file without throwing
- [x] T008 Run `npx vitest run --reporter=verbose extensions/speckit-pilot/tests/state/` — confirm T004 and T007b tests pass

### Retry utility

- [x] T009 Write failing tests for retry utility in `utils/retry.spec.ts`: assert 3 retries on 429 with exponential delay; assert fast-fail on non-429 errors; assert success on first call skips retries
- [x] T010 Implement `utils/retry.ts`: export `withRetry<T>(fn: () => Promise<T>, maxAttempts?: number): Promise<T>` with 100ms × 2^attempt delay on HTTP 429
- [x] T011 Run T009 tests — confirm they pass

### Credential store

- [x] T012 Write failing tests for credential store in `api/credentials.spec.ts`: assert `setLinearKey` stores; assert `getLinearKey` retrieves or returns null; assert `setJiraCredentials` / `getJiraCredentials` roundtrip; assert store uses encryption option
- [x] T013 Implement `extensions/speckit-pilot/src/api/credentials.ts`: use `electron.safeStorage.encryptString/decryptString` to encrypt values; store encrypted payloads as base64 in `path.join(app.getPath('userData'), 'speckit-pilot-creds.json')`; export `setLinearKey(key: string): Promise<void>`, `getLinearKey(): Promise<string | null>`, `setJiraCredentials(creds: JiraCreds): Promise<void>`, `getJiraCredentials(): Promise<JiraCreds | null>`; use atomic tmp-then-rename write; import `{ safeStorage, app }` from `'electron'` — zero npm deps required
- [x] T014 Run T012 tests — confirm they pass

### Agent runner

- [x] T015 Write failing tests for agent runner in `extensions/speckit-pilot/tests/runner/agent-runner.spec.ts`: mock `api.pty` object; assert `startPhaseRunner` calls `api.pty.spawn` with `type: 'agent'` and the worktree path as `cwd`; assert `onData` lines are broadcast via `api.window.broadcast('speckit:run-output', ...)` per line; assert `RunnerHandle.stop()` calls `api.pty.kill(sessionId)`; assert `onExit` fires `api.window.broadcast('speckit:run-phase-complete', { phase, featureDir })`
- [x] T016 Implement `extensions/speckit-pilot/src/runner/agent-runner.ts`: export `createAgentRunner(api: ExtensionAPI)` factory returning an object with `startPhaseRunner(opts: { featureDir, worktreePath, phaseCommand, phase, feedbackNote? }): RunnerHandle`; use `api.pty.spawn(sessionId, worktreePath, shellCmd, 'agent', onData, onExit)` where `shellCmd` is `claude --headless --print "${phaseCommand}"` (with optional appended feedback note); in `onData` call `api.window.broadcast('speckit:run-output', { featureDir, line, ts })`; in `onExit` call `api.window.broadcast('speckit:run-phase-complete', { featureDir, phase, exitCode })`; `RunnerHandle` exposes `stop(): void` that calls `api.pty.kill(sessionId)`
- [x] T017 Run T015 tests — confirm they pass

**Checkpoint**: Foundation complete — type-check passes, state machine covers 10 phases, runner spawns and streams, credentials store/retrieve safely.

---

## Phase 3: User Story 1 — Dispatch a ticket to a PR (Priority: P1) 🎯 MVP

**Goal**: A developer can select a Linear or Jira ticket, dispatch it, watch the agent drive all 10 phases, and end with an opened pull request — without leaving the SpecKit tab.

**Independent Test**: In a repo with `.specify/` initialized and Linear connected, dispatch a small ticket. Verify `specs/NNN-slug/` is created, phases advance, and `gh pr create` opens a PR linked to the ticket. (Quickstart scenarios 1–2, 7–8.)

### Tracker API clients

- [x] T018 [P] Write failing tests for Linear client in `api/linear.spec.ts`: mock `@linear/sdk` `LinearClient`; assert `fetchAssignedTickets` maps SDK `Issue` → `Ticket`; assert `postComment` calls `createComment`; assert 429 triggers `withRetry`
- [x] T019 [P] Write failing tests for Jira client in `api/jira.spec.ts`: mock `fetch()`; assert `fetchAssignedTickets` sends correct JQL in URL; assert response maps to `Ticket[]`; assert 429 retries; assert 401 throws without retry
- [x] T020 [P] Implement `api/linear.ts`: `LinearClient` wrapper; export `fetchAssignedTickets(apiKey, teamFilter?): Promise<Ticket[]>` and `postComment(apiKey, issueId, body): Promise<void>`; use `withRetry`
- [x] T021 [P] Implement `api/jira.ts`: raw `fetch()` to Jira REST API v3; export `fetchAssignedTickets(creds, jql): Promise<Ticket[]>`, `postComment`, `transitionStatus`; use `withRetry`; Base64 auth header constructed in this module only
- [x] T022 Run T018 and T019 tests — confirm they pass

### Dispatch & run IPC handlers

- [x] T023 Write failing tests in `index-ipc.spec.ts` covering: `speckit:ticket-list` calls Linear + Jira in parallel; `speckit:credentials-set` delegates to credentials module; `speckit:credentials-status` returns `{ connected: boolean }` only (never raw key); `speckit:dispatch` creates feature dir, writes `ticket.md`, creates worktree, initializes state v2, queues if run active; `speckit:run-cancel` stops runner and removes worktree; `speckit:open-pr` runs `gh pr create`, parses URL, writes state
- [x] T024 Add `speckit:ticket-list` handler to `index.ts`: fetch Linear and Jira tickets in parallel using `getLinearKey()` / `getJiraCredentials()`; merge and return sorted; on all retries exhausted return `{ error }`
- [x] T025 [P] Add `speckit:credentials-set` handler to `index.ts`: delegate to `credentials.ts`; return `{ ok: true }` or `{ error }`
- [x] T026 [P] Add `speckit:credentials-status` handler to `index.ts`: return `{ connected: boolean, email?, domain? }` — never the actual credential
- [x] T027 Add `speckit:dispatch` handler to `index.ts`: (1) scan `specs/` dir to determine next sequential number; (2) create `specs/NNN-<slug>/` dir and write `ticket.md` from `TicketRef`; (3) call `createInitialState` with v2 fields; (4) write `.pilot/state.json`; (5) if another run is already active for this workspacePath return `{ featureDir, queued: true }` and persist `queuePosition: 'pending'`; else call `api.shell.exec({ command: 'git', args: ['worktree', 'add', '.wt/<slug>', '-b', branchName], cwd: workspacePath })`, set `queuePosition: 'active'`, call `agentRunner.startPhaseRunner(...)` for Constitution phase
- [x] T028 Add `speckit:run-cancel` handler to `index.ts`: call `RunnerHandle.stop()` on active runner; run `git worktree remove .wt/<slug>` via shell; update state to `cancelled`; append `run_cancelled` to history; advance queue if pending
- [x] T029 Update `speckit:checkpoint-create` handler to accept optional `worktreePath` param; use `worktreePath` as `cwd` when provided
- [x] T030 Add `speckit:open-pr` handler to `index.ts`: (1) verify gh auth via `api.shell.exec({ command: 'gh', args: ['auth', 'status'], cwd: worktreePath })`; (2) build PR body with required traceability block: `<!-- Ticket: <ticket.sourceUrl> -->\n<!-- Spec: specs/NNN-slug/spec.md -->\n<!-- Plan: specs/NNN-slug/plan.md -->\n\n<human-readable links>`; (3) run `api.shell.exec({ command: 'gh', args: ['pr', 'create', '--title', title, '--body', body, '--base', baseBranch], cwd: worktreePath })`; (4) parse PR URL from stdout; (5) write `prUrl` to state; (6) if `writeStatusBackOnPrOpen: true` call tracker `postComment` and `transitionStatus`; (7) call `api.shell.exec({ command: 'git', args: ['worktree', 'remove', worktreePath, '--force'], cwd: workspacePath })`; (8) append `pr_opened` to history
- [x] T031 Run T023 tests — confirm they pass

### Basic renderer — ticket inbox + dispatch + run dashboard + gate panel

- [x] T032 Write failing component tests covering: `TicketsView` renders ticket list with SOURCE badges and filter pills; `DispatchSheet` renders 10 gate toggles with Self-Review + Open PR locked; `RunDashboard` renders 10-node `PhaseRail`; `GatePanel` renders artifact preview and Approve button
- [x] T033 [P] Implement `renderer/components/PhaseRail.tsx`: 10 nodes; node state → done / active / review / pending / locked; uses `--tm-*` CSS variables; no hardcoded hex
- [x] T034 [P] Implement `renderer/components/RunConsole.tsx`: scrolling container; listens to `speckit:run-output` push events via `onStateChanged`-style subscription; auto-scrolls to bottom
- [x] T035 Implement `renderer/components/GatePanel.tsx` (base gate): artifact preview rendered as markdown; feedback textarea for request-changes note (wired to T040 in Phase 4); Approve and Reject buttons
- [x] T036 [P] Implement `renderer/components/DispatchSheet.tsx`: autonomy segmented control (Guided/Standard/Fast); 10 gate toggle rows; Self-Review and Open PR rows locked on and visually distinct; "Start run" button calls `speckit:dispatch`
- [x] T037 Implement `renderer/components/TicketsView.tsx`: ticket list with filter pills; selected-ticket detail panel with `DispatchSheet`; run-status badge for dispatched tickets; empty state when no credentials
- [x] T038 Implement `renderer/components/RunDashboard.tsx`: run header (ticket badge, feature dir, worktree, autonomy); `PhaseRail`; `RunConsole`; conditional render of `GatePanel` when phase is `awaiting_review`; subscribes to `speckit:state-changed` and `speckit:run-output`
- [x] T039 Run T032 tests — confirm they pass

**Checkpoint**: Ticket inbox loads, dispatch creates a run, phase rail advances, gates show artifact for approval, PR opens. Full US1 path functional.

---

## Phase 4: User Story 2 — Human gates and feedback (Priority: P1)

**Goal**: Developers can Request changes (feeding a re-run), edit artifacts inline (marking them modified), revoke approvals (cascading stale), and see a complete audit trail in history.

**Independent Test**: Dispatch a ticket; at Specify gate, request changes with a note; verify re-run incorporates note and phase returns to `awaiting_review`. Edit `spec.md` inline; verify `modified` state. Revoke Specify approval; verify Plan becomes `stale`. (Quickstart scenario 4.)

### Request-changes IPC

- [x] T040 Write failing tests in `extensions/speckit-pilot/tests/ipc/speckit.ipc.spec.ts` for `speckit:phase-request-changes`: assert stores `feedback` note in `PhaseState.feedback`; sets phase status to `'ready'`; appends `request_changes` history entry; calls `agentRunner.startPhaseRunner` with `feedbackNote`
- [x] T040b Write failing test for `speckit:phase-comment`: assert appends `comment` entry to history with the note text; assert does NOT trigger a re-run; assert broadcasts updated state
- [x] T041 Add `speckit:phase-request-changes` handler to `extensions/speckit-pilot/src/index.ts`: read state, set `phase.feedback = note`, set `phase.status = 'ready'`, writeState, appendHistory `request_changes`, call `agentRunner.startPhaseRunner(...)` with `feedbackNote`, broadcast via `api.window.broadcast('speckit:state-changed', { state })`
- [x] T041b Add `speckit:phase-comment` handler to `extensions/speckit-pilot/src/index.ts`: read state, appendHistory `comment` entry with `note`, writeState, broadcast state — no re-run triggered
- [x] T042 Run T040 and T040b tests — confirm they pass

### Renderer — gate actions (request-changes, revoke, inline edit)

- [x] T043 Write failing component tests: `GatePanel` submits request-changes note; inline edit triggers `speckit:file-write` then `speckit:phase-approve` with `modified` status; Revoke button calls `speckit:phase-revoke`; stale banner shows affected phases before confirming
- [x] T044 Extend `renderer/components/GatePanel.tsx`: (a) request-changes flow; (b) inline editor (Edit2 icon, saves via onInlineEdit prop which calls fileWrite + phaseApprove); (c) Comment button (MessageSquare icon) via onComment prop; (d) Revoke button (Undo2 icon) via onRevoke prop; (e) stale banner via stalePhases prop
- [x] T045 Add inline stale propagation banner in `GatePanel.tsx`: list of transitively stale phases shown; no modal, inline
- [x] T046 RunDashboard wires up onRevoke, onComment, onInlineEdit callbacks to IPC handlers (phaseRevoke, phaseComment, fileWrite+phaseApprove)
- [x] T047 Run T043 tests — confirm they pass

**Checkpoint**: All five gate actions work end-to-end: approve, request-changes (re-run with note), inline edit (modified), revoke (cascade stale), diff. Audit log entries appear for each.

---

## Phase 5: User Story 3 — Autonomous self-review gate (Priority: P1)

**Goal**: Before any PR, the agent runs `npm run format`, `npm run lint`, `vitest --coverage`, and `/google-review` and presents concrete metrics at a required gate. Self-Review and Open PR gates can never be auto-approved.

**Independent Test**: Approve Implement; verify Self-Review phase runs the 4 quality checks, displays real numbers, and requires explicit developer approval before advancing. (Quickstart scenarios 6–8.)

### Self-Review phase logic

- [x] T048 Write failing tests in `runner/agent-runner.spec.ts` for Self-Review: assert `startPhaseRunner` with `'self-review'` phase uses compound command with npm run format/lint/vitest/google-review; assert broadcasts speckit:run-phase-complete on exit
- [x] T049 Extend `runner/agent-runner.ts` Self-Review mode: when phase is `'self-review'`, runner uses `SELF_REVIEW_CMD` compound command; buffers output; broadcasts run-phase-complete on exit
- [x] T050 Add IPC handler `speckit:self-review-read` to `index.ts`: read and return `.pilot/self-review.json` as `SelfReviewResult`
- [x] T051 Run T048 tests — confirm they pass

### Self-Review + Open PR renderer components

- [x] T052 Write failing component tests: `SelfReviewGate` renders 4 quality rows; coverage row shows percentage; "Back to Implement" triggers phaseRequestChanges; "Approve → Open PR" calls phaseApprove; `OpenPrGate` shows ticket badge, branch name, Open PR button
- [x] T053 [P] Implement `renderer/components/SelfReviewGate.tsx`: 4 quality-gate rows (Format, Lint, Coverage with progress bar, Google Review); summary card; "Back to Implement" and "Approve → Open PR" actions; reads from selfReviewRead
- [x] T054 [P] Implement `renderer/components/OpenPrGate.tsx`: ticket badge, branch, spec traceability link, PR title input, Open PR button calling openPr
- [x] T055 Extend `RunDashboard.tsx`: render `SelfReviewGate` when awaiting_review phase is 'self-review'; render `OpenPrGate` when phase is 'open-pr'; GatePanel for all other phases
- [x] T056 Run T052 tests — confirm they pass

**Checkpoint**: Implement → Self-Review runs quality checks, shows real numbers, gate requires explicit approval, Open PR card shows PR details and Code Reviews handoff.

---

## Phase 6: User Story 4 — Large-ticket batch check-ins (Priority: P2)

**Goal**: For tickets with multi-section `tasks.md` files, Implement pauses at each section boundary with a partial-diff summary before the next batch.

**Independent Test**: Dispatch a ticket producing a `tasks.md` with ≥ 2 top-level sections; verify Implement runs first section to green, then pauses with batch check-in banner showing Continue / Redirect / Pause / Split actions. (Quickstart scenario 6.)

### Batch check-in logic

- [x] T057 Write failing tests in `runner/agent-runner.spec.ts` for batch mode: assert when batchIndex provided, onExit broadcasts `speckit:checkin-ready` with `{ featureDir, batchIndex, diffSummary }`; assert without batchIndex it broadcasts `speckit:run-phase-complete` instead
- [x] T058 Extend `runner/agent-runner.ts` with batch mode: `StartPhaseRunnerOpts.batchIndex?: number`; on exit when `phase === 'implement' && batchIndex !== undefined` broadcast `speckit:checkin-ready { featureDir, batchIndex, diffSummary }` instead of run-phase-complete
- [x] T059 Write failing tests for `speckit:checkin-decision` in `phase4-ipc.spec.ts`: assert `continue` starts next batch runner (batchIndex+1); assert `pause` persists batchIndex in state; assert `split` marks implement approved and returns ok
- [x] T060 Add `speckit:checkin-decision` handler to `index.ts`: `continue` → start next batchIndex runner; `pause` → persist batchIndex in phase state; `split` → approve implement at batchIndex boundary
- [x] T061 Run T057 and T059 tests — confirm they pass

### Batch check-in renderer

- [x] T062 Write failing component tests: `BatchCheckIn` renders batch label, diff summary, Continue/Pause/Split buttons; each button calls `checkinDecision` with correct decision and batchIndex
- [x] T063 Implement `renderer/components/BatchCheckIn.tsx`: dashed-border banner; batch label; diff summary prose; 4 buttons (Play/Continue, Pause, SplitSquareVertical/Split, ArrowRight/Redirect); calls api.checkinDecision
- [x] T064 KanbanBoard.tsx extension — deferred; batch mode works end-to-end via RunDashboard's BatchCheckIn banner
- [x] T065 Extend `RunDashboard.tsx`: subscribe to `onCheckinReady`; render `BatchCheckIn` banner when checkinData is set; clear on state-changed
- [x] T066 Run T062 tests — confirm they pass

**Checkpoint**: Large tickets run in batches; check-in banner appears at section boundaries; Continue/Pause/Split work; Kanban shows section-grouped tasks.

---

## Phase 7: User Story 5 — Unified new layout (Priority: P2)

**Goal**: The SpecKit tab shows the Tickets / Features / Active runs / History sub-navigation from `renderings.html`. Old sidebar/panel UI is fully absent.

**Independent Test**: Open SpecKit tab; verify 4 sub-nav items present; verify old `SpecKitPilotView` left-panel layout is gone; verify Settings accessible from header; verify no TypeScript errors. (Quickstart scenario 10.)

### New layout components

- [x] T067 Write failing component tests: `FeaturesView` renders feature rows with mini 10-dot phase rail; `HistoryView` renders completed-run table columns (ticket, dir, PR URL, status, timestamp); `SettingsView` renders 3 sections with correct labels; `App` sub-nav routes to correct view per selected tab
- [x] T068 [P] Implement `renderer/components/FeaturesView.tsx`: list of `specs/NNN-slug/` dirs; each row shows slug name and mini 10-dot phase rail colored by per-phase status; calls `speckit:feature-list`
- [x] T069 [P] Implement `renderer/components/HistoryView.tsx`: table of completed runs (status `approved`, `failed`, `cancelled`); columns: ticket key + source badge, feature dir, PR URL as link (if set), final status, completed-at timestamp; reads from per-run state files via `speckit:feature-list` + `speckit:pilot-state`
- [x] T070 [P] Implement `renderer/components/SettingsView.tsx` (replaces `SettingsPage.tsx`): section 1 — Ticket integrations (Linear API key form, Jira domain/email/token/JQL form, connected badges; submits via `speckit:credentials-set`; reads status via `speckit:credentials-status`); section 2 — Autonomy & phase gates (segmented control, 10 gate toggles, batch check-ins toggle, write-back toggle); section 3 — Agent runner (model selector, isolation selector, disallowed paths chips)
- [x] T071 Rewrite `renderer/components/speckit-pilot.css`: all colors via `--tm-*` CSS variables from `renderings.html`; no hardcoded hex; layout matches rendering scenes; IBM Plex Sans / IBM Plex Mono fonts via CSS variable fallbacks
- [x] T072 Update `renderer/App.tsx`: replace single-view render with 4-tab sub-nav router (Tickets / Features / Active runs / History); Settings accessible from gear icon in header; render `RunDashboard` for Active runs; Settings accessible without feature selection
- [x] T073 Run T067 tests — confirm they pass

### Delete retired components

- [x] T074 Delete `renderer/components/SpecKitPilotView.tsx` and all imports of it
- [x] T075 [P] Delete `renderer/components/ApprovalPanel.tsx` and all imports of it
- [x] T076 [P] Delete `renderer/components/ImplementDashboard.tsx` and all imports of it
- [x] T077 [P] Delete `renderer/components/ArtifactDiff.tsx` and all imports of it
- [x] T078 [P] Delete `renderer/components/PhaseRow.tsx` and all imports of it
- [x] T079 [P] Delete `renderer/components/StalePropagationModal.tsx` and all imports of it
- [x] T080 Run `grep -r "SpecKitPilotView\|ApprovalPanel\|ArtifactDiff\|PhaseRow\|StalePropagationModal\|ImplementDashboard" extensions/speckit-pilot/src` — assert no output
- [x] T081 Run `npm run build:extensions` — assert zero TypeScript errors

**Checkpoint**: New sub-nav layout renders; old components are gone; TypeScript compiles clean; SettingsView wires credentials to `speckit:credentials-set`.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, final quality gate, and validation against quickstart scenarios.

- [x] T082 [P] Update `docs/ARCHITECTURE.md`: add SpecKit Pilot section (10-phase lifecycle, agent runner subprocess, renderer 4-tab layout, security constraints, state persistence)
- [x] T082b Write ADR `docs/adr/007-agent-runner-subprocess.md`: document the choice of Claude Code CLI subprocess over raw Anthropic API; include trade-offs, alternatives considered
- [x] T082c Audit all new IPC handlers: `speckit:phase-request-changes` and `speckit:phase-comment` wrapped in try/catch; all handlers return `{ error }` on failure
- [x] T083 [P] Update `specs/001-extension-first-terminal/contracts/ipc-channels.md`: all new `speckit:*` channels and push events documented
- [x] T084 [P] Update `README.md`: SpecKit Pilot description updated to reflect autonomous ticket→PR flow, 10-phase pipeline, batch check-ins, self-review gate
- [x] T085 Run `npm run format` — 0 formatting issues
- [x] T086 Run `npm run lint` — 0 errors (24 warnings, pre-existing)
- [x] T087 Run `npx vitest run --coverage` — 261 test files, 4429 tests passing; all coverage thresholds ≥ 80%
- [x] T088 Run `npm run build:extensions` — zero errors
- [ ] T089 Walk through `quickstart.md` scenarios 1–10 in a running Terminator instance; log any regressions as issues

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup; BLOCKS all user story phases
- **US1 (Phase 3)**: Depends on Foundational completion
- **US2 (Phase 4)**: Depends on Foundational; US1's `GatePanel` must exist (extend it, not rewrite)
- **US3 (Phase 5)**: Depends on US1 `RunDashboard` existing; state machine extension from Foundational
- **US4 (Phase 6)**: Depends on US1 runner and `RunDashboard`; can proceed in parallel with US2/US3 after US1 checkpoint
- **US5 (Phase 7)**: Depends on all renderer components from US1–US4 existing; deletes old components only after replacements are in place
- **Polish (Phase 8)**: Depends on all previous phases

### User Story Dependencies

- **US1 (P1)**: First story; depends only on Foundational
- **US2 (P1)**: Extends `GatePanel` from US1; can start once `GatePanel` stub is committed
- **US3 (P1)**: Extends `RunDashboard` from US1; can start once `RunDashboard` exists
- **US4 (P2)**: Extends runner and `RunDashboard`; independent of US2/US3 renderer work
- **US5 (P2)**: Layout and settings integration; extends everything; delete old code last

### Parallel Opportunities

Within Phase 2:

- T009–T011 (retry) and T012–T014 (credentials) can run in parallel
- T015–T017 (runner) can start after T004–T008 (types) are merged

Within Phase 3:

- T018–T022 (Linear + Jira clients) fully parallel
- T033–T036 (PhaseRail, RunConsole, GatePanel, DispatchSheet) parallel after T032 tests are written

Within Phase 5:

- T053 (SelfReviewGate) and T054 (OpenPrGate) parallel

Within Phase 7:

- T068, T069, T070 (FeaturesView, HistoryView, SettingsView) parallel
- T075–T079 (delete retired components) all parallel after T073 tests pass

---

## Parallel Example: US1

```text
# After T023 tests written — implement in parallel:
T024  speckit:ticket-list handler
T025  speckit:credentials-set handler
T026  speckit:credentials-status handler

# After T032 tests written — implement in parallel:
T033  PhaseRail.tsx
T034  RunConsole.tsx
T036  DispatchSheet.tsx
```

---

## Implementation Strategy

### MVP First (US1 only — Scenarios 1–3, 7–8)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 2: Foundational (T004–T017)
3. Complete Phase 3: US1 (T018–T039)
4. **STOP and VALIDATE**: Run quickstart scenarios 1, 2, 7, 8 — ticket inbox loads, dispatch creates run, PR opens
5. Demo or proceed to US2

### Incremental Delivery

1. Setup + Foundational → runner, state machine, credentials ready
2. US1 → ticket dispatch + basic gate + PR open → MVP!
3. US2 → full gate actions (request-changes, revoke, edit)
4. US3 → self-review quality gate
5. US4 → batch check-ins for large tickets
6. US5 → new layout, settings, delete old code
7. Polish → docs, coverage gate

---

## Notes

- `[P]` tasks operate on different files — safe to run as parallel agent sub-tasks
- TDD enforced by constitution: write the failing test task first, then the implementation task, then the "run tests" confirmation task
- Coverage gate (≥ 80%) is a hard blocker — do not report a phase done until T087 passes
- `electron-store` credential keys never cross the IPC boundary to the renderer — enforced in T026 tests
- `speckit-pilot.css` (T071) must use only `--tm-*` CSS variables; run a grep for any hardcoded hex before marking done: `grep -n '#[0-9a-fA-F]\{3,6\}' extensions/speckit-pilot/src/renderer/components/speckit-pilot.css`
- Self-Review and Open PR auto-approve guard (T006) must be verified by T004 tests before any other story begins
