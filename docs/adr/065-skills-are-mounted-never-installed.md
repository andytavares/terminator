# ADR 065: Skills are mounted, never installed

**Status**: Accepted

**Date**: 2026-09-26

## Context

A Foundry agent knew the prompt of its role and its brief, and nothing more. A
team writes down practices as Claude Code skills, for example how to fix a
failing check or how this codebase wants migrations written. These skills
reached no factory agent unless they were in the operator's own
`~/.claude/skills`. They do load from there, because the launch passes no
`--setting-sources`. This makes a run depend on whose machine it ran on.
Writing skills into `.claude/skills` of the target repository would break
ADR-042: Foundry writes nothing into a repository but the change the order
asked for.

Claude Code loads the skills in `<dir>/.claude/skills/` for every directory
passed with `--add-dir`, through the `project` setting source
(https://code.claude.com/docs/en/skills, "Load skills from a directory outside
the project").

## Decision

- Roles and steps declare `skills: [id]`. A node gets the union of the skills
  of its role and its step.
- A skill resolves on the same three rungs as a recipe:
  `<dataRoot>/skills/<id>/SKILL.md`, then `.foundry/skills/<id>/` of a
  repository (honoured, never created), then the `skills/` of the extension. An
  unknown id refuses the run before anything starts, and names the id.
- Before the agent of a node launches, its skills are copied to
  `<order>/skills-mount/<node>/.claude/skills/`. The launch adds
  `--add-dir <mount>`. Ledger: `skills.mounted`, with the rung each skill came
  from.
- The tool policy allows reads under the mount and refuses writes. This rule
  comes ahead of every other rule, so reading a skill never waits for an
  answer.
- One built-in skill, `ci-fix`, on the builder: reproduce the failure that the
  brief carries with the project's own command, and fix the cause, never the
  check.

## Alternatives

- **Write skills into the `.claude/skills` of the repository.** Rejected:
  ADR-042.
- **Inline skill text into the brief.** Rejected. A skill is loaded when it is
  relevant. A brief that carries the body of every skill is longer for every
  turn.
- **`--setting-sources` to shut out the operator's personal skills.**
  Deferred. It would also drop their settings and hooks. The mount makes the
  skills of the factory reproducible. Personal skills still add to them.

## Consequences

- Personal skills in `~/.claude/skills` still load into factory agents.
- A skill is copied per node. If someone edits a skill mid-run, only nodes that
  have not launched yet see the edit.
