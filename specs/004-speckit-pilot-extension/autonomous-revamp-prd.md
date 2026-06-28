# SpecKit Pilot — Autonomous Ticket→PR Revamp (PRD)

**Extension:** `terminator.speckit-pilot` (revamp, not a new extension)
**Surface:** Project tab `SpecKit` (unchanged)
**Status:** Draft v0.1
**Author:** Andrew Tavares
**Date:** 2026-06-27
**Supersedes design in:** `specs/014-ticket-pilot` (folded into this revamp)

---

## 0. TL;DR

SpecKit Pilot already orchestrates the full Spec-Kit lifecycle — Constitution → Specify → Clarify → Plan → Checklist → Tasks → Analyze → Implement — with human-in-the-loop approval gates, a `.pilot/state.json` phase state machine, stale-propagation, per-file confirm, artifact diffs, a `tasks.md` kanban, and a `history.jsonl` audit log. Today the human runs each phase by hand in a terminal and the extension watches for the resulting artifacts.

This revamp keeps that lifecycle as the orchestration backbone and adds the three pieces that turn it into "dispatch a ticket, get a PR":

1. **A ticket front-door.** Pull Linear/Jira tickets into the SpecKit tab. Dispatching a ticket creates the feature dir under `specs/` and seeds the Specify phase from the ticket.
2. **An autonomous agent runner.** Each phase is executed by a headless Claude Agent SDK run (running the same spec-kit slash command the human runs today) instead of waiting for a human to do it. The existing artifact-detection + gate flow is unchanged — the agent just produces the artifact, then the gate stops for review.
3. **Two new tail phases.** `Self-Review` (format, lint, coverage ≥80%, `/google-review`) and `Open PR` (`gh pr create`, link the ticket back). These extend `PHASE_ORDER` cleanly.

Everything else — gates, feedback, check-ins, audit — is the spec-kit machinery you already built. We are not inventing a parallel orchestration flow.

---

## 1. Why revamp instead of building new

The `014-ticket-pilot` exploration proposed a separate extension with its own Design→Plan→Test→Implement phase model. That duplicated what SpecKit Pilot already does well. The spec-kit lifecycle **is** the right orchestration model for an autonomous agent:

- It already decomposes work into reviewable artifacts (`spec.md`, `plan.md`, `tasks.md`) with a gate between each — exactly the supervised-autonomy checkpoint pattern.
- It already encodes the constitution as phase 1, so the agent works under the repo's rules from the first step.
- It already has `tasks.md` as a natural unit for large-ticket check-ins (task batches), plus a kanban view to watch them.
- It already persists state and an audit log in the format we want.

The only thing it was missing was an _executor_ and an _input_. This revamp supplies both and ends the flow at a PR. Reusing the existing state machine, IPC surface, and components is less code, less risk, and a single mental model for the user.

### Non-goals

- Not a Linear/Jira client (read + minimal write-back only).
- No auto-merge — the output is always a seat PR.
- No second review UI — the PR is handed to the existing Code Reviews tab.
- Not removing the manual path — running phases by hand still works; the agent runner is an additive way to advance a phase.

---

## 2. What changes vs. what stays

| Area                       | Today                                                                                           | After revamp                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Input**                  | User picks an existing `specs/<feature>/` dir                                                   | Plus: pick a Linear/Jira ticket; dispatch creates the feature dir and seeds Specify                                     |
| **Phase execution**        | User runs `/specify`, `/plan`, `/implement` etc. in a terminal; extension watches for artifacts | Agent runner launches a headless Claude Agent SDK run per phase that produces the artifact; manual path still available |
| **Phases (`PHASE_ORDER`)** | constitution → … → implement (8)                                                                | + `review` + `pr` (10)                                                                                                  |
| **Gates / state machine**  | `locked→ready→running→awaiting_review→approved` (+ stale/modified/failed/skipped)               | **Unchanged**                                                                                                           |
| **Feedback**               | approve / reject / revoke / skip / edit artifact / per-file confirm                             | **Unchanged**, applied to the new phases too                                                                            |
| **Large work**             | `tasks.md` + kanban + per-file confirm                                                          | Plus: task-batch check-ins during Implement                                                                             |
| **Output**                 | Stops at Implement                                                                              | `gh pr create`, ticket write-back, hand off to Code Reviews                                                             |
| **State**                  | `.pilot/state.json` + `.pilot/history.jsonl` in feature dir                                     | **Same files**, plus `ticket` + `pr` fields and a `runner` block                                                        |
| **Surface**                | Project tab `SpecKit`                                                                           | **Unchanged**                                                                                                           |

---

## 3. Personas

- **Andrew (primary), senior engineer.** Wants to fan well-scoped tickets out to an agent that works under the constitution, while keeping the gate-by-gate control spec-kit already gives him. Trusts the spec→plan→tasks discipline; does not trust unsupervised merges.
- **Sam (secondary), tech lead.** Needs agent PRs to be small, tested, traceable to a ticket and to the spec/plan that produced them. The spec-kit artifacts are a bonus: the PR links back to a real `spec.md`/`plan.md`, so review is grounded.
- **Dana (tertiary), EM.** Wants the audit trail — which tickets were agent-run, rework loops per phase — which `history.jsonl` already provides.

---

## 4. User Flows

### 4.1 Dispatch a ticket (happy path)

1. Andrew opens the **SpecKit** project tab. Alongside existing features, a **Tickets** view lists his Linear + Jira tickets.
2. He selects `ENG-482 — Fix race condition in session reattach` and clicks **Dispatch**.
3. A dispatch sheet confirms: feature dir name (`specs/015-fix-reattach-race`), autonomy level, and which phase gates are active (defaults from `DEFAULT_SETTINGS.phaseGates`). He clicks **Start**.
4. The runner executes **Constitution** (reads `.specify/memory/constitution.md` — auto-approved, no changes) then **Specify**: the agent writes `spec.md` from the ticket body + acceptance criteria. Phase rail shows `Specify → awaiting_review`.
5. Andrew reviews the generated `spec.md` in the existing artifact view, edits one line, approves. (Editing marks it `modified` → re-review, the existing transition.)
6. The runner advances through **Clarify → Plan → Checklist → Tasks → Analyze**, pausing at each required gate. Checklist is optional by default (`required:false`) so it auto-advances unless enabled.
7. **Implement** runs against a worktree, working through `tasks.md`. Andrew watches the kanban; per-file confirm is on by default for Implement.
8. **Self-Review** (new) runs `npm run format`, `npm run lint`, `vitest run --coverage`, `/google-review`; surfaces real results; gate.
9. **Open PR** (new) runs `gh pr create`, links the PR to `ENG-482`, posts the URL back to Linear, and offers **Open in Code Reviews**.

### 4.2 Large ticket — task-batch check-ins

1. For `ENG-455` (epic), the **Tasks** phase produces a `tasks.md` with many tasks across modules.
2. During **Implement**, the runner executes tasks in **batches** (grouped by the section headers spec-kit already writes into `tasks.md`). At each batch boundary it **checks in**: "Batch 1 (token client, T001–T008) complete, tests green. Continue to Batch 2 (middleware swap)?"
3. Andrew reviews the partial diff and continues, redirects, or pauses. This reuses the per-file confirm + kanban surfaces; the check-in is a batch-level gate rather than a file-level one.

### 4.3 Feedback / correction (any phase)

Unchanged from today, now applied across all 10 phases: **Approve**, **Reject** (deletes the phase artifact, resets to `ready` for a re-run), **Revoke** (downstream approved phases → `stale`), **Skip** (optional phases), **Edit artifact** (markdown editor → `modified` → re-review), **Comment** (non-blocking, logged). Per-file confirm during Implement stays.

### 4.4 Failure / interruption

A failed phase run enters `failed` (existing status); `speckit:implement-stop` already exists for stopping a run. On restart, state is read from `.pilot/state.json` and the run resumes at the last gate. The agent works in a git worktree with a checkpoint commit (`speckit:checkpoint-create` already exists) so a failed Implement never corrupts the tree.

---

## 5. Phase Model (extended)

`PHASE_ORDER` gains two entries. Everything before `review` is the existing spec-kit lifecycle, unchanged.

| #   | Phase            | Agent action (slash command run headless)           | Artifact               | Default gate                    |
| --- | ---------------- | --------------------------------------------------- | ---------------------- | ------------------------------- |
| 1   | `constitution`   | Reads `.specify/memory/constitution.md`             | constitution.md        | required (auto if unchanged)    |
| 2   | `specify`        | `/specify` from the **ticket**                      | `spec.md`              | required                        |
| 3   | `clarify`        | `/clarify`                                          | `spec.md` (updated)    | required                        |
| 4   | `plan`           | `/plan`                                             | `plan.md`              | required                        |
| 5   | `checklist`      | `/checklist`                                        | `checklists/`          | **optional** (`required:false`) |
| 6   | `tasks`          | `/tasks`                                            | `tasks.md`             | required                        |
| 7   | `analyze`        | `/analyze`                                          | `tasks.md` (validated) | required                        |
| 8   | `implement`      | `/implement` (batched for large)                    | code + tests           | required, `perFileConfirm:true` |
| 9   | `review` _(new)_ | format, lint, `vitest --coverage`, `/google-review` | `.pilot/review.json`   | required                        |
| 10  | `pr` _(new)_     | `gh pr create`, ticket write-back                   | PR URL in state        | required                        |

**Status lattice:** unchanged (`locked → ready → running → awaiting_review → approved`, + `stale`/`modified`/`failed`/`skipped`), governed by the existing `phase-state-machine.ts`.

**Why the new gates are required:** `review` and `pr` are the last points before code becomes a shareable artifact — the highest-blast-radius steps, so they gate by default and can never be auto-approved in a way that opens a PR without a human. This matches the HITL principle of gating where actions are hard to reverse ([StackAI](https://www.stackai.com/insights/human-in-the-loop-ai-agents-how-to-design-approval-workflows-for-safe-and-scalable-automation)).

### 5.1 Autonomy levels (new dispatch control)

A single dispatch-time control sets how many gates are active by toggling `phaseGates[*].required`:

- **Guided** — every phase gated.
- **Standard** _(default)_ — Specify, Plan, Tasks, Self-Review, Open PR gated; Clarify/Checklist/Analyze/Implement flow through.
- **Fast** — only Self-Review and Open PR gated.

Self-Review and Open PR are never ungated, regardless of level.

---

## 6. The Agent Runner (the core new component)

The runner is what makes phases autonomous. It is a thin orchestration layer around the Claude Agent SDK; it does **not** replace the state machine.

- **Per-phase, bounded task.** For a phase, the runner launches a headless Claude Agent SDK run with: the feature context (`spec.md`/`plan.md`/`tasks.md` so far), the repo constitution and `CLAUDE.md`, and the specific phase objective ("run `/plan` for this feature and stop"). The run produces the phase's artifact, then yields.
- **Reuses the existing detection.** When the artifact appears, the current `checkArtifacts` + file-watcher flow fires `artifact_detected`, moving the phase to `awaiting_review` exactly as it does when a human produces the file. **No change to the gate UX.**
- **New IPC:** `speckit:phase-run` (start a phase run), `speckit:run-stream` (stream agent output to the run console), reusing `speckit:implement-stop` to cancel. The runner registers in `index.ts` alongside the existing handlers.
- **Constitution enforcement is free.** Because the constitution is phase 1 and is injected into every run's context, the agent writes code under the same TDD/coverage rules a human contributor follows — and the Self-Review phase verifies it with the very same `/google-review` skill the constitution mandates for humans.
- **Isolation.** Implement and later phases run in a git worktree created via the core git channels (`git.createWorktree`); `disallowedPaths` (already in `PilotSettings`) blocks edits to secrets/CI without confirmation.

This is the same shape mature ticket→PR systems use: normalize the input, hand a scoped skill set to an agentic worker, manage context/checkpoints/permissions around it, and end at a reviewable PR ([Port](https://docs.port.io/guides/all/automatically-resolve-tickets-with-coding-agents/), [Cognition](https://cognition.com/blog/how-cognition-uses-devin-to-build-devin)).

---

## 7. Ticket Integration

### 7.1 Ingest + write-back

|            | Linear                                                                                                                            | Jira                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Auth       | Personal API key                                                                                                                  | API token + email (Cloud) / PAT |
| Read       | Issues assigned to me, filtered by team/project                                                                                   | JQL                             |
| Dispatch   | Creates `specs/<n>-<slug>/`, writes the ticket into a seed file the Specify run consumes, records `ticket` in `.pilot/state.json` | same                            |
| Write-back | Comment with PR URL; optional status → In Review                                                                                  | Comment + transition            |

New IPC: `speckit:ticket-list`, `speckit:ticket-dispatch`, `speckit:ticket-writeback`. SDKs (`@linear/sdk`, a Jira client) go in **`extensions/speckit-pilot/package.json`**, never the root, per the extension constitution. Tokens live in the main process (`electron-store`, keychain-backed where available) — never in the repo or the isolated webview.

### 7.2 Mapping a ticket to a feature

Dispatch creates the next-numbered `specs/<NNN>-<slug>/` dir (matching the repo's existing numbering, e.g. `015-...`), drops a `ticket.md` seed (title, body, acceptance criteria, source URL), and runs Constitution + Specify so `spec.md` is generated from the ticket. From there it is an ordinary spec-kit feature, fully compatible with the manual flow.

### 7.3 Output

`Open PR` uses `gh pr create` (the path the git-integration extension already uses). The PR description links the ticket and the generating `spec.md`/`plan.md`. **Open in Code Reviews** routes to the existing PR-review surface.

---

## 8. Architecture (delta on the existing extension)

```
extensions/speckit-pilot/
├── manifest.json            # version bump; projectTab unchanged
├── package.json             # + @linear/sdk, jira client (NEW)
└── src/
    ├── index.ts             # + ticket + phase-run IPC handlers (EXTEND)
    ├── types/speckit.types.ts   # + 'review','pr' in PhaseId/PHASE_ORDER; + ticket/pr/runner fields (EXTEND)
    ├── state/
    │   ├── phase-state-machine.ts   # UNCHANGED
    │   ├── artifact-hash.ts         # UNCHANGED
    │   └── state-persistence.ts     # UNCHANGED
    ├── agent/                       # NEW
    │   ├── runner.ts                # launch Claude Agent SDK per phase
    │   └── phase-prompts.ts         # scoped prompt + stop condition per phase
    ├── integrations/                # NEW
    │   ├── linear.ts
    │   └── jira.ts
    └── components/
        ├── SpecKitPilotView.tsx     # + Tickets view + dispatch sheet (EXTEND)
        ├── KanbanBoard.tsx          # REUSE (task batches/check-ins)
        ├── ImplementDashboard.tsx   # REUSE (run console)
        ├── ApprovalPanel.tsx        # REUSE (gates for new phases too)
        ├── ArtifactDiff.tsx         # REUSE (spec.md/plan.md diffs)
        ├── PhaseRow.tsx             # REUSE (now renders 10 phases)
        ├── ReviewPanel.tsx          # NEW (self-review gate results)
        └── PrPanel.tsx              # NEW (seat PR card)
```

### 8.1 Data model delta

```ts
// added to PilotState
ticket?: { source: 'linear' | 'jira'; key: string; url: string; title: string }
pr?: { url: string; number: number; branch: string }
runner?: { autonomy: 'guided'|'standard'|'fast'; worktreePath: string; activeRunId: string | null }
// PhaseId gains: 'review' | 'pr'
```

State stays in `.pilot/state.json` + `.pilot/history.jsonl` in the feature dir. The new phases append to the same `history.jsonl` with the existing `HistoryEntry` shape.

### 8.2 Safety

- Agent shell stays within the worktree; PRs only — never force-push, never touch `main`, never merge.
- `disallowedPaths` (existing setting) blocks sensitive edits without confirm.
- The two tail gates are non-removable; Self-Review surfaces real numbers (coverage %, lint count, `/google-review` BLOCKERs), not a checkmark, to fight rubber-stamping.

---

## 9. UX Principles

1. **Don't make the user re-learn anything.** The phase rail, approval panel, diff view, kanban, and history are the ones they already use — the revamp adds a ticket view at the front and two phases at the end.
2. **Summarize at gates, logs on demand** — the existing artifact/diff view already does this; the new run console is collapsible.
3. **Supervised autonomy** via autonomy levels mapped onto the existing `phaseGates`.
4. **Human-first / discoverable** per CLI/TUI design guidance ([clig.dev](https://clig.dev/)) — the next action is always obvious at the active gate.
5. **Everything reversible & auditable** — reject/revoke/stale-propagation and `history.jsonl` already guarantee this.

---

## 10. Settings (extends existing `SettingsPage.tsx`)

`terminator.speckit-pilot.*`, workspace-scoped where noted:

| Setting                                                               | Default                         |
| --------------------------------------------------------------------- | ------------------------------- |
| `…linear.apiKey` / `…jira.baseUrl` / `…jira.email` / `…jira.apiToken` | —                               |
| `…tickets.linearTeams` / `…tickets.jiraJql` (workspace)               | —                               |
| `…autonomy.default` (workspace)                                       | `standard`                      |
| `…phaseGates.<phase>.required` (workspace)                            | from `DEFAULT_SETTINGS`         |
| `…implement.batchCheckins` (workspace)                                | `true`                          |
| `…pr.writebackTransition` (workspace)                                 | `true`                          |
| `…agent.model`                                                        | `DEFAULT_SETTINGS.defaultModel` |
| `…disallowedPaths` (workspace)                                        | existing default                |

---

## 11. Risks & Mitigations

| Risk                                                                   | Mitigation                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Agent writes a plausible-but-wrong `spec.md` that passes a rushed gate | Specify/Plan/Tasks gated; reject deletes the artifact and re-runs; spec-kit's Clarify/Analyze phases catch gaps the user misses |
| Self-Review becomes a rubber stamp                                     | Real numbers surfaced; PR still goes through human Code Review                                                                  |
| Token leakage                                                          | Tokens only in main-process `electron-store`; never in repo/webview/PR                                                          |
| Large feature → unreviewable diff                                      | Task-batch check-ins during Implement; per-file confirm; spec-kit already chunks into `tasks.md`                                |
| Tracker API drift                                                      | Integrations isolated; Zod-validated at the boundary; ingest failure is a toast (constitution Principle VII)                    |
| Runner complexity creeps into the state machine                        | Hard boundary: runner only produces artifacts and emits `artifact_detected`; it never writes phase status directly              |
| Over-trust of "Fast" mode                                              | Self-Review + Open PR gates never removable                                                                                     |

---

## 12. Delivery Plan (spec-kit milestones, each ≥80% covered)

- **M1 — Phase extension.** Add `review` + `pr` to `PhaseId`/`PHASE_ORDER`/gates; render 10 phases; new `ReviewPanel`/`PrPanel` (no agent yet, manual triggers). Proves the rail + gates extend cleanly.
- **M2 — Self-Review + PR phases.** Wire `npm` checks + `/google-review` + `gh pr create`; ticket-less (run on an existing feature) so it ships value to the current manual flow immediately.
- **M3 — Agent runner.** `speckit:phase-run` + `agent/runner.ts`; autonomous Specify→…→Implement on a small feature.
- **M4 — Ticket front-door.** Linear/Jira ingest, dispatch creates feature dir + seeds Specify, write-back.
- **M5 — Batch check-ins + autonomy levels.** Task-batch gating in Implement; autonomy presets.
- **M6 — Polish & docs.** Per the constitution's documentation table: update `README.md` SpecKit Pilot entry, `docs/ARCHITECTURE.md`, a new ADR, and `specs/004-…/contracts`.

Each milestone is independently shippable; M1–M2 improve the existing manual flow even before the agent lands.

---

## 13. Open Questions

1. **Headless runner mechanism** — does `agent/runner.ts` shell out to the `claude` CLI in a worktree, or use the Agent SDK in-process? (Leaning: CLI in worktree first — matches how the manual flow already runs spec-kit commands in a terminal, lowest new surface.)
2. **Constitution as Specify input vs. ticket as Specify input** — confirm the seed: ticket.md drives `/specify`; constitution stays phase 1. (Leaning: yes.)
3. **One PR per feature vs. per task-batch** for very large tickets. (Leaning: single PR default.)
4. **Checklist phase** — keep optional by default (current behavior) or require it for agent runs to raise quality?
5. **Write-back default** — auto-transition the ticket on PR open, or opt-in to avoid surprising board automation?

---

## Sources

- [Command Line Interface Guidelines (clig.dev)](https://clig.dev/)
- [StackAI — Designing HITL Approval Workflows](https://www.stackai.com/insights/human-in-the-loop-ai-agents-how-to-design-approval-workflows-for-safe-and-scalable-automation)
- [Permit.io — HITL for AI Agents: Best Practices](https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo)
- [MindStudio — Issue Trackers as AI Agent Infrastructure](https://www.mindstudio.ai/blog/issue-trackers-ai-agent-infrastructure-jira-linear)
- [Cognition — How Cognition Uses Devin to Build Devin](https://cognition.com/blog/how-cognition-uses-devin-to-build-devin)
- [Port — Automatically resolve tickets with coding agents](https://docs.port.io/guides/all/automatically-resolve-tickets-with-coding-agents/)
