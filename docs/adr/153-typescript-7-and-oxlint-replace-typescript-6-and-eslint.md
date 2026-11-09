# ADR 153: TypeScript 7 and oxlint replace TypeScript 6 and ESLint

**Status**: Accepted

**Date**: 2026-11-08

Supersedes ADR 106.

## Context

ADR 106 held `typescript` at 6.0.3 because typescript-eslint loads the TypeScript compiler API, and TypeScript 7 (the Go port) ships only `tsc`. typescript-eslint still declares `typescript: ">=4.8.4 <6.1.0"`. The maintainer asked for a faster typecheck and lint (design: "Terminator Speed and termctl", 2026-11-08). Three specs also called the compiler API at run time: `extensions/foundry/tests/verify/ecosystem-neutral.spec.ts`, `packages/core-shared/tests/unit/packages/extension-sdk/renderer-declaration.spec.ts` and `tests/unit/lint/temporal-boundary.spec.ts`.

## Decision

`typescript` is 7.0.2 and `npm run typecheck` runs its `tsc`. oxlint 1.89.0 replaces ESLint, with oxlint-tsgolint 7.0.2005 for the typed rules (`options.typeAware` in `.oxlintrc.json`, [type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware.html)). ESLint, `@eslint/js`, `eslint-config-prettier`, `typescript-eslint`, `@vitest/eslint-plugin`, `globals` and `eslint.config.mjs` are removed.

`.oxlintrc.json` keeps every rule `eslint.config.mjs` enforced, with the same files and exceptions:

- oxlint's own rules cover `eslint:recommended`, the typescript-eslint recommended set, `no-restricted-imports`, the vitest rules, `rules-of-hooks`, `exhaustive-deps` and the size limits.
- `eslint-plugin-react-hooks` (the React Compiler rules, as `react-hooks-js/*`), `eslint-plugin-testing-library` and `eslint-plugin-playwright` run as oxlint JS plugins ([JS plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins.html)). They keep `eslint` installed as their peer, but nothing runs ESLint.
- oxlint has no `no-restricted-syntax`. `scripts/oxlint-plugin/index.mjs` adds `terminator/restricted-syntax`, which takes named groups of the old selectors. A later override replaces the groups of an earlier one, as ESLint's options did.
- oxlint's `no-restricted-imports` ignores a regex with a lookahead, without an error. The extension boundary and the pure layers use negated `group` patterns instead.

The three specs no longer call the compiler API. Two parse with `@babel/parser`. The Temporal spec runs `tsc` on a probe file, so it moves to `tests/integration/lint/`. The lint specs start oxlint, so they move there too; `tests/integration/lint/oxlint-sandbox.ts` lints each case at its repo path in a temporary copy of the config.

## Alternatives considered

- **Stay on TypeScript 6 with ESLint (ADR 106).** It keeps the slow typecheck and lint the maintainer asked to remove, until typescript-eslint supports a compiler API that TypeScript 7 does not ship yet.
- **`oxc-parser` for the two parsing specs.** It would pass Constitution IV as oxlint does, but `@babel/parser` was already in the tree, through Stryker, so it adds no package.
- **Biome.** It has no type-aware rules and does not run ESLint plugins, so the testing-library, Playwright and React Compiler rules would be lost.

## Consequences

`npm run lint` runs oxlint in every workspace and at the root, through Turborepo as before. Disable comments keep their ESLint rule names: oxlint reads `eslint-disable` comments, and `react-hooks/exhaustive-deps` is oxlint's `react/exhaustive-deps`. oxlint, oxlint-tsgolint and the JS plugin support are young; JS plugins are alpha and not covered by semver, so an upgrade must be checked against `tests/integration/lint/`. Constitution XIV's "Enforced, not trusted" names `eslint.config.mjs` and needs an amendment to name `.oxlintrc.json`.

Constitution IV asks for an active community and several active maintainers. npm lists one publishing account for `oxlint` and `oxlint-tsgolint` (`npm view oxlint maintainers`), as it lists release bots for `turbo`. The projects themselves have more: in the 13 weeks to 2026-11-08, 18 people made more than five commits each to oxc-project/oxc, and 2 to oxc-project/tsgolint (`gh api repos/oxc-project/oxc/stats/contributors`).
