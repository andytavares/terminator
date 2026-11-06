# ADR 142: A pull request event can resume an agent

**Status**: Accepted

**Date**: 2026-11-04

## Context

The README says "Terminator resumes nothing for you". An agent that stopped stays stopped until the operator sends it back. A failed check or a review comment on a pull request of mine then waits on Home until the operator notices. The operator can already send a failing check to an agent by hand ("Send to agent").

## Decision

For pull requests of mine, the git-integration extension wakes the agent on the branch when one of these happens after the app started:

- A check turns failed.
- Someone else posts a review or a comment.
- The branch starts to conflict with its base.

The extension compares each dashboard refresh with the one before (`src/home/pr-watch.ts`). The first refresh after the app starts only sets the baseline. The setting `terminator.git-integration.prWatch.enabled` (default on) turns the watch off.

A wake follows this order:

1. An agent session is live in the branch worktree: send it the prompt.
2. No session is live and a conversation is recorded: resume it once, then send the prompt.
3. Neither: send nothing. The "Send to agent" action stays.

Each prompt starts with "Sent by Terminator · pull request #N · wake k of 10", so the transcript shows who sent it. The state of each pull request is in the `pr-watch` store.

The watch stops, or skips, in these cases:

- The pull request merges or closes: the state is deleted.
- The pull request has had 10 wakes: Home shows "Wakes stopped".
- An agent the watch woke ends: the watch resumes no other agent. The SDK cannot tell Stop from an exit. It still prompts a live session later.
- The worktree has uncommitted changes and no live session: the agent did not make them.
- A conversation was already resumed for the pull request: at most one.

Each wake shows on Home as "Agent woken".

## Consequences

- The README rule "Terminator resumes nothing for you" holds everywhere except this case. The README and the user guide must name the exception and its limits.
- A wake counts as one use of `pr-watch-wake`.
- The wake limit counts every wake, not only wakes for comments, so one number tells the operator how far the agent has run.
- "Open agent" on Home raises the window. The SDK has no call that focuses one agent tab.
- The failed log is the end of the job log from the GitHub REST API, because `api.github` has no `gh run view` verb.
- The "Agent woken" rows are in memory. After a restart the rows are gone and the counts stay.
