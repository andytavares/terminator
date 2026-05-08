# ADR-008: Extension Entry Point Format — CommonJS with Separate Compilation

**Date**: 2026-05-07
**Status**: Accepted
**Branch**: 002-git-github-integration

## Context

The `ExtensionHost` loads extensions dynamically at runtime using Node.js `require()`. This requires extension entry points to be CommonJS modules (`.js` files), not TypeScript source (`.ts`) files.

Two options were considered:

**Option A**: Add a TypeScript compile step for extensions (`tsc` with a separate `tsconfig.extensions.json`). Extensions are authored in TypeScript and compiled to CommonJS during the build step.

**Option B**: Generate extensions as plain CommonJS JavaScript (`.js` files with `module.exports`). Extension authors write JavaScript directly, bypassing the TypeScript compile step for extensions.

## Decision

**Option A — TypeScript with compilation** for bundled first-party extensions (`extensions/git-integration/`).

**Option B — Plain CommonJS JavaScript** for the scaffolding CLI (`scripts/create-extension.js`) and generated extension skeletons (`src/index.js`).

Rationale:
- The git-integration extension is a first-party codebase extension — TypeScript provides type safety and IDE support against the `ExtensionAPI` interface.
- The scaffolding CLI generates `.js` files (not `.ts`) so users can run generated extensions without a build step. The `manifest.json` `main` field points to `src/index.js`.
- Vitest handles TypeScript transpilation for unit/integration tests, so tests import `.ts` files directly.
- For production, the bundled extension's TypeScript is compiled via a separate `tsconfig.extensions.json` step (or included in the main electron-vite build).

## Consequences

- `ExtensionHost` reads `manifest.json` (not `extension.json`) — updated in T085.
- The `manifest.json` `main` field for the git-integration extension points to `src/index.js` (compiled output).
- The scaffolding CLI generates `src/index.js` (CommonJS) using `module.exports = { activate, deactivate }`.
- Third-party extension authors who want TypeScript must add their own compile step and ensure `main` points to the compiled `.js` output.
- The `EXTENSION-DEVELOPMENT.md` documents this workflow clearly.
