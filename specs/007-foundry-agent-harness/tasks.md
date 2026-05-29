---
description: 'Task list for Foundry — Agentic Harness Extension'
---

# Tasks: Foundry — Agentic Harness Extension

**Input**: Design documents from `specs/007-foundry-agent-harness/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: TDD is NON-NEGOTIABLE per Constitution Principle VI. Every test task must be written first and confirmed FAILING before the companion implementation task begins. Red → Green → Refactor without exception.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing. 7 user stories + 1 foundational phase + 1 polish phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other [P] tasks in the same phase (different files, no shared state)
- **[Story]**: Which user story this task belongs to (US1–US7)
- Exact file paths are included in every task description

---

## Phase 1: Setup (Extension Scaffold)

**Purpose**: Create the `extensions/foundry/` directory structure and configuration files so the extension can be loaded by the core app.

- [x] T001 Create `extensions/foundry/` directory tree matching the plan: `src/types/`, `src/core/`, `src/providers/`, `src/components/`, `src/state/`, `tests/unit/core/`, `tests/unit/providers/`, `tests/unit/state/`, `tests/unit/components/`, `tests/integration/`, `coverage/`
- [x] T002 Create `extensions/foundry/manifest.json` with id `terminator.foundry`, version `0.1.0`, main `src/index.js`, minAppVersion `0.1.0`
- [x] T003 [P] Create `extensions/foundry/package.json` with pinned dependencies: `@xyflow/react`, `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`, `diff`, `react@18.3.1`, `react-dom@18.3.1`, `zod@3.23.8`, `zustand@4.5.5`
- [x] T004 [P] Create `extensions/foundry/CLAUDE.md` documenting isolation rules, IPC patterns (`extensionBridge.invoke`), what the extension may/must-not do, and dev workflow (matching the pattern in `extensions/speckit-pilot/CLAUDE.md`)

**Checkpoint**: `extensions/foundry/` scaffold is present and manifest is valid.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Domain types, core utilities, provider interface, and state stores. All user stories depend on this phase.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Types

- [x] T005 [P] Create `extensions/foundry/src/types/foundry.types.ts` with all domain types from data-model.md: `Harness`, `Sensor`, `SensorResult`, `Provider`, `ProviderType`, `ProviderRef`, `Run`, `RunMode`, `RunStatus`, `Iteration`, `Gate`, `GateDecision`, `FileChange`, `FileChangeStatus`, `SubAgent`, `SubAgentStatus`, `HistoryEntry`, `GateDecisionSummary`, `CopilotMessage`, `HarnessHealthEvent`, `HealthEventKind`
- [x] T006 [P] Create `extensions/foundry/src/types/ipc.types.ts` with typed payload and response shapes for all 28 IPC channels defined in `contracts/ipc-channels.md`

### Core Utilities (TDD — write test first, confirm FAIL, then implement)

- [x] T007 [P] Write failing tests in `extensions/foundry/tests/unit/core/harness.spec.ts`: read harness.json from disk, write harness.json atomically, return `notFound` when file absent, validate no secret fields
- [x] T008 [P] Implement `extensions/foundry/src/core/harness.ts`: `readHarness(workspaceRoot)`, `writeHarness(workspaceRoot, harness)` — atomic tmp-file write, Zod schema validation, no secrets in output
- [x] T009 [P] Write failing tests in `extensions/foundry/tests/unit/core/history.spec.ts`: append JSONL line, read N entries from end, paginate with offset+limit, return `hasMore`, parse malformed lines gracefully
- [x] T010 [P] Implement `extensions/foundry/src/core/history.ts`: `appendHistoryEntry(workspaceRoot, entry)`, `readHistory(workspaceRoot, offset, limit)` returning `{ entries, total, hasMore }`
- [x] T011 [P] Write failing tests in `extensions/foundry/tests/unit/core/git.spec.ts`: dirty-tree returns modified files, checkpoint creates commit with correct message, revert-files runs `git checkout --`, diff-file returns unified patch with line counts
- [x] T012 [P] Implement `extensions/foundry/src/core/git.ts`: `getStatus(workspaceRoot)`, `createCheckpoint(workspaceRoot, runId)`, `stashChanges(workspaceRoot)`, `revertFiles(workspaceRoot, filePaths)`, `getDiffForFile(workspaceRoot, filePath)` — all via `child_process.execFile`
- [x] T013 [P] Write failing tests in `extensions/foundry/tests/unit/core/sensors.spec.ts`: passing command returns `{ pass: true, exitCode: 0 }`, failing command returns `{ pass: false, exitCode: N }`, captures last-20-lines of stderr, measures duration
- [x] T014 [P] Implement `extensions/foundry/src/core/sensors.ts`: `runSensor(sensor, workspaceRoot)` → `SensorResult`, `runAllSensors(harness, workspaceRoot)` → `SensorResult[]` — uses `child_process.spawn` with piped stdio
- [x] T015 [P] Write failing tests in `extensions/foundry/tests/unit/core/keychain.spec.ts`: encrypt+decrypt round-trip, `isAvailable()` returns boolean, `storeKey(id, plaintext)` and `retrieveKey(id)` operations, `deleteKey(id)` removes entry
- [x] T016 [P] Implement `extensions/foundry/src/core/keychain.ts`: `isAvailable()`, `storeKey(keyId, plaintext, workspaceRoot)`, `retrieveKey(keyId, workspaceRoot)`, `deleteKey(keyId, workspaceRoot)` — uses `electron.safeStorage`, encrypted blobs stored as base64 in `.foundry/keychain.enc`
- [x] T017 [P] Write failing tests in `extensions/foundry/tests/unit/core/dag.spec.ts`: cycle detection (Kahn's algorithm) returns affected node IDs, topological sort produces correct tier layers for parallel execution, single-node DAG valid, 8-node valid DAG with parallelism
- [x] T018 [P] Implement `extensions/foundry/src/core/dag.ts`: `validateDag(subAgents)` → `{ valid: true } | { valid: false; cycleNodes: string[] }`, `topoSort(subAgents)` → `string[][]` (parallel tiers)

### Provider Interface

- [x] T019 [P] Write failing tests in `extensions/foundry/tests/unit/providers/adapter.spec.ts`: `RunRequest` has required fields, `RunEvent` discriminated union covers `token | file-changed | done | error`, streaming and process-tail modes conform to `AsyncIterable<RunEvent>`
- [x] T020 [P] Implement `extensions/foundry/src/providers/adapter.ts`: `ProviderAdapter` interface with `run(request: RunRequest): AsyncIterable<RunEvent>`, `testConnection(): Promise<{ ok: boolean; latencyMs: number }>`, `supportsStreaming: boolean`; export `RunRequest`, `RunEvent` types

### State Stores

- [x] T021 [P] Write failing tests in `extensions/foundry/tests/unit/state/foundry.store.spec.ts`: store initializes with empty runs, `addRun`/`updateRun`/`removeRun` actions, `activeRunId` setter, health events accumulate and resolve, `setHarness` updates harness state
- [x] T022 [P] Implement `extensions/foundry/src/state/foundry.store.ts`: Zustand store with slices for `runs: Map<string, Run>`, `activeRunId`, `harness: Harness | null`, `healthEvents: HarnessHealthEvent[]`, `providers: Provider[]`
- [x] T023 [P] Write failing tests in `extensions/foundry/tests/unit/state/copilot.store.spec.ts`: `appendMessage`, `addFileChange`, `removeFileChange`, `clearFiles`, `resetConversation`
- [x] T024 [P] Implement `extensions/foundry/src/state/copilot.store.ts`: Zustand store with `messages: CopilotMessage[]`, `pendingFiles: Map<string, FileChange>`, `isStreaming: boolean`

### Main Process & Renderer Skeleton

- [x] T025 Implement `extensions/foundry/src/index.ts` skeleton: `activate(api)` registers all IPC handlers (stub implementations returning `{ error: 'not implemented' }`), `deactivate()` disposes all disposables — establishes the full channel list from `contracts/ipc-channels.md`; also initialises in-memory health-event accumulator (consecutive sensor-failure + gate-rejection counters) that will be populated in Phase 9
- [x] T026 Implement `extensions/foundry/src/renderer.tsx` skeleton: registers Foundry right-sidebar panel (`api.panels.registerPanel`), History global tab (`api.panels.registerGlobalTab`), top-bar item (`api.topBar.addItem`), all 5 commands (`api.commands.register`), 2 keyboard shortcuts (`api.keyboard.register`), sidebar rail icon (`api.sidebar.registerItem`), settings schema (`api.settings.register`)

**Checkpoint**: All core utilities tested, provider interface typed, stores functional. `npm run build:extensions` passes. Extension loads in Terminator (all IPC stubs respond without crashing).

---

## Phase 3: User Story 1 — Harness Setup Wizard (Priority: P1) 🎯 MVP Start

**Goal**: Developer can open Foundry in a fresh repo, complete the 5-step setup wizard, and have `.foundry/harness.json` + `AGENTS.md` written to disk.

**Independent Test**: Open a fresh repo, open Foundry, complete wizard (TypeScript template → edit AGENTS.md → add `npm run lint` sensor → verify ✓ health check → select Claude → Done). Confirm `.foundry/harness.json` exists with sensors array and no API key. Confirm `AGENTS.md` exists at workspace root. Confirm sidebar shows "Harness ready — 1 sensor active."

### Tests for User Story 1

- [x] T027 [P] [US1] Write failing tests in `extensions/foundry/tests/unit/core/harness.spec.ts` (additions): `detectHarnessSetupRequired` returns true when no AGENTS.md, returns false when AGENTS.md exists
- [x] T028 [P] [US1] Write failing component tests in `extensions/foundry/tests/unit/components/HarnessSetupWizard.spec.tsx`: wizard step progression (template → AGENTS.md editor → sensors → provider → done), template selection populates editor, sensor health check triggers `foundry:sensor-run` IPC and shows pass/fail badge, wizard completion triggers `foundry:harness-write` + `foundry:agents-md-write` IPC calls

### Implementation for User Story 1

- [x] T029 [US1] Implement `extensions/foundry/src/components/FoundryPanel.tsx`: sidebar panel with harness status bar ("Harness ready — N sensors active" / health alerts), run list area (active run cards + recent run cards per Screen 1), "new run" dashed button, first-run banner when `agentsMdPath` absent ("Set up harness" CTA blocks access to run features)
- [ ] T030 [US1] Implement `extensions/foundry/src/components/HarnessSetupWizard.tsx`: 5-step wizard (template → agents.md → sensors → provider → done) per Screen 8; template picker (General/TypeScript-Node/Python/Blank); AGENTS.md editor with syntax highlighting using core CSS token colors; sensors inline health-check runner showing pass ✓ / fail ✗ badge per input; provider radio selection; footer with back/next/done; warns but does not block on failing sensor
- [x] T031 [US1] Wire harness IPC handlers in `extensions/foundry/src/index.ts`: `foundry:harness-read`, `foundry:harness-write`, `foundry:agents-md-read`, `foundry:agents-md-write`, `foundry:agents-md-scan` — replace stubs with real implementations using `harness.ts`, `git.ts`, `fs`
- [x] T032 [US1] Wire sensor health-check IPC in `extensions/foundry/src/index.ts`: `foundry:sensor-run` replaces stub with real `sensors.runSensor()` call
- [x] T033 [US1] Connect `HarnessSetupWizard` into `extensions/foundry/src/components/FoundryPanel.tsx`: when `firstRun` state is true, replace run list with wizard; on wizard completion, set `firstRun = false`, re-read harness, update status bar
- [ ] T034 [US1] Create `extensions/foundry/src/components/foundry.css`: extension-scoped styles using `var(--bg)`, `var(--surface)`, `var(--accent)`, etc. — no new color values. Status badge classes, harness status bar, run card, wizard step indicator, sensor health badge.

**Checkpoint**: US1 fully functional. Setup wizard writes correct files. Status bar reflects sensor count. All US1 tests pass. Coverage ≥ 80% on all new files.

---

## Phase 4: User Story 2 — Provider Configuration (Priority: P1)

**Goal**: Developer can add Claude, OpenAI, Gemini, and Ollama providers. API keys stored in OS keychain. Workspace can override default provider. "Test connection" shows pass/fail within 5 seconds.

**Independent Test**: Add Claude provider with API key → verify key absent from `.foundry/harness.json` → add Ollama (localhost:11434) → "Test connection" on each → pass/fail shown within 5s → switch active workspace provider to Ollama.

### Tests for User Story 2

- [x] T035 [P] [US2] Write failing tests in `extensions/foundry/tests/unit/providers/claude.spec.ts`: adapter implements `ProviderAdapter`, streaming yields `RunEvent` tokens, `testConnection()` returns `{ ok, latencyMs }`, handles auth error gracefully
- [x] T036 [P] [US2] Write failing tests in `extensions/foundry/tests/unit/providers/openai.spec.ts`: same contract as claude.spec.ts using OpenAI SDK mocks
- [x] T037 [P] [US2] Write failing tests in `extensions/foundry/tests/unit/providers/gemini.spec.ts`: same contract using Google AI SDK mocks
- [x] T038 [P] [US2] Write failing tests in `extensions/foundry/tests/unit/providers/ollama.spec.ts`: process-tail adapter emits stdout chunks as `token` events, `supportsStreaming: false`, `testConnection()` checks fetch to `/api/tags`, handles "not reachable" gracefully with descriptive error message

### Implementation for User Story 2

- [x] T039 [P] [US2] Implement `extensions/foundry/src/providers/claude.ts`: `ClaudeAdapter` implementing `ProviderAdapter`; uses `@anthropic-ai/sdk` streaming (`messages.stream`); yields `RunEvent` tokens; `testConnection()` calls `/v1/models`; retrieves API key via `keychain.retrieveKey()`
- [x] T040 [P] [US2] Implement `extensions/foundry/src/providers/openai.ts`: `OpenAIAdapter` using `openai` SDK streaming; same interface as `ClaudeAdapter`
- [x] T041 [P] [US2] Implement `extensions/foundry/src/providers/gemini.ts`: `GeminiAdapter` using `@google/generative-ai` streaming; same interface
- [x] T042 [P] [US2] Implement `extensions/foundry/src/providers/ollama.ts`: `OllamaAdapter`; `supportsStreaming: false`; spawns child process for CLI mode or uses `fetch` to `/api/generate` with `stream: true`; `testConnection()` fetches `/api/tags`; descriptive error when Ollama unreachable ("Ollama not reachable at localhost:11434")
- [x] T043 [US2] Wire provider IPC handlers in `extensions/foundry/src/index.ts`: `foundry:provider-list`, `foundry:provider-save` (checks `keychain.isAvailable()` first — if false returns `{ error: 'OS encryption unavailable' }`; otherwise encrypts `apiKey` via `keychain.storeKey` then strips it), `foundry:provider-delete` (removes keychain entry), `foundry:provider-test` (instantiates correct adapter, calls `testConnection()`, enforces 5s timeout)
- [ ] T044 [US2] Implement provider section of `extensions/foundry/src/components/HarnessSettings.tsx`: settings nav sidebar (Sensors / AGENTS.md / Gates / Providers / Run history per Screen 6); Providers section with provider cards (name, model, test connection button, edit, delete); "Add provider" flow (type picker → API key input → save); "key stored in keychain ✓" masked display; provider-level Ollama endpoint input; if `foundry:provider-save` returns `{ error: 'OS encryption unavailable' }`, show toast "OS encryption unavailable — API key providers disabled on this system" and disable the Save button for key-requiring providers

**Checkpoint**: US2 fully functional. All four provider adapters work. Keys stored in keychain (absent from harness.json). Test-connection reports within 5s. All US2 tests pass.

---

## Phase 5: User Story 3 — Spec-to-Code Run (Priority: P1) 🎯 MVP Complete

**Goal**: Developer can launch a Spec-to-Code run from a spec file, watch live agent output, review the gate (diff + sensors), and approve/request-changes/reject. Run history is written to `.foundry/history.jsonl`.

**Independent Test**: Create a `feature.md` spec. Launch Spec-to-Code run (spec-to-code mode, Claude). Observe: git checkpoint logged, agent output streams live, sensors run automatically on completion, gate panel opens with diff + sensor results. Approve → run marked "done", history entry written with token counts + gate decision.

### Tests for User Story 3

- [x] T045 [P] [US3] Write failing tests in `extensions/foundry/tests/unit/core/run-engine.spec.ts`: `createRun` returns Run with UUID and `running` status, dirty-tree check blocks run when `requireCleanWorkingTree: true`, checkpoint commit called before dispatch, file-change accumulation from `fs.watch` events, gate creation after agent completion, `requestChanges` prepends `[FEEDBACK]:` prefix, `reject` calls git-revert-files and completes within 2000ms (SC-005 timing assertion), `approve` writes history entry, iteration-limit warning at max; concurrent-run guard: second `createRun` for same workspace returns `{ error: 'A run is already active in this workspace' }` when a run is in `running` or `gate` status
- [ ] T046 [P] [US3] Write failing component tests in `extensions/foundry/tests/unit/components/DiffViewer.spec.tsx`: renders unified diff hunks with correct add/del/ctx CSS classes, shows `+N / -M` line counts, renders empty-diff state ("No files changed")
- [ ] T047 [P] [US3] Write failing component tests in `extensions/foundry/tests/unit/components/GatePanel.spec.tsx`: renders file list with new(+)/modified(~) badges, clicking file row updates diff viewer, sensor footer shows pass ✓ / fail ✗ per sensor, Approve/Request Changes/Reject buttons present and fire correct IPC calls
- [ ] T048 [P] [US3] Write failing component tests in `extensions/foundry/tests/unit/components/NewRunWizard.spec.tsx`: mode card selection (Spec-to-code/Orchestrate/Co-pilot), provider pill selection, spec file input, context auto-detection shows AGENTS.md + harness.json badges, back/next/launch navigation

### Implementation for User Story 3

- [x] T049 [US3] Implement `extensions/foundry/src/core/run-engine.ts` for Spec-to-Code mode: `createSpecToCodeRun(params)` → creates Run record, checks dirty tree, creates git checkpoint, dispatches to provider adapter, accumulates file changes via `api.fs.watch`, runs sensors on completion, opens gate, processes gate decision (approve/request-changes/reject), enforces iteration limit, writes `HistoryEntry` on done/rejected/aborted; broadcasts `foundry:run-event` push events
- [ ] T050 [US3] Implement `extensions/foundry/src/components/DiffViewer.tsx`: renders unified diff string as syntax-highlighted hunks (`diff-add`/`diff-del`/`diff-ctx`/`diff-hunk` classes per Screen 3); shows per-file `+N / -M` counts; empty-diff state
- [ ] T051 [US3] Implement `extensions/foundry/src/components/NewRunWizard.tsx`: 3-step wizard (mode cards → configure → review+launch) per Screen 2; mode cards (Spec-to-code/Orchestrate/Co-pilot with icons and descriptions); provider pills + model select; spec file path input with browse; max-iterations number input; auto-detected context row (AGENTS.md feedforward badge + harness sensors badge)
- [x] T052 [US3] Implement `extensions/foundry/src/components/RunConsole.tsx`: live agent output console (c-system/c-agent/c-file/c-sensor/c-ok CSS classes per Screen 3); changed-files list with new(+)/modified(~) status badges and line count deltas; abort button; copy button
- [ ] T053 [US3] Implement `extensions/foundry/src/components/GatePanel.tsx`: split layout (console left, diff right) per Screen 3; file list selector; `DiffViewer` for selected file; sensor results footer (sensor name + pass/fail icon); Approve/Request Changes (requires note textarea)/Reject & Reset buttons; iteration counter badge (iter N/M)
- [x] T054 [US3] Wire all remaining run IPC handlers in `extensions/foundry/src/index.ts`: `foundry:run-create` (validates harness, checks for existing active run in workspace — returns `{ error: 'A run is already active in this workspace' }` if one exists in `running` or `gate` status, then selects adapter, invokes `run-engine`), `foundry:run-gate-decide`, `foundry:run-abort`, `foundry:run-list`, `foundry:run-switch-provider`; wire git IPC: `foundry:git-status`, `foundry:git-checkpoint`, `foundry:git-stash`, `foundry:git-revert-files`, `foundry:git-diff-file`; wire `foundry:sensors-run-all`
- [x] T055 [US3] Wire run console launch in `extensions/foundry/src/renderer.tsx` and `extensions/foundry/src/components/FoundryPanel.tsx`: clicking a run card or the "new run" button opens the run console via `api.window.openAuxiliary('foundry-run', { runId })` (a dedicated auxiliary window renders `RunConsole` + `GatePanel`); the top-bar "Start Foundry Run" button triggers `NewRunWizard`, which on launch calls `openAuxiliary`; note: `'project-tab'` is not a valid `PanelSlot` — do NOT use `api.panels.registerPanel` for the run console
- [ ] T056 [US3] Implement sensors section of `extensions/foundry/src/components/HarnessSettings.tsx`: sensor cards (name, command display, passing/failing badge, edit button, run button, consecutive-failure alert per Screen 6); "add sensor" dashed button; gate defaults section (toggles: require gate/sensors-must-pass/auto-checkpoint/require-clean-tree + max-iterations input)
- [x] T057 [US3] Integration test in `extensions/foundry/tests/integration/run-lifecycle.spec.ts`: full spec-to-code cycle with mocked Claude adapter (yields 3 token events + 2 file-change events + done event); verifies checkpoint commit, sensor execution, gate state, approve → history entry written with ALL required fields from FR-038 (runId, mode, provider, model, specPath, tokenCountIn, tokenCountOut, sensorSummary, gateDecisions, filesChangedCount, durationMs, createdAt, completedAt); verifies `activate()` completes within 1000ms (SC-009 load-time assertion)

**Checkpoint**: US3 fully functional. Spec-to-Code run completes end-to-end. Gate panel shows diff + sensor results. Approve/reject work. History entry written. All tests pass. Coverage ≥ 80% on all new files.

---

## Phase 6: User Story 4 — Multi-Agent Orchestration (Priority: P2)

**Goal**: Developer can enter a task, receive a proposed DAG, edit it interactively (drag nodes, draw edges), launch, and see parallel agents run simultaneously with per-sub-agent gates.

**Independent Test**: Task: "Build a REST API with tests and OpenAPI docs." → Foundry proposes 3+ sub-agents → Add a docs agent node in the DAG → connect dependency edge → launch → verify parallel-eligible agents run simultaneously → each sub-agent gate approves → merged history entry written.

### Tests for User Story 4

- [ ] T058 [P] [US4] Write failing tests for `extensions/foundry/tests/unit/core/dag.spec.ts` (additions): `computeParallelTiers` returns correct tier grouping for 5-node DAG, drag-node position update preserved, edge removal breaks dependency correctly
- [ ] T059 [P] [US4] Write failing component tests in `extensions/foundry/tests/unit/components/DagGraph.spec.tsx`: React Flow renders correct node count, node status colors (green=done/accent=running/border=waiting/amber=gate), edge drawing triggers `onEdgesChange`, double-click fires `onNodeRename`, cycle-edge highlighted red
- [ ] T060 [P] [US4] Write failing component tests in `extensions/foundry/tests/unit/components/OrchestrationView.spec.tsx`: sub-agent list reflects DAG state, selecting list item highlights DAG node, progress bar updates with done/total count, "abort all" and "full log" buttons present

### Implementation for User Story 4

- [ ] T061 [P] [US4] Implement `extensions/foundry/src/components/DagGraph.tsx`: React Flow (`@xyflow/react`) interactive DAG per Screen 4; custom node components with status color coding (green=done, accent=running, amber=gate, faint-border=waiting, dashed-border=pending); edge drawing via connection handles; double-click node → inline rename; cycle detection on `onConnect` → highlight red + block launch; `MiniMap` and `Controls` optional
- [ ] T062 [US4] Implement `extensions/foundry/src/components/OrchestrationView.tsx`: split layout (DAG pane left, sub-agent list right) per Screen 4; sub-agent list items with number badge, role name, status badge, token/time meta; progress bar (N/total done); "abort all" + "full log" buttons; footer with progress; gate panel overlay on sub-agent gate open
- [ ] T063 [US4] Extend `extensions/foundry/src/core/run-engine.ts` with orchestrate mode: `createOrchestrationRun(params)` accepts confirmed `SubAgent[]` DAG; uses `dag.topoSort()` to compute parallel tiers; dispatches parallel-eligible sub-agents concurrently; chains approved sub-agent output as input to downstream agents; resets only rejected sub-agent + transitive downstream on `reject-replan`; writes merged `HistoryEntry` linking all sub-agent run IDs
- [x] T064 [US4] Wire orchestrate IPC handlers in `extensions/foundry/src/index.ts`: `foundry:orchestrate-plan` (calls configured provider with task description, parses proposed DAG), `foundry:dag-validate` (calls `dag.validateDag()`)

**Checkpoint**: US4 fully functional. Interactive DAG works (drag, edge draw, rename). Parallel agents run simultaneously. Sub-agent gates work independently. Downstream reset on reject. All tests pass.

---

## Phase 7: User Story 5 — Co-pilot Mode (Priority: P2)

**Goal**: Developer can have a continuous conversation with the agent. Live diff panel updates as agent modifies files. Per-file revert and full abort work without interrupting the conversation.

**Independent Test**: Open Co-pilot (Claude provider required). Type "Add error handling to auth middleware." → agent responds and modifies file → diff panel shows change → "Revert" on specific file → only that file restored → follow-up message → agent receives full conversation history.

### Tests for User Story 5

- [x] T065 [P] [US5] Write failing tests in `extensions/foundry/tests/unit/core/copilot-ipc.spec.ts`: tests mock `index.ts` IPC handler dispatch; `copilot-send` validates provider `supportsStreaming: true` (rejects Ollama/custom with clear error), dispatches with full `CopilotMessage[]` conversation history + AGENTS.md content as system context, accumulates new file changes; `copilot-revert-file` calls `git.revertFiles` for single file; `copilot-abort` reverts all `filesModifiedThisTurn`; `copilot-accept-all` clears pending files; session-close event (via `api.terminal.onSessionClose`) triggers `copilot.store.resetConversation()`
- [ ] T066 [P] [US5] Write failing component tests in `extensions/foundry/tests/unit/components/CopilotView.spec.tsx`: user message bubble aligns right with accent bg, agent message bubble aligns left with surface bg, file mentions render as teal inline chips, send dispatches `foundry:copilot-send`, diff panel shows per-file tabs with revert button, "accept all" + "abort" buttons present

### Implementation for User Story 5

- [ ] T067 [P] [US5] Implement `extensions/foundry/src/components/CopilotView.tsx`: split layout (chat pane left, live diff pane right) per Screen 5; user messages (accent-bg bubble, right-aligned) and agent messages (surface bg bubble, left-aligned) per CSS spec; file mentions rendered as `<span class="file-mention">` teal chips; `send` button dispatches `foundry:copilot-send`; textarea with `Shift+Enter` newline / `Enter` send; diff pane header ("live diff — N files") with "accept all" + "abort" buttons; per-file tab selector; `DiffViewer` for selected file; per-file "revert" button in diff footer; `+N added / -M removed` stats
- [x] T068 [US5] Wire co-pilot IPC handlers in `extensions/foundry/src/index.ts`: `foundry:copilot-send` (validates `provider.supportsStreaming === true`, assembles `CopilotMessage[]` history + AGENTS.md as system context, streams via `adapter.run()`, broadcasts `foundry:copilot-event` push events, accumulates file changes), `foundry:copilot-revert-file`, `foundry:copilot-accept-all`, `foundry:copilot-abort`; also wire `api.terminal.onSessionClose` to broadcast `foundry:copilot-reset` push event so the renderer's `copilot.store.resetConversation()` is called when the associated project closes (FR-033)
- [x] T069 [US5] Register co-pilot mode within `extensions/foundry/src/components/NewRunWizard.tsx`: when Co-pilot mode selected, validate provider supports streaming (`supportsStreaming: true`); show advisory "CLI-based providers (Ollama, Custom) are not supported in Co-pilot mode" if unsupported provider selected; launch opens `CopilotView` as project tab

**Checkpoint**: US5 fully functional. Co-pilot conversation works. Live diff panel updates. Per-file revert works. Abort reverts all turn files. Ollama/custom providers correctly blocked. All tests pass.

---

## Phase 8: User Story 6 — Run History & Audit (Priority: P3)

**Goal**: Developer can view all workspace runs in reverse chronological order, filter by mode/status/provider/search, click into a run to see gate timeline and sensor output, paginate beyond 200 entries, re-run from history.

**Independent Test**: Complete 3 runs of different modes. Open History tab. Verify all 3 listed in reverse order with correct metadata columns. Filter by "spec-to-code" → only matching entries shown. Select a run → gate timeline visible. Click "Re-run" → NewRunWizard pre-filled.

### Tests for User Story 6

- [ ] T070 [P] [US6] Write failing component tests in `extensions/foundry/tests/unit/components/HistoryView.spec.tsx`: table renders correct columns (run/spec, mode chip, model, tokens, time, status), filter pills update displayed rows, text search filters by name, selected row highlights detail pane, gate timeline entries render with correct decision icons, "re-run" fires IPC pre-fill, "load more" pagination appends rows, compare button fires `foundry:history-compare` IPC and opens inline comparison panel; render of 200-entry mock dataset completes within 500ms (SC-007 timing assertion)

### Implementation for User Story 6

- [x] T071 [US6] Implement `extensions/foundry/src/components/HistoryView.tsx`: global tab view per Screen 7; header with filter pills (all/spec-to-code/orchestrate/co-pilot/failed) + text search input; table with columns (run/spec name, mode chip `mc-stc`/`mc-orc`/`mc-cp`, model, token count, duration, status badge); `tbl-row.selected` highlights detail pane; detail pane with run metadata section (mode, provider, tokens in+out, iterations, sensors, files, date) + gate timeline (`gt-entry` with decision dot, note, timestamp, actor); "view spec" + "re-run" footer buttons; "load more" button when `hasMore: true`; mode chip colors: spec→code=accent, orchestrate=teal, co-pilot=blue; **compare panel** (FR-039): when two rows are selected (checkbox multi-select), a "Compare" button appears; clicking it calls `foundry:history-compare` IPC and renders a side-by-side panel showing the two runs' `promptSummary`, gate decisions, sensor results, and token counts in adjacent columns
- [x] T072 [US6] Wire history IPC handlers in `extensions/foundry/src/index.ts`: `foundry:history-load` (reads from `history.ts` with offset/limit, returns `{ entries, total, hasMore }`), `foundry:history-compare` (reads two entries by runId)
- [x] T073 [US6] Register `HistoryView` as the History global tab in `extensions/foundry/src/renderer.tsx` (replace stub component from Phase 2)

**Checkpoint**: US6 fully functional. History tab loads, filters, paginates. Gate timeline visible. Re-run works. All tests pass.

---

## Phase 9: User Story 7 — Harness Health & Drift Detection (Priority: P3)

**Goal**: Foundry alerts the developer when sensors fail 3× consecutively, when the same gate is rejected 3× consecutively, or when AGENTS.md references files that no longer exist. Developer can take corrective action from the alert.

**Independent Test**: Break a sensor command → run 3 times → "Sensor failing" warning appears with sensor name + "Edit sensor" action. Reject the same spec 3 gates in a row → "Feedforward gap detected" advisory. Add a stale file reference to AGENTS.md → reopen workspace → "Stale reference" warning with line number + "Remove reference" fix.

### Tests for User Story 7

- [x] T074 [P] [US7] Write failing tests in `extensions/foundry/tests/unit/state/health.spec.ts`: `trackSensorResult` increments consecutive count and emits alert at 3, resets count on pass; `trackGateDecision` increments rejection count per spec+gate and emits alert at 3; `scanAgentsMdRefs` returns stale refs for non-existent paths; alert resolves when corrective action taken

### Implementation for User Story 7

- [x] T075 [US7] Implement health tracking in the **main process** in `extensions/foundry/src/index.ts` (not in the renderer store — sensors and gate decisions are processed in the main process): add in-memory `Map<string, number>` for sensor consecutive failures and a `Map<string, number>` for gate rejections per `specPath+gateIndex`; call `trackSensorResult(sensorName, pass)` after each sensor run in `run-engine.ts` — increments count on fail, resets on pass, adds `HarnessHealthEvent { kind: 'sensor-failure' }` to an in-memory array at count ≥ 3; call `trackGateDecision(specPath, gateIndex, decision)` after each gate decision — increments reject count, adds `{ kind: 'feedforward-gap' }` at count ≥ 3; broadcast `foundry:health-changed` push event after any change to the health array
- [x] T076 [US7] Implement `foundry:agents-md-scan` IPC in `extensions/foundry/src/index.ts` (replace stub): reads AGENTS.md, extracts path references via regex, checks each against `fs.access`, returns `{ staleRefs: [{ line, ref }] }`; called on workspace open event
- [x] T077 [US7] Add health alert display to `extensions/foundry/src/components/FoundryPanel.tsx`: harness status bar shows amber/red indicators when health events exist; each alert renders with kind-specific message + action button ("Edit sensor" / "Open AGENTS.md editor" / "Remove reference"); clicking action navigates to HarnessSettings or AGENTS.md editor; alert dismisses and status bar returns to "Harness ready" when event resolves
- [ ] T077b [P] [US7] Implement AGENTS.md editor section in `extensions/foundry/src/components/HarnessSettings.tsx` (M4 — Screen 6 nav item): add "AGENTS.md" nav item to the settings nav sidebar; the section renders the same editor used in `HarnessSetupWizard.tsx` (extract to a shared `AgentsMdEditor` sub-component); loads content via `foundry:agents-md-read`, saves via `foundry:agents-md-write`; shows line count advisory banner when content exceeds 200 lines; shows stale-reference warnings inline if any are present in the current health events
- [x] T078 [US7] Broadcast `foundry:health-changed` push event from main process in `extensions/foundry/src/index.ts` whenever `healthEvents` array changes; renderer subscribes in `extensions/foundry/src/components/FoundryPanel.tsx` via `extensionBridge.on('foundry:health-changed', ...)`

**Checkpoint**: US7 fully functional. All three health alert types work. Corrective actions resolve alerts. All tests pass.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, coverage verification, isolation audit, final code cleanliness.

- [ ] T079 [P] Update `README.md`: add Foundry to features list with description, add `⌘⇧A` / `⌘⇧R` keyboard shortcuts to shortcuts table, add `@xyflow/react`, `@anthropic-ai/sdk`, `openai`, `@google/generative-ai` to tech stack table with community health links
- [ ] T080 [P] Write three ADR files in `docs/adr/`: ADR for React Flow interactive DAG choice, ADR for provider adapter contract pattern, ADR for safeStorage keychain strategy (content from `research.md` ADR-001/002/003)
- [x] T081 [P] Run `npx vitest run --coverage --project=foundry` and fix any `extensions/foundry/src/**` file with coverage below 80% threshold on statements, branches, functions, or lines
- [x] T082 [P] Run `npm run lint` and fix any lint errors in `extensions/foundry/src/` (unused imports, missing types, etc.)
- [x] T083 [P] Run `npm run build:extensions` — verify `extensions/foundry/src/index.js` compiles without errors or type errors
- [x] T084 Perform isolation audit: temporarily rename `extensions/foundry/` to `extensions/foundry.bak/`, run `npm run build`, confirm zero errors in core app and all other extensions. Rename back. If any error found, fix the isolation violation before marking done.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user story phases
- **Phase 3 (US1 — Harness Setup)**: Depends on Phase 2 only
- **Phase 4 (US2 — Providers)**: Depends on Phase 2 only; can run in parallel with US1
- **Phase 5 (US3 — Spec-to-Code)**: Depends on Phase 2; benefits from US1 (harness) + US2 (providers) being complete
- **Phase 6 (US4 — Orchestration)**: Depends on Phase 5 (run engine must be solid)
- **Phase 7 (US5 — Co-pilot)**: Depends on Phase 2 + Phase 4 (providers); can run in parallel with US4
- **Phase 8 (US6 — History)**: Depends on Phase 5 (history entries produced by spec-to-code runs)
- **Phase 9 (US7 — Health)**: Depends on Phase 3 (harness), Phase 5 (run sensor tracking)
- **Phase 10 (Polish)**: Depends on all story phases being complete

### User Story Dependencies

- **US1 (P1)**: Independent after Phase 2
- **US2 (P1)**: Independent after Phase 2; can run in parallel with US1
- **US3 (P1)**: Depends on US1 (harness) + US2 (providers)
- **US4 (P2)**: Depends on US3 (run engine)
- **US5 (P2)**: Depends on US2 (streaming providers); can run in parallel with US4
- **US6 (P3)**: Depends on US3 (history entries)
- **US7 (P3)**: Depends on US1 (sensors), US3 (run tracking)

### Within Each Phase

- All `[P]`-marked tasks within a phase can be parallelized (different files, no shared state)
- Test tasks must be written and FAIL before their companion implementation tasks begin
- Types tasks (T005, T006) before everything in Phase 2
- Stores after types; skeleton index.ts after stores

---

## Parallel Opportunities

### Phase 2 — Maximum Parallelism

All T007–T024 core utility pairs (test + impl) can run in parallel since they are entirely different files:

```
Parallel stream A: T007 (harness test) → T008 (harness impl)
Parallel stream B: T009 (history test) → T010 (history impl)
Parallel stream C: T011 (git test) → T012 (git impl)
Parallel stream D: T013 (sensors test) → T014 (sensors impl)
Parallel stream E: T015 (keychain test) → T016 (keychain impl)
Parallel stream F: T017 (dag test) → T018 (dag impl)
Parallel stream G: T019 (adapter test) → T020 (adapter impl)
Parallel stream H: T021 (foundry.store test) → T022 (foundry.store impl)
Parallel stream I: T023 (copilot.store test) → T024 (copilot.store impl)
```

### Phase 4 — Provider Adapters

Four provider adapters can be implemented in parallel:

```
T035+T039 (claude), T036+T040 (openai), T037+T041 (gemini), T038+T042 (ollama)
```

---

## Implementation Strategy

### MVP: P1 Stories Only (Phases 1–5)

1. Complete Phase 1: Scaffold
2. Complete Phase 2: Foundational (CRITICAL — blocks everything)
3. Complete Phase 3: US1 (harness setup wizard)
4. Complete Phase 4: US2 (provider configuration)
5. Complete Phase 5: US3 (spec-to-code run + gate panel)
6. **STOP and VALIDATE**: Full Spec-to-Code run end-to-end. This is the primary value delivery.

### Incremental Delivery (P2/P3 Stories)

After MVP:

- Phase 6 (US4 — Orchestration) + Phase 7 (US5 — Co-pilot) in parallel
- Phase 8 (US6 — History) + Phase 9 (US7 — Health) in parallel
- Phase 10: Polish + isolation audit

---

## Notes

- `[P]` = different files, no shared mutable state with other `[P]` tasks in the same phase
- Every test task must produce a **FAILING** test before the implementation task begins
- Run `npm run build:extensions` after every significant batch to catch type errors early
- `extensions/foundry/src/index.js` is a build artifact — never edit directly, always gitignored
- CSS: use only `var(--token-name)` from core. Never introduce raw hex colors or new CSS variables.
- IPC: always use `window.electronAPI.extensionBridge.invoke('foundry:...')` from renderer — never direct `ipcRenderer`
- Commit after each phase checkpoint at minimum
