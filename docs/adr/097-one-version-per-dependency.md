# ADR 097: One version per dependency

**Status**: Accepted
**Date**: 2026-10-12
**Relates to**: Constitution Principle IV (2.0.0)

## Decision

Every package is declared at one exact version across the root and all workspace `package.json` files. A library published under two names counts as one. `xterm` 5.3 is removed in favour of `@xterm/xterm` 6. Ranges are not allowed, except in references to the own workspaces of this repository. A CI check fails the build on any mismatch or range.

npm `overrides` is not used to force a version. The one exception is a security fix, with the advisory linked beside it. To resolve a transitive duplicate, upgrade the direct dependency that pulls it in.

The check is [`syncpack`](https://syncpack.dev) `lint`, pinned at 15.3.3, run in CI. One configuration covers all three rules: a single version policy, exact specifiers, and a ban on `xterm` so that only `@xterm/xterm` remains ([README](https://github.com/JamieMason/syncpack#readme)).

## Principle IV exception

`syncpack` is published by one npm maintainer, which Principle IV forbids. The project owner approved the exception on 2026-10-12. The owner chose the tool that the documentation of Turborepo lists first for this job. The exception is accepted for these reasons:

- `syncpack` is a development-only lint. It never ships in the app and never runs at the run time of the app.
- If it stops being maintained, the cost is replacing one CI step.

If `syncpack` is deprecated or carries an active CVE, the project replaces it under the last rule of Principle IV.

## Context

On 2026-10-12, the repository had these problems:

- 11 packages were declared at different versions across workspaces.
- Two of those 11 packages were a major version apart (`lucide-react` 0.475 and 1.x; `react-markdown` 9 and 10).
- The terminal library was installed under two names.
- 48 specs were ranges.
- The lockfile held 102 packages at more than one version.

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
