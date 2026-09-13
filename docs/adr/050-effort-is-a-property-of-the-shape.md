# ADR 050: Effort is a property of the shape of the work

**Status**: Accepted

**Date**: 2026-09-13

**Builds on**: [ADR 044](044-a-fan-out-parallelises-lanes-not-units.md) (which
decided what a shape parallelises; this decides how hard its agents think)

## Context

Foundry chose a shape for every order — `quick` for a one-lane P3 change,
`standard` for anything spanning lanes or graded above P2 — and then launched
every agent in every shape at the same reasoning effort: whatever the
runtime's default happened to be. A role declared `modelTier: fast | deep`,
which picked the model, and nothing anywhere picked the effort.

The runtime exposes it. `claude --effort low|medium|high|xhigh|max` sets how
much reasoning a session spends, the default is `high` on every current model,
and Anthropic's own guidance for coding agents is that `xhigh` is the setting
for the hardest agentic work while `high` is enough for a scoped change
(`code.claude.com/docs/en/model-config`). The operator's working practice
outside Foundry already sized effort per task: `sonnet` at `high` for a
change whose files can be named, `opus` at `xhigh` for a root cause or a
cross-cutting refactor. Inside Foundry the same order ran at the default no
matter which shape it was given, so the ladder that chose the shape chose
nothing about the thinking.

The mismatch is visible in the shape names. `bugfix` exists because a fix
whose reproduction passes without the cause being found is not a fix; that is
exactly what more effort buys. `quick` exists because a one-sentence change
does not need a verifier; it does not need deep reasoning either, and paying
for it there is the cost the shape was meant to avoid.

## Decision

**A recipe declares the effort its agents launch with, every agent step
inherits it, and a step may override it for itself.**

- `effort: low | medium | high | xhigh | max` is a field on the recipe and on
  any step. The schema refuses any other value by file, the way it refuses an
  unknown step kind.
- The executor resolves a node's effort as the step's own, else the recipe's,
  else `null`, and hands it to the launch alongside the model tier. `null`
  means the flag is not passed, so an operator who has configured effort in
  their own runtime settings keeps that configuration for a recipe that says
  nothing.
- A fast-tier role is launched with no effort regardless of what the recipe
  says. The fast tier resolves to `haiku`, and that model does not take the
  flag; passing it would refuse the launch, which is worse than a scribe
  thinking at the default.
- Every built-in shape declares one. `quick` and `spike` at `high`: one lane,
  nothing flagged, or a question answered by reading. `direct`, `standard`,
  `bugfix`, `refactor` and `speckit` at `xhigh`: a second look, more than one
  lane, a root cause, a shape change that must prove behaviour unchanged, a
  pipeline that plans before it builds. None at `max`, which the runtime's own
  documentation describes as prone to overthinking.

The effort travels the same path the model tier does — recipe → executor →
`runNode` → supervised runner → `buildLaunchSpec` — and is quoted onto the
command line the same way, because it reaches a shell.

## Consequences

- An operator's own recipe, in the data root or a repository's `.foundry/`,
  sizes its agents' reasoning with one line. A shape for research or a design
  document can run at `high` where a refactor runs at `xhigh`, which is the
  sizing the operator was already doing by hand outside Foundry.
- Model choice is unchanged: the tier still picks it, the setting still
  supplies the deep model. Effort and model are separate levers and stay so.
- The built-in levels are a starting point, not a measurement. The runtime
  documentation says to raise effort when an agent skipped a file, did not run
  the tests or did not check its work, and to lower it where a task is routine.
  A shape whose builders keep doing the former should move up; one paying for
  reasoning it does not use should move down. Both are one line in a YAML file.
- `EFFORT_LEVELS` is a copy of the runtime's list. A level the runtime adds is
  refused by the schema until it is added here, which is the right failure: a
  recipe naming a level this build does not know is reported by file, never
  passed through to a launch that would refuse it in a terminal nobody reads.
