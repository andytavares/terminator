# ADR-030: An agent session learns its issue from a SessionStart hook

**Status**: Accepted
**Date**: 2026-08-22
**Feature**: [031-linear-project-integration](../../specs/031-linear-project-integration/spec.md)
**Builds on**: [ADR-026](026-supervised-runs-in-a-terminal.md) (the verified hook contract),
[ADR-029](029-core-issue-tracker-service.md) (where the issue comes from)

## Context

A project can now carry an issue (ADR-029). The point of that is not the badge — it is that an
agent session started in the project should already know what it is for, without the operator
pasting a ticket into every new conversation.

The requirement that decides the mechanism is **FR-020**: a session the operator starts _by hand_,
at an ordinary shell prompt in the project's directory, must get the same context as one this
application launched. That rules out anything that depends on us being the one who spawns it.

## Decision

**A `SessionStart` hook, registered in the project directory's `.claude/settings.local.json`,
running a Terminator-written script that prints the issue as `additionalContext`.**

Three pieces, and the script is deliberately the dumbest of them:

```
   link / issue / toggle changes
              │
              ▼
  <userData>/integrations/context/<projectId>.json    ← core writes
              ▲
              │ reads (nothing else)
  <projectDir>/.claude/settings.local.json            ← core merges an owned block
              │ registers
              ▼
         SessionStart hook  ──stdout──▶  the agent runtime
```

The script holds **no credential**, makes **no network call**, and knows nothing about trackers.
It reads one file and prints. That is the whole of its authority, and it is why putting it inside
the operator's own repository directory is acceptable.

### The verified contract

From the published hook documentation, and consistent with what ADR-026 established by running the
binary:

- `SessionStart` accepts JSON on stdout; `hookSpecificOutput.additionalContext` is added to the
  model's context at session start, and `sessionTitle` names the session.
- **`hookEventName` is required inside `hookSpecificOutput`.** Omit it and the runtime ignores the
  entire object — silently. ADR-026 recorded this the expensive way; this feature's hook test runs
  the real script under node and asserts the field is present, so it cannot regress.
- **Hook output fields are capped at 10,000 characters.** Past that the runtime does not fail: it
  writes the value to a file and substitutes a preview and a path. An over-budget context would
  therefore become a pointer nobody follows, which is why the budget is enforced by us and shown to
  the operator (FR-022, FR-023).
- `.claude/settings.local.json` is the highest-precedence filesystem settings file, is gitignored by
  convention, and hooks from every level **merge** rather than replace.

`ELECTRON_RUN_AS_NODE=1` with the application's own binary runs the script — the same invocation
ADR-026 uses, so the hook depends on neither a `node` on `PATH` nor whatever a login shell exported.

### The budget

Header first, always: key, title, tracker, state, assignee, labels, URL. Then the description
(trimmed near 4,000 characters), then at most the five most recent comments. If anything was
dropped, a closing line says so and names the issue URL.

Composed in that order on purpose. When the budget bites it costs **discussion, never identity** —
an agent that knows the key, the title and the state but not the third comment is still working on
the right thing; one that got the tail of a description and no key is not.

Truncation prefers whole blocks, and re-closes a fenced code block it had to cut, because a
half-open fence swallows everything after it and would turn the rest of the context into code.

### Rejected alternatives

| Alternative                                        | Rejected because                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `claude --settings <file>` at launch               | Covers only sessions this application starts. FR-020 requires a hand-started one to work, and it is the case the operator hits most. |
| A `CLAUDE.md` or `ticket.md` written into the repo | Pollutes the working tree and turns up in every diff. (SpecKit's own `ticket.md` stays — it is a phase input, a different job.)      |
| An environment variable naming a settings file     | **No such variable is documented.** Checked against the environment-variables reference.                                             |
| `UserPromptSubmit` instead of `SessionStart`       | Would re-inject the issue on every turn, spending context repeatedly on a fact that does not change within a session.                |

Environment variables (`TERMINATOR_ISSUE_KEY`, `TERMINATOR_ISSUE_TRACKER`) are still stamped on
terminals in a linked project — but as a convenience for scripts and prompts, not as the mechanism.
They cannot be the mechanism: they only reach terminals this application spawns.

## Consequences

**The cost, stated plainly: this writes one file inside the operator's repository directory.**
That is a real intrusion and it is bounded by rules the code enforces and tests check:

- **Merge, never replace.** An existing `SessionStart` array keeps every entry it had, and every
  other settings key is left alone.
- **`.claude/settings.json` — the shared, checked-in one — is never read or written.** Only
  `settings.local.json`.
- **Settings that cannot be parsed are refused, not clobbered.** Overwriting a file we do not
  understand would destroy whatever the operator put there.
- **Unlinking restores.** Our block is removed; if the file is then empty it goes, and if we created
  the `.claude` directory that goes too. SC-010 — "the project directory is unchanged after
  detachment" — is a test that compares the directory listing before and after.
- **An unwritable directory fails loudly and the link is undone** (FR-026). A link that looks
  attached and silently feeds nothing is worse than no link at all.

**Also good.** The drawer's preview is produced by the same function that writes the file, so what
the operator inspects is the thing itself rather than a second rendering of it. And a tracker
outage does not cost the operator their context: the previous file stays until a successful read
replaces it.

**Verified, not assumed.** The load-bearing claim — that a `claude` started by hand, in an ordinary
shell, in a linked project directory actually receives the context — was proven against a live
agent runtime. A project was built containing nothing but the hook and a context file naming a
_fictional_ issue; the agent named that issue. A control run in a directory with no hook answered
something else entirely. Recorded in
[verifications.md](../../specs/031-linear-project-integration/verifications.md).
