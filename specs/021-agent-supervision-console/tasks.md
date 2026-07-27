---
description: 'Task list for Agent Supervision Console'
---

# Tasks: Agent Supervision Console

**Input**: Design documents from `/specs/021-agent-supervision-console/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Test tasks are **MANDATORY**, not optional. Constitution VI (Test-Driven Development, NON-NEGOTIABLE) requires Red → Green → Refactor with no production code before a failing test demands it, plus an 80% coverage gate on statements/branches/functions/lines. Every test task in this file must be written and observed failing before the implementation tasks that follow it.

**Organization**: Tasks are grouped by user story. Phase order follows the ratified delivery sequence in plan.md, which intentionally places US5 (provisioning) before US2 (stall detection) — thresholds must be tuned against real sessions in real worktrees.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US8)
- Every task names an exact file path

## Path Conventions

Electron desktop app. Core only — no extension is created or modified.

- Main process: `src/main/`
- Renderer: `src/renderer/`
- Shared: `src/shared/`
- Published SDK types: `packages/extension-sdk/types/`
- Tests mirror source: `tests/unit/`, `tests/integration/`, `tests/e2e/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies, boundary enforcement, and directory scaffolding

- [x] T001 Add `@anthropic-ai/claude-agent-sdk` at exact version `0.3.220` to `dependencies` in root `package.json`. Required migrating the repository to `zod@4.4.3` first — the SDK peer-requires Zod 4 and six manifests pinned Zod 3. See `docs/adr/030-zod-4-migration.md` and research.md R11.
- [x] T002 Create the supervision source tree skeleton with index barrels only: `src/main/supervision/{agent-runtime,events,state,stall,worktree,review,workitems,feed,query,storage,autonomy,notify,lanes}/` and `src/main/codehost/`
- [x] T003 [P] Add ESLint `no-restricted-imports` clause forbidding `@anthropic-ai/claude-agent-sdk` anywhere under `src/` except `src/main/supervision/agent-runtime/**` in `.eslintrc.json` (enforces FR-002–FR-004, SC-007)
- [x] T004 [P] Add ESLint `no-restricted-imports` clause forbidding any file under `src/**` from importing `extensions/**` in `.eslintrc.json` (enforces FR-065, SC-011)
- [x] T005 [P] Add a lint-rule regression spec asserting both restricted-import clauses are present and correctly scoped in `tests/unit/config/eslint-boundaries.spec.ts`
- [x] T006 [P] Verify the existing `node` and `jsdom` project globs in `vitest.config.ts` already match the new `tests/unit/main/**`, `tests/unit/renderer/**`, and `tests/integration/supervision/**` paths; add a glob only if a path is genuinely unmatched
- [x] T007 [P] Decide config file format for `.terminator/config.*` — JSON (no new dependency, Constitution IV stdlib preference) vs TOML (needs a parser); record the decision and rationale in `specs/021-agent-supervision-console/research.md` under R5
- [x] T008 [P] Decide publication-directory watch mechanism — `node:fs.watch` with debounce vs adding `chokidar` to core; spike both and record the decision in `specs/021-agent-supervision-console/research.md` under R7

**Checkpoint**: Dependencies installed, boundaries enforced by lint, two deferred dependency decisions closed

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The neutral event shape, transport, and persistence that every story consumes

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. The `SessionEvent` union in particular is the contract every downstream consumer is written against.

- [x] T009 [P] Write failing spec for the `SessionEvent` discriminated union — one case per kind, asserting no SDK type is structurally referenced — in `tests/unit/main/supervision/events/session-event.spec.ts`
- [x] T010 Define the `SessionEvent` union per data-model.md §1, including `callId` and `isShell` on tool events (required by the FR-015 exemption), in `src/main/supervision/events/session-event.ts`
- [x] T011 [P] Write failing spec for the event bus — subscribe, publish, unsubscribe, no delivery after unsubscribe — in `tests/unit/main/supervision/events/event-bus.spec.ts`
- [x] T012 Implement the typed in-process event bus in `src/main/supervision/events/event-bus.ts`
- [x] T013 [P] Write failing spec for shared supervision Zod schemas and `RuntimeState` (including the `unknown` state required by FR-009) in `tests/unit/shared/schemas/supervision.spec.ts`
- [x] T014 [P] Define shared supervision types in `src/shared/types/supervision.ts` per data-model.md §2, §3
- [x] T015 Define Zod schemas mirroring those types in `src/shared/schemas/supervision.ts`
- [x] T016 [P] Write failing spec for the append-only JSONL log helper — append, read-all, read-range, tolerate a torn final line — in `tests/unit/main/supervision/storage/jsonl-log.spec.ts`
- [x] T017 Implement the append-only JSONL log helper in `src/main/supervision/storage/jsonl-log.ts` (backs stall firings and the feed per research.md R9)
- [x] T018 [P] Write failing spec for supervision IPC channel registration and the invoke table in `src/main/ipc/__tests__/supervision-ipc.spec.ts`
- [x] T019 Implement supervision IPC handlers in `src/main/ipc/supervision.ipc.ts`, registering through the existing `channel-registrar` pattern
- [x] T020 Wire `supervision.ipc.ts` into main-process startup in `src/main/index.ts` and declare the channels in `src/shared/electron-api/manifest.ts` (the manifest generates both the preload and the remote shim; editing `preload.ts` directly would fight that mechanism). Deferred because `registerSupervisionHandlers` takes a `SupervisionSource` and the session registry that implements it is T038. Wiring it now would mean committing an empty stub — speculative code (Constitution V) and a dead export (Constitution X).

**Checkpoint**: Neutral event shape, bus, schemas, log helper, and IPC exist — user stories can begin

---

## Phase 3: User Story 1 - Real runtime state for every supervised session (Priority: P1) 🎯 MVP

**Goal**: Every supervised session carries an accurate, continuously updated runtime state derived from observed agent activity, surviving restart and driver loss.

**Independent Test**: Start a supervised session; drive it through a permission request, an idle period, and completion. Verify `working → needs_input → working → ready` on the session list without opening the session, and that state survives a console restart. Full script in quickstart.md § P1.

### Tests for User Story 1 ⚠️ WRITE FIRST, OBSERVE FAILING

- [x] T021 [P] [US1] Write failing spec for the runtime state machine covering every transition in data-model.md §3, including empty-diff termination and the `unknown` restart case, in `tests/unit/main/supervision/state/state-machine.spec.ts`
- [x] T022 [P] [US1] Write failing spec for SDK-shape → `SessionEvent` translation (permission request, tool start/finish with `callId`, result success and each error subtype) in `tests/unit/main/supervision/agent-runtime/to-session-event.spec.ts`
- [x] T023 [P] [US1] Write failing spec for the permission bridge — request becomes pending state, allow/deny returns the documented `PermissionResult`, deny-with-interrupt path — in `tests/unit/main/supervision/agent-runtime/permission-bridge.spec.ts`
- [x] T024 [P] [US1] Write failing spec for the transcript tailer — consumes a path supplied by hook input, never computes one; tolerates unparseable lines without failing the session — in `tests/unit/main/supervision/agent-runtime/transcript-tailer.spec.ts`
- [x] T025 [P] [US1] Write failing spec for the session registry — persist, restore, and mark `unknown` when restart finds no evidence — in `tests/unit/main/supervision/state/session-registry.spec.ts`
- [x] T026 [P] [US1] Write failing spec for source reconciliation asserting the transcript wins when driver and transcript disagree (FR-006) in `tests/unit/main/supervision/state/reconcile.spec.ts`
- [x] T027 [P] [US1] Write failing integration spec driving a fake agent through request → approve → finish and asserting listing-surface state within 2s (SC-001) in `tests/integration/supervision/session-lifecycle.spec.ts`
- [x] T028 [P] [US1] Write failing spec for the session driver — start, interrupt, redirect, and clean teardown on session end — in `tests/unit/main/supervision/agent-runtime/driver.spec.ts`
- [x] T029 [P] [US1] Write failing spec for lifecycle hook handlers asserting `transcript_path`, `session_id`, and `cwd` are captured from hook input and that shell `PreToolUse`/`PostToolUse` pairs emit matching `callId`s, in `tests/unit/main/supervision/agent-runtime/hooks.spec.ts`
- [x] T030 [P] [US1] Write failing spec for per-session metric accumulation (turns, cost, context proportion, diff summary) in `tests/unit/main/supervision/state/session-metrics.spec.ts`

### Implementation for User Story 1

- [x] T031 [US1] Implement SDK-shape → `SessionEvent` translation in `src/main/supervision/agent-runtime/to-session-event.ts`, mapping `SDKResultMessage` success/error subtypes onto `session_ended`
- [x] T032 [US1] Implement the `canUseTool` permission bridge in `src/main/supervision/agent-runtime/permission-bridge.ts`, returning the documented `PermissionResult` union
- [x] T033 [US1] Implement lifecycle hook handlers (`SessionStart`, `Stop`, `PreToolUse`, `PostToolUse`) in `src/main/supervision/agent-runtime/hooks.ts`, capturing `transcript_path`, `session_id`, and `cwd` from `BaseHookInput` per research.md R3
- [x] T034 [US1] Implement the transcript tailer in `src/main/supervision/agent-runtime/transcript-tailer.ts`, opening only the path supplied by hook input and parsing defensively
- [x] T035 [US1] Implement the session driver — start, interrupt via `Query.interrupt()`, redirect — in `src/main/supervision/agent-runtime/driver.ts` (the only file importing the SDK)
- [x] T036 [US1] Implement the runtime state machine as a pure reducer over `SessionEvent` in `src/main/supervision/state/state-machine.ts`
- [x] T037 [US1] Implement source reconciliation favouring the transcript in `src/main/supervision/state/reconcile.ts`
- [x] T038 [US1] Implement the session registry with `electron-store` persistence and restart re-adoption in `src/main/supervision/state/session-registry.ts`
- [x] T039 [US1] Implement per-session metric accumulation (turns, cost, context proportion, diff summary) in `src/main/supervision/state/session-metrics.ts`
- [x] T040 [P] [US1] Write failing spec for the renderer supervision store in `tests/unit/renderer/supervision/supervision-store.spec.ts`
- [x] T041 [US1] Implement the Zustand supervision store subscribing to state-change IPC in `src/renderer/stores/supervision.store.ts`
- [x] T042 [US1] Replace the undifferentiated activity indicator with real runtime state on the existing session list in `src/renderer/components/` (lucide-react, flat, `currentColor`, CSS-sized per Constitution XII)
- [x] T043 [P] [US1] Write failing component spec for the runtime-state indicator — one rendering per `RuntimeState` including `unknown`, flat `currentColor` icons only — in `tests/unit/renderer/supervision/state-indicator.spec.tsx`
- [x] T044 [US1] Write ADR `docs/adr/026-agent-sdk-over-pty-supervision.md` and ADR `docs/adr/027-agent-runtime-seam.md`

**Checkpoint**: US1 fully functional. The session list shows observed truth instead of a green dot. **This is the MVP.**

---

## Phase 4: User Story 5 - Provision an isolated, usable working copy per lane (Priority: P2)

**Goal**: Every agent gets a working copy that is immediately buildable and runnable — dependencies present, ports allocated, env files in place, setup already run — with failures surfaced rather than buried.

**Independent Test**: Provision on the largest repository; verify zero manual steps, non-colliding ports across two concurrent copies, and that a failing setup command surfaces as `failed` with output attached. Full script in quickstart.md § P2.

**Sequencing note**: Ahead of US2 by design (plan.md) — stall thresholds need real work in real worktrees to tune against.

### Tests for User Story 5 ⚠️ WRITE FIRST, OBSERVE FAILING

- [x] T045 [P] [US5] Write failing spec for repository config parsing, defaults for every absent key, and a valid empty/absent file in `tests/unit/main/supervision/worktree/repo-config.spec.ts`
- [x] T046 [P] [US5] Write failing spec for the port allocator — non-overlapping spans, skips spans held by live worktrees, probes actual availability (SC-008) — in `tests/unit/main/supervision/worktree/port-allocator.spec.ts`
- [x] T047 [P] [US5] Write failing spec for provisioning — symlink declared dirs, copy declared files, skip-and-record a missing source dir, export the three env vars — in `tests/unit/main/supervision/worktree/provisioner.spec.ts`
- [x] T048 [P] [US5] Write failing spec asserting non-zero setup exit marks the session `failed`, retains output, and starts no agent (FR-034) in `tests/unit/main/supervision/worktree/setup-runner.spec.ts`
- [x] T049 [P] [US5] Write failing spec asserting archive is refused while a session runs and runs teardown when it is not (FR-035, FR-036) in `tests/unit/main/supervision/worktree/archive.spec.ts`
- [x] T050 [P] [US5] Write failing spec for the external-editor handoff — resolves the operator's configured editor, opens the session's working copy path, reports a stated error when no editor is configured (FR-044) — in `tests/unit/main/supervision/worktree/editor-handoff.spec.ts`
- [x] T051 [P] [US5] Write failing integration spec provisioning two concurrent working copies of one repository and asserting no port overlap in `tests/integration/supervision/concurrent-provisioning.spec.ts`

### Implementation for User Story 5

- [x] T052 [US5] Implement repository config loading with full defaults in `src/main/supervision/worktree/repo-config.ts` per contracts/repo-config.contract.md
- [x] T053 [US5] Implement the port allocator with live-worktree awareness and bind probing in `src/main/supervision/worktree/port-allocator.ts`
- [x] T054 [US5] Implement directory sharing (symlink) and file copying in `src/main/supervision/worktree/materialize.ts`, recording skipped sources rather than failing silently
- [x] T055 [US5] Implement the provisioner orchestrating branch creation, materialisation, port allocation, and env export in `src/main/supervision/worktree/provisioner.ts`, reusing the existing `createWorktree`/`removeWorktree` in `src/main/git/git-service.ts`
- [x] T056 [US5] Implement the setup, teardown, **and verify** command runner with output capture and exit-code propagation in `src/main/supervision/worktree/setup-runner.ts` (all three are declared in the repo config contract; parsing `verify` without ever running it would leave dead configuration)
- [x] T057 [US5] Implement archive with the running-session guard in `src/main/supervision/worktree/archive.ts`
- [x] T058 [US5] Implement the one-action external-editor handoff opening a session's working copy in `src/main/supervision/worktree/editor-handoff.ts` (FR-044)
- [x] T059 [US5] Wire provisioning failure onto the `starting → failed` transition through the event bus in `src/main/supervision/worktree/provisioner.ts`
- [x] T060 [P] [US5] Write failing spec for provisioning IPC handlers in `src/main/ipc/__tests__/supervision-ipc.spec.ts`
- [x] T061 [US5] Add provisioning IPC handlers to `src/main/ipc/supervision.ipc.ts`
- [x] T062 [US5] Surface provisioning status and retained setup output on the session detail view in `src/renderer/components/supervision/`
- [x] T063 [P] [US5] Write failing component spec for the provisioning status view — setup output retained and shown on failure, editor-handoff action present — in `tests/unit/renderer/supervision/provisioning-status.spec.tsx`
- [x] T064 [P] [US5] Document `.terminator/config.*` — every key, defaults, and the three exported env vars — in `docs/user-guide/`
- [x] T065 [P] [US5] Document that database branching is deliberately unsolved, naming Neon/Supabase branching and per-worktree Docker as the two known patterns and claiming nothing further (FR-038), in `docs/user-guide/`

**Checkpoint**: US1 + US5 work. Agents run in isolated, immediately usable working copies.

---

## Phase 5: User Story 2 - Detect the silent stall (Priority: P1)

**Goal**: Catch an agent that has stopped making progress without asking for anything — recorded from day one, surfaced only when the operator turns shadow mode off.

**Independent Test**: Induce each of the three signals and verify a firing is recorded while shadow mode leaves visible state untouched; verify a 12-minute test suite produces **no** firing. Full script in quickstart.md § P3.

### Tests for User Story 2 ⚠️ WRITE FIRST, OBSERVE FAILING

- [x] T066 [P] [US2] Write failing table-driven spec for `evaluateStall` covering the silence signal at, below, and above threshold with `now` injected, in `tests/unit/main/supervision/stall/evaluate-stall.spec.ts`
- [x] T067 [P] [US2] Extend the loop signal (single file, zero net change over the window) and revert signal (≥2 reverts in 10 edits) cases in `tests/unit/main/supervision/stall/evaluate-stall.spec.ts`
- [x] T068 [P] [US2] **Add the load-bearing negative case**: a session blocked on one long-running shell command for 12 minutes produces **no** firing (FR-015). Per quickstart.md this gates shippability — if it fires, the feature does not ship.
- [x] T069 [P] [US2] Write failing spec for in-flight shell-command tracking — a `PreToolUse`/`PostToolUse` pair opens and closes an interval, an unclosed pair keeps it open, and open intervals are excluded from the silence calculation — in `tests/unit/main/supervision/stall/session-facts.spec.ts`
- [x] T070 [P] [US2] Write failing spec for per-repository threshold override with fallback to defaults (FR-016) in `tests/unit/main/supervision/stall/thresholds.spec.ts`
- [x] T071 [P] [US2] Write failing spec for the firing log — every firing recorded in both modes with signal, inputs, session, time, and `shadowMode` (FR-017) — in `tests/unit/main/supervision/stall/firing-log.spec.ts`
- [x] T072 [P] [US2] Write failing spec asserting shadow mode defaults **on**, and that in shadow mode a firing changes no session state, posts no feed entry, and emits no notification (FR-018) in `tests/unit/main/supervision/stall/shadow-mode.spec.ts`
- [x] T073 [P] [US2] Write failing spec asserting that with shadow mode off a firing sets `stalled`, posts a console-attributed feed entry, and notifies (FR-019) in `tests/unit/main/supervision/stall/surface-stall.spec.ts`
- [x] T074 [P] [US2] Write failing spec for judgement recording and the precision report over an operator-chosen period (FR-020) in `tests/unit/main/supervision/stall/precision-report.spec.ts`
- [x] T075 [P] [US2] Write failing spec for the 30s scheduler — fires on interval, skips terminal sessions, never overlaps runs — in `tests/unit/main/supervision/stall/stall-scheduler.spec.ts`

### Implementation for User Story 2

- [x] T076 [US2] Implement `evaluateStall` as a **pure** function `(facts, thresholds, now) → StallFiring | null` with no clock or I/O access, in `src/main/supervision/stall/evaluate-stall.ts` (Constitution XI)
- [x] T077 [US2] Implement in-flight shell-command tracking from the `PreToolUse`/`PostToolUse` `callId` pair and exclude that interval from the silence calculation, in `src/main/supervision/stall/session-facts.ts`
- [x] T078 [US2] Implement threshold resolution with per-repository override in `src/main/supervision/stall/thresholds.ts`
- [x] T079 [US2] Implement the append-only firing log with judgement recording and the precision report in `src/main/supervision/stall/firing-log.ts`
- [x] T080 [US2] Implement the 30s scheduler in `src/main/supervision/stall/stall-scheduler.ts`
- [x] T081 [US2] Implement the shadow-mode gate at the **surfacing** step only — never inside `evaluateStall` — defaulting to on, in `src/main/supervision/stall/surface-stall.ts`
- [x] T082 [US2] Add the shadow-mode toggle and the precision report view in `src/renderer/components/supervision/`, plus the four stall actions (ask what's wrong, view activity record, interrupt and redirect, discard session and worktree) wired to the driver
- [x] T083 [P] [US2] Write failing component spec for the shadow-mode toggle, the precision report, and the four stall actions in `tests/unit/renderer/supervision/stall-controls.spec.tsx`

**Checkpoint**: US1 + US5 + US2. Stalls are being recorded against real work. Shadow mode stays on until the precision report justifies turning it off.

---

## Phase 6: User Story 3 - One screen that answers "does anything need me?" (Priority: P2)

**Goal**: One ranked list of everything needing the operator, an always-visible summary, and one keystroke to anywhere.

**Independent Test**: With sessions in every state across two repositories, verify ranking, inline permission action, the explicit all-clear, and a palette that returns all five entity types. Full script in quickstart.md § P4.

### Tests for User Story 3 ⚠️ WRITE FIRST, OBSERVE FAILING

- [x] T084 [P] [US3] Write failing table-driven spec for `rankAttention` — blocking requests → stalls → failures → awaiting review, never grouped by repository (FR-022) — in `tests/unit/main/supervision/query/rank-attention.spec.ts`
- [x] T085 [P] [US3] Write failing spec for the status summary computation including age of oldest blocked session (FR-025) in `tests/unit/main/supervision/query/status-summary.spec.ts`
- [x] T086 [P] [US3] Write failing spec for the unified entity index over sessions, work items, repositories, worktrees, and commands (FR-026) in `tests/unit/main/supervision/query/entity-index.spec.ts`
- [x] T087 [P] [US3] Write failing spec for the since-last-viewed diff computation (FR-027) in `tests/unit/main/supervision/query/since-last-viewed.spec.ts`
- [x] T088 [P] [US3] Write failing spec for the notification policy — modal only for blocking permission requests, non-blocking otherwise, progress deferred to digest (FR-028) — in `tests/unit/main/supervision/notify/notification-policy.spec.ts`
- [x] T089 [P] [US3] Write failing spec asserting mute suppresses notification but never the feed entry (FR-029) in `tests/unit/main/supervision/notify/mute-rules.spec.ts`
- [x] T090 [P] [US3] Write failing component spec for the empty state explicitly stating everything is fine rather than rendering blank (FR-024) in `tests/unit/renderer/supervision/attention-queue.spec.tsx`
- [x] T091 [P] [US3] Write failing E2E spec covering the 45-minutes-away scenario — determine all session state from one surface in under 30s (SC-003) — in `tests/e2e/supervision-attention.spec.ts`
- [x] T092 [P] [US3] Write failing component spec for the persistent status bar — four counts plus age of oldest blocked session — in `tests/unit/renderer/supervision/status-bar.spec.tsx`
- [x] T093 [P] [US3] Write failing component spec for the palette returning all five entity types in one ranked list in `tests/unit/renderer/supervision/palette.spec.tsx`
- [x] T094 [P] [US3] Write failing component spec for the "since you last looked" panel in `tests/unit/renderer/supervision/since-you-last-looked.spec.tsx`

### Implementation for User Story 3

- [x] T095 [US3] Implement `rankAttention` as a pure function in `src/main/supervision/query/rank-attention.ts` — built **once**, consumed by the attention queue, the feed, and the palette (research.md R10)
- [x] T096 [US3] Implement the status summary in `src/main/supervision/query/status-summary.ts`
- [x] T097 [US3] Implement the unified entity index in `src/main/supervision/query/entity-index.ts`
- [x] T098 [US3] Implement since-last-viewed diffing in `src/main/supervision/query/since-last-viewed.ts`
- [x] T099 [US3] Implement the notification policy and mute rules in `src/main/supervision/notify/notification-policy.ts`, reusing the existing core notification centre
- [x] T100 [US3] Build the Attention Queue surface with inline approve/deny and the explicit all-clear state in `src/renderer/components/supervision/AttentionQueue/`
- [x] T101 [US3] Build the persistent status bar in `src/renderer/components/supervision/StatusBar/`
- [x] T102 [US3] Extend the existing command palette over the new entity index in `src/renderer/components/supervision/Palette/`
- [x] T103 [US3] Build the reusable "since you last looked" panel in `src/renderer/components/supervision/SinceYouLastLooked/`
- [x] T104 [US3] Mount status bar and attention queue into the app shell in `src/renderer/`

**Checkpoint**: US1 + US5 + US2 + US3. One screen answers "is everything OK". Stalls appear here the moment shadow mode is turned off — no code change required.

---

## Phase 7: User Story 4 - Review queue with risk grading and backpressure (Priority: P2)

**Goal**: Finished work queued worst-first by risk, reviewed intent-first, with the console refusing to start new agents while the unreviewed queue is over the limit.

**Independent Test**: Four sessions with different risk profiles; verify queue order, the four-step flow, per-hunk accept/reject, and a refused fifth agent start. Full script in quickstart.md § P5.

### Tests for User Story 4 ⚠️ WRITE FIRST, OBSERVE FAILING

- [x] T105 [P] [US4] Write failing spec for the code-host client — check status, PR state, merge — in `tests/unit/main/codehost/codehost-client.spec.ts`
- [x] T106 [P] [US4] Write failing spec asserting check state resolves to `unavailable` and **never** `passing` when `gh` is absent, unauthenticated, offline, or reports no checks (FR-057) in `tests/unit/main/codehost/check-status.spec.ts`
- [x] T107 [P] [US4] Write failing table-driven spec for `gradeRisk` covering each P0 trigger, each P1 trigger, the P3 conditions, and P2 as the default, in `tests/unit/main/supervision/review/risk-grader.spec.ts`
- [x] T108 [P] [US4] Extend that spec with the **evaluation-order** case: a lockfile change that also touches a critical path grades P0, not P3 (data-model.md §10)
- [x] T109 [P] [US4] Extend the grader spec asserting a non-`passing` check state disqualifies P3 entirely, in `tests/unit/main/supervision/review/risk-grader.spec.ts`
- [x] T110 [P] [US4] Write failing spec asserting an empty-diff session never enters the queue (FR-045) in `tests/unit/main/supervision/review/review-queue.spec.ts`
- [x] T111 [P] [US4] Write failing spec for worst-first queue ordering with the grade trigger retained per item (FR-046, FR-050) in `tests/unit/main/supervision/review/review-queue.spec.ts`
- [x] T112 [P] [US4] Write failing spec for the backpressure gate — refuse at or above the limit, state reason and count, one-action override, override recorded with timestamp and queue depth (FR-053, FR-054) — in `tests/unit/main/supervision/review/backpressure.spec.ts`
- [x] T113 [P] [US4] Write failing spec asserting the gate applies to the next start attempt and never retroactively kills running agents (spec Edge Cases) in `tests/unit/main/supervision/review/backpressure.spec.ts`
- [x] T114 [P] [US4] Write failing spec for merge policy — no unattended merge unless per-repository enabled, no global switch exists, never when checks are pending/failed/unavailable (FR-058, FR-059, FR-062) — in `tests/unit/main/supervision/review/merge-policy.spec.ts`
- [x] T115 [P] [US4] Write failing spec for unattended-merge recording and retrieval (FR-060, FR-061, SC-012) in `tests/unit/main/supervision/review/merge-audit.spec.ts`
- [x] T116 [P] [US4] Write failing spec for the autonomy ladder — each level auto-approves a strictly larger set; destructive ops always prompt (FR-041) — in `tests/unit/main/supervision/autonomy/autonomy-ladder.spec.ts`
- [x] T117 [P] [US4] Write failing spec asserting an off-allowlist network host prompts at every level including `ship` (FR-042) in `tests/unit/main/supervision/autonomy/host-allowlist.spec.ts`
- [x] T118 [P] [US4] Write failing spec for per-hunk accept/reject retaining only accepted changes, and for reject-all leaving a coherent branch marked discarded (FR-052, spec Edge Cases), in `tests/unit/main/supervision/review/hunk-decisions.spec.ts`
- [x] T119 [P] [US4] Write failing spec for intent extraction — original request vs the agent's own account, with out-of-request work called out (FR-051) — in `tests/unit/main/supervision/review/intent-diff.spec.ts`
- [x] T120 [P] [US4] Write failing component spec for the Review Inbox list — worst-first order, grade badge, and the specific grade trigger per item — in `tests/unit/renderer/supervision/review-inbox.spec.tsx`
- [x] T121 [P] [US4] Write failing component spec for the four-step review flow enforcing intent → risk → structure → tests order in `tests/unit/renderer/supervision/review-flow.spec.tsx`
- [x] T122 [P] [US4] Write failing component spec for per-hunk accept/reject and the unattended-merge audit view in `tests/unit/renderer/supervision/hunk-review.spec.tsx`

### Implementation for User Story 4

- [x] T123 [US4] Implement the core code-host client shelling out to `gh` in `src/main/codehost/codehost-client.ts` — core-owned, never reading from any extension (FR-056)
- [x] T124 [US4] Implement check-state resolution with the fail-safe-to-`unavailable` posture in `src/main/codehost/check-status.ts`
- [x] T125 [US4] Implement `gradeRisk` as a pure function with strict top-down evaluation order in `src/main/supervision/review/risk-grader.ts`
- [x] T126 [US4] Implement the review queue with worst-first ordering and empty-diff exclusion in `src/main/supervision/review/review-queue.ts`
- [x] T127 [US4] Implement the backpressure gate and override log in `src/main/supervision/review/backpressure.ts`, counting globally across all repositories per spec Assumptions
- [x] T128 [US4] Implement merge policy and the unattended-merge audit record in `src/main/supervision/review/merge-policy.ts`
- [x] T129 [US4] Implement the autonomy ladder and host allowlist check, wired into the permission bridge, in `src/main/supervision/autonomy/autonomy-ladder.ts`
- [x] T130 [US4] Implement intent extraction — original request vs the agent's own account, with out-of-request work called out (FR-051) — in `src/main/supervision/review/intent-diff.ts`
- [x] T131 [US4] Implement per-hunk accept/reject application in `src/main/supervision/review/hunk-decisions.ts`
- [x] T132 [US4] Build the Review Inbox surface with grade badges and the specific grade trigger per item in `src/renderer/components/supervision/ReviewInbox/`
- [x] T133 [US4] Build the four-step review flow — intent → risk → structure → tests — in `src/renderer/components/supervision/ReviewInbox/ReviewFlow/`
- [x] T134 [US4] Build the per-hunk accept/reject diff surface in `src/renderer/components/supervision/ReviewInbox/HunkReview/`
- [x] T135 [US4] Build the backpressure refusal dialog stating reason and current count, with the one-action override, in `src/renderer/components/supervision/ReviewInbox/`
- [x] T136 [US4] Build the unattended-merge audit view in `src/renderer/components/supervision/ReviewInbox/MergeAudit/`
- [x] T137 [US4] Add the autonomy-level picker to the agent assign flow in `src/renderer/components/supervision/`
- [x] T138 [US4] Write ADR `docs/adr/029-core-owned-codehost-client.md`

**Checkpoint**: US1 + US5 + US2 + US3 + US4. No change reaches the default branch without a recorded justification.

---

## Phase 8: User Story 6 - Work items from ticket to merged, gated by human approval (Priority: P3)

**Goal**: Intake from three sources into one shape, rendered on a board with gate chips, with the console never touching producer-owned state.

**Independent Test**: Hand-write a contract file into the publication directory and verify it appears; bind a session and verify the producer's directory is byte-for-byte unchanged. Full script in quickstart.md § P6.

### Tests for User Story 6 ⚠️ WRITE FIRST, OBSERVE FAILING

- [x] T139 [P] [US6] Write failing spec for contract schema validation covering every required and optional field per contracts/work-item.contract.md in `tests/unit/main/supervision/workitems/contract-schema.spec.ts`
- [x] T140 [P] [US6] Write failing spec for each failure row in the contract validation table — unknown major version, missing version, schema violation, truncated write, zero lanes — each degrading exactly one item (FR-085), in `tests/unit/main/supervision/workitems/contract-schema.spec.ts`
- [x] T141 [P] [US6] Write failing spec asserting duplicate `id` across two producers flags **both** as conflicted and never silently picks one (FR-074) in `tests/unit/main/supervision/workitems/conflict-detection.spec.ts`
- [x] T142 [P] [US6] Write failing spec asserting the watcher reads only the console-owned publication directory and never any producer-owned path (FR-072) in `tests/unit/main/supervision/workitems/publication-watcher.spec.ts`
- [x] T143 [P] [US6] Write failing spec asserting the console never writes, amends, or deletes a contract file (FR-073) **and never creates or modifies a specification, plan, or task artefact** (FR-076) in `tests/unit/main/supervision/workitems/read-only-guard.spec.ts`
- [x] T144 [P] [US6] Write failing spec for lane bindings in console-owned storage, single-valued per `(workItemId, laneOrd)` (FR-075), in `tests/unit/main/supervision/workitems/lane-bindings.spec.ts`
- [x] T145 [P] [US6] Write failing spec for producer command invocation and the read-only degradation when a command is unregistered (FR-077, FR-078) in `tests/unit/main/supervision/workitems/producer-commands.spec.ts`
- [x] T146 [P] [US6] Write failing spec asserting gate enforcement refuses implementation and names the missing gate (FR-083) in `tests/unit/main/supervision/workitems/gates.spec.ts`
- [x] T147 [P] [US6] Write failing spec asserting intake starts no agent (FR-069) in `tests/unit/main/supervision/workitems/intake.spec.ts`
- [x] T148 [P] [US6] Write failing spec for agent prompt composition — a started session receives its lane's `task_ids` and the work item's specification and plan paths, and degrades cleanly to ad-hoc when no work item is bound (FR-039) — in `tests/unit/main/supervision/workitems/compose-agent-prompt.spec.ts`
- [x] T149 [P] [US6] Write failing spec for the new Extension API namespaces asserting `api.supervision` exposes no transcript path and no pending-permission data, per contracts/extension-api.contract.md, in `tests/unit/main/extensions/supervision-api.spec.ts`
- [x] T150 [P] [US6] Write failing component spec for the Work Item Board — phase columns, artefact and gate chips, and the read-only state when a producer registered no command — in `tests/unit/renderer/supervision/work-item-board.spec.tsx`
- [x] T151 [P] [US6] Write failing integration spec for the boundary: bind a session, then assert the producer directory is byte-for-byte unchanged, in `tests/integration/supervision/producer-boundary.spec.ts`
- [x] T152 [P] [US6] Write failing E2E spec for SC-011 — with `extensions/` absent, core starts and delivers every capability except intake and gate actions, which state no producer is installed — in `tests/e2e/supervision-no-extensions.spec.ts`

### Implementation for User Story 6

- [x] T153 [US6] Implement the contract Zod schema with `contract_version` major-version policy in `src/main/supervision/workitems/contract-schema.ts`
- [x] T154 [US6] Implement the publication directory watcher over the console-owned tree only, using the mechanism decided in T008, in `src/main/supervision/workitems/publication-watcher.ts`
- [x] T155 [US6] Implement per-item degradation and conflict reporting in `src/main/supervision/workitems/work-item-store.ts`
- [x] T156 [US6] Implement lane bindings in console-owned storage in `src/main/supervision/workitems/lane-bindings.ts`
- [x] T157 [US6] Implement producer command invocation with the unregistered-command read-only path in `src/main/supervision/workitems/producer-commands.ts`
- [x] T158 [US6] Implement gate evaluation and the implementation-start refusal in `src/main/supervision/workitems/gates.ts`
- [x] T159 [US6] Implement intake normalising ticket URL, code-host issue reference, and local document into one shape without starting an agent, in `src/main/supervision/workitems/intake.ts`
- [x] T160 [US6] Implement agent prompt composition from the bound lane's `task_ids` and the work item's specification and plan paths in `src/main/supervision/workitems/compose-agent-prompt.ts`, and wire it into the session start path (FR-039)
- [x] T161 [US6] Add `api.supervision`, `api.worktrees`, and `api.workItems` to the Extension API in `src/main/extensions/api.ts` per contracts/extension-api.contract.md
- [x] T162 [US6] Publish the matching types and bump the minor version in `packages/extension-sdk/types/api.d.ts` and `packages/extension-sdk/package.json`
- [x] T163 [US6] Build the Work Item Board with phase columns and artefact/gate chips in `src/renderer/components/supervision/WorkItemBoard/`
- [x] T164 [US6] Build intake (paste URL / drop file) and the gate approve/reject-with-notes actions in `src/renderer/components/supervision/WorkItemBoard/`
- [x] T165 [US6] Write ADR `docs/adr/028-console-owned-publication-directory.md`
- [x] T166 [P] [US6] Document the publication directory, contract schema, versioning policy, and producer command registration in `docs/EXTENSION-DEVELOPMENT.md`

**Checkpoint**: Work items flow end to end. The console is fully producer-agnostic — a hand-written JSON file works identically to any extension.

---

## Phase 9: User Story 7 - Coordinate one work item across several repositories (Priority: P3)

**Goal**: Ordered lanes, predicted collisions, and merge ordering enforced when a shared contract is involved.

**Independent Test**: A three-repository work item with one shared file; verify lane ordering, collision flags on every touching lane, and a refused out-of-order merge. Full script in quickstart.md § P7.

### Tests for User Story 7 ⚠️ WRITE FIRST, OBSERVE FAILING

- [x] T167 [P] [US7] Write failing spec for shared-file collision detection flagging the file on **every** lane that touches it (FR-087) in `tests/unit/main/supervision/lanes/collision-detection.spec.ts`
- [x] T168 [P] [US7] Write failing spec for merge-order enforcement refusing a lane while a blocking lane is unmerged and naming it (FR-088, SC-006) in `tests/unit/main/supervision/lanes/merge-order.spec.ts`
- [x] T169 [P] [US7] Write failing spec asserting downstream lanes are flagged as needing rebase/re-run when an upstream lane merges a shared-file change after they started (FR-090) in `tests/unit/main/supervision/lanes/downstream-staleness.spec.ts`
- [x] T170 [P] [US7] Write failing component spec asserting a single-lane work item renders as one row with no multi-repository ceremony (FR-089) in `tests/unit/renderer/supervision/lane-view.spec.tsx`

### Implementation for User Story 7

- [x] T171 [US7] Implement collision detection across lane shared-file sets in `src/main/supervision/lanes/collision-detection.ts`
- [x] T172 [US7] Implement merge-order enforcement in `src/main/supervision/lanes/merge-order.ts`
- [x] T173 [US7] Implement downstream staleness flagging in `src/main/supervision/lanes/downstream-staleness.ts`
- [x] T174 [US7] Build the lane view rendering lanes in merge order with role, tasks, bound session, and blocking relationships in `src/renderer/components/supervision/LaneView/`
- [x] T175 [US7] Add collision and staleness indicators to the lane view in `src/renderer/components/supervision/LaneView/`
- [x] T176 [US7] Implement the single-lane collapse path in `src/renderer/components/supervision/LaneView/`
- [x] T177 [US7] Wire merge refusal into the review surface's merge action in `src/renderer/components/supervision/ReviewInbox/`
- [x] T178 [P] [US7] Document multi-repository lanes and merge ordering in `docs/user-guide/`

**Checkpoint**: Multi-repository work items cannot merge out of order. Single-repository work is unaffected.

---

## Phase 10: User Story 8 - Catch up on what happened while away (Priority: P3)

**Goal**: A chronological written account with honest attribution and inline reply.

**Independent Test**: Leave agents running, return, read the feed; verify prose summaries, console-attributed stall entries, and that an inline reply reaches the right session. Full script in quickstart.md § P7.

### Tests for User Story 8 ⚠️ WRITE FIRST, OBSERVE FAILING

- [x] T179 [P] [US8] Write failing spec for feed entry authorship — console-generated entries attributed to the console, never the agent (FR-092) — in `tests/unit/main/supervision/feed/feed-log.spec.ts`
- [x] T180 [P] [US8] Write failing spec for chronological ordering and per-milestone summary generation in `tests/unit/main/supervision/feed/milestone-summary.spec.ts`
- [x] T181 [P] [US8] Write failing spec asserting an inline reply is delivered to the originating session (FR-093) in `tests/unit/main/supervision/feed/feed-reply.spec.ts`
- [x] T182 [P] [US8] Write failing spec asserting a muted session still produces feed entries while emitting no notification (FR-029) in `tests/unit/main/supervision/feed/mute-interaction.spec.ts`
- [x] T183 [P] [US8] Write failing spec for the periodic digest — routine progress events batched, nothing lost, no per-event notification — in `tests/unit/main/supervision/feed/digest.spec.ts`
- [x] T184 [P] [US8] Write failing component spec for the Standup Feed — chronological order, visible console-vs-agent attribution, inline reply, mute controls — in `tests/unit/renderer/supervision/standup-feed.spec.tsx`

### Implementation for User Story 8

- [x] T185 [US8] Implement the feed log over the JSONL helper with explicit authorship in `src/main/supervision/feed/feed-log.ts`
- [x] T186 [US8] Implement milestone detection and cheap-model summary generation — one call per milestone, never the supervised agent — in `src/main/supervision/feed/milestone-summary.ts`
- [x] T187 [US8] Implement feed reply delivery through the driver in `src/main/supervision/feed/feed-reply.ts`
- [x] T188 [US8] Implement the periodic digest for routine progress events in `src/main/supervision/feed/digest.ts`
- [x] T189 [US8] Build the Standup Feed surface with visible authorship and inline reply in `src/renderer/components/supervision/StandupFeed/`
- [x] T190 [US8] Add mute controls per session and per event class in `src/renderer/components/supervision/StandupFeed/`

**Checkpoint**: All eight user stories functional and independently testable.

---

## Phase 11: Polish & Cross-Cutting Concerns

- [x] T191 [P] Add the SC-007 upgrade-regression suite — pin an older SDK version, run supervision tests, upgrade, re-run, assert the diff touches only `agent-runtime/` and its tests — in `tests/integration/supervision/runtime-upgrade.spec.ts`
- [x] T192 [P] Add a compaction-gap regression test asserting a context-compaction gap is not read as a stall (spec Edge Cases) in `tests/unit/main/supervision/stall/compaction-gap.spec.ts`
- [x] T193 [P] Add a regression test asserting a session bound twice to one lane is refused or explicitly replaced, never silently doubled (spec Edge Cases), in `tests/unit/main/supervision/workitems/lane-bindings.spec.ts`
- [x] T194 [P] Add the README feature entry for the supervision console in `README.md`
- [x] T195 [P] Add the supervision subsystem section — event flow, the seam, the boundary — to `docs/ARCHITECTURE.md`
- [x] T196 [P] Add the end-to-end operator walkthrough to `docs/user-guide/USER-GUIDE.md`
- [x] T197 Run the full quickstart.md validation for every phase and record results
- [x] T198 Verify SC-001 (permission visible ≤2s) and SC-003 (all state in ≤30s) — measured through the real substrate and the real IPC handler in `tests/integration/supervision/success-criteria.spec.ts`, and the renderer moved from a 2s poll to push-on-change so the budget is not consumed before IPC. Results recorded in quickstart.md. Judging the stall thresholds against your own work still needs a person; that is what shadow mode is for., per `specs/021-agent-supervision-console/quickstart.md` §P1 and §P4
- [x] T199 Run the SC-011 boundary test: `mv extensions /tmp/extensions-parked && npm run build && npm run dev`, confirm core delivers everything but intake, then restore
- [x] T200 Remove dead code, unused imports, and untracked placeholder comments introduced across all phases, under `src/main/supervision/`, `src/main/codehost/`, and `src/renderer/components/supervision/` (Constitution X)
- [x] T201 Run `npm run format`, then `npm run lint` (0 errors), then `npx vitest run --coverage` (all pass, ≥80% on all four metrics) — all three must succeed
- [x] T202 Confirm every new production file under `src/main/supervision/`, `src/main/codehost/`, and `src/renderer/components/supervision/` has a companion spec at ≥80% individual coverage (Constitution VI — a file at 0% is a defect regardless of the aggregate)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**
- **US1 (Phase 3)**: depends on Foundational. Blocks every other story — all of them consume runtime state.
- **US5 (Phase 4)**: depends on US1
- **US2 (Phase 5)**: depends on US1; **should follow US5** so thresholds are tuned against real worktrees
- **US3 (Phase 6)**: depends on US1; consumes US2 firings for the stall row
- **US4 (Phase 7)**: depends on US1 and US5
- **US6 (Phase 8)**: depends on US1; consumes US5 for provisioning and US4 for backpressure
- **US7 (Phase 9)**: depends on US6 (lanes come from the contract) and US4 (merge action)
- **US8 (Phase 10)**: depends on US1; consumes US2 for console-attributed entries
- **Polish (Phase 11)**: depends on all desired stories

### Critical path

`Setup → Foundational → US1 → US5 → US2 → US3 → US4 → US6 → US7/US8 → Polish`

US1 is a hard serialisation point. Everything else is a rendering of the state it produces.

### Within each user story

- Test tasks are written and observed **failing** before any implementation task in that phase (Constitution VI)
- Pure functions before the services that call them
- Main-process implementation before IPC before renderer
- Documentation ships in the same phase, not after (Constitution VIII)

### Parallel opportunities

- T003–T009 (Setup) — 7 tasks
- T021–T030 (US1 tests) — 10 tasks
- T045–T051 (US5 tests) — 7 tasks
- T063–T075 (US2 tests) — 13 tasks
- T083–T094 (US3 tests) — 12 tasks
- T105–T122 (US4 tests) — 18 tasks
- T139–T152 (US6 tests) — 14 tasks
- T166–T170 (US7 tests) — 5 tasks
- T178–T184 (US8 tests) — 7 tasks
- T191–T196 (Polish) — 6 tasks

Implementation tasks within a phase are mostly sequential — they share the same subsystem and often the same files.

---

## Parallel Example: User Story 2

```bash
# Launch all US2 test tasks together — different files, no interdependencies:
Task: "T066 Write failing table-driven spec for evaluateStall covering the silence signal at — tests/unit/main/supervision/stall/evaluate-stall.spec.ts"
Task: "T067 Extend the loop signal (single file, zero net change over the window) and revert — tests/unit/main/supervision/stall/evaluate-stall.spec.ts"
Task: "T068 Add the load-bearing negative case: a session blocked on one long-running shell "
Task: "T069 Write failing spec for in-flight shell-command tracking — a PreToolUse/PostToolU — tests/unit/main/supervision/stall/session-facts.spec.ts"
Task: "T070 Write failing spec for per-repository threshold override with fallback to defaul — tests/unit/main/supervision/stall/thresholds.spec.ts"
Task: "T071 Write failing spec for the firing log — every firing recorded in both modes with — tests/unit/main/supervision/stall/firing-log.spec.ts"
Task: "T072 Write failing spec asserting shadow mode defaults on, and that in shadow mode a  — tests/unit/main/supervision/stall/shadow-mode.spec.ts"
Task: "T073 Write failing spec asserting that with shadow mode off a firing sets stalled, po — tests/unit/main/supervision/stall/surface-stall.spec.ts"
Task: "T074 Write failing spec for judgement recording and the precision report over an oper — tests/unit/main/supervision/stall/precision-report.spec.ts"
Task: "T075 Write failing spec for the 30s scheduler — fires on interval, skips terminal ses — tests/unit/main/supervision/stall/stall-scheduler.spec.ts"
Task: "T083 Write failing component spec for the shadow-mode toggle, the precision report, a — tests/unit/renderer/supervision/stall-controls.spec.tsx"
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 Setup (T001–T008) → 2. Phase 2 Foundational (T009–T020) → 3. Phase 3 US1 (T021–T044) → 4. **Stop and validate** against quickstart.md § P1 → 5. Ship.

At this point the session list shows observed truth instead of one green dot. That alone changes the day, and everything after it is a rendering of the same state.

### Incremental delivery

| Increment  | Adds                                                                                  |
| ---------- | ------------------------------------------------------------------------------------- |
| MVP        | Real runtime state (US1)                                                              |
| +US5       | Agents run in isolated, immediately usable worktrees                                  |
| +US2       | Stalls recorded in shadow mode against real work                                      |
| +US3       | One screen answers "is anything wrong"; shadow mode can now be turned off on evidence |
| +US4       | Nothing merges unreviewed without a recorded justification                            |
| +US6       | Work items flow ticket → merged with human gates                                      |
| +US7, +US8 | Multi-repository ordering and catch-up                                                |

### Single-operator note

This is a single-developer project, so the parallel-team strategy in the template does not apply. The `[P]` markers are still worth honouring — batching parallel test tasks in one pass is faster than interleaving them with implementation, and it keeps the red phase of each cycle genuinely red.

### Two decisions to close before Phase 2

T007 (config format) and T008 (watcher mechanism) are deliberately scheduled in Setup. Both are dependency questions carried over from planning, and both should be closed before code depends on either answer.
