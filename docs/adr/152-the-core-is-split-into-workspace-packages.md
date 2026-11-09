# ADR 152: The core is split into workspace packages, run by Turborepo

**Status**: Accepted

**Date**: 2026-11-08

## Context

The core lived at the repository root: `src/` (about 59,000 lines) and `tests/` (511 spec files). The extensions and the two published packages were npm workspaces; the core was not. A tool that picks the checks a change reaches works from the package graph, and to such a tool any change to the root reaches everything. The maintainer asked for test targeting through Turborepo (design: "Terminator Speed and termctl", 2026-11-08).

## Decision

The core moves into five workspace packages: `packages/core-shared` (was `src/shared`), `packages/core-main` (`src/main`), `packages/core-renderer` (`src/renderer` and `src/extension-frame`), `packages/core-renderer-remote` (`src/renderer-remote`) and `packages/test-support` (`tests/support`, `tests/setup.ts`, `tests/global-setup.ts`, `tests/fixtures`). Each core spec moves into the package whose source it imports. The root `tests/` keeps E2E, the live specs, the specs of `scripts/` and the configs, and the few specs that import both main and renderer or an extension. Every workspace has `lint` and `test` scripts, and each one with a tsconfig has a `typecheck` script. Each core package type-checks its specs with its own `tsconfig.test.json`, so each lint and typecheck process holds only its package's specs. The root `tsconfig.test.json` keeps the root specs and `packages/test-support`. Turborepo (`turbo.json`) runs `npm run typecheck` and `npm run lint` across them, and replaces `scripts/typecheck.mjs`, `scripts/lint.mjs` and `scripts/each-limited.mjs`. No task is cached, so every run still checks everything once (Constitution XIV, ADR 151).

Two things stay as they were, so the built and packaged app does not change. The Electron app stays at the root: `package.json` (`main`, the dependencies electron-builder packages and electron-vite externalizes), `electron.vite.config.ts` and `electron-builder.cjs`. And the core packages import each other by relative path. Each one declares the core packages it uses in its `package.json` only so that Turborepo's graph knows them. Every workspace with specs also declares `@terminator/test-support` as a dev dependency, because its specs run under `packages/test-support/setup.ts`. knip is told to ignore those declarations.

## Alternatives considered

- **`apps/desktop` for the Electron app.** electron-builder packages the dependencies of the app's `package.json`, and electron-vite externalizes them. Moving the app moves both, and the packaged app changes. That is a change of its own, for when a reason needs it.
- **Imports by package name (`@terminator/core-shared/...`).** Main-process files import with `.js` extensions and renderer files without, and the packages ship TypeScript source. Package-name imports then depend on how TypeScript, Vite, Vitest and knip each resolve an `exports` pattern. A relative path resolves the same in all of them.
- **One package for the whole core.** A change to the renderer would then reach every main-process spec.

## Consequences

The pre-commit hook and CI run the same npm scripts as before. `npm test` still runs the whole Vitest suite in one process, and each workspace's `test` script runs its own part of it (`vitest run --root ../.. <package>/`). Test selection, cached results and the CI changes that use them come in a later change, with the constitution amendment they need.
