# Contract: recipes, roles and rules

**Feature**: `037-foundry-software-factory` | **Date**: 2026-09-06

The extension point. YAML files, validated with zod on load (R2). This document covers the authoring format, name resolution and the compatibility rules — field shapes are in [data-model.md](../data-model.md).

## Name resolution

A recipe, role or rule is referenced by name and resolved most-specific-first (FR-022):

| #   | Looked up in                              | Meaning                                                                      |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | `<dataRoot>/recipes/<name>.yaml`          | The operator's own. Applies in every repository. Wins over everything.       |
| 2   | `<repo>/.foundry/recipes/<name>.yaml`     | The project's own. **Honoured when present, never created, never required.** |
| 3   | Built-in, shipped in the extension bundle | Always available.                                                            |

Same three rungs for `roles/` and `rules/`.

Rung 2 is what lets a team ship a house recipe with its code without making Foundry require anything of a repository. It is read-only in both directions: Foundry never writes there, and a repository that has no `.foundry/` directory is entirely normal (FR-069, FR-070).

A file whose `id` does not match its filename is a load error, named at load time rather than at use time.

## Recipes

```yaml
id: bugfix
description: Reproduce first, then fix, then prove the reproduction flips.

requires:
  - toolchain: test # not offered where the probe found no test command

steps:
  - id: reproduce
    kind: agent
    role: builder
    expect: { tests_added: '>= 1', suite_exit_code: '!= 0' } # must fail

  - id: fix
    kind: fanout
    over: plan.units[role=builder]
    after: [reproduce]
    step: { kind: agent, role: builder }

  - id: verify
    kind: fanout
    over: plan.units
    step: { kind: agent, role: verifier, context: fresh }

  - id: inspect
    kind: agent
    role: inspector
    when: risk.triggers is not empty

  - id: integrate
    kind: join
    order: lane.ord

  - id: ship
    kind: gate
    rule: ready-for-review
    options: [mark_ready, hold]
    defaultIfIgnored: hold
```

### The six step kinds

`agent`, `run`, `judge`, `gate`, `fanout`, `join`. There is no conditional kind, no loop kind and no sub-recipe kind, because no built-in recipe needs one (Complexity Tracking). `when` is an attribute of a step, not a kind.

### `requires`

What a recipe needs of a repository. An unmet requirement means the recipe is **not offered**, with the reason available (FR-020) — never silently rewritten into something else, which is what `PLAIN_PHASE_COMMANDS` does today and is one of the things this feature deletes.

Supported forms: `path_exists: <glob>`, `toolchain: <check>`, `repos: <comparison>`.

The `speckit` recipe declares `path_exists: .specify/`. That single line replaces `state/skill-availability.ts` and the whole plain-prose fallback table.

### Expression surface

`over`, `when` and `expect` accept a deliberately small language: a path into the order (`plan.units`, `risk.triggers`), an optional filter (`[role=builder]`), and comparisons (`is empty`, `is not empty`, `>= n`, `!= n`). It is not a scripting language and must not become one — a recipe that needs arbitrary logic wants a role, which is a prompt and an output schema, not code in a data file.

## Roles

```yaml
id: verifier
modelTier: deep
allowResume: false # structural: FR-032's fresh context is not a convention
reads: [unit.diff, unit.satisfies, context.toolchain, rules]
writes: [] # a verifier changes nothing
tools: [read, run_tests]
outputSchema: verdict
prompt: |
  You are checking work you did not do…
```

`allowResume: false` is the mechanism behind the model's most important invariant — a verdict's `producedBy.sessionId` must differ from the node's. A role that may not resume cannot inherit the builder's reasoning, so the property is enforced by the runner rather than asked for in a prompt.

`writes: []` is likewise load-bearing: the verifier's tool allowlist contains no write tool, so a verifier that decided to fix what it found could not.

### `writes:` is two things at once

It answers **whether a role may touch a checkout** — only `worktree`, `integration_branch` and `docs` do, and anything else runs read-only — and it answers **what that role may hand back**. Four targets are collectable: `context`, `findings`, `plan` and `acceptance`. A rung whose role declares one is given a file at `<order>/rungs/<node>.json`, its JSON schema in the brief, and permission to write that one path and nothing else; what it writes is read back, validated against exactly the artefacts it declared, merged, and the file cleared.

That is why an artefact a role produces must be declared even when it changes nothing in the repository. `inspector` carried `writes: []` and a prompt asking it for findings with a severity and a line, so every inspection ended in a terminal nobody reads; it declares `findings` now, which grants it no new permission — `findings` is not a checkout destination, so it still gets no editing tool. The verifier stays at `[]` deliberately: its verdict is an exit status (FR-033), not a document.

`plan` and `acceptance` are collected but never applied. The run graph is compiled from the agreed order before any rung runs, so replacing the plan underneath work already in flight would orphan it. A rung that contests either — or that raises a finding — produces a `forge-defect` gate instead, which is the rule for an order that contradicts itself.

## Rules

```yaml
id: exit-code-not-count
scope: universal
rung: L2
asserts: A test verdict comes from the command's exit status, never from a printed summary.
appliesWhen: always
origin: built-in
```

`scope: universal` rules ship with the tool and hold everywhere. `scope: project` rules load only where the repository carries what they depend on (FR-042) — `docs-in-pr` and `flat-icons` are derived from this repository's constitution and are simply absent in a repository that has none.

`origin` is provenance, and the curator depends on it: an accepted proposal is written with `origin: curator:<ledger entry ids>`, so the rule carries the rejections that produced it and can be judged later on whether it was worth adding (FR-079, FR-081).

## Compatibility

- Every file carries `schemaVersion`. An unknown higher version is a load error naming the file — never a partial load.
- Built-ins may gain fields; they may not change the meaning of an existing one. A rung, an intent or a step kind is added, never repurposed.
- A user file that overrides a built-in by name **replaces it entirely**. There is no merge, because a half-overridden recipe is a shape nobody wrote and nobody can predict.
- Removing a built-in recipe is a breaking change and needs an ADR. Adding one does not.

## Load-time obligations

1. Validate every file with zod before it is offered. A malformed file is reported by path and excluded; it never takes the surface down with it — the same reasoning `runtime/workitem.ts` already applies to agent-written JSON.
2. Resolve names once per run, not per step, so a file changing mid-run cannot change the shape of work already underway.
3. Report the resolution rung in the ledger when a recipe is selected. "Which recipe ran" is not the whole answer; "and which of the three it came from" is.
