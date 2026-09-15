# Implementation Plan: Resume an agent session

**Branch**: `055-resume-agent-session` | **Date**: 2026-09-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/055-resume-agent-session/spec.md`

**Builds on**: feature 054 (`054-session-home-wall`, PR #182, not yet merged). This branch is cut from it and should land after it.

## Summary

- **Capture**: a `SessionStart` hook, merged once into the operator's own Claude settings, writes each conversation's id, transcript path and folder to a file named by the terminal it ran in. The terminal is known because `terminal:create` exports `TERMINATOR_SESSION_ID`.
- **Keep**: those facts join feature 054's `SessionRecord`, so they survive a restart and are pruned with it. A record now also exists for a session whose only context is a captured conversation.
- **Offer**: Home and the wall show **Resume** on an exited or closed session whose transcript still exists, and say so plainly when it does not.
- **Resume**: opens a terminal on the same branch in the recorded folder, writes `claude --resume <id>` into it, moves the old session's description, link and conversation to it in one call, and closes the exited terminal.

## Technical Context

**Language/Version**: TypeScript 5.5.4 in the Electron 42.4.1 main and renderer processes.

**Primary Dependencies**: React 18.3.1, Zustand 4.5.5, `xterm` 5.3.0, Zod, lucide-react, `node-pty`. No new dependencies.

**External contract**: Claude Code 2.1.273 — `SessionStart` hook payload, `--resume <id>`, and user-level settings merging. All three verified live (research R1, R2, R7); none of them is documented behaviour this plan can lean on without checking.

**Storage**: feature 054's `userData/session-records.json`, plus a new `userData/agent-sessions/` directory the hook writes into and the main process watches. One entry merged into `~/.claude/settings.json`.

**Testing**: Vitest 4.1.9 (jsdom for the renderer), Playwright 1.61.0 for e2e, and one live run behind `E2E_LIVE=1`.

**Target Platform**: macOS arm64 desktop.

**Performance Goals**: a conversation is resumable within 5 seconds of the agent starting (SC-001); the resumed terminal shows within 5 seconds of pressing Resume (SC-004).

**Constraints**:

- Nothing may start an agent on its own (SC-007).
- The hook must exit 0 and print nothing, whatever happens: it runs before every agent session in every folder.
- Never overwrite settings that cannot be parsed, in the operator's Claude config or in a repo.
- Core only; no Extension API change.

**Scale/Scope**: a few hundred records; one hook file; three surfaces gaining one control.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design._

| Principle                   | Status        | How                                                                                                                                                    |
| --------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I. Source Integrity         | Pass          | New code under `src/` and `tests/` only. The hook script is carried as source and written at startup, as ADR-026 requires.                             |
| II. Extension Isolation     | Pass          | All core. The hook is Terminator's own script, not an extension's; no extension is named, called or depended on.                                       |
| IV. Dependency Stewardship  | Pass          | No new packages.                                                                                                                                       |
| V. Readability & Minimalism | Pass          | One capture route, one store, one resume path. No settings toggle and no removal command until asked for (research R8).                                |
| VI. TDD (80%)               | Pass, planned | Failing specs first for the hook script, the watcher, the record changes, the IPC, the pure planner and each surface.                                  |
| VII. SOLID / YAGNI          | Pass          | Reuses `installProjectHook`'s shape, the record store, `terminal:create`, and 054's surfaces. `provider` keeps a second agent a branch, not a rewrite. |
| VIII. Documentation         | Pass, planned | Same PR: ARCHITECTURE (persistence table, a Resume section), README, the user guide — including how to remove the hook — and ADR 055.                  |
| IX. ADRs                    | Pass          | `docs/adr/055-a-conversation-outlives-its-terminal.md`, written with this plan.                                                                        |
| X. Code Cleanliness         | Pass, planned | No dead exports: no uninstall function ships because nothing would call it. Lint at 0.                                                                 |
| XI. Purity                  | Pass          | `resumeCommand`, `planResume` and the report parser are pure; side effects stay in the store, the watcher and the IPC layer.                           |
| XII. Icons                  | Pass          | Resume uses a flat lucide icon inheriting text colour.                                                                                                 |

**Post-design re-check**: passes. One thing to keep honest: the feature writes into a file outside the application's own data (`~/.claude/settings.json`). The operator chose that, the write is merged and identifiable, and the user guide says how to undo it.

## Project Structure

### Documentation (this feature)

```text
specs/055-resume-agent-session/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── agent-hook.md
│   ├── session-records-ipc.md
│   └── ui-surfaces.md
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks
```

### Source Code (repository root)

```text
src/shared/
├── types/index.ts                        # AgentConversation; SessionRecord.agent; resumable on the wire
├── schemas/session-records.schema.ts     # transfer input; agent shape
└── agent-sessions/report.ts              # new, pure: parse and validate a hook report

src/main/
├── agents/agent-session-hook.ts          # new, the hook script source + user-settings install
├── agents/agent-session-watcher.ts       # new, watches userData/agent-sessions and folds reports in
├── sessions/session-record-store.ts      # setAgent, transfer, widened existence rule, resumable
├── ipc/session-records.ipc.ts            # transfer; resumable on list and changed
├── ipc/terminal.ipc.ts                   # TERMINATOR_SESSION_ID; initialCommand
└── index.ts                              # install the hook, start the watcher

src/renderer/
├── sidebar/resume.ts                     # new, pure: resumeCommand, planResume
├── sidebar/session-facts.ts              # facts carry agent + resumable
├── terminal/start-session.ts             # resumeSession: create, command, transfer, close the old
├── components/session/ResumeButton.tsx   # new
├── components/home/LedgerView.tsx        # Resume in the row
├── components/home/LogbookView.tsx       # Resume in the detail
└── components/overview/WallTile.tsx      # Resume in the footer

tests/
├── unit/shared/agent-sessions/report.spec.ts
├── unit/agents/agent-session-hook.spec.ts        # the script's behaviour, and the settings merge
├── unit/agents/agent-session-watcher.spec.ts
├── unit/sessions/session-record-store.spec.ts    # extended
├── unit/ipc/session-records.ipc.spec.ts          # extended
├── unit/ipc/terminal.ipc.spec.ts                 # extended
├── unit/renderer/sidebar/resume.spec.ts
├── unit/renderer/components/ResumeButton.spec.tsx
├── unit/renderer/terminal/start-session.spec.ts  # extended
├── e2e/resume-session.spec.ts
└── e2e/live/resume-live.spec.ts                  # the run that proves it

docs/
├── ARCHITECTURE.md
├── adr/055-a-conversation-outlives-its-terminal.md
└── user-guide/USER-GUIDE.md
README.md
```

**Structure Decision**: the existing single Electron project. Capture is a new `src/main/agents/` pair — script and watcher — beside the integrations module whose hook it is modelled on. Everything the surfaces need stays in 054's record and pure layer.

## Delivery order

1. **Capture (US1, US2 foundation)**: types and report parser, the hook script and its user-settings install, `TERMINATOR_SESSION_ID`, the watcher, and `setAgent` on the record store. Ends with quickstart §3 passing by hand.
2. **Offer (US1, US3)**: `resumable` on the wire, the pure planner, the Resume control on all three surfaces, and the "no longer available" case.
3. **Resume (US1)**: `initialCommand`, `transfer`, `resumeSession`, closing the exited terminal. Ends with quickstart §4 run live.
4. **Restart (US2)** and **hand-started sessions (US4)**: e2e over a relaunch; the live run already covers a hand-started agent, since that is how §4 starts one.
5. **Docs and ADR**, then quickstart §1–§6 with evidence in the PR.

## Complexity Tracking

No constitution violations to justify.
