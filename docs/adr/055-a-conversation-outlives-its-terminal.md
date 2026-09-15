# ADR 055: A conversation outlives its terminal

**Status**: Accepted

**Date**: 2026-09-15

**Builds on**: [ADR 054](054-overview-is-a-wall-sessions-carry-context.md) (session records) and [ADR 026](026-supervised-runs-in-a-terminal.md) (a hook script carried as source and written at startup).

## Context

A terminal's process dies with the app; the agent's conversation does not. Claude Code keeps a transcript per conversation and will resume one by id, so the work an operator did with an agent survives long after the terminal that hosted it — but Terminator knew nothing about that id, so a crashed agent, a closed tab or a restart lost the thread.

Three things were checked live against Claude Code 2.1.273 before any of this was designed, because none of it is behaviour a document promises:

1. The `SessionStart` hook's payload carries `session_id`, `transcript_path`, `cwd` and `source` (`startup` or `resume`).
2. A per-terminal environment variable set when Terminator spawns the PTY is visible to that hook, because the hook runs beneath the agent.
3. `claude --resume <id>` restores the conversation. A session told to remember 4242, exited and resumed, answered 4242 — and the hook fired again with the same id and `source: "resume"`.

## Decision

1. **The conversation id is captured from the agent, through a hook in the operator's own Claude settings.** One entry merged into `~/.claude/settings.json`, identifiable by Terminator's script path, installed once at startup. The existing per-project hook stays what it is — issue context, tied to a link — and this one has a single job.
2. **The terminal is named by the environment.** `terminal:create` exports `TERMINATOR_SESSION_ID`; the hook writes `userData/agent-sessions/<terminal id>.json`. This is exact where matching on time or folder is a guess, and it covers a `claude` the operator typed themselves. A conversation in a terminal outside Terminator names no terminal and is ignored.
3. **The facts live on the session record** from ADR 054, which already survives restarts and is pruned 30 days after close. A record now exists for a session whose only context is a captured conversation.
4. **Resume is offered, never automatic.** An exited or closed session whose transcript still exists offers Resume; a restart starts no agents on its own. A session whose transcript has gone says so where the button would be, rather than offering one that fails.
5. **Resuming replaces the exited terminal.** A new terminal opens on the same branch in the recorded folder, `claude --resume <id>` is written into it, one call moves the description, link and conversation across, and the exited tab closes. One terminal per conversation.
6. **The provider is named, not assumed.** `provider: 'claude'` on the record, and one pure function turning a conversation into a command line, so a second agent is a branch rather than a rewrite.

## Alternatives considered

- **Install the hook in every repository** (today's per-project mechanism, widened): covers hand-started sessions, but writes `.claude/settings.local.json` into every repo Terminator knows. The operator chose the single user-level entry.
- **Pass `--settings` only when Terminator launches the agent**: installs nothing anywhere, but a `claude` typed by hand — the common case — could never be resumed.
- **Infer the conversation from the transcript directory** by folder and time: no reliable answer when two terminals on one branch start seconds apart.
- **Resume everything at launch**: fastest to pick up, but a restart would spawn several agents unasked. Rejected by the operator.
- **An append-only capture log**: grows without bound and needs de-duplication to answer "the most recent conversation in this terminal", which one file per terminal answers by existing.

## Consequences

- Terminator writes into a file it does not own, `~/.claude/settings.json`. The write is merged, identifiable and idempotent, a file that cannot be parsed is never overwritten, and the user guide says how to remove the entry. No uninstall command ships, because nothing in the app would call it (Constitution X).
- Capture depends on the hook running. An operator who removes the entry, or runs an agent that is not Claude Code, gets no Resume — and no promise of one.
- A conversation is only resumable on the machine holding its transcript. The record may travel; the transcript does not, and the stat that decides `resumable` is what makes that visible rather than confusing.
- Anything that can write `~/.claude/settings.json` can make the hook run a command of its choosing. That was already true of Claude Code's own settings; this feature adds one entry to it and does not widen who may write there.
