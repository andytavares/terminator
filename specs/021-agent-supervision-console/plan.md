# Implementation Plan: Agent Supervision Console

**Branch**: `021-agent-supervision-console` | **Date**: 2026-07-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/021-agent-supervision-console/spec.md`

## Summary

Turn Terminator into a supervision console for 2–6 long-running Claude Code agents. Two capabilities carry the feature: **derived runtime state** for every supervised session (so a blocked agent is visible in under 2 seconds without opening it) and **stall detection** (so an agent stuck without asking for help is caught at all). Everything else — worktree provisioning, review queue with risk grading, backpressure, work-item board, lanes, feed — exists to make those two usable.

Technical approach: a new core subsystem `src/main/supervision/` containing an SDK-backed agent-runtime seam, an event bus, a runtime state machine, a pure stall detector, a worktree manager built on the git service that already exists, a review queue, and a code-host client. All seven surfaces are core React. The only coupling permitted to extensions is the published Extension API plus a console-owned publication directory that producers write work-item contracts into — the console never reads inside, writes into, or knows the internals of any extension.

## Technical Context

**Language/Version**: TypeScript 5.x (strict), Node 20 LTS+ (24 confirmed), ESM

**Primary Dependencies**: Electron 42.4.1 · React 18.3.1 · Zustand 4.5.5 · Zod 3.23.8 · electron-store ^8.2.0 · lucide-react · **new:** `@anthropic-ai/claude-agent-sdk` pinned `0.3.220` (main process only, behind the R2 seam)

**External tools**: `git` (already used by core) · `gh` CLI (new to core — see R6; auth is `gh auth login`'s problem, not ours)

**Storage**: `electron-store` for keyed state (config, shadow mode, lane bindings, overrides, unattended-merge records); append-only JSONL under user-data for the two growing logs (stall firings, feed entries). No database — `pglite`/`sql.js` in the tree are extension dependencies and are off-limits to core.

**Testing**: Vitest 4.x, two projects (`node` + `jsdom`), v8 coverage, **80% hard gate on statements/branches/functions/lines**. Playwright for E2E. TDD is non-negotiable (Constitution VI).

**Target Platform**: Electron desktop — macOS 13+ primary, Windows 11, Ubuntu 22.04 LTS

**Project Type**: Desktop application (Electron main + renderer + shared)

**Performance Goals**: permission request visible on every listing surface ≤ 2 s (SC-001) · stall evaluated on a ≤ 30 s tick (FR-011) · stall surfaced ≤ 10 min (SC-002) · full state of all sessions readable in ≤ 30 s from one surface (SC-003)

**Constraints**: local-first, single-operator, offline-tolerant (code host unavailable degrades to `unavailable`, never to `passing`) · no terminal-output parsing for state · **no core→extension coupling of any kind**

**Scale/Scope**: 2–6 concurrent supervised sessions by design; tens of work items; a stall-firing log measured in thousands of rows. 93 functional requirements across 8 prioritised user stories.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                   | Gate                                                                            | Status                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Source Integrity         | Every API choice cites vendor docs                                              | **PASS** — `canUseTool`, `PermissionResult`, `SDKResultMessage`, `Query.interrupt()`, `BaseHookInput.transcript_path` all cited in [research.md](./research.md) from the Claude Agent SDK reference. Repo facts (empty `src/main/github/`, existing `createWorktree`) verified by reading the tree, not assumed.  |
| II. Extension Isolation     | Core must not depend on any extension; extensions must not touch core internals | **PASS** — the feature's defining constraint. FR-063 – FR-067 encode it; SC-011 tests it (remove every extension, core still delivers everything but intake). Enforced by lint rule, see Phase 1.                                                                                                                 |
| IV. Dependency Stewardship  | Justify each new dependency; prefer stdlib                                      | **PASS with conditions** — one new npm dependency (`@anthropic-ai/claude-agent-sdk`, first-party Anthropic, pinned exactly because it is `0.x`). `gh` is an external CLI, not a package. Two dependency questions (TOML parser, file watcher) are deferred to task time with an explicit stdlib-first constraint. |
| V. Readability & Minimalism | No speculative code                                                             | **PASS** — the one abstraction (agent-runtime seam) has a present-requirement justification (SC-007); see Complexity Tracking.                                                                                                                                                                                    |
| VI. TDD + 80% coverage      | Red→Green→Refactor; no new file untested                                        | **PASS** — the highest-value units (`evaluateStall`, `rankAttention`, `gradeRisk`) are pure functions with injected clocks, so they are table-driven tests with no fakes. Every new file ships with a spec.                                                                                                       |
| VII. SOLID & YAGNI          | No abstraction for anticipated futures                                          | **PASS with justification** — see Complexity Tracking row 1.                                                                                                                                                                                                                                                      |
| VIII. Documentation         | Docs ship in the same PR                                                        | **PASS** — README feature entry, `docs/ARCHITECTURE.md` supervision section, `docs/EXTENSION-DEVELOPMENT.md` contract + command registration, `docs/user-guide/`.                                                                                                                                                 |
| IX. ADRs                    | Significant decisions recorded at decision time                                 | **PASS** — four ADRs, numbered from 026 (next free; 025 is the last existing). Listed in Phase 1.                                                                                                                                                                                                                 |
| X. Code Cleanliness         | Lint 0 errors, no dead code, no untracked TODOs                                 | **PASS**                                                                                                                                                                                                                                                                                                          |
| XI. Functional Purity       | Side effects at the boundary only                                               | **PASS** — detector, ranker, and grader are pure; I/O confined to the seam, the worktree manager, the code-host client, and the store.                                                                                                                                                                            |
| XII. UI Icons               | `lucide-react`, flat, `currentColor`, CSS-sized                                 | **PASS**                                                                                                                                                                                                                                                                                                          |

**Development Environment**: feature branch `021-agent-supervision-console` ✓ · spec ratified through `/speckit-clarify` ✓ · no direct commits to `main` ✓

**Result: PASS.** Two justified deviations, recorded in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/021-agent-supervision-console/
├── plan.md              # This file
├── spec.md              # Ratified specification (93 FRs, 5 clarifications)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── work-item.contract.md       # Publication directory schema + versioning
│   ├── extension-api.contract.md   # New Extension API surface
│   └── repo-config.contract.md     # .terminator/config.json
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/main/supervision/                 # NEW — the substrate (FR-063)
├── agent-runtime/                    # THE SEAM (FR-002 – FR-004). Only place importing the SDK.
│   ├── driver.ts                     #   start / interrupt / redirect a session
│   ├── permission-bridge.ts          #   canUseTool -> PendingPermission -> decision
│   ├── transcript-tailer.ts          #   tails transcript_path from hook input (R3)
│   ├── hooks.ts                      #   SessionStart / Stop / Pre+PostToolUse
│   └── to-session-event.ts           #   SDK shapes -> runtime-neutral SessionEvent
├── events/session-event.ts           # The neutral union. No SDK type crosses here.
├── events/event-bus.ts
├── state/state-machine.ts            # SessionEvent -> RuntimeState (FR-001)
├── state/session-registry.ts         # persistence + restart re-adoption (FR-009)
├── stall/evaluate-stall.ts           # PURE (FR-012 – FR-015)
├── stall/stall-scheduler.ts          # 30 s tick (FR-011)
├── stall/firing-log.ts               # append-only; precision report (FR-017, FR-020)
├── worktree/provisioner.ts           # symlink, copy, ports, setup (FR-030 – FR-034)
├── worktree/port-allocator.ts
├── worktree/repo-config.ts           # .terminator/config.json (FR-037)
├── review/risk-grader.ts             # PURE (FR-046 – FR-050)
├── review/review-queue.ts
├── review/backpressure.ts            # gate + override log (FR-053, FR-054)
├── review/merge-policy.ts            # unattended merge rules (FR-058 – FR-062)
├── workitems/publication-watcher.ts  # console-owned dir only (FR-070 – FR-074)
├── workitems/contract-schema.ts      # Zod + contract_version
├── workitems/lane-bindings.ts        # console-owned storage (FR-075)
├── workitems/producer-commands.ts    # outbound via Extension API (FR-077, FR-078)
├── feed/feed-log.ts                  # JSONL + attribution (FR-091, FR-092)
└── query/rank-attention.ts           # PURE — one query, three surfaces (R10)

src/main/codehost/                    # NEW — core's own gh client (FR-056, FR-057)
├── codehost-client.ts
└── check-status.ts

src/main/ipc/supervision.ipc.ts       # NEW — follows channel-registrar pattern
src/main/extensions/api.ts            # EXTEND — read-only supervision surface (FR-066, FR-079)

src/shared/schemas/supervision.ts     # NEW — Zod schemas shared main<->renderer
src/shared/types/supervision.ts       # NEW

src/renderer/stores/supervision.store.ts   # NEW
src/renderer/stores/review.store.ts        # NEW
src/renderer/components/supervision/       # NEW — all seven surfaces (FR-064)
├── AttentionQueue/         # Concept 01
├── StatusBar/              # Concept 10 — persistent summary
├── Palette/                # Concept 10 — extends existing Cmd+P over new entities
├── SinceYouLastLooked/     # built once in P4, reused everywhere (FR-027)
├── ReviewInbox/            # Concept 08
├── WorkItemBoard/          # Concept 02
├── LaneView/               # Concept 06
└── StandupFeed/            # Concept 07

tests/unit/main/supervision/**        # mirrors the tree above
tests/unit/renderer/supervision/**
tests/integration/supervision/**
tests/e2e/supervision.spec.ts

packages/extension-sdk/types/api.d.ts # EXTEND — published supervision surface
```

**Structure Decision**: Everything lands in **core** (`src/main`, `src/renderer`, `src/shared`), with `src/main/supervision/` as a new top-level subsystem alongside the existing `git/`, `terminal/`, `remote/`, `notifications/`. No new extension is created and no existing extension is modified. This follows directly from FR-063/FR-064 and from the clarification that surfaces are core. Test files mirror the source tree under `tests/unit/`, matching the existing convention.

## Phased Delivery

Phases follow the spec's user-story priorities, which follow the PRD's build order. Each phase is independently shippable and independently testable.

| Phase                    | Stories  | Delivers                                                                                                                                                          | Key FRs         |
| ------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **P1 — Substrate**       | US1      | Agent-runtime seam, event bus, state machine, session registry, restart re-adoption. Proof: the existing session list shows real states instead of one green dot. | FR-001 – FR-010 |
| **P2 — Provisioning**    | US5      | Worktree manager: sharing, copying, ports, setup/teardown, repo config. Unblocks every later phase.                                                               | FR-030 – FR-038 |
| **P3 — Stall detection** | US2      | Pure detector, 30 s scheduler, firing log, shadow mode (default **on**), precision report.                                                                        | FR-011 – FR-021 |
| **P4 — Attention**       | US3      | `rankAttention`, Attention Queue, status bar, palette extension, "since you last looked". Stalls become visible here once shadow mode is off.                     | FR-022 – FR-029 |
| **P5 — Review**          | US4      | Code-host client, risk grader, review queue, four-step review, per-hunk accept, backpressure gate, unattended-merge policy + audit view. Largest single phase.    | FR-039 – FR-062 |
| **P6 — Work items**      | US6      | Publication directory, contract schema + versioning, watcher, lane bindings, producer commands, board, gates.                                                     | FR-063 – FR-085 |
| **P7 — Lanes & feed**    | US7, US8 | Lane view, merge ordering, collision flags, standup feed, digest, mute rules.                                                                                     | FR-086 – FR-093 |

**Sequencing note**: P2 (provisioning) is pulled ahead of P3 (stall detection) relative to the spec's story priorities. Stall detection needs sessions doing real work in real worktrees to tune against; running P3 first would mean tuning thresholds against toy sessions. This is a sequencing decision, not a scope change — no requirement moves.

**Shadow mode and P4**: shadow mode ships default-on in P3 (FR-018), so stalls are recorded but invisible. P4's Attention Queue therefore launches showing permission requests, failures, and finished work only. Stalls appear there the moment shadow mode is turned off, which is an operator decision informed by the P3 precision report — not a code change.

## Phase 1 Design Outputs

- [data-model.md](./data-model.md) — entities, the runtime state machine, and validation rules
- [contracts/work-item.contract.md](./contracts/work-item.contract.md) — publication directory layout, JSON schema, `contract_version` policy
- [contracts/extension-api.contract.md](./contracts/extension-api.contract.md) — new published Extension API surface (read-only supervision, worktree provisioning, producer command registration)
- [contracts/repo-config.contract.md](./contracts/repo-config.contract.md) — `.terminator/config.json`
- [quickstart.md](./quickstart.md) — runnable validation scenarios per phase

**Boundary enforcement (mechanical, not conventional)**: add an ESLint `no-restricted-imports` rule with two clauses —

1. `@anthropic-ai/claude-agent-sdk` may be imported only under `src/main/supervision/agent-runtime/` — enforces FR-002 – FR-004 and SC-007;
2. no file under `src/` may import from `extensions/` — enforces FR-065 and SC-011.

A convention that is not enforced is a convention that decays. Both clauses are cheap and turn two of the spec's hardest constraints into lint errors.

**ADRs to write at decision time (Constitution IX)**, next free number is 026:

- `026-agent-sdk-over-pty-supervision.md` — why the SDK drives supervised sessions and PTY parsing is rejected
- `027-agent-runtime-seam.md` — one seam, one implementation; why this is not speculative abstraction
- `028-console-owned-publication-directory.md` — why the console owns the contract location and schema
- `029-core-owned-codehost-client.md` — why core duplicates `gh` access rather than consuming the extension's

## Complexity Tracking

| Violation                                                                                                                                             | Why Needed                                                                                                                                                                                                                                                            | Simpler Alternative Rejected Because                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent-runtime seam with exactly one implementation — an abstraction over a single concrete case, which Constitution V/VII normally treats as a defect | SC-007 requires that upgrading the agent runtime cause no state-reporting regression, and that absorbing such an upgrade touch only this boundary and its own tests. The SDK is `0.x` and ships continuously; the transcript line schema is not a published contract. | Letting SDK types flow into the state machine, detector, review queue, and surfaces is less code today, but a single `0.x` shape change then edits all of them at once — the exact failure SC-007 exists to prevent, and the documented cause of Omnara's archival. Justified by a present requirement, not an anticipated second runtime, which remains an explicit non-goal (FR-004 forbids making it pluggable). |
| Core duplicates `gh` access that the `git-integration` extension already implements                                                                   | FR-065 forbids core calling into any extension. FR-062 makes unattended-merge safety depend on check state, so that data cannot be contingent on whether an extension happens to be installed.                                                                        | Consuming the extension's client would make a core safety property depend on an install — precisely the coupling ruled out during clarification. Recorded as accepted cost in the spec's Assumptions. A later feature may invert it so the extension consumes core's client through the Extension API.                                                                                                              |
