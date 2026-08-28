# ADR 033: One app band for two contribution points

**Status**: Accepted

**Date**: 2026-08-27

**Feature**: `032-branch-first-sidebar`

## Context

Terminator's sidebar hosted app-level surfaces — destinations that have nothing to do with which session is selected — in two places at once:

- **Top**: global tabs, contributed via `contributes.globalTab` in an extension manifest, rendered as four unlabelled 11-pixel icons. In practice: Overview (core), Remote Control (`wifi`), Notes (`file`), Task Vault (`calendar`).
- **Bottom**: sidebar items, contributed via `api.sidebar.registerItem()` at runtime, rendered by `ExtensionFooter` as a labelled button. In practice: Git Changes.

Roughly seven hundred pixels apart, in two different visual treatments. A user has no way to know why Notes is at the top and Git Changes at the bottom, because the reason is which registration API the extension author happened to reach for. That is an implementation detail leaking into layout.

The unlabelled half is worse than untidy. Hover-only and icon-only navigation is a documented accessibility failure: it excludes touch, keyboard and assistive-technology users outright, and the icons here are not self-evident even to a sighted mouse user — a calendar glyph for a capture tool is actively misleading, and the icon comes from the extension's own manifest, so nothing stops the next one being worse.

## Decision

Both contribution points render into a single labelled band at the top of the sidebar, `AppBand`.

- Every entry shows its icon **and** its `label` as visible text. There is no icon-only mode and no setting that produces one.
- Every entry carries an `aria-label`; the icon is `aria-hidden`. The active entry carries `aria-current="page"`.
- Every entry is a `<button>`, keyboard reachable in reading order with a visible focus ring.
- A contribution that supplies no icon gets a neutral `Square`, so a missing field cannot leave a hole in the band.
- The band is ruled off from the session list, so the two read as different systems.
- `AppBand` names no extension in its own code. It iterates registry data (Principle II).

**Neither contribution contract changes.** Extensions register exactly as they did. What changed is only where core chooses to draw them. `ExtensionFooter` is deleted, and the notification bell and the add-repo control move down onto the search row, where they act on the list rather than on the apps.

## Consequences

**Good**

- One place to look, and everything in it is named.
- The accessibility failure is closed: labels, accessible names, focus order, no hover dependency.
- No extension had to change to get here, which is what `FR-020` requires.

**Bad**

- **Vertical space.** The band is taller than a row of bare icons, on a surface where vertical space is the scarce resource. Judged worth it: four unlabelled icons that nobody can name are not cheaper, they are just smaller.
- **It will not scale indefinitely.** Five entries fit at 300px; ten will not. The band scrolls horizontally, which is a stopgap rather than an answer. The condition for revisiting is concrete: if a real install reaches eight or more entries, the band needs overflow behaviour designed rather than inherited.
- Two APIs still exist for what is now one visual surface. Collapsing them would force every extension to change, so the duplication stays until the Extension API takes a major version for other reasons.

## Alternatives considered

**Collapse the two contribution points into one API.** Rejected under `FR-020` — it would require every installed extension to be rewritten and re-released for a change with no user-visible benefit beyond tidiness in the registry.

**Label the top strip and leave the footer alone.** Rejected. It fixes the unlabelled-icons problem and leaves the split exactly as found, which is the part a user actually trips over.

**Move everything into the footer instead.** Rejected. Overview is the most-used destination of the five and belongs above the fold, not below a list that can run to two hundred rows.
