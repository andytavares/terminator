# Contract: feeding an agent session

**Feature**: 031-linear-project-integration

This is the contract between Terminator and the agent runtime. Every claim below was verified
against Claude Code's published hook documentation or, where marked, against the binary itself
(ADR-026). The parts that fail **silently** are called out, because those are the ones that cost
a day.

## The three pieces

```
   link/issue/toggle changes
             │
             ▼
  <userData>/integrations/context/<projectId>.json     ← core writes
             ▲
             │ reads (nothing else)
   <projectDir>/.claude/settings.local.json            ← core merges an owned block
             │ registers
             ▼
        SessionStart hook  ──stdout──▶  agent runtime
```

The hook script holds **no credential**, makes **no network call**, and knows nothing about
trackers. It reads one file and prints. That is the whole of its authority.

## 1. The context file

`<userData>/integrations/context/<projectId>.json`

```json
{
  "projectId": "…",
  "tracker": "linear",
  "key": "TAV-42",
  "markdown": "# Linked issue: TAV-42\n…",
  "chars": 2143,
  "truncated": false,
  "builtAt": "2026-08-22T14:11:03.000Z"
}
```

Written whenever the link, the issue, or the per-project toggle changes; deleted on unlink.
Addressed by project id, so it survives a project rename and cannot collide.

## 2. The owned settings block

Merged into `<projectDir>/.claude/settings.local.json`. Verified from the documentation:
this file is the highest-precedence filesystem settings file, is gitignored by convention, and
hooks from all levels **merge** rather than replace.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "ELECTRON_RUN_AS_NODE=1 '<execPath>' '<hookScript>' '<contextFile>'",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

**Rules this write obeys** (FR-025):

- **Merge, never replace.** An existing `SessionStart` array keeps its entries; ours is appended.
- **Owned and identifiable.** Our entry is recognisable by the hook script path, so unlink can
  remove exactly it and nothing else.
- **`.claude/settings.json` is never touched.** Only `settings.local.json`.
- **Unwritable directory ⟹ loud failure.** The link is not created and the operator is told why
  (FR-026). Silently starting a session without context is the failure this rule exists to
  prevent.
- **Unlink restores.** After removal the file is byte-identical to its pre-link state where the
  operator has not otherwise edited it; if our block was the only content, the file is deleted
  along with an empty `.claude` directory we created (SC-010).

`ELECTRON_RUN_AS_NODE=1` with the application's own binary is the same invocation ADR-026 uses:
it means the hook needs neither a `node` on `PATH` nor whatever a login shell happened to export.
Without it, the script would launch a second copy of the application.

## 3. The hook script

Carried as a string constant in core and written to disk at startup — the pattern established by
`extensions/speckit-pilot/src/runtime/hook-script.ts`, for the reason recorded there: the bundler
produces one file per entry point, and a loose script beside it survives development and vanishes
from the packaged app.

**Output contract** — verified:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "…",
    "sessionTitle": "TAV-42"
  }
}
```

- `additionalContext` is added to the model's context at session start.
- `sessionTitle` names the session.
- **`hookEventName` is required.** Omit it and the entire object is ignored — silently. This is
  recorded in ADR-026 as established by running the binary, not by reading.
- stdout with **exit 0** is the channel.
- **Hook output fields are capped at 10,000 characters.** Past that the runtime writes the value
  to a file and substitutes a preview plus the path — so an over-budget context does not fail,
  it silently becomes a pointer. This is why the budget is enforced by us, visibly (FR-022).

**Failure behaviour**: any problem — missing file, unreadable, malformed — exits 0 having printed
nothing. A session with no issue context is a session; a session that will not start is a
regression. The operator learns from the absence of the notification (FR-024), not from a broken
terminal.

## 4. The context markdown

Composed header-first, so a truncation that bites costs discussion, never identity:

```markdown
# Linked issue: TAV-42

Unify Linear connections behind one core service
State: In Progress · Assignee: Andrew
URL: https://linear.app/tav/issue/TAV-42

## Description

…

## Recent comments (3)

andrew: …
```

**Budget**: ceiling 10,000 characters. Description trimmed at ~4,000; at most 5 comments; when
anything was dropped, a closing line naming the issue URL. Truncation prefers whole blocks so a
fenced code block is never cut open.

The drawer's preview is produced by **this same function** — not a re-render of it — so what the
operator inspects is what the agent receives (FR-023).

## 5. Session environment

`pty-manager.spawnSession` currently passes `process.env` through unchanged. For a session in a
linked project it composes `process.env` plus:

| Variable               | Value         |
| ---------------------- | ------------- |
| `TERMINATOR_ISSUE_KEY` | `TAV-42`      |
| `TERMINATOR_ISSUE_URL` | the issue URL |

For scripts and prompts. **Not** how the agent gets its context — that is the hook, which also
covers a session the operator starts from an ordinary shell outside the application (FR-020).

## What is deliberately not used

| Mechanism                                      | Why not                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `claude --settings <file>` at launch           | Covers only sessions the application launches. FR-020 requires a hand-started one to work too.                         |
| A `CLAUDE.md` or `ticket.md` in the repo       | Pollutes the working tree and shows up in diffs.                                                                       |
| An environment variable naming a settings file | No such variable is documented. Checked.                                                                               |
| `UserPromptSubmit` instead of `SessionStart`   | Would re-inject the issue on every turn, spending context repeatedly for a fact that does not change within a session. |
