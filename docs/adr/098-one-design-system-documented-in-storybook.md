# ADR 098: One design system, documented in Storybook

**Status**: Accepted
**Date**: 2026-10-12
**Extends**: ADR-039 (one UI layer, published outward)
**Relates to**: Constitution Principle XIII (2.0.0)

## Decision

`packages/extension-ui` becomes the design system for the whole app. ADR-039 made it the shared floor and said it was "a floor, not a fence". This makes it the fence:

1. **Tokens.** Color, spacing, type, radius and layer values are defined once, in one token file in the design system, for both themes. The core injects that file into its own renderer and into every extension view, the way VS Code injects its theme into webviews as [`--vscode-*` variables](https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content). The core's `--bg-*` names and the extensions' `--tm-*` names become one set.
2. **Components.** Button, field, tabs, dialog, popover, toast, empty state, markdown and relative time live in the design system. The core and every extension use them instead of their own. A missing component is added there first.
3. **The core is a consumer.** The core's own dialogs, toast and empty state move onto the design system.
4. **Documentation.** Storybook with the [React and Vite framework](https://storybook.js.org/docs/get-started/frameworks/react-vite) documents every component, with stories for each state in both themes. The stories run as tests through the [Vitest add-on](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon).
5. **Layout.** Playwright [screenshot tests](https://playwright.dev/docs/test-snapshots) at the supported window sizes, in both themes, guard every core and extension surface. ADR-039's contrast test stays.
6. **Fonts** ship with the app instead of being fetched.

## Context

Controls look different and do not line up across screens. The audit counted three token definitions under two naming schemes, eleven dialog implementations, 539 button rules across 3,600 lines of CSS, and a code font fetched at run time that falls back to another font when the fetch fails. The core uses 1 of the shared package's 22 exports; Foundry uses none.

## Alternatives considered

| Alternative                          | Why rejected                                                                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A third-party component library      | A second visual language to override; the tokens still have to be ours                                                                                                              |
| Web components, as VS Code's toolkit | Microsoft deprecated its Webview UI Toolkit on 2025-01-01 ([announcement](https://github.com/microsoft/vscode-webview-ui-toolkit/issues/561)); the app and all extensions are React |
| Chromatic for visual tests           | A paid service; Playwright is already in the repository                                                                                                                             |

## Consequences

- Storybook is a new development dependency and gets the Principle IV review in the change that adds it.
- Extension views keep their own documents (ADR-022, ADR-038); only the token file crosses by injection, everything else is an import.
