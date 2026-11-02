# ADR 140: Each background token has one role

**Status**: Accepted

**Date**: 2026-11-02

## Context

The dark theme had six backgrounds between `#0c0c0f` and `#22222e`. Adjacent steps were 1.02 to 1.08:1 apart, and borders were white at 6% (1.14:1). The icon band painted the lightest background and the work area the darkest, so the chrome drew the eye before the work. The tokens also meant several things at once: `--tm-bg-base` was both the page canvas and the darkest step, and `--tm-bg-surface` painted sidebars, raised tables and floating panels. New values alone could not fix that. Darkening the chrome token darkened every canvas too. The design and its renderings of 31 screens are in the research artifact "Terminator Depth and Hierarchy".

## Decision

Each background token has one role, and the dark values are spaced against the canvas:

| Token                | Role                                   | Dark value | Against the canvas |
| -------------------- | -------------------------------------- | ---------- | ------------------ |
| `--tm-bg-surface`    | Recessed: app band, sidebars, rails    | `#0b0b0e`  | 1.12:1 darker      |
| `--tm-bg-base`       | The canvas                             | `#19191d`  | 1                  |
| `--tm-bg-card`       | A block on the canvas                  | `#222229`  | 1.10:1             |
| `--tm-bg-elevated`   | A float: dialog, menu, popover, drawer | `#26262d`  | 1.17:1             |
| `--tm-bg-card-hover` | Hover and the selected row             | `#2c2c34`  | 1.27:1             |

The step sizes follow the roles of the Radix Colors dark scale ([Radix: understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)). Surfaces lighten as they rise, as in Material's dark theme ([Material Components: Dark theme](https://github.com/material-components/material-components-android/blob/master/docs/theming/Dark.md)). Grey text is neutral, so it no longer shares the link colour's hue. Fields take a new `--tm-border-control` at 3:1 ([WCAG 2.2, 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)). Floats take a new `--tm-shadow-overlay`. Font sizes are seven tokens. The light theme keeps its colour values.

`tests/unit/renderer/design-tokens-contrast.spec.ts` holds the ladder: each step against the canvas, and AA for every text tier on the lightest background it sits on.

## Alternatives considered

| Option                          | Why not                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| New values, same mixed roles    | Tried in the research. The canvas got darker, because `--tm-bg-base` was also the darkest step.  |
| Radix Colors as a dependency    | A package for twelve values, and a second naming scheme beside `--tm-*` (Constitution IV, XIII). |
| A redesign of each screen       | Twenty-one bespoke layouts, and the next screen built goes flat again.                           |
| Shadows for depth on near-black | A shadow barely shows on `#0c0c0f`; both references lift the surface instead.                    |

## Consequences

- Every sidebar and side rail, in the core and in each extension, is on `--tm-bg-surface`. A block on the canvas is on `--tm-bg-card`, never on surface.
- Rounding raw sizes to the scale moves some widths; a fixed column sized for 10px text must be widened.
- `docs/EXTENSION-STYLE.md` sections 8 and 8a carry the rules for extension authors.
