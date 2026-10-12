# ADR 102: Unused code is a CI gate

**Status**: Accepted
**Date**: 2026-10-12
**Relates to**: Constitution Principles IV and VI

## Decision

Unused files, exports and dependencies fail the build. The check is [knip](https://knip.dev), pinned at 6.39.0, run as `npm run lint:unused` in the CI lint job. Its configuration is `knip.jsonc`, one entry per npm workspace ([monorepos and workspaces](https://knip.dev/features/monorepos-and-workspaces), [configuration](https://knip.dev/reference/configuration)).

Entry points come from knip's plugins wherever one exists: electron-vite (the main, preload and renderer inputs, the extension host among them), Vite (each extension's `vite.renderer.config.ts` and `vite.config.remote.ts`), Vitest, Playwright and Storybook. The SDK and the design system are entered through their `package.json` `exports`, so their exports are an API and never reported. What knip cannot see is listed by hand with a comment saying how it is reached: the `window.electronAPI` global declaration, a file esbuild bundles from a string in an E2E spec, a grammar loaded by path, the `ngrok` binary the user installs.

When the gate was added it reported 4 unused files, 6 unused dependencies, 2 unused devDependencies, 50 unlisted dependencies, 70 unused exports, 117 unused exported types and 1 duplicate export (`npx knip`). Each was deleted, made module-private or declared, so the gate starts at zero.

## Principle IV exception

knip is published by one npm maintainer, which Principle IV forbids. It is the tool the project owner chose for this gate. It is accepted on the same terms as syncpack ([ADR 097](097-one-version-per-dependency.md)): it is a development-only lint that never ships and never runs in the app, and if it stops being maintained the cost is one CI step. Version 5.62 crashes on this repository's TypeScript 5.5.4; 6.x parses with oxc and does not load TypeScript at all. If it is deprecated or carries an active CVE, it is replaced under Principle IV's last rule.

## Alternatives considered

| Alternative                       | Why rejected                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ts-prune`                        | Exports only: no unused files or dependencies; resumed after a long hiatus ([README](https://github.com/nadeesha/ts-prune)) |
| TypeScript `noUnusedLocals`       | Sees one file at a time: an export nobody imports is not a local                                                            |
| ESLint `import/no-unused-modules` | Needs `eslint-plugin-import`, does not check `package.json` dependencies                                                    |

## Consequences

- An export is a decision: a module exports what another module imports, and nothing else.
- A dependency that nothing imports is removed in the same change that stops importing it.
- `knip --production` (code reachable only from tests) is not gated yet; Principle VI asks for it, and it is the next step.
