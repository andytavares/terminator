# ADR 125: A security fix skips the release-age cooldown

**Status**: Accepted

**Date**: 2026-10-23

Amends the release-age check (`scripts/check-release-age.mjs`).

## Context

`check-release-age` fails a pull request that adds a dependency version published fewer than 14 days ago. Dependabot's cooldown "is only available for version updates, not security updates" (https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference#cooldown), so its security pull requests are opened the day the fix ships. #293 and #294 bumped `fastify` to 5.12.6 (GHSA-389g-gv7q-r4x8) and failed Lint with `2 under 14 days old`, `mermaid@12.2.0` and `fastify@5.12.6`.

## Decision

A version that fixes a published advisory does not wait for the cooldown.

- The check runs `npm audit --package-lock-only --json` on the base branch's `package.json` and lockfile (in a temporary directory) and on the head.
- An advisory in the base report and not in the head report is fixed.
- Exempt are the added versions of the vulnerable package and, transitively, of every package in its `effects` on the base report (`katex` fixed by `mermaid@12.2.0`, so `mermaid`). Every other added version still needs 14 days or an entry in `.release-age-exceptions.json`; `chevrotain@13.2.0`, which mermaid 12 pulls in, is one.
- Each exempt version is printed with the advisory it fixes.
- The audit can only exempt. If either report cannot be read, nothing is exempt, as before.

## Consequences

- Dependabot security pull requests pass Lint the day they open.
- A version that comes with a fix but also adds unrelated new packages is still held to the cooldown for those packages.
- The check now needs `npm` and the registry's advisory endpoint; when they are unavailable it behaves as it did before.
