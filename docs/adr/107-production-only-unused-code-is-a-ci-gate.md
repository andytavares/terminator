# ADR 107: Code only tests reach is a CI gate

**Status**: Accepted
**Date**: 2026-10-13
**Extends**: [ADR 104](104-unused-code-is-a-ci-gate.md)
**Relates to**: Constitution Principle VI

## Decision

ADR 104's gate runs knip over everything, tests included, so a file or export a spec imports never counts as unused, even when nothing in the app does. Its last consequence named the next step. This takes it: `npm run lint:unused:production` runs `knip --production` in the CI lint job, right after the unused-code step, and must report nothing.

In [production mode](https://knip.dev/features/production-mode) knip reads only the `entry` and `project` patterns that end in `!`, the production entries its plugins give (electron-vite's main, preload and renderer inputs, the Vite configs), and the `dependencies`, not the `devDependencies`. `knip.jsonc` marks each extension's `src/index.ts` and the `window.electronAPI` declaration with `!`. It leaves `tests/` and the design system's `stories/` out of the production run with negated `!` patterns, so the default run still sees them.

## What the first run found

The first run, before `knip.jsonc` marked anything (`npx knip --production`), reported 260 unused files, 5 unused dependencies, 275 unused exports and 66 unused exported types. Most of the files were whole extensions knip could not see as production code. The findings had five causes, each fixed at the cause:

| Cause                                                                   | Fix                                                                        | Count                     |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------- |
| Production entries knip could not see, and tests it took for production | `!` on 3 entries; tests and stories negated with `!` in `project`          | 260 files, 5 dependencies |
| Code nothing in the app calls                                           | Deleted with its tests (Principle VI)                                      | 16                        |
| An expectation kept in `src/` that only specs read                      | Moved beside the specs (`tests/support/quick-actions.ts` and the specs)    | 8                         |
| A test seam: a setter or reset only specs call                          | Replaced by what the app does (a fake clock, a fresh module, disposing)    | 3                         |
| Code the app runs from inside its own file, which a spec tests directly | Tagged [`@internal`](https://knip.dev/reference/jsdoc-tsdoc-tags#internal) | 199 values, 25 types      |

`@internal` is knip's own answer for an export "not meant for public consumption, but only for internal usage such as tests": production mode does not report it. knip prints a tag hint for an `@internal` the code no longer needs, so a tag cannot outlive its reason.

## Consequences

- A function, constant or type that no shipped code reaches fails the build, whether or not a test imports it.
- A new export that only a spec imports is a choice: drop the `export` and test it through the code that calls it, or tag it `@internal`. The second is for a pure function whose cases are clearer tested alone.
- A test seam in `src/` (a clock setter, a reset) fails the gate. Specs fake what the app reads instead (`vi.useFakeTimers`, `vi.resetModules`).
- The default run, ADR 104's gate, is unchanged.
