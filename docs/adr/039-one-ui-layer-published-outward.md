# ADR 039: One UI layer, published outward

**Status**: Accepted

**Date**: 2026-09-05

## Context

The extensions and the core had drifted into two vocabularies for the same things, and nothing watched for it. We measured the following before this feature:

| What                                          | Extensions          | Core |
| --------------------------------------------- | ------------------- | ---- |
| Independent overlay implementations           | 4                   | 1    |
| `z-index` values, unmanaged                   | 38                  | —    |
| `size={n}` icon props (Principle XII)         | 185                 | 2    |
| Hardcoded hex / raw `rgba()` in CSS           | 320 / 739           | —    |
| `--tm-*` names referenced but never published | 21 (121 references) | —    |
| Light theme                                   | none                | yes  |

The last two rows matter most, because they are not style drift. They are dead CSS. A reference to a token that nobody defines makes its declaration invalid, and the browser drops it: a hover with no hover, a colour with no colour. Also, `EXTENSION_BASE_CSS` had a single dark `:root` block, so when the app switched to light, every extension panel stayed dark.

The cause is the same in each row. The core's rules lived in the core's stylesheet and the core's components. An extension is a separate document that loads neither. Nothing was published outward, so five teams-of-one each invented their own.

We considered three ways out.

**Copy the core's components into each extension.** Rejected: this gives five copies, which is what we already had, only with a shared ancestor to argue about.

**Add runtime UI to `@terminator/extension-sdk`.** Rejected: that package is types-only, with a `types` field, no `main`, and no build step. A third party installs it to get type definitions. Adding React changes what the package _is_, and forces a build on consumers who wanted `.d.ts` files.

**Have the core host the UI on an extension's behalf.** Rejected for the compositing reason in ADR 038.

## Decision

**`packages/extension-ui` is the single implementation of the shared UI behaviour. It is published outward: to the bundled extensions, to the core, and to third parties.**

It carries these parts:

- the components (`Dialog`, `ConfirmDialog`, `Popover`, `ToastRegion`, `EmptyState`, `IconButton`)
- the primitives under them (`useDismissible`, the focus trap, the modal-depth registry)
- the layer scale

It is source-only: `main`, `module` and `types` all point at `./src/index.ts`. `react`, `react-dom` and `lucide-react` are peer dependencies, so it adds no build step and no second React.

The token contract is published alongside it, by a different route. The design tokens cannot be an import, because CSS in a separate document must be injected into that document. `EXTENSION_BASE_CSS` in `extension-view-host.ts` is that injection. It is the authority for which `--tm-*` names exist. Both themes live there.

Three rules keep the layer from drifting again. Each rule is enforced, not only documented:

- `docs/EXTENSION-STYLE.md` is the written rule set. Its vocabulary rules are `no-restricted-syntax` selectors scoped to `extensions/*/src/**/*.tsx`, with a fixture spec (`tests/unit/lint/extension-vocabulary.spec.ts`). An equivalent rule for the word "project" had existed since ADR 032, but it was scoped to `src/renderer/components/**`. This is why the extensions drifted.
- A raw `z-index` number in an extension is a lint error.
- `tests/e2e/extension-themes.spec.ts` renders every extension surface in both themes. It asserts WCAG AA on the composited result. Reading the stylesheets cannot answer this question: half these colours are alpha over an inherited surface or a `color-mix`, and only a browser composites them.

## Consequences

The core is a consumer of this package, not its owner: `ConfirmDialog` in the core wraps the shared one. The direction matters. A shared floor that the core does not itself stand on stops matching the core.

Extension isolation (Constitution II) is unaffected, and its enforcement is slightly better. `packages/extension-ui` is a peer of both sides, so an extension that imports it does not reach into core internals. We removed five direct imports of core source in the process. All five were also inert: each bundled a second copy of a store instead of sharing one.

An extension can still write its own overlay. Nothing prevents it. For a surface that is genuinely unlike the shared ones, that is the right call. The package is a floor, not a fence.
