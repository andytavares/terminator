# ADR 151: CI runs everything, once, with nothing fancy

**Status**: Accepted

**Date**: 2026-11-08

Supersedes ADR 107, ADR 124, ADR 125, ADR 132, ADR 136 and ADR 139. Amends ADR 070, ADR 071, ADR 123, ADR 133, ADR 134 and ADR 150.

## Context

CI had grown test selection, a stability gate, a nightly sweep, quarantine, duration-based E2E shards, a real-order Foundry canary and a local CI simulation (`npm run ci:local`) with a pre-push hook. The maintainer asked on 2026-11-08: "Refactor ci entirely, make everything that can run on Ubuntu images do that and simplify everything. Remove the burn in and flake detection stuff, simplify everything, nothing fancy." The same day the maintainer asked to remove the canary, the local CI simulation, the second knip run (`knip --production`) and the release-age check too.

## Decision

Every CI run runs every check and every test once: Lint, Typecheck, Format, Stories, Test (the whole Vitest suite with coverage for Codecov), and the whole Playwright suite in three shards with Playwright's `--shard`. Only Start, E2E, the story screenshots and the signed release run on macOS; every other job runs on `ubuntu-24.04-arm`. Locally, the pre-commit hook runs lint-staged and then `npm run check`, the same npm scripts CI runs, and `npm run lint:workflows` fails if ci.yml leaves one of them out. `.npmrc`'s `min-release-age=14` is the release-age rule: npm refuses to install a version published fewer than 14 days ago.

## Consequences

Selection, the stability gate, the sweep, quarantine, the timing file, the canary, `ci:local`, the pre-push hook, the local-check status, `knip --production` and `scripts/check-release-age.mjs` are deleted. A flaky test is found when it fails in a normal run and is fixed at its cause (Constitution XIV, "One run decides"). Every run costs a full test run, and E2E does not run before a commit.
