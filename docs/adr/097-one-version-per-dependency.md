# ADR 097: One version per dependency

**Status**: Accepted
**Date**: 2026-10-12
**Relates to**: Constitution Principle IV (2.0.0)

## Decision

Every package is declared at one exact version across the root and all workspace `package.json` files. A library published under two names counts as one: `xterm` 5.3 is removed in favour of `@xterm/xterm` 6. Ranges are not allowed outside references to this repository's own workspaces. A CI check fails the build on any mismatch or range.

npm `overrides` is not used to force a version, except to apply a security fix with the advisory linked beside it. A transitive duplicate is resolved by upgrading the direct dependency that pulls it in.

The check is [`syncpack`](https://syncpack.dev) `lint`, pinned at 15.3.3, run in CI. One configuration covers all three rules: a single version policy, exact specifiers, and a ban on `xterm` so only `@xterm/xterm` remains ([README](https://github.com/JamieMason/syncpack#readme)).

## Principle IV exception

`syncpack` is published by one npm maintainer, which Principle IV forbids. The project owner approved the exception on 2026-10-12, choosing the tool Turborepo's documentation lists first for this job. It is accepted because it is a development-only lint: it never ships in the app and never runs at the app's run time, and if it stops being maintained the cost is replacing one CI step. If it is deprecated or carries an active CVE, it is replaced under Principle IV's last rule.

## Context

On 2026-10-12, 11 packages were declared at different versions across workspaces, two of them a major apart (`lucide-react` 0.475 and 1.x; `react-markdown` 9 and 10), the terminal library was installed under two names, and 48 specs were ranges. The lockfile held 102 packages at more than one version.

## Alternatives considered

| Alternative   | Why rejected                                                                                                                                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Turborepo     | A task runner and cache; it does not enforce versions. Its docs point to `syncpack`, `manypkg` and `sherif` ([docs](https://turborepo.com/docs/crafting-your-repository/managing-dependencies#keeping-dependencies-on-the-same-version)) |
| `syncpack`    | One npm maintainer; Principle IV                                                                                                                                                                                                         |
| `sherif`      | One npm maintainer; Principle IV                                                                                                                                                                                                         |
| pnpm catalogs | Built for exactly this ([docs](https://pnpm.io/catalogs)), but means leaving npm, which the workflow section of the constitution names                                                                                                   |

## Consequences

- `@manypkg/cli` was the compliant alternative (two npm maintainers, last release 2025-08-28).
- The CI check is added only after the existing mismatches are fixed, so it lands green.
- Upgrades become one change across all workspaces at once.
