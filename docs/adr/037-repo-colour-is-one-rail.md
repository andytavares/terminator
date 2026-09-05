# ADR 037: Repo colour is one rail

**Status**: Accepted

**Date**: 2026-09-05

**Supersedes**: `033-one-app-band`, in its colour half only — the app-band consolidation that ADR stands for is unchanged, and this feature keeps it.

## Context

Feature 033 gave a repo's identity colour the run of the sidebar column. It was spent in six places at once:

| Surface      | Treatment                                           |
| ------------ | --------------------------------------------------- |
| Group header | `color-mix(--ws-color 10%, transparent)` background |
| Row at rest  | 5% background                                       |
| Row hovered  | 14% over `--bg-card-hover`                          |
| Row selected | 22% over `--bg-card-hover`                          |
| Edge rails   | `inset 2px` at 70% (header) and 30% (row)           |
| Header text  | the raw swatch, as `color`                          |

The reasoning was continuity: an unpainted element in the middle of a run reads as the tint breaking rather than as the run ending. That reasoning is sound, and the implementation carried real care — `sidebar-workspace-tint.spec.ts` read the actual CSS and asserted every wash stayed shallow enough to hold WCAG AA for all ten preset colours in both themes.

Two things were wrong with it anyway.

**It spent the loudest channel on the least urgent fact.** Which repo a row belongs to is the most stable thing about it and almost never the thing you are looking for. Meanwhile the state of the row — the thing you _are_ looking for — had a single small glyph. The eye was drawn by hue and had to work to find the shape.

**The header text failed AA outright.** The washes were tested; the text colour was not tested in situ. Painting a repo name in its own swatch, composited over that swatch's own 10% wash, measures in the light theme at:

| Preset    | Contrast     |
| --------- | ------------ |
| `#facc15` | **1.08 : 1** |
| `#4ade80` | **1.23 : 1** |
| `#5cc0bb` | **1.52 : 1** |

against the 4.5 : 1 AA requires. Measured in a browser, not inferred.

## Decision

**A repo's colour appears as one 2px rail on the rows belonging to it, and as a small swatch beside the repo's name. Nowhere else.**

- No background tint at rest, on hover, or when selected.
- Hover and selection are neutral theme surfaces, **identical for every repo**.
- The repo name is `--text-primary`, ordinary text.
- A row with no repo draws no rail and is otherwise laid out identically.

The edge belongs to the repo alone. In particular the "needs you" emphasis, which used to be a 3px accent edge that deliberately overrode the repo rail, moves into the status gutter — the two were fighting for the same three pixels, which was a contradiction between two requirements as written.

## Consequences

**The AA failure is fixed rather than worked around.** Moving the colour into a 7px swatch and the name to `--text-primary` takes those three from 1.08/1.23/1.52 to **15.0 : 1**.

**The contrast guarantee is retargeted, not deleted.** `sidebar-workspace-tint.spec.ts` still exists and still runs over all ten presets in both themes. It now asserts the washes are _gone_ — no `color-mix` of `--ws-color` survives anywhere in the sidebar, and the colour is used only in a `box-shadow` rail and a swatch `background` — and it checks the text tokens against the flat surfaces they now sit on. With no `color-mix` left there is nothing a browser would resolve differently from the arithmetic in that spec.

**Continuity is no longer a concern.** It was a property of a run of tinted surfaces; there is no run. Repos are separated by their headers and by the change of rail colour.

## Alternatives considered

**Keep the washes, fix only the header text.** The narrowest correction, and it would have closed the AA defect. Rejected: it leaves the colour still doing the loudest work on the least urgent fact, which is the substance of the complaint rather than an accessibility footnote.

**Drop colour to a dot beside the repo name and go fully greyscale in the column.** Closest to the reference product, and the most disciplined option. Rejected because with several repos on screen the rail is what lets a row be assigned to its repo without reading upward to find its header — the dot answers "which repo is this header" but not "which repo is this row".
