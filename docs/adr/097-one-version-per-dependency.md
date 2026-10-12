# ADR 097: One version per dependency

**Status**: Accepted
**Date**: 2026-10-12
**Relates to**: Constitution Principle IV (2.0.0)

## Decision

Every package is declared at one exact version across the root and all workspace `package.json` files. A library published under two names counts as one: `xterm` 5.3 is removed in favour of `@xterm/xterm` 6. Ranges are not allowed outside references to this repository's own workspaces. A CI check fails the build on any mismatch or range.

npm `overrides` is not used to force a version, except to apply a security fix with the advisory linked beside it. A transitive duplicate is resolved by upgrading the direct dependency that pulls it in.

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

- The tool that runs the check is open: `@manypkg/cli` (two npm maintainers, last release 2025-08-28) needs a Principle IV review, and the alternative is a short script in `scripts/`. It is chosen before the check is added.
- Upgrades become one change across all workspaces at once.
