# ADR-106: TypeScript 6.0.3, Not 7.0, Until typescript-eslint Supports 7

**Status**: Accepted
**Date**: 2026-10-12

## Decision

The repository pins `typescript` at **6.0.3**, the newest release on the 6.x line, up from 5.5.4. It does not move to 7.0.2, the release npm tags `latest` (`npm view typescript dist-tags`: `latest: '7.0.2'`).

The upgrade changes four compiler settings. TypeScript 6.0 changed a default or deprecated an option for each one ([TypeScript 6.0 release notes, "Breaking Changes and Deprecations"](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)):

| Setting                                                                                                                  | Why                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl` removed from `tsconfig.main.json` and `tsconfig.renderer.json`; `@shared/*` maps to `./src/shared/*`           | `baseUrl` is deprecated (TS5101) and removed in 7.0. It was only the prefix of the one `paths` entry. The release notes say to rewrite this case this way.                                                                                                                    |
| `"types": ["node"]` in `tsconfig.shared.json`                                                                            | `types` now defaults to `[]`. `src/shared/schemas/settings.schema.ts` reads `process.env.SHELL`.                                                                                                                                                                              |
| `vite/client` in `types` of `tsconfig.renderer.json`, `tsconfig.test.json`, `tsconfig.extension.json` and `extension-ui` | `noUncheckedSideEffectImports` now defaults to `true`, so every `import './x.css'` was TS2882. Vite resolves the stylesheets, and Vite's [client types](https://vite.dev/guide/features#client-types) declare `*.css`. The check stays on for every other side-effect import. |
| `Buffer` casts dropped from `tests/unit/terminal/pty-manager.spec.ts`                                                    | In 5.9, `lib.d.ts` makes `Buffer` generic over `ArrayBufferLike`. So `'…' as unknown as Buffer` no longer fits `readFileSync`'s `string \| NonSharedBuffer`. The mocked value is a string, and the type admits a string without a cast.                                       |

`npm run typecheck` reported these changes and nothing else, across the core, the specs, both packages and the five extensions.

## Context

TypeScript 7.0 is the native (Go) port. Its npm package ships the `tsc` binary and no compiler API. The `.` export of the package is `lib/version.cjs`, which exports only `version` and `versionMajorMinor` (checked on the 7.0.2 tarball from `npm pack typescript@7.0.2`). The status table of the port lists the API as "not ready" ([microsoft/typescript-go README](https://github.com/microsoft/typescript-go#what-works-so-far)).

typescript-eslint loads the compiler API from `typescript`. `npm run lint` runs typescript-eslint for every TypeScript file. Its newest release, 8.71.1, declares `typescript: ">=4.8.4 <6.1.0"` (`npm view typescript-eslint@latest peerDependencies`; [Dependency Versions](https://typescript-eslint.io/users/dependency-versions)). Its canary declares the same range. Storybook's `react-docgen-typescript` in `packages/extension-ui` loads the same API.

## Alternatives considered

| Alternative                                                                                                                              | Why rejected                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript@7.0.2` for `tsc`, and `@typescript/typescript6` (Microsoft's package that re-exports the 6.0 API) for the tools that need it | typescript-eslint and react-docgen-typescript call `require('typescript')`, not `@typescript/typescript6`. To point them at it, you need an npm `overrides` entry. Principle IV allows `overrides` only for a security fix. |
| `typescript@7.0.2` alone                                                                                                                 | `npm run lint` and Storybook stop working, because the package has no compiler API.                                                                                                                                         |
| Stay on 5.5.4                                                                                                                            | 5.5.4 cannot read the declarations of `@vitejs/plugin-react` (string export names). For this reason, `vite-config-remote.spec.ts` stayed out of the type-check.                                                             |

## Consequences

The configs no longer use the deprecations that TypeScript 7 removes. The move to 7 is a version bump once the range of typescript-eslint includes 7.
