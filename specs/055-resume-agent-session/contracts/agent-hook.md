# Contract: the capture hook

## Installation

- One entry merged into `~/.claude/settings.json` under `hooks.SessionStart`, with `matcher: "*"`.
- Its command runs Terminator's own script, written to `userData/integrations/agent-session-hook.cjs`, the way the existing context hook is written and run (`ELECTRON_RUN_AS_NODE=1`, the application's binary, then the script path).
- Identifiable by that script path, so re-installing replaces exactly one entry and never stacks up copies.
- Merge, never replace: every other `SessionStart` entry, and every other key in the file, is left as it was. A file that cannot be parsed is left alone and reported, never overwritten.
- Installed once at startup. Removing it is a documented manual step (research R8).

## What the hook is given

Verified live on Claude Code 2.1.273. On stdin, one JSON object:

```json
{
  "session_id": "b610a882-41f3-4833-a6a3-dc3a33aea060",
  "transcript_path": "/Users/you/.claude/projects/<slug>/<session_id>.jsonl",
  "cwd": "/Users/you/code/repo",
  "hook_event_name": "SessionStart",
  "source": "startup"
}
```

`source` is `resume` when the conversation was resumed, with the same `session_id`.

From its environment: `TERMINATOR_SESSION_ID`, the terminal the agent is running in.

## What the hook does

- Writes `userData/agent-sessions/<TERMINATOR_SESSION_ID>.json` (see data-model → HookReport), replacing what was there.
- Writes nothing when `TERMINATOR_SESSION_ID` is absent: the conversation is in a terminal this application does not own.
- Prints nothing and exits 0 whatever happens. A hook that fails loudly delays or breaks every session start; the context hook already holds this line.

## What the main process does

- Watches `userData/agent-sessions/` and folds each report into the named session's record, creating the record if the session has none.
- Ignores a report naming a session it does not know.
