# ADR 039: One UI layer, published outward

**Status**: Accepted

**Date**: 2026-09-05

## Context

The extensions and the core had drifted into two vocabularies for the same
things, and nothing was watching. Measured before this feature:

| What                                          | Extensions          | Core |
| --------------------------------------------- | ------------------- | ---- |
| Independent overlay implementations           | 4                   | 1    |
| `z-index` values, unmanaged                   | 38                  | —    |
| `size={n}` icon props (Principle XII)         | 185                 | 2    |
| Hardcoded hex / raw `rgba()` in CSS           | 320 / 739           | —    |
| `--tm-*` names referenced but never published | 21 (121 references) | —    |
| Light theme                                   | none                | yes  |

The last two lines are the ones that matter most, because they are not style
drift — they are dead CSS. A reference to a token nobody defines makes its
declaration invalid and the browser drops it: a hover with no hover, a colour
with no colour. And `EXTENSION_BASE_CSS` had a single dark `:root` block, so
switching the app to light left every extension panel dark.

The cause is the same in each row. The core's rules lived in the core's
stylesheet and the core's components, and an extension is a separate document
that loads neither. Nothing was published outward, so five teams-of-one each
invented their own.

Three ways out were considered.

**Copy the core's components into each extension.** Rejected: five copies is
what we already had, only with a shared ancestor to argue about.

**Add runtime UI to `@terminator/extension-sdk`.** Rejected: that package is
types-only — a `types` field, no `main`, no build step — and it is what a third
party installs to get type definitions. Putting React in it changes what the
package _is_ and forces a build on consumers who wanted `.d.ts` files.

**Have the core host the UI on an extension's behalf.** Rejected for the
compositing reason in ADR 038.

## Decision

**`packages/extension-ui` is the single implementation of the shared UI
behaviour, and it is published outward — to the bundled extensions, to the core,
and to third parties.**

It carries the components (`Dialog`, `ConfirmDialog`, `Popover`, `ToastRegion`,
`EmptyState`, `IconButton`), the primitives underneath them (`useDismissible`,
the focus trap, the modal-depth registry), and the layer scale. It is
source-only — `main`, `module` and `types` all point at `./src/index.ts` — with
`react`, `react-dom` and `lucide-react` as peer dependencies, so it adds no
build step and no second React.

The token contract is published alongside it, by a different route: the design
tokens cannot be an import, because CSS in a separate document has to be injected
into that document. `EXTENSION_BASE_CSS` in `extension-view-host.ts` is that
injection, and it is the authority for what `--tm-*` names exist. Both themes
live there.

Three rules keep it from drifting again, and each is enforced rather than
documented:

- `docs/EXTENSION-STYLE.md` is the written rule set, and its vocabulary rules
  are `no-restricted-syntax` selectors scoped to `extensions/*/src/**/*.tsx`,
  with a fixture spec (`tests/unit/lint/extension-vocabulary.spec.ts`). The
  equivalent rule for the word "project" had existed since ADR 032 but was
  scoped to `src/renderer/components/**` — which is precisely why the
  extensions drifted.
- A raw `z-index` number in an extension is a lint error.
- `tests/e2e/extension-themes.spec.ts` renders every extension surface in both
  themes and asserts WCAG AA on the composited result. Reading the stylesheets
  cannot answer this: half these colours are alpha over an inherited surface or
  a `color-mix`, and only a browser composites them.

## Consequences

The core is a consumer of this package, not its owner — `ConfirmDialog` in the
core wraps the shared one. That direction matters: a shared floor that the core
does not itself stand on is a floor that stops matching the core.

Extension isolation (Constitution II) is unaffected and slightly better
enforced. `packages/extension-ui` is a peer of both, so an extension importing
it is not reaching into core internals. Five direct imports of core source were
removed in the process; all five were also inert, bundling a second copy of a
store rather than sharing one.

An extension may still write its own overlay. Nothing prevents it, and for a
surface genuinely unlike the shared ones that is the right call — the package is
a floor, not a fence.
