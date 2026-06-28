# Implementation Plan: SpecKit Pilot Revamp

**Branch**: `015-speckit-pilot-revamp` | **Date**: 2026-06-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/015-speckit-pilot-revamp/spec.md`

---

## Summary

Replace the existing SpecKit Pilot extension UI with the autonomous ticket→PR flow specified in `specs/014-ticket-pilot/renderings.html`. The extension gains a ticket inbox (Linear + Jira), an autonomous agent runner that drives each spec-kit phase via `claude --headless` subprocess, two new tail phases (Self-Review and Open PR), a run queue (one active run per workspace), and a fully redesigned 10-phase UI. The existing phase state machine, state persistence, and gate action IPC handlers are extended — not replaced.

---

## Technical Context

**Language/Version**: TypeScript 5.x (Electron main process + React 18 renderer)

**Primary Dependencies**:

- Electron 32+ (existing)
- React 18 (renderer, existing)
- Vite (extension renderer build, existing)
- `@linear/sdk` (NEW — extension package.json only)
- `electron-store` (NEW — extension package.json only, credential storage)
- `diff` 5.2.2 (existing, artifact diffs)
- Node.js `child_process.spawn` (runner, no new dep)

**Storage**:

- `<featureDir>/.pilot/state.json` — PilotState v2 (JSON file, atomic write)
- `<featureDir>/.pilot/history.jsonl` — append-only audit log
- `<featureDir>/.pilot/self-review.json` — Self-Review phase result
- `electron-store` — Linear and Jira credentials (main process, keychain-backed)
- In-memory — run queue and ticket cache

**Testing**: Vitest (existing), coverage threshold ≥ 80%

**Target Platform**: Electron desktop app (macOS, Linux, Windows)

**Project Type**: Electron extension (isolated renderer + main-process IPC handlers)

**Performance Goals**: Ticket list renders in < 2s; phase artifact renders in < 500ms

**Constraints**: Extension isolation (Constitution Principle II) — all new deps in `extensions/speckit-pilot/package.json` only

**Scale/Scope**: One active run per workspace; ticket inbox up to ~100 items

---

## Constitution Check

_Pre-design gate — checked against `.specify/memory/constitution.md`_

| Principle                          | Status | Notes                                                                     |
| ---------------------------------- | ------ | ------------------------------------------------------------------------- |
| I. Source Integrity                | ✓      | Linear SDK from official docs; Jira REST v3 from Atlassian docs           |
| II. Extension Isolation            | ✓      | `@linear/sdk`, `electron-store` added to extension `package.json` only    |
| III. Code Readability & Minimalism | ✓      | Reuse existing state machine, persistence, gate IPC handlers              |
| IV. Test-Driven Development        | ✓      | Every new file gets a companion spec; TDD enforced                        |
| V. SOLID & YAGNI                   | ✓      | No over-engineering; per-batch-PR deferred; one active run enforced       |
| VI. Documentation as First-Class   | ✓      | plan.md, data-model.md, contracts/, quickstart.md shipped with code       |
| VII. Error Handling                | ✓      | Rate limiting, IPC errors, subprocess failures all toast per constitution |
| VIII. Functional Purity            | ✓      | State machine transitions pure; side effects isolated to IPC handlers     |

---

## Project Structure

### Documentation (this feature)

```text
specs/015-speckit-pilot-revamp/
├── plan.md              # This file
├── research.md          # Phase 0 — technology decisions
├── data-model.md        # Phase 1 — entities and type definitions
├── quickstart.md        # Phase 1 — validation scenarios
├── contracts/
│   ├── ipc-channels.md  # All IPC channels (retained + new)
│   └── extension-views.md  # UI view contracts
└── tasks.md             # Phase 2 — /speckit-tasks output
```

### Source Code

```text
extensions/speckit-pilot/
├── manifest.json                        # unchanged
├── package.json                         # add @linear/sdk, electron-store
├── src/
│   ├── index.ts                         # main process — extend IPC handlers
│   ├── types/
│   │   └── speckit.types.ts             # extend: new PhaseIds, Ticket, Run, PilotState v2
│   ├── state/
│   │   ├── phase-state-machine.ts       # extend PHASE_ORDER to 10 phases
│   │   └── state-persistence.ts        # keep + update defaultArtifactPaths for new phases
│   ├── runner/
│   │   └── agent-runner.ts             # NEW — spawn claude --headless, manage lifecycle
│   ├── api/
│   │   ├── linear.ts                   # NEW — Linear SDK wrapper + retry
│   │   ├── jira.ts                     # NEW — Jira REST API wrapper + retry
│   │   └── credentials.ts             # NEW — electron-store credential management
│   ├── utils/
│   │   ├── retry.ts                    # NEW — withRetry(fn, maxAttempts) utility
│   │   └── markdown.ts                 # keep as-is
│   └── renderer/
│       ├── App.tsx                     # update root to new sub-nav routing
│       └── components/
│           ├── TicketsView.tsx         # NEW — ticket inbox (scene 01)
│           ├── DispatchSheet.tsx       # NEW — dispatch side panel (scene 02)
│           ├── FeaturesView.tsx        # NEW — features list
│           ├── RunDashboard.tsx        # NEW — 10-phase rail + console (scenes 03-04)
│           ├── GatePanel.tsx           # NEW — approval gate panel (scenes 04, 06, 07)
│           ├── SelfReviewGate.tsx      # NEW — quality gate rows (scene 06)
│           ├── OpenPrGate.tsx          # NEW — PR card + actions (scene 07)
│           ├── BatchCheckIn.tsx        # NEW — batch check-in banner (scene 05)
│           ├── KanbanBoard.tsx         # keep + add batch-section grouping
│           ├── HistoryView.tsx         # NEW — completed run log
│           ├── SettingsView.tsx        # NEW — replaces SettingsPage.tsx
│           ├── PhaseRail.tsx           # NEW — 10-node horizontal phase rail
│           └── RunConsole.tsx          # NEW — streaming console
│
│   # Files removed in this revamp:
│   # src/components/SpecKitPilotView.tsx      -> replaced by App.tsx sub-nav
│   # src/components/ApprovalPanel.tsx         -> replaced by GatePanel.tsx
│   # src/components/ImplementDashboard.tsx    -> absorbed into RunDashboard.tsx
│   # src/components/ArtifactDiff.tsx          -> absorbed into GatePanel.tsx
│   # src/components/PhaseRow.tsx              -> replaced by PhaseRail.tsx
│   # src/components/StalePropagationModal.tsx -> replaced by inline stale banner
│   # src/components/speckit-pilot.css         -> replaced (full rewrite)
```

---

## Implementation Milestones

### M0 — Type system + state machine extension

Extend types and state machine before any other code. All downstream work depends on this.

1. Update `speckit.types.ts`:

   - Add `PhaseId` values: `'self-review'` and `'open-pr'`
   - Add interfaces: `Ticket`, `TicketRef`, `RunMeta`, `SelfReviewResult`
   - Add type: `AutonomyLevel = 'guided' | 'standard' | 'fast'`
   - Extend `PilotState` to version 2: add `ticket`, `run`, `queuePosition`, `worktreePath`, `branchName`, `prUrl`
   - Extend `PhaseState`: add `feedback: string | null`, `batchIndex: number | null`
   - Extend `PilotSettings`: add `defaultAutonomy`, `batchCheckinsEnabled`, `writeStatusBackOnPrOpen`, `linear: LinearSettings | null`, `jira: JiraSettings | null`
   - Extend `HistoryEntry.action` with new values
   - Update `PHASE_ORDER` to 10 entries; update `DEFAULT_SETTINGS`

2. Update `phase-state-machine.ts`:

   - Include `'self-review'` and `'open-pr'` in all transition maps
   - Add constraint: both new phases never set `autoApprove: true` regardless of autonomy level

3. Update `state-persistence.ts`:
   - `defaultArtifactPaths` for `'self-review'` → `['.pilot/self-review.json']`, for `'open-pr'` → `[]`
   - `createInitialState` initializes v2 fields with null defaults

**Tests**: Extend `phase-state-machine.spec.ts` to cover all 10-phase transitions; assert Self-Review and Open PR can never be auto-approved.

---

### M1 — Agent runner + credential store

4. Create `runner/agent-runner.ts`:

   - `spawnPhaseRunner(worktreePath, phaseCommand, options?): RunnerHandle`
   - Captures stdout line-by-line; pushes `speckit:run-output` event per line to all `BrowserWindow`s
   - On process exit: checks exit code; calls `checkArtifacts`; fires `speckit:run-phase-complete`
   - Enforces `commandTimeoutMs` with SIGTERM → SIGKILL escalation
   - `RunnerHandle.stop()` for cancellation

5. Create `utils/retry.ts`:

   - `withRetry<T>(fn: () => Promise<T>, maxAttempts?: number): Promise<T>`
   - Detects HTTP 429; delay: `100ms × 2^attempt` before retry
   - Throws after exhausting attempts

6. Create `api/credentials.ts`:
   - Uses `electron-store` with encryption
   - `setLinearKey(apiKey: string): void`
   - `getLinearKey(): string | null`
   - `setJiraCredentials(creds: JiraCreds): void`
   - `getJiraCredentials(): JiraCreds | null`
   - Never returns actual secrets to caller outside main process

**Tests**: `agent-runner.spec.ts` (mock `child_process.spawn`), `retry.spec.ts`, `credentials.spec.ts`.

---

### M2 — Tracker API clients

7. Create `api/linear.ts`:

   - `fetchAssignedTickets(apiKey: string, teamFilter?: string): Promise<Ticket[]>`
   - Uses `@linear/sdk` `LinearClient`; maps `Issue` → `Ticket`
   - Uses `withRetry` for rate limits
   - `postComment(apiKey: string, issueId: string, body: string): Promise<void>`

8. Create `api/jira.ts`:
   - `fetchAssignedTickets(creds: JiraCreds, jql: string): Promise<Ticket[]>`
   - Uses `fetch()` to `GET /rest/api/3/search?jql=...&fields=summary,description,priority,status`
   - Maps Jira fields → `Ticket`; uses `withRetry`
   - `postComment(creds: JiraCreds, issueKey: string, body: string): Promise<void>`
   - `transitionStatus(creds: JiraCreds, issueKey: string, transitionName: string): Promise<void>`

**Tests**: `linear.spec.ts`, `jira.spec.ts` (mock HTTP with 200, 429, and 401 responses).

---

### M3 — New IPC handlers

Add new channels to `index.ts` (retain all existing handlers unchanged):

9. `speckit:ticket-list` — fetch from Linear + Jira in parallel; merge; return sorted list
10. `speckit:credentials-set` — store via `credentials.ts`; return `{ ok: true }`
11. `speckit:credentials-status` — return `{ connected: boolean, email?, domain? }` only
12. `speckit:dispatch` — create feature dir, write `ticket.md`, init state v2, create worktree, queue or start runner
13. `speckit:run-cancel` — stop runner, remove worktree, set state to `cancelled`, advance queue
14. `speckit:phase-request-changes` — store feedback note, reset phase to `ready`, re-run with note
15. `speckit:checkin-decision` — handle `continue` / `pause` / `split` for batch check-in
16. `speckit:open-pr` — run `gh pr create` in worktree, write back PR URL to state + tracker
17. Update `speckit:checkpoint-create` — add optional `worktreePath` param

**Tests**: Extend `index-ipc.spec.ts` for each new handler; mock `agent-runner`, `linear`, `jira`, `credentials`.

---

### M4 — Renderer: new UI

Full renderer replacement following `specs/014-ticket-pilot/renderings.html`. All `--tm-*` CSS variables inherited from the Terminator host.

18. `speckit-pilot.css` — new stylesheet; all colors via `--tm-*` tokens; no hardcoded hex
19. `PhaseRail.tsx` — 10 nodes; node state maps to done/active/review/pending/locked visuals
20. `RunConsole.tsx` — scrolling ANSI-safe log; listens to `speckit:run-output` push events
21. `GatePanel.tsx` — base gate: artifact preview (markdown rendered), feedback textarea, Reject/Approve actions
22. `SelfReviewGate.tsx` — quality-gate row grid: Format, Lint, Tests, Coverage (with progress bar), /google-review
23. `OpenPrGate.tsx` — PR card: title, branch, diff stats, traceability links, write-back status, "Open in Code Reviews" action
24. `BatchCheckIn.tsx` — dashed-border check-in banner with partial-diff link and 4 action buttons
25. `KanbanBoard.tsx` — extend existing: group tasks by `tasks.md` section; active batch highlighted
26. `HistoryView.tsx` — table of completed runs: ticket badge, feature dir, PR URL, final status, timestamp
27. `SettingsView.tsx` — 3 sections per scene 08: Integrations, Autonomy/Gates, Agent Runner
28. `DispatchSheet.tsx` — autonomy segmented control, 10 gate toggles (Self-Review + Open PR locked), Start run button
29. `TicketsView.tsx` — inbox list + filter pills + ticket detail + DispatchSheet side panel
30. `FeaturesView.tsx` — feature rows with mini 10-dot phase rail
31. `RunDashboard.tsx` — composes PhaseRail + RunConsole; conditionally renders GatePanel variants or BatchCheckIn
32. `App.tsx` — sub-nav router with Tickets / Features / Active runs / History tabs; Settings accessible from header

**Tests**: Each component gets a `.spec.tsx` with jsdom + `electronAPI` mock. Cover key render states per component.

---

### M5 — Delete retired code

33. Remove: `SpecKitPilotView.tsx`, `ApprovalPanel.tsx`, `ImplementDashboard.tsx`, `ArtifactDiff.tsx`, `PhaseRow.tsx`, `StalePropagationModal.tsx`
34. Verify with `grep -r "SpecKitPilotView\|ApprovalPanel\|ArtifactDiff\|PhaseRow\|StalePropagationModal\|ImplementDashboard" extensions/speckit-pilot/src` returns nothing
35. Verify `npm run build:extensions` passes with zero TypeScript errors

---

### M6 — Docs + final quality gate

36. Update `docs/ARCHITECTURE.md` — agent runner, run queue, tracker integration sections
37. Update `specs/001-extension-first-terminal/contracts/ipc-channels.md` — add new `speckit:*` channels
38. Update `README.md` — SpecKit Pilot feature description updated for autonomous ticket→PR flow
39. Run `npm run format && npm run lint && npx vitest run --coverage && npm run build:extensions`

---

## Key Invariants

1. **Extension isolation**: `@linear/sdk` and `electron-store` declared in `extensions/speckit-pilot/package.json` only; never in root `package.json`.
2. **Credentials never reach renderer**: `speckit:credentials-status` returns `{ connected: boolean }` only; no secret ever crosses the IPC boundary to the renderer.
3. **Self-Review and Open PR are never auto-approved**: enforced in the state machine and locked in dispatch gate config regardless of autonomy level.
4. **One active run per workspace**: `speckit:dispatch` handler enforces the queue.
5. **Worktree cleanup on terminal state**: cancel, PR success, and run_failed all remove `.wt/<slug>`.
6. **No modification to main app files**: `src/main/preload.ts`, `src/renderer/electron.d.ts`, and root `package.json` are never touched.
