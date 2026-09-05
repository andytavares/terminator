# ADR 036: The board is one grid; a lane is a column

**Status**: Accepted

**Date**: 2026-09-05

## Context

ADR 035 takes terminals out of the sidebar. That removes the surface answering "which terminal is in what state", so something has to replace it — and across every repo at once, not only inside the branch that happens to be selected.

The Overview screen already drew every terminal as a tile with a **live** preview, but as one flat `auto-fill` grid with no state grouping, and its tile showed only whether a terminal was busy rather than which of the four states it was in. Arranging those tiles into lanes by state is the obvious move.

The obvious implementation is not available.

`TerminalSession.mountPreview` does not render a copy of the terminal. It **moves the one live xterm element** into the container:

```ts
// src/renderer/components/terminal/TerminalSession.tsx
mountPreview(container: HTMLElement): (() => void) | null {
  …
  container.appendChild(this.element)
  return () => { …; this.element.parentElement?.removeChild(this.element) }
}
```

and `SessionTile` calls it from a `useLayoutEffect` keyed on the session id. There is exactly one such element per session.

So if each lane were its own container, a terminal changing state would move its card to a different React parent. React would unmount the old subtree and mount a new one, the layout effect's cleanup would run, and the live element would be torn out and re-appended — blanking the preview in the middle of the very transition the board exists to make legible. Worse, any arrangement that could mount two previews of one session at once would tear it out of the first.

## Decision

**The board is one CSS grid containing every card. A lane is a `grid-column`, not a container.**

Three properties follow, and all three are load-bearing:

1. Every card is a **direct child of the one grid**, positioned by `grid-column` and `grid-row`.
2. Cards are emitted in a **stable order that does not depend on their lane** (sorted by session id), so React never reorders the DOM either.
3. A state change therefore rewrites two style properties and nothing else. The DOM node is never re-created, re-parented, or moved.

`BoardScreen.spec.tsx` asserts the node identity survives a lane change, and `tests/e2e/board.spec.ts` marks a card's node in the running app, forces a re-render, and checks the marker survived.

Grid placement is discrete and cannot be transitioned, so the 180ms move FR-011 asks for is played back by **FLIP**: measure where each card was, let it land, then replay it from the old position. Only the card that actually moved animates, and `prefers-reduced-motion` skips the replay entirely.

## Consequences

**Rows align across lanes.** With explicit `grid-row` placement, the *n*th card of every lane shares a row, so cards must be uniform height or gaps appear. The card is built to be: a fixed-height preview, a single-line title, a single-line source label, and a footer that is always present. Every optional fact is omitted rather than drawn empty, which keeps the height constant rather than varying it.

**An empty lane is free.** "Draw nothing in the body" is the natural result of no card claiming that column, rather than a special case. The exited lane hiding itself while empty is a column-template change, not an unmount.

**Lane visibility is presentational.** A hidden lane keeps its cards; only `visible` flips. Showing it again costs nothing and needs no recomputation.

**Constitution XII constrains the design.** The reference product tints its lane icons — grey, green, purple. Icons here are flat and inherit `currentColor`, and never differentiate state by colour. Lanes are told apart by position, label and count; the glyphs separate by shape, and opacity alone holds the history lane back. This is also what makes the board readable in greyscale.

## Alternatives considered

**Per-lane containers, accept the flash.** Simplest to write. Rejected: it breaks the preview at exactly the moment the transition is meant to be legible, which is the one moment the board is for.

**Replace the live preview with `captureToDataUrl` snapshots.** The method already exists and would make cards freely movable. Rejected: it trades a live surface for a stale JPEG, and the live preview is what makes a card worth more than a row — you can read the question an agent is actually asking without opening it.

**Absolute positioning with transforms.** Would allow ragged column heights. Rejected as substantially more code to maintain, with responsive behaviour to reimplement by hand, for a layout difference nobody asked for.
