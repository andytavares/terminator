# SpecKit Pilot — Autonomous Ticket → PR (PRD)

**Feature dir:** `specs/014-ticket-pilot`
**Affects extension:** `terminator.speckit-pilot` (UI replaced, flow rebuilt)
**Orchestration layer:** Spec Kit (the installed SDD workflow)
**Surface:** SpecKit project tab
**Status:** Draft v1 — ready to drive through Spec Kit
**Author:** Andrew Tavares
**Date:** 2026-06-27

> **How to run this through Spec Kit:** see [`START-HERE.md`](./START-HERE.md). The spec-kit-format feature spec is in [`spec.md`](./spec.md); the end-to-end UI is in [`renderings.html`](./renderings.html).

---

## 0. TL;DR

Dispatch a Linear or Jira ticket to an autonomous agent that takes it from problem statement to a reviewable "seat" pull request — owning design, planning, testing, and implementation, reviewing its own work against our constitution, and pausing at human gates throughout.

**Spec Kit is the orchestration layer.** We do not invent a new pipeline. The SDD cycle Spec Kit already runs — Constitution → Specify → Clarify → Plan → Checklist → Tasks → Analyze → Implement, with its artifacts (`spec.md`, `plan.md`, `tasks.md`) and review gates between phases — is the engine that drives every run. This product wraps that engine in a new flow and a new layout:

1. **A ticket front-door** that pulls Linear/Jira and seeds `specify` from the ticket.
2. **An agent runner** that drives each spec-kit command headless instead of a human typing it.
3. **Two tail phases past `implement`** — **Self-Review** (format, lint, coverage ≥80%, `/google-review`) and **Open PR** (`gh pr create`, write back to the ticket).
4. **A new UI** — a single SpecKit view (ticket inbox → dispatch → a 10-phase run dashboard → gates → tasks board → self-review → PR). This **fully replaces** the existing SpecKit Pilot sidebar/panel UI.

The end product is the flow in `renderings.html`, orchestrated by Spec Kit. The existing extension is the starting point, not a constraint — UI and backing logic are rebuilt as needed to deliver this flow.

---

## 1. Problem

Work is defined in Linear/Jira, done in the terminal, and reviewed in GitHub. Every handoff loses context. Dispatching a ticket to an agent today means copy-pasting the ticket, re-explaining the codebase, babysitting the run, and opening the PR by hand. There is no durable, gate-by-gate, auditable path from "ticket" to "reviewable PR" inside the terminal where the work happens — and no path that enforces our engineering constitution automatically.

Spec Kit already gives us a disciplined SDD pipeline with review gates. It is the right orchestration substrate. What's missing is (a) a ticket as the input, (b) an agent that drives the pipeline instead of a human, (c) a clean end at a PR, and (d) a UI built for that flow rather than for manually nudging phases.

### Non-goals

- Not a Linear/Jira client (read + minimal write-back only).
- No auto-merge — output is always a seat PR for human review.
- No second PR-review UI — the PR hands off to the existing Code Reviews tab.
- Not preserving the current SpecKit Pilot UI — it is replaced.

---

## 2. Why Spec Kit as the orchestration layer

- It already decomposes work into reviewable artifacts with a gate between each phase — exactly the supervised-autonomy checkpoint model good agent UX needs ([StackAI](https://www.stackai.com/insights/human-in-the-loop-ai-agents-how-to-design-approval-workflows-for-safe-and-scalable-automation), [Orkes](https://orkes.io/blog/human-in-the-loop/)).
- It encodes the constitution as phase 1, so the agent works under our rules (TDD, ≥80% coverage, `/google-review`) from the first step.
- It already chunks large work into `tasks.md`, giving us natural check-in boundaries for big tickets.
- It already persists state and an audit trail and exposes scriptable commands (`/speckit-specify`, `…plan`, `…tasks`, `…implement`, etc.) — which is precisely what an agent runner needs to drive.

Reusing Spec Kit means we orchestrate with a proven engine and spend our effort on the three things that are actually new: the ticket front-door, the runner, and the tail phases — plus the UI.

---

## 3. Personas

- **Andrew (primary), senior engineer.** Wants to fan well-scoped tickets to an agent that works under the constitution, while keeping gate-by-gate control. Trusts the spec → plan → tasks discipline; will not trust an unsupervised merge.
- **Sam (secondary), tech lead.** Needs agent PRs to be small, tested, and traceable back to a ticket _and_ to the spec/plan that produced them, so review is grounded.
- **Dana (tertiary), EM.** Wants the audit trail: which tickets were agent-run, how much rework per phase, whether quality held.

---

## 4. The Flow (end to end)

This is the requirement. Screen numbers reference `renderings.html`.

1. **Ticket inbox (screen 1).** The SpecKit tab opens to a Tickets view: Linear + Jira tickets assigned to me, filtered to this repo. Dispatched tickets show the spec-kit feature dir they created and their live phase.
2. **Dispatch (screen 2).** Select a ticket → a dispatch sheet confirms the new `specs/NNN-slug/` dir, autonomy level, and which spec-kit phase gates are active. Start.
3. **Constitution + Specify.** The runner drives `/speckit-specify` seeded from the ticket; `spec.md` is generated. Gate.
4. **Run dashboard (screen 3).** A horizontal 10-phase rail (Constitution → … → Implement → Self-Review → Open PR) is the spine. The agent runner drives the current spec-kit command headless; a streaming console shows tool activity.
5. **Gates + feedback (screen 4).** At each phase the generated artifact (`spec.md`/`plan.md`/`tasks.md`) is presented for **Approve / Request changes / Comment / Edit / Reject / Revoke**. Requesting changes re-runs the phase with feedback; editing re-enters review; revoking an upstream phase marks downstream `stale`.
6. **Implement + check-ins (screen 5).** Implement works through `tasks.md` on a kanban board. For large tickets the runner executes tasks in **batches** (grouped by `tasks.md` sections) and **checks in** at each boundary with a partial-diff summary: Continue / Redirect / Pause / Split.
7. **Self-Review (screen 6).** New phase: run format, lint, `vitest --coverage`, `/google-review`; surface real numbers; gate.
8. **Open PR (screen 7).** New phase: `gh pr create`, link the PR to the ticket and the generating `spec.md`/`plan.md`, write the URL back to Linear/Jira, offer **Open in Code Reviews**.
9. **Settings (screen 8).** Linear/Jira credentials, autonomy presets, per-phase gate defaults, runner model + isolation, disallowed paths.

### 4.1 Autonomy levels

One dispatch-time control sets how many spec-kit gates require human approval:

- **Guided** — every phase gated.
- **Standard** _(default)_ — Specify, Plan, Tasks, Self-Review, Open PR gated; Clarify/Checklist/Analyze/Implement flow through.
- **Fast** — only Self-Review and Open PR gated.

Self-Review and Open PR are **never** ungated — code never becomes a PR without an explicit human approval.

### 4.2 Feedback model

At any gate: **Approve** (advance), **Request changes** (free-text → the runner re-drives that spec-kit command with the feedback), **Comment** (non-blocking, logged), **Edit** (hand-edit the artifact → re-review), **Reject** (discard artifact, re-run), **Revoke** (un-approve an upstream phase → downstream goes `stale`). Per-file confirm is available during Implement.

### 4.3 Large-ticket check-ins

A check-in is a **batch-level gate** at a `tasks.md` section boundary. The agent completes a batch (its tasks pass), stops, and shows a partial-diff summary before continuing. This keeps each reviewed diff small and lets the user redirect, pause, or split remaining work into a follow-up ticket — preventing an unreviewable mega-diff from forming.

---

## 5. Phase Model (Spec Kit + 2)

The orchestration is the spec-kit SDD cycle, extended with two tail phases.

| #   | Phase                   | Spec-kit command the runner drives                     | Artifact               | Default gate               |
| --- | ----------------------- | ------------------------------------------------------ | ---------------------- | -------------------------- |
| 1   | Constitution            | reads `.specify/memory/constitution.md`                | constitution.md        | auto if unchanged          |
| 2   | Specify                 | `/speckit-specify` (from the **ticket**)               | `spec.md`              | required                   |
| 3   | Clarify                 | `/speckit-clarify`                                     | `spec.md`              | required                   |
| 4   | Plan                    | `/speckit-plan`                                        | `plan.md`              | required                   |
| 5   | Checklist               | `/speckit-checklist`                                   | `checklists/`          | optional                   |
| 6   | Tasks                   | `/speckit-tasks`                                       | `tasks.md`             | required                   |
| 7   | Analyze                 | `/speckit-analyze`                                     | `tasks.md` (validated) | required                   |
| 8   | Implement               | `/speckit-implement` (batched for large)               | code + tests           | required, per-file confirm |
| 9   | **Self-Review** _(new)_ | format · lint · `vitest --coverage` · `/google-review` | `review.json`          | required                   |
| 10  | **Open PR** _(new)_     | `gh pr create` + ticket write-back                     | PR URL                 | required                   |

The review-gate state model (locked → ready → running → awaiting_review → approved, plus stale/modified/failed/skipped) is the same gate discipline Spec Kit's review cycle already provides; phases 9–10 plug into the same gate UX.

---

## 6. The Agent Runner

The runner is what makes the spec-kit cycle autonomous. It is a thin driver around the Claude Agent SDK; it does not own orchestration — Spec Kit does.

- **Drives one spec-kit command per phase.** For a phase, the runner launches a headless Claude Agent SDK run in a git worktree with the feature context so far, the constitution + `CLAUDE.md`, and the instruction to run that phase's spec-kit command and stop. Spec Kit produces the artifact; the run yields.
- **Gate on artifact.** When the artifact lands, the gate opens for review. This is identical to a human running the command by hand — the runner just removes the human keystroke.
- **Constitution enforcement is inherent.** Constitution is phase 1 of the spec-kit cycle and is in every run's context; Self-Review verifies the result with the same `/google-review` the constitution mandates for humans.
- **Isolation & safety.** Implement and later phases run in a worktree (core `git.createWorktree`); a checkpoint commit precedes Implement; `disallowedPaths` blocks secret/CI edits without confirm; runs only ever open a PR — never force-push, touch `main`, or merge.

This mirrors how mature ticket→PR systems work: normalize the ticket, hand a scoped skill set to an agentic worker, manage context/checkpoints/permissions, and end at a reviewable PR ([Port](https://docs.port.io/guides/all/automatically-resolve-tickets-with-coding-agents/), [Cognition](https://cognition.com/blog/how-cognition-uses-devin-to-build-devin)).

---

## 7. Ticket Integration

|            | Linear                                                                         | Jira                            |
| ---------- | ------------------------------------------------------------------------------ | ------------------------------- |
| Auth       | Personal API key                                                               | API token + email (Cloud) / PAT |
| Read       | Issues assigned to me by team/project                                          | JQL                             |
| Dispatch   | Create `specs/NNN-slug/`, write `ticket.md` seed, drive Constitution + Specify | same                            |
| Write-back | Comment with PR URL; optional status → In Review                               | Comment + transition            |

Tokens live in the main process (`electron-store`, keychain-backed where available) — never in the repo or the isolated webview. Linear/Jira SDKs go in `extensions/speckit-pilot/package.json`, not the root (extension constitution). New IPC: `speckit:ticket-list`, `speckit:ticket-dispatch`, `speckit:ticket-writeback`, `speckit:phase-run`, `speckit:run-stream`.

Dispatch creates the next-numbered feature dir, drops a `ticket.md` seed (title, body, acceptance criteria, source URL) that `/speckit-specify` consumes, and records the ticket in run state. From there it is an ordinary spec-kit feature.

The PR (`gh pr create`, the path the git-integration extension already uses) links the ticket and the generating `spec.md`/`plan.md`. **Open in Code Reviews** routes to the existing PR-review surface.

---

## 8. Architecture

The product = **Spec Kit (orchestration) + a new UI + a runner + ticket I/O + two tail phases.**

```
extensions/speckit-pilot/
├── manifest.json            # projectTab "SpecKit"
├── package.json             # + @linear/sdk, jira client
└── src/
    ├── index.ts             # IPC: ticket I/O, phase-run, run-stream, gates, persistence
    ├── orchestration/       # drives Spec Kit
    │   ├── speckit-driver.ts    # maps phase → spec-kit command; invokes via worktree
    │   └── phase-model.ts       # 10-phase model incl. review + pr; gate state
    ├── agent/
    │   ├── runner.ts            # headless Claude Agent SDK per phase
    │   └── phase-prompts.ts     # scoped prompt + stop condition per phase
    ├── integrations/
    │   ├── linear.ts
    │   └── jira.ts
    └── renderer/                # NEW UI — replaces the old views
        ├── App.tsx              # routes: inbox | run | settings
        ├── InboxView.tsx        # ticket inbox + dispatch (screens 1–2)
        ├── RunDashboard.tsx     # 10-phase rail + console (screen 3)
        ├── GatePanel.tsx        # artifact + approve/request-changes/edit (screen 4)
        ├── TasksBoard.tsx       # kanban + batch check-in (screen 5)
        ├── SelfReviewPanel.tsx  # quality gates (screen 6)
        ├── PrPanel.tsx          # seat PR card (screen 7)
        └── SettingsView.tsx     # integrations + autonomy + gates (screen 8)
```

**What we keep from the existing extension** only where it serves the flow: the idea of a per-feature state file + audit log (`.pilot/state.json`, `history.jsonl`), the gate state transitions, and artifact-change detection. **What we replace:** the entire renderer/UI. **What's new:** orchestration driver over spec-kit commands, the agent runner, ticket I/O, and phases 9–10. Treat the old backend as reference, not a fixed foundation — rebuild it where the flow needs something different.

### 8.1 Run state

```ts
TicketRun {
  id, feature: 'specs/NNN-slug',
  ticket: { source: 'linear'|'jira', key, url, title },
  autonomy: 'guided'|'standard'|'fast',
  worktreePath, branch,
  phases: Record<PhaseId, { status, artifactPaths, approvedAt, approvedBy, lastRunId }>,
  pr?: { url, number, branch },
}
```

Persisted per feature with an append-only `history.jsonl` audit log (actor, ts, action), satisfying the traceability HITL governance expects ([Permit.io](https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo)).

---

## 9. UX Principles

1. **Human-first, discoverable** — the next action is always obvious at the active gate ([clig.dev](https://clig.dev/)).
2. **Summarize at gates, logs on demand** — gates show a decision-ready artifact summary; the run console is collapsible.
3. **Supervised autonomy** — autonomy levels map to which spec-kit gates require approval; the agent moves fast when safe, stops when a human decision adds value.
4. **One coherent layout** — a single SpecKit view drives the whole flow; no scattered panels.
5. **Everything reversible & auditable** — reject/revoke/stale-propagation and `history.jsonl`.

---

## 10. Success Metrics

| Metric                                                   | Target                        |
| -------------------------------------------------------- | ----------------------------- |
| PR acceptance (agent PRs merged without major rework)    | ≥ 60% within a quarter of use |
| Time-to-first-artifact (dispatch → spec.md ready)        | < 5 min median, S/M tickets   |
| Rework loops per phase (request-changes before approval) | ≤ 2 median                    |
| Self-Review first-pass (reaches PR, no failed gate)      | ≥ 70%                         |
| Abandonment (dispatched runs cancelled)                  | < 20%                         |

We deliberately do **not** optimize for minimizing human involvement; the goal is supervised autonomy, and we measure whether the human stays in control ([StackAI](https://www.stackai.com/insights/human-in-the-loop-ai-agents-how-to-design-approval-workflows-for-safe-and-scalable-automation)).

---

## 11. Risks & Mitigations

| Risk                                                            | Mitigation                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Agent writes a plausible-but-wrong `spec.md` past a rushed gate | Specify/Plan/Tasks gated; spec-kit's Clarify/Analyze catch gaps; reject re-runs cheaply                              |
| Self-Review becomes a rubber stamp                              | Surface real numbers (coverage %, lint count, `/google-review` BLOCKERs); PR still goes through human Code Review    |
| Token leakage                                                   | Tokens only in main-process `electron-store`; never in repo/webview/PR                                               |
| Large ticket → unreviewable diff                                | Task-batch check-ins; per-file confirm; spec-kit already chunks into `tasks.md`                                      |
| Tracker API drift                                               | Integrations isolated; Zod-validated at the boundary; ingest failure is a toast (constitution Principle VII)         |
| Spec-kit command invocation drift across versions               | The orchestration driver centralizes the phase→command mapping in one file; pinned to the installed spec-kit version |
| Over-trust of Fast mode                                         | Self-Review + Open PR gates never removable                                                                          |

---

## 12. Open Questions (resolve during Clarify)

1. **Runner mechanism** — drive spec-kit by shelling the `claude` CLI in a worktree, or embed the Agent SDK in-process? (Lean: CLI in worktree — matches how spec-kit commands already run.)
2. **One PR per feature vs. per task-batch** for very large tickets. (Lean: single PR default.)
3. **Checklist phase** — keep optional, or require it for agent runs to raise quality?
4. **Write-back default** — auto-transition the ticket on PR open, or opt-in?
5. **How much constitution/context to inject per phase** before hitting token/cost limits.

---

## Sources

- [Command Line Interface Guidelines (clig.dev)](https://clig.dev/)
- [StackAI — Designing HITL Approval Workflows](https://www.stackai.com/insights/human-in-the-loop-ai-agents-how-to-design-approval-workflows-for-safe-and-scalable-automation)
- [Permit.io — HITL for AI Agents: Best Practices](https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo)
- [Orkes — Human-in-the-Loop in Agentic Workflows](https://orkes.io/blog/human-in-the-loop/)
- [MindStudio — Issue Trackers as AI Agent Infrastructure](https://www.mindstudio.ai/blog/issue-trackers-ai-agent-infrastructure-jira-linear)
- [Cognition — How Cognition Uses Devin to Build Devin](https://cognition.com/blog/how-cognition-uses-devin-to-build-devin)
- [Port — Automatically resolve tickets with coding agents](https://docs.port.io/guides/all/automatically-resolve-tickets-with-coding-agents/)
