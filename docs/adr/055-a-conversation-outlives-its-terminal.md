# ADR 055: A conversation outlives its terminal

**Status**: Accepted

**Date**: 2026-09-15

**Builds on**: [ADR 054](054-overview-is-a-wall-sessions-carry-context.md) (session records) and [ADR 026](026-supervised-runs-in-a-terminal.md) (a hook script carried as source and written at startup).

## Context

A terminal's process dies with the app. The agent's conversation does not. Claude Code keeps a transcript per conversation and resumes one by id. So the work that an operator did with an agent survives long after the terminal that hosted it. But Terminator knew nothing about that id, so a crashed agent, a closed tab or a restart lost the thread.

We checked three things live against Claude Code 2.1.273 before we designed any of this, because no document promises this behaviour:

1. The `SessionStart` hook's payload carries `session_id`, `transcript_path`, `cwd` and `source` (`startup` or `resume`).
2. A per-terminal environment variable, set when Terminator spawns the PTY, is visible to that hook, because the hook runs beneath the agent.
3. `claude --resume <id>` restores the conversation. We told a session to remember 4242, exited, and resumed. It answered 4242, and the hook fired again with the same id and `source: "resume"`.

## Decision

1. **A hook in the operator's own Claude settings captures the conversation id from the agent.** One entry, merged into `~/.claude/settings.json` and identifiable by Terminator's script path, is installed once at startup. The existing per-project hook stays what it is: issue context, tied to a link. This one has a single job.
2. **The environment names the terminal.** `terminal:create` exports `TERMINATOR_SESSION_ID`, and the hook writes `userData/agent-sessions/<terminal id>.json`. This is exact where matching on time or folder is a guess, and it covers a `claude` that the operator typed. A conversation in a terminal outside Terminator names no terminal, and Terminator ignores it.
3. **The facts live on the session record** from ADR 054. That record already survives restarts, and Foundry prunes it 30 days after close. A record now exists for a session whose only context is a captured conversation.
4. **Terminator offers Resume and never resumes automatically.** An exited or closed session whose transcript still exists offers Resume. A restart starts no agents on its own. A session whose transcript has gone says so where the button would be. It does not offer a button that fails.
5. **Resuming replaces the exited terminal.** A new terminal opens on the same branch in the recorded folder, and Terminator writes `claude --resume <id>` into it. One call moves the description, link and conversation across, and the exited tab closes. Each conversation has one terminal.
6. **The record names the provider. It does not assume one.** The record carries `provider: 'claude'`. One pure function turns a conversation into a command line, so a second agent is a branch and not a rewrite.

## What building it added

- **The entry outlives the install that wrote it.** The operator's settings hold one entry that names a script inside an application data directory. That directory differs between a packaged app, a development run and a test profile. So Terminator matches the entry by script _name_, not path: one entry, whichever install last wrote it. The command is guarded (`test -f <script> && … || true`). A hook whose script has gone does nothing. It does not fail before every agent session on the machine.
- **Resumability is a fact about right now.** We first read whether a transcript exists once, at launch. Deleting a transcript then left Home offering a Resume that could not work. Every surface that draws Resume now asks again as it appears. The identical before/after screenshots found this. No test did.
- **We proved it live against Claude Code 2.1.273.** We started a conversation by hand and told it to remember a number. The hook captured it. We ended it with `/exit`, resumed it from Home's wall, and asked again. It answered. `tests/e2e/live/resume-live.spec.ts` is that run, and it restores the operator's `~/.claude/settings.json` afterwards.

## Alternatives considered

- **Install the hook in every repository** (today's per-project mechanism, widened). This covers hand-started sessions, but it writes `.claude/settings.local.json` into every repo that Terminator knows. The operator chose the single user-level entry.
- **Pass `--settings` only when Terminator launches the agent.** This installs nothing anywhere, but a `claude` typed by hand, which is the common case, could never be resumed.
- **Infer the conversation from the transcript directory** by folder and time. This gives no reliable answer when two terminals on one branch start seconds apart.
- **Resume everything at launch.** This is the fastest way to pick up, but a restart would spawn several agents unasked. The operator rejected it.
- **An append-only capture log.** This grows without bound. It also needs de-duplication to answer "the most recent conversation in this terminal", which one file per terminal answers by existing.

## Consequences

- Terminator writes into a file that it does not own, `~/.claude/settings.json`. The write is merged, identifiable and idempotent. Terminator never overwrites a file that it cannot parse, and the user guide says how to remove the entry. No uninstall command ships, because nothing in the app would call it (Constitution X).
- Capture depends on the hook running. An operator who removes the entry, or who runs an agent that is not Claude Code, gets no Resume and no promise of one.
- A conversation is resumable only on the machine that holds its transcript. The record may travel. The transcript does not. The stat that decides `resumable` makes that visible and avoids confusion.
- Anything that can write `~/.claude/settings.json` can make the hook run a command of its choosing. That was already true of Claude Code's own settings. This feature adds one entry to the file and does not widen who may write there.
