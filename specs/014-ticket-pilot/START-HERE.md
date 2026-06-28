# 014 — Start Here: trigger Spec Kit for this feature

This folder is a Spec-Kit-ready feature. Contents:

| File              | What it is                                                                           |
| ----------------- | ------------------------------------------------------------------------------------ |
| `spec.md`         | The feature spec in Spec-Kit template format — the input to `/speckit-plan`.         |
| `prd.md`          | Full PRD (rationale, flow, architecture, risks). Reference, not a spec-kit artifact. |
| `renderings.html` | The end-to-end UI (8 screens). Open in a browser. This is the target layout.         |
| `ticket.md`       | A seed you can paste into `/speckit-specify` if you'd rather regenerate `spec.md`.   |

**Orchestration:** Spec Kit runs the cycle. You drive these commands in a Claude Code terminal inside Terminator; the agent produces each artifact and you approve between phases.

> **Commands use hyphen notation** (post-upgrade): `/speckit-specify`, `/speckit-clarify`, `/speckit-plan`, `/speckit-checklist`, `/speckit-tasks`, `/speckit-analyze`, `/speckit-implement`. (The earlier dot form, `/speckit.specify`, is gone.) Type `/speckit-` in your command menu to see the list.

---

## Recommended path — use the spec already written (skip Specify)

You already have a finished `spec.md`, so go straight to Plan.

```bash
# 1. Be on the feature branch Spec Kit will derive from the dir name
git checkout -b 014-ticket-pilot      # or: git checkout 014-ticket-pilot

# 2. (optional) resolve the deferred decisions in spec.md §Clarifications
/speckit-clarify

# 3. Generate the implementation plan from spec.md
/speckit-plan

# 4. Generate the task list
/speckit-tasks

# 5. (optional) cross-check spec ↔ plan ↔ tasks for gaps
/speckit-analyze

# 6. Implement (TDD, per the constitution)
/speckit-implement
```

Approve/refine the artifact each phase produces (`plan.md`, `tasks.md`, …) before moving on — that is the human gate.

---

## Alternative path — regenerate the spec from the seed

If you'd rather let Spec Kit author `spec.md` from scratch:

```bash
/speckit-specify "$(cat specs/014-ticket-pilot/ticket.md)"
```

Spec Kit will create its own next-numbered feature dir and branch and write a fresh `spec.md`. Use this folder's `spec.md`/`prd.md`/`renderings.html` as the reference to steer and approve it. (Downside: it won't keep the `014` number.)

---

## What you're signing up to build (scope `/speckit-plan` will expand)

This is a UI replacement + new orchestration/runner work on `extensions/speckit-pilot/`. Rough shape, smallest-shippable-first:

1. **Phase model + gates (M1)** — 10-phase model incl. `review` + `pr`; gate state transitions; the orchestration driver that maps each phase to a spec-kit command. _No agent yet._
2. **Self-Review + Open PR phases (M2)** — format/lint/`vitest --coverage`/`/google-review`; `gh pr create`. Works on an existing feature even before the agent runner — ships value to your current manual flow.
3. **Agent runner (M3)** — `speckit:phase-run` drives each spec-kit command headless in a worktree; streams to the run console.
4. **Ticket front-door (M4)** — Linear/Jira ingest + dispatch creates the feature dir and seeds Specify; write-back.
5. **Batch check-ins + autonomy levels (M5)** — task-batch gating during Implement; Guided/Standard/Fast presets.
6. **New UI (cross-cutting)** — replace the old SpecKit views with the inbox → run dashboard → gates → tasks board → self-review → PR layout in `renderings.html`; **remove the retired views** (no dead code).
7. **Tests + docs (per constitution)** — ≥80% coverage on every new file; update `README.md` SpecKit Pilot entry, `docs/ARCHITECTURE.md`, a new ADR, and `specs/004-…/contracts`.

Each milestone is independently shippable; M1–M2 improve today's manual flow before the agent lands.

---

## Constitution reminders (these are enforced)

- Run `find-reuse` before new code; write the failing test first (Red → Green → Refactor).
- `npm run format` · `npm run lint` (0 errors) · `npx vitest run --coverage` (all ≥80%) · `npm run build:extensions` before done.
- Run `/google-review` and clear all BLOCKERs before committing.
- Ship docs in the same change (see the documentation table in `CLAUDE.md`).
