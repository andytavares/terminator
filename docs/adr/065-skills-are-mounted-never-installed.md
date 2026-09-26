# ADR 065: Skills are mounted, never installed

**Status**: Accepted

**Date**: 2026-09-26

## Context

A Foundry agent knew its role's prompt and its brief, nothing more. The
practices a team writes down as Claude Code skills (how to fix a failing check,
how this codebase wants migrations written) reached no factory agent unless
they happened to be in the operator's own `~/.claude/skills`. They do load from
there, because the launch passes no `--setting-sources`, which makes a run
depend on whose machine it ran on. Writing skills into the target repository's
`.claude/skills` would break ADR-042: Foundry writes nothing into a repository
but the change the order asked for.

Claude Code loads the skills in `<dir>/.claude/skills/` for every directory
passed with `--add-dir`, through the `project` setting source
(https://code.claude.com/docs/en/skills, "Load skills from a directory outside
the project").

## Decision

- Roles and steps declare `skills: [id]`. A node gets the union of its role's
  and its step's.
- A skill resolves on the same three rungs as a recipe:
  `<dataRoot>/skills/<id>/SKILL.md`, then a repository's
  `.foundry/skills/<id>/` (honoured, never created), then the extension's own
  `skills/`. An unknown id refuses the run before anything starts, and names it.
- Before a node's agent launches, its skills are copied to
  `<order>/skills-mount/<node>/.claude/skills/`, and the launch adds
  `--add-dir <mount>`. Ledger: `skills.mounted`, with the rung each came from.
- The tool policy allows reads under the mount and refuses writes, ahead of
  every other rule, so reading a skill is never held for an answer.
- One built-in skill, `ci-fix`, on the builder: reproduce the failure the brief
  carries with the project's own command, fix the cause, never the check.

## Alternatives

- **Write skills into the repository's `.claude/skills`.** Rejected: ADR-042.
- **Inline skill text into the brief.** Rejected: a skill is loaded when it is
  relevant; a brief carrying every skill's body is longer for every turn.
- **`--setting-sources` to shut out the operator's personal skills.**
  Deferred: it would also drop their settings and hooks. The mount makes the
  factory's own skills reproducible; personal ones still add to them.

## Consequences

- Personal skills in `~/.claude/skills` still load into factory agents.
- A skill is copied per node, so editing one mid-run affects only nodes that
  have not launched yet.
