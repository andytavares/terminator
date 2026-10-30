# ADR 132: CI finishes in five minutes

**Status**: Accepted

**Date**: 2026-10-27

Amends ADR 123 (the job layout, and what a push to `main` runs), ADR 124 (where the quarantined tests run, and how many times the stability gate repeats a spec) and ADR 129 (the goal).

## Context

A pull request took 8 to 16 minutes in CI, and 25 to 54 minutes when runs overlapped (`gh run list --workflow=ci.yml --limit 60`). Most of the time was waiting for a runner. One run asked for about 25 jobs, 7 on macOS. The Free plan runs 20 jobs and 5 macOS jobs at once (https://docs.github.com/en/actions/reference/limits). E2E shards waited up to 16.2 minutes for a macOS runner (run 40357114319).

Inside the run:

- Quarantine (E2E) and E2E stability waited for every E2E shard, then queued for a macOS runner again. In run 40536027375, E2E ended at 10.3 minutes. Quarantine (E2E) started at 15.4 and ran no test.
- Lint spent 148 s in `lint:quarantine`, which listed every unit and e2e spec to find a tag that no spec carried. It spent 114 s in ESLint groups that ran one after another.
- The Quarantine job spent 150 s collecting the unit suite to run no test.
- Dependabot opened one pull request per ungrouped package. Four started CI in the same minute (runs 40357034589, 40357075771, 40357114319).

## Decision

1. **The goal is five minutes per run**, from push to the last check. A run over five minutes is a finding to fix, as ADR 129 says of a slow step. There is still no `timeout-minutes`.
2. **At most five macOS jobs per run**: three E2E shards, Start and Story screenshots. Nothing waits on E2E:
   - Each E2E shard runs its part of the five repeats of every changed e2e spec after its own tests (`scripts/stability.mjs --e2e --part K/3`, which passes the own `--shard` of Playwright). The E2E stability job is gone.
   - Each E2E shard runs two apps at once, planned as two lanes. The suite ran in 610 s against 815 s with one lane (runs 40572074278 and 40566760766). `scripts/e2e-shard.mjs` prints the worker count with the arguments of each shard, so CI, `ci:local:e2e` and the sweep agree. A hang in `extension-escape.spec.ts` (runs 40579399555 and 40594749096, with two apps and with one) was the spec waiting on a key press whose frame the exit hid. The spec now waits on the exit.
   - Each E2E shard selects its own tests (`scripts/test-select.mjs --github-output`) instead of waiting for Select tests. It stops after the install when nothing is selected.
   - The quarantined unit and e2e tests run in the nightly `stability-sweep.yml`, in jobs that do not gate (Constitution XIV). They no longer run on a pull request.
3. **Fewer Linux jobs**: Select tests also plans the stability shards. Stories also runs the perf budgets (not Format, which is a required check). The build of Start also fails on build warnings (the Build job is gone). E2E report runs only when an E2E shard failed. Stability shards plan for 3 minutes and are at most 4.
4. **Cheaper steps**: `lint:quarantine` lists only the spec files that contain the tag or that `tests/quarantine.json` names, and none when there are none. `npm run lint` runs up to 3 ESLint groups at once, as memory allows. An E2E shard restores the build from `actions/cache` when no tracked file outside the tests and docs changed.
5. **A push to `main` runs what its change reaches** (Constitution XIV, 5.0.0, approved by the maintainer on 2026-10-27), compared with the commit that `main` was at before (`selectionBase` in `scripts/test-select.mjs`). The nightly sweep and the release run every test. A full run is about 610 s of E2E over three shards, which is more than five minutes on the free macOS runners.
6. **The stability gate repeats each changed spec up to ten times, in CI only** (Constitution XIV, 5.0.0, approved by the maintainer on 2026-10-27). Thirty repeats took 10.1 minutes of CI on a change to fifteen specs (run 40588044519) and 38 minutes of `ci:local`. `ci:local` and `ci:local:e2e` leave the repeats to CI (`SKIPPED_JOBS` in `scripts/ci-plan.mjs`).
7. **One Dependabot pull request a week** for every package outside the lockstep groups.

## Alternatives considered

- **E2E on Linux.** Linux runners have no 5-job limit, but Constitution XIV runs the app on macOS, as the app ships.
- **Codecov Test Analytics or Trunk for flaky tests.** Codecov already receives every JUnit report. It lists tests that are flaky on `main` in a pull-request comment, but it has no quarantine and no gate. Trunk quarantines by overriding the exit code, which lets an outside service decide a check (ADR 124).
- **A self-hosted runner on the Mac of the developer.** GitHub says that self-hosted runners "should almost never be used for public repositories" (https://docs.github.com/en/actions/reference/security/secure-use).
- **Caching `node_modules`.** `actions/setup-node` already caches the npm download cache. A cached `node_modules` can differ from a clean `npm ci`.

## Consequences

- A full run (`test: all`, or a change to what every test depends on, such as the lockfile or the test tooling) still takes more than five minutes. A push to `main` no longer is a full run.
- Two runs at once still share five macOS runners.
- A fix to a quarantined test shows in the nightly sweep, not on its pull request.
- A change that edits many specs gets longer stability shards, not more of them. The cap of 4 keeps a run under 20 jobs, so 50 changed specs plan about 400 s per shard.
