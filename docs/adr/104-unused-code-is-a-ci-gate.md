# ADR 104: Unused code is a CI gate

**Status**: Accepted
**Date**: 2026-10-12
**Relates to**: Constitution Principles IV and VI

## Decision

Unused files, exports and dependencies fail the build. The check is [knip](https://knip.dev), pinned at 6.39.0. It runs as `npm run lint:unused` in the CI lint job. Its configuration is `knip.jsonc`, with one entry per npm workspace ([monorepos and workspaces](https://knip.dev/features/monorepos-and-workspaces), [configuration](https://knip.dev/reference/configuration)).

Entry points come from the plugins of knip wherever one exists: electron-vite, Vite, Vitest, Playwright and Storybook.

- electron-vite covers the main, preload and renderer inputs, and the extension host among them.
- Vite covers the `vite.renderer.config.ts` and `vite.config.remote.ts` of each extension.

The SDK and the design system are entered through the `exports` in their `package.json`. So their exports are an API, and knip never reports them.

The config lists by hand what knip cannot see. Each entry has a comment that says how the code is reached:

- the `window.electronAPI` global declaration
- a file that esbuild bundles from a string in an E2E spec
- a grammar loaded by path
- the `ngrok` binary that the user installs

When the team added the gate, it reported these findings (`npx knip`):

- 4 unused files
- 6 unused dependencies
- 2 unused devDependencies
- 50 unlisted dependencies
- 70 unused exports
- 117 unused exported types
- 1 duplicate export

The team deleted each one, made it module-private, or declared it. So the gate starts at zero.

## Principle IV exception

knip is published by one npm maintainer, which Principle IV forbids. The project owner chose it for this gate. The exception is accepted on the same terms as syncpack ([ADR 097](097-one-version-per-dependency.md)). It is a development-only lint that never ships and never runs in the app. If it stops being maintained, the cost is one CI step. Version 5.62 crashes on TypeScript 5.5.4 of this repository. Version 6.x parses with oxc and does not load TypeScript at all. If knip is deprecated or carries an active CVE, the project replaces it under the last rule of Principle IV.

## Alternatives considered

| Alternative                       | Why rejected                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ts-prune`                        | Exports only: no unused files or dependencies; resumed after a long hiatus ([README](https://github.com/nadeesha/ts-prune)) |
| TypeScript `noUnusedLocals`       | Sees one file at a time: an export nobody imports is not a local                                                            |
| ESLint `import/no-unused-modules` | Needs `eslint-plugin-import`, does not check `package.json` dependencies                                                    |

## Consequences

- An export is a decision. A module exports what another module imports, and nothing else.
- A dependency that nothing imports is removed in the same change that stops importing it.
- The gate does not yet cover `knip --production` (code reachable only from tests). Principle VI asks for it, and it is the next step.
