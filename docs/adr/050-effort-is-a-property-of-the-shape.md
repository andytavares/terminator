# ADR 050: Effort is a property of the shape of the work

**Status**: Accepted

**Date**: 2026-09-13

**Builds on**: [ADR 044](044-a-fan-out-parallelises-lanes-not-units.md) (which
decided what a shape parallelises; this decides how hard its agents think)

## Context

Foundry chose a shape for every order. `quick` is for a one-lane P3 change. `standard` is for anything that spans lanes or grades above P2. Foundry then launched every agent in every shape at the same reasoning effort: whatever the runtime's default happened to be. A role declared `modelTier: fast | deep`, which picked the model. Nothing picked the effort.

The runtime exposes effort. `claude --effort low|medium|high|xhigh|max` sets how much reasoning a session spends. The default is `high` on every current model. Anthropic's own guidance for coding agents is that `xhigh` is the setting for the hardest agentic work, and `high` is enough for a scoped change (`code.claude.com/docs/en/model-config`). The operator's working practice outside Foundry already sized effort per task: `sonnet` at `high` for a change whose files can be named, and `opus` at `xhigh` for a root cause or a cross-cutting refactor. Inside Foundry the same order ran at the default, whichever shape it was given. So the ladder that chose the shape chose nothing about the thinking.

The shape names show the mismatch. `bugfix` exists because a fix whose reproduction passes without anyone finding the cause is not a fix. More effort buys exactly that. `quick` exists because a one-sentence change does not need a verifier. It does not need deep reasoning either, and paying for deep reasoning there is the cost the shape was meant to avoid.

## Decision

**A recipe declares the effort that its agents launch with. Every agent step inherits it. A step may override it for itself.**

- `effort: low | medium | high | xhigh | max` is a field on the recipe and on any step. The schema refuses any other value by file, the way it refuses an unknown step kind.
- The executor resolves a node's effort as the step's own, else the recipe's, else `null`. It hands the result to the launch alongside the model tier. `null` means that Foundry does not pass the flag. An operator who has configured effort in their own runtime settings keeps that configuration for a recipe that says nothing.
- Foundry launches a fast-tier role with no effort, whatever the recipe says. The fast tier resolves to `haiku`, and that model does not take the flag. Passing the flag would refuse the launch, which is worse than a scribe that thinks at the default.
- Every built-in shape declares an effort:
  - `quick` and `spike` run at `high`. `quick` is one lane with nothing flagged. `spike` is a question answered by reading.
  - `direct`, `standard`, `bugfix`, `refactor` and `speckit` run at `xhigh`. Their work is a second look, more than one lane, a root cause, a shape change that must prove behaviour unchanged, or a pipeline that plans before it builds.
  - None runs at `max`, which the runtime's own documentation describes as prone to overthinking.

The effort travels the same path as the model tier: recipe → executor → `runNode` → supervised runner → `buildLaunchSpec`. Foundry quotes it onto the command line the same way, because it reaches a shell.

## Consequences

- An operator's own recipe, in the data root or a repository's `.foundry/`, sizes its agents' reasoning with one line. A shape for research or a design document can run at `high` where a refactor runs at `xhigh`. This is the sizing that the operator was already doing by hand outside Foundry.
- Model choice is unchanged. The tier still picks it, and the setting still supplies the deep model. Effort and model are separate levers and stay separate.
- The built-in levels are a starting point. They are not a measurement. The runtime documentation says to raise effort when an agent skipped a file, did not run the tests or did not check its work. It says to lower effort where a task is routine. A shape whose builders keep doing the former should move up. A shape that pays for reasoning it does not use should move down. Each change is one line in a YAML file.
- `EFFORT_LEVELS` is a copy of the runtime's list. The schema refuses a level that the runtime adds until someone adds it here. This is the right failure. Foundry reports, by file, a recipe that names a level this build does not know. It never passes the level through to a launch that would refuse it in a terminal that nobody reads.
