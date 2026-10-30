# ADR-013: SpecKit Pilot invokes native `/speckit-*` skills and supports run-console replies

**Status:** Accepted
**Date:** 2026-07-03

## Context

The headless phase runner had two problems:

1. **Freeform prose prompts made runs wander.** Each phase ran a hand-written
   instruction ("write a spec in spec.md…"). The agent had no feature-dir
   convention. It wrote artifacts at the repo root, asked where files should
   go, and could not tell which of N specs it was working on. SpecKit already
   ships stage skills (`/speckit-specify`, `-plan`, `-tasks`, …) that encode all
   of this.
2. **No way to answer the model.** `claude --print` is one-shot and non-interactive.
   When a stage (especially `/speckit-clarify`) asked a question, there was no
   channel to answer it.

## Decisions

### 1. Invoke the native `/speckit-*` skills (SpecKit mode)

`PHASE_COMMANDS` now maps each SpecKit-mode phase to its skill:
`constitution → /speckit-constitution`, `specify → /speckit-specify <title>`,
`clarify → /speckit-clarify`, `plan → /speckit-plan`, `checklist → /speckit-checklist`,
`tasks → /speckit-tasks`, `analyze → /speckit-analyze`, `implement → /speckit-implement`.
Quick-fix mode keeps prose prompts. It skips specify/tasks, so the native skills have no
spec.md/tasks.md to read.

**Feature-dir resolution.** SpecKit resolves the feature dir from the git branch
or `SPECIFY_FEATURE` / `SPECIFY_FEATURE_DIRECTORY` (via `.specify/scripts/bash/common.sh`).
The pilot's worktree branch (`feature/<slug>`) does not match its feature dir
(`specs/<slug>`). The runner therefore **exports `SPECIFY_FEATURE` and
`SPECIFY_FEATURE_DIRECTORY=specs/<slug>`** on every spawn. `/speckit-specify`
honors `SPECIFY_FEATURE_DIRECTORY` as the top-priority override and persists it
to `.specify/feature.json`. All downstream skills then operate on the same dir,
independent of the branch, and no new dir is minted.

**Prerequisite (not owned by the pilot).** The `/speckit-*` skills live in
`.claude/skills/` (untracked, per `.specify/integrations/claude.manifest.json`).
They must be installed and reachable where the agent runs (i.e. in the worktree).
Install them via the `specify` CLI's Claude integration. If they are absent, the agent
falls back to freeform behavior.

### 2. Reply to the model from the run console

The runner captures the Claude `session_id` from the stream-json output
(`sessionIdFromStreamJsonLine`) and reports it via `onSession`. The pilot stores
it per card. A chat input under the run console posts to `speckit:run-reply`.
That channel resumes the conversation (`claude --print --resume <id> …`) with the user's
text and streams the answer back into the same console. The reply reuses the
phase's completion callbacks, so the gate re-evaluates when the model finishes.

## Consequences

- Runs stay inside `specs/<slug>` and stop asking where files go.
- `/speckit-clarify` becomes usable. The user can answer its questions inline.
- The pilot depends on the SpecKit Claude skills being installed in worktrees.
  This is a documented prerequisite. The pilot does not install them.
- Replies resume the same session, so the model answers with full context.
