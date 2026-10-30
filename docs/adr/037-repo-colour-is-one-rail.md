# ADR 037: Repo colour is one rail

**Status**: Accepted

**Date**: 2026-09-05

**Supersedes**: `033-one-app-band`, in its colour half only. The app-band consolidation that ADR stands for is unchanged, and this feature keeps it.

## Context

Feature 033 gave a repo's identity colour the whole sidebar column. The colour was used in six places at once:

| Surface      | Treatment                                           |
| ------------ | --------------------------------------------------- |
| Group header | `color-mix(--ws-color 10%, transparent)` background |
| Row at rest  | 5% background                                       |
| Row hovered  | 14% over `--bg-card-hover`                          |
| Row selected | 22% over `--bg-card-hover`                          |
| Edge rails   | `inset 2px` at 70% (header) and 30% (row)           |
| Header text  | the raw swatch, as `color`                          |

The reasoning was continuity. An unpainted element in the middle of a run reads as a break in the tint, not as the end of the run. That reasoning is sound. The implementation was also careful: `sidebar-workspace-tint.spec.ts` read the actual CSS. It asserted that every wash stayed shallow enough to hold WCAG AA for all ten preset colours in both themes.

Two things were still wrong.

**It spent the loudest channel on the least urgent fact.** The repo a row belongs to is the most stable fact about it, and you almost never look for it. The state of the row is the fact you _do_ look for, and it had one small glyph. Hue drew the eye, and you had to work to find the shape.

**The header text failed AA outright.** The tests covered the washes, but not the text colour in place. A repo name painted in its own swatch, over that swatch's own 10% wash, measures in the light theme at:

| Preset    | Contrast     |
| --------- | ------------ |
| `#facc15` | **1.08 : 1** |
| `#4ade80` | **1.23 : 1** |
| `#5cc0bb` | **1.52 : 1** |

AA requires 4.5 : 1. We measured these in a browser. We did not infer them.

## Decision

**A repo's colour appears as one 2px rail on the rows that belong to it, and as a small swatch beside the repo's name. Nowhere else.**

- No background tint at rest, on hover, or when selected.
- Hover and selection use neutral theme surfaces, **identical for every repo**.
- The repo name is `--text-primary`, ordinary text.
- A row with no repo draws no rail. Its layout is otherwise identical.

The edge belongs to the repo alone. The "needs you" emphasis used to be a 3px accent edge that deliberately overrode the repo rail. It moves into the status gutter. The two fought for the same three pixels, which was a contradiction between two requirements as written.

## Consequences

**The AA failure is fixed, not worked around.** The colour moves into a 7px swatch and the name moves to `--text-primary`. This takes those three presets from 1.08/1.23/1.52 to **15.0 : 1**.

**The contrast guarantee has a new target. It is not deleted.** `sidebar-workspace-tint.spec.ts` still exists and still runs over all ten presets in both themes. It now asserts that the washes are _gone_. No `color-mix` of `--ws-color` survives in the sidebar, and the colour appears only in a `box-shadow` rail and a swatch `background`. It also checks the text tokens against the flat surfaces they now sit on. No `color-mix` is left, so a browser cannot resolve anything differently from the arithmetic in that spec.

**Continuity is no longer a concern.** It was a property of a run of tinted surfaces, and there is no run now. Repo headers and the change of rail colour separate the repos.

## Alternatives considered

**Keep the washes, fix only the header text.** This is the narrowest correction, and it would have closed the AA defect. Rejected: the colour would still do the loudest work on the least urgent fact. That is the substance of the complaint, not an accessibility footnote.

**Drop colour to a dot beside the repo name and go fully greyscale in the column.** This is closest to the reference product and the most disciplined option. Rejected: with several repos on screen, the rail lets you assign a row to its repo without reading upward to find its header. The dot answers "which repo is this header" but not "which repo is this row".
