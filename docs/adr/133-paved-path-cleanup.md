# ADR 133: Paved-path cleanup

**Status**: Accepted

**Date**: 2026-10-27

Amends Constitution Principles VI and XIV (6.0.0), and relies on ADR 095 (Codecov gates coverage) and ADR 132 (CI finishes in five minutes). Makes one exception to Principle II.

## Context

Principle VI named a Vitest threshold on the changed files as the coverage gate. Principle XIV forbade any outside service to gate. ADR 095 had already made Codecov `codecov/patch` the gate, because the whole-file Vitest gate produced padding tests. The text of the constitution and the practice disagreed.

Principle XIV said that a failure reproduces with `TEST_SEED=<seed>`. The repository kept its own seed code (`tests/support/test-seed.ts`) beside the seed of Vitest, which prints and takes its own seed (`--sequence.seed`).

Principle II keeps an extension out of core internals. The task-vault extension owns a database console, `DatabaseAdmin`, that runs SQL against the shared `app.sqlite`.

The Jira provider had no user besides the owner. The intake of Foundry listed `'jira'` beside `'linear'`.

## Decision

1. **Principle VI (6.0.0): the coverage gate is Codecov `codecov/patch`**, at 80% of the changed lines. Vitest has no coverage threshold.
2. **Principle XIV (6.0.0): `codecov/patch` is the one outside service allowed to gate.** `npm run ci:local` reports it as not run (`NOT_RUN_HERE` in `scripts/ci-local.mjs`). Every other outside service still never gates.
3. **Principle XIV (6.0.0): the seed is the seed of Vitest.** Vitest shuffles files and tests with a new seed on every run and prints the seed. A failure reproduces with `--sequence.seed=<seed>`. `TEST_SEED`, `tests/support/test-seed.ts` and `announceTestOrder` are deleted. `scripts/stability.mjs` passes `--sequence.seed` to each repeat.
4. **Database-console exception to Principle II (owner decision, 2026-10-27).** `DatabaseAdmin` of task-vault keeps full SQL access to the shared `app.sqlite`. The owner chose the console over a narrower API.
5. **Jira is removed.** The provider is deleted, and the intake of Foundry takes Linear only. The Jira URL recognition in PR review text stays, because it does not use the provider.

## Alternatives considered

- **Keep the Vitest threshold and make Codecov advisory.** This brings back the padding tests that ADR 095 removed.
- **Keep `TEST_SEED` as a wrapper over the seed of Vitest.** This gives two names for one value, and a second code path to maintain.
- **Narrow `DatabaseAdmin` to read-only SQL.** The owner declined, because the console is a maintenance tool.
- **Deprecate Jira first.** The only user is the owner, so a deprecation period costs more than it saves.

## Consequences

- A change that adds untested lines fails `codecov/patch` on the pull request, not in `ci:local`.
- The constitution, CI and the docs name the same seed flag.
- `DatabaseAdmin` can still change any table of `app.sqlite`. The owner accepts that risk.
- The app no longer reads a Jira credential left in `app.sqlite`.
