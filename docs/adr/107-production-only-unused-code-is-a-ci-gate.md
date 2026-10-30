# ADR 107: Code only tests reach is a CI gate

**Status**: Accepted
**Date**: 2026-10-13
**Extends**: [ADR 104](104-unused-code-is-a-ci-gate.md)
**Relates to**: Constitution Principle VI

## Decision

The gate of ADR 104 runs knip over everything, tests included. So a file or export that a spec imports never counts as unused, even when nothing in the app uses it. The last consequence of ADR 104 named the next step, and this ADR takes it. `npm run lint:unused:production` runs `knip --production` in the CI lint job, right after the unused-code step. It must report nothing.

In [production mode](https://knip.dev/features/production-mode), knip reads only these inputs:

- the `entry` and `project` patterns that end in `!`
- the production entries that its plugins give (the main, preload and renderer inputs of electron-vite, and the Vite configs)
- the `dependencies`, not the `devDependencies`

`knip.jsonc` marks the `src/index.ts` of each extension and the `window.electronAPI` declaration with `!`. Negated `!` patterns leave `tests/` and the `stories/` of the design system out of the production run. The default run still sees them.

## What the first run found

The first run used `npx knip --production`, before `knip.jsonc` marked anything. It reported 260 unused files, 5 unused dependencies, 275 unused exports and 66 unused exported types. Most of the files were whole extensions that knip could not see as production code. The findings had five causes. Each fix addresses the cause:

| Cause                                                                   | Fix                                                                        | Count                     |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------- |
| Production entries knip could not see, and tests it took for production | `!` on 3 entries; tests and stories negated with `!` in `project`          | 260 files, 5 dependencies |
| Code nothing in the app calls                                           | Deleted with its tests (Principle VI)                                      | 16                        |
| An expectation kept in `src/` that only specs read                      | Moved beside the specs (`tests/support/quick-actions.ts` and the specs)    | 8                         |
| A test seam: a setter or reset only specs call                          | Replaced by what the app does (a fake clock, a fresh module, disposing)    | 3                         |
| Code the app runs from inside its own file, which a spec tests directly | Tagged [`@internal`](https://knip.dev/reference/jsdoc-tsdoc-tags#internal) | 199 values, 25 types      |

`@internal` is the answer of knip for an export "not meant for public consumption, but only for internal usage such as tests". Production mode does not report it. knip prints a tag hint for an `@internal` that the code no longer needs. So a tag cannot outlive its reason.

## Consequences

- A function, constant or type that no shipped code reaches fails the build. A test import does not change this.
- A new export that only a spec imports needs a choice. Either drop the `export` and test it through the code that calls it, or tag it `@internal`. Use the tag for a pure function whose cases are clearer when tested alone.
- A test seam in `src/` (a clock setter, a reset) fails the gate. Specs fake what the app reads instead (`vi.useFakeTimers`, `vi.resetModules`).
- The default run, the gate of ADR 104, is unchanged.
