# ADR 059: Foundry's prompts fit Claude Opus 5.5, and a command runs without an agent

**Status**: Accepted

**Date**: 2026-09-24

**Amends**: [ADR 050](050-effort-is-a-property-of-the-shape.md). ADR 050 is not edited. Its premise that "the default is `high` on every current model" no longer holds, and this ADR records what replaced it.

## Context

Foundry's deep roles run Claude Code's `opus` alias, which now resolves to Claude Opus 5.5. A prompt audit against that model (`docs/research/prompt-audit-2026-09-24.md`) found three problems:

- **Effort was sized for the previous Opus.** Claude Opus 5.5 defaults to `medium`, and at a given level it thinks more per turn than Claude Opus 5, most of all at `xhigh`. Anthropic's guidance is to start at `medium` and keep `xhigh` for measured gains. `quick` and `spike` said they wanted the model's default and set `high`, above it. Six shapes ran at `xhigh` with nothing measured.
- **Each verification command spent an agent turn.** Every ladder rung (lint, the unit's tests, coverage) started a model turn told "Run this exactly, and report its exit status". The verdict was then read back out of that agent's transcript, never from what the agent said. Doing it this way cost a model turn per rung, plus a race between the turn ending and the transcript being flushed, which needed a bounded retry.
- **Prompt text written for the previous model.** It included incident narratives in the architect prompt, a shouting header in `CLAUDE.md`, and a transcript view that rendered only `text` blocks. Claude Opus 5.5 writes its notes between tool calls as `thinking` blocks.

## Decision

- **Every shape drops one effort level.** `quick`, `spike`, `research` and `poc` run at `medium`. `direct`, `standard`, `bugfix`, `refactor`, `speckit` and `design-doc` run at `high`. Effort stays declared on every shape, because the default differs between models.
- **A ladder rung runs its command in a terminal tab of its own, with no agent.** `SupervisedRunner.runCommand` opens a plain tab in the lane's checkout and types `sh <script>; exit $?`. The script echoes the command, then runs it. The tab's exit status is the verdict, and the tab stays open, exited, as the record of what ran. `rungExitCode`, `settledRungExitCode` and `ladderNode` are deleted.
- **The prompt text is plain.** The architect and converge prompts keep each rule with its reason, without the incident that motivated it. `CLAUDE.md` states the constitution rule at normal volume. The transcript view renders non-empty `thinking` blocks.

## Alternatives considered

- **Run a rung on the fast tier instead of the deep one.** This was the audit's first proposal. It is cheaper, but it keeps both the agent and the transcript race.
- **Keep `xhigh` and measure first.** Rejected as the default: every order would pay for the old model's levels until someone measured them. The new levels are the starting point; measure one order per shape at each level before moving any shape back up.

## Consequences

- A rung no longer goes through the autonomy policy. It never needed it: the rung's `mayUseTool` already allowed everything, and its command comes from the toolchain probe, not from an agent.
- A rung that hangs holds its lane, exactly as an agent that never ended its turn did before.
- Recipe `kind: run` steps are unchanged, and still reach an agent. They also carry Spec Kit slash commands, which need one. That is recorded as follow-up work in the pull request that introduced this ADR.
