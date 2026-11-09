# ADR 154: A pull request checks what it reaches, on Linux; main checks everything

**Status**: Accepted

**Date**: 2026-11-08

Amends ADR 151 and ADR 134.

## Context

A lone pull request took about 8.5 minutes in CI (run 42525513630): every macOS job waited about 4 minutes for one of the Free plan's five macOS runners, each of the ten jobs ran its own `npm ci`, and every run tested everything. The maintainer asked for CI and local checks as close to ten times faster as possible, and decided in the design interview (design "Terminator Speed and termctl", 2026-11-08): a pull request runs only what its change reaches and `main` runs everything; E2E and the story screenshots move to Linux; Start and the macOS-only specs run on `main` only. ADR 152 made the core into workspace packages so Turborepo can tell what a change reaches.

## Decision

- **Selection.** A pull request runs `turbo run … --affected` against `origin/main`. The pre-commit hook runs the same tasks against `HEAD`. A change to a root config, the lockfile or a file in `globalDependencies` reaches every package. The root's own tasks (the specs of `scripts/` and the configs, the specs that cross packages, the e2e typecheck) run on every pull request.
- **Cache.** On a pull request and locally, a task whose inputs are byte-identical to one that passed replays from the Turborepo cache (`.turbo`, kept between CI runs with `actions/cache`). A push to `main` runs every task with `--force`.
- **Runners.** Every pull request job runs on `ubuntu-24.04-arm`: one Check job (format, lint, typecheck, test), the E2E shards under `xvfb-run`, and Stories with Linux screenshot baselines. On a push to `main`, after those pass, one macOS job runs Start and the specs tagged `@mac`, then the signed release.
- **E2E selection.** The e2e folder of each package runs when the package is affected; a change to a core package runs every folder.

## Alternatives considered

- **Paid larger runners.** Billed, and the macOS concurrency limit stays at five on the Free and Team plans (https://docs.github.com/en/actions/reference/limits).
- **macOS for E2E on pull requests.** The runner queue alone exceeds the target.
- **Cache hits without selection.** Every package would still run on any change to a core package that many depend on, and a change to an extension would still start every E2E shard.

## Consequences

A bug that shows only on macOS is found on `main`, before the release, not on the pull request. A pull request that touches a root config runs everything. The story screenshot baselines are Linux renders.
