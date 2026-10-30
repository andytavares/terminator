# ADR 060: A factory is a projection

**Status**: Accepted

**Date**: 2026-09-25

## Context

Operators watched Foundry's running work as text: the Forge's order list and the Floor's chips and bands. `docs/research/foundry-factory-view.md` proposed a second view at the fidelity of StarNet. It is a lit, detailed 3/4 pixel-art hall where agents visibly walk, sit and work. The operator can switch to it and back on demand, and it does not change what Foundry can prove.

StarNet's own rule is "the interface must never assert state the harness cannot prove". This rule is why Foundry's `src/order/standing.ts` exists, and it governs this feature too. A factory that shows a crew walking, a screen lighting or a belt turning for no reason is a UI that lies.

Constitution Principle XII treats every icon-like mark (a toggle, a badge) as a control. Such a mark must stay lucide-react, flat, sized by CSS and coloured only by `currentColor`. The principle says nothing about illustration. The design document left one question open: does a pixel sprite, drawn to look like a person or a desk, fall under that rule, or is it closer to a screenshot or a diagram? On 2026-09-25, before this ADR was written, the user approved reading Constitution XII as covering icon-like marks only. Sprites and props are illustration and may use colour.

## Decision

**A factory hall is a projection of the run graph. It owns no state of its own.**

- `layoutHall(graph)` is pure and deterministic: the same `RunGraph` always produces the same `HallMap` (tiles, props, belts, seats, anchors). The layout is derived, never authored. There is no layout editor and none is planned, for the same reason `run-graph.ts` documents: an editable picture would drift from the recipe it is supposed to represent.
- `diffObservation(prev, next)` turns two polls of `foundry:run.observe` (plus `foundry:run.activity`) into a list of `FactoryEvent`s. A crew member walks, a screen lights, a belt turns, or a beacon flashes **only** in response to one of these events. None of these happens speculatively or to fill dead time. Idle crew stay in the breakroom. Wandering the production floor is not a behavior the sim has.
- The whole render pipeline is Canvas 2D. It has four stages:

  1. A static bake per `HallMap`.
  2. A per-frame y-sorted pass over props, crew and crates.
  3. A lightmap with light pools cut from an ambient dark.
  4. An additive glow pass for live sources only (a lit screen, a lamp, a gate beacon).

  This is StarNet's own technique, written fresh against Foundry's model (graph, lanes, standing) and not ported. StarNet's renderer is 22k+ lines built for a different domain (rooms as capability grants, an editable layout), and the licence of its art is unstated.

- Art is procedural. There is one draw function per `PropKind` and one per `CrewAnim`. Each is built from a shared detail kit (bevel, rivets, wear, scanline, glow), not from PNG sheets. Code is not a binary asset, so props diff, test and theme like the rest of the extension.
- Every icon-like mark drawn in the DOM layer over the scene stays lucide-react, flat, `currentColor`, sized by CSS. This covers the List/Factory toggle and the `ShieldQuestion` stranded/ask badge. Only the pixel art inside the `<canvas>` uses colour of its own. Constitution XII's icon rule and this illustration exception are both live in the same surface, deliberately.
- Idling has exactly one place: the breakroom. A node whose state is `waiting`, `passed`, `skipped` or `blocked` sends its crew member there. Nothing walks the production floor without a cause.

## Alternatives considered

- **Port StarNet's renderer.** Rejected: it is 22k+ lines of globals built for a different simulation model, and the provenance of its art is unverified.
- **PixiJS (WebGL).** Rejected for now: it is a new dependency (Constitution IV), for a scene of tens of actors that Canvas 2D already carries at StarNet's own fidelity. It remains the documented escape hatch if a measured frame budget is missed on a large order. That trigger is a number, not a guess, and nobody has measured one yet.
- **DOM/CSS sprites.** Rejected: lighting, y-sorting and dozens of walking actors do not fit the box model.
- **An editable hall layout.** Rejected: the graph is derived from the recipe, so a hand-edited picture would drift from the run it claims to represent.

## Consequences

- We can delete a factory hall and redraw it from `foundry:run.observe` and `foundry:run.activity` at any time with no data loss. It holds no state that those two channels plus the pure sim clock cannot reconstruct.
- Every new `PropKind`, `CrewAnim` or `FactoryEvent` variant must be added to the exhaustive switches in `art/props.ts`, `art/crew.ts`, `director.ts` and `events.ts`. `assertNever` and `npm run typecheck:extensions` enforce this. A lookup `Record` keyed by any of these unions is disallowed, for the reason that ADR history already carries: a missing member ships through a green build and blanks the surface at runtime.
- Toggling List ⇄ Factory changes only the Forge surface (order list and hall). The Inbox, Ledger and Settings are unaffected. The toggle's preference (`terminator.foundry.view`) belongs to the operator, not to an order or a run.
- The scene never asserts anything that the harness cannot prove. The scene does not draw the crew member of an orphaned node. A stranded node's crew member visibly raises a hand and waits. The operator decides a gate from the same Inbox as everywhere else in the app, not from a control inside the hall itself.

## Addendum: status in the hall, and replay (2026-09-25)

The hall draws status inside it, not beside it:

- a nameplate per station that carries only its name
- a status lamp on each station: flashing while it works, orange while it needs the operator, red when it has failed or lost its agent, green when done
- one callout per station, which rises from where an event belongs and is lifted clear of its neighbours and their nameplates
- a card pinned over the station that waits on the operator, which the operator answers in place through the same channels as the Floor and the Inbox

The order's own bar (back, title, progress, replay) sits above the hall, so it never covers the top row of stations. Finished work rides its belt and waits at the next station until that step starts.

A run can be replayed. The replay is another source of observations, fed through the same diff and director:

- `writeRunGraph` records node states whenever they change.
- The stall watcher already reads every live run's transcript. It records tool calls into an append-only `run-timeline.jsonl` beside the order's run graph.
- Gate waits come from the gate store's own timestamps.

A replay shows only what Foundry recorded, so nothing in it is orphaned or stranded. Quiet stretches longer than six seconds are shortened, so an overnight wait does not replay as hours of nothing. The recording may miss tool calls made in a run's last 30 seconds (the watcher's interval) before it ends.

## Addendum: breakroom, seats and routed belts (2026-09-26)

Idling's one place is now the breakroom. It is an enclosed room centred on the median crewed station, and it replaces the lounge strip. Idle crew take the nearest free seat by walked distance. Each seat holds one person, reserved on the crew member, with a deterministic tie-break by seat id. Crew walk a `walk` grid in which stations, furniture, seats and belts are solid. They cross belts only at drawn step-over plates. Foundry places the plates for connectivity, or to cap a detour at 8 tiles. Belts are a routed network, port to port (east side out, west side in). Belts share tiles only within one source (splitters) or one target (mergers). Unrelated belts cross only at right angles. See `docs/research/foundry-hall-breakroom-belts.md` for the full design.

## Addendum: nobody walks behind a station (2026-09-26)

The row directly above a station is where its screens and its nameplate are drawn, so a crew member on that row was hidden behind the station. Every Read or Bash burst sent one there, because the archive and the rack stood on the head row behind the yard stations. That row is now solid in the `walk` grid for each station's width. The archive and the rack stand on the nearest head-row column that is reachable from the front once the step-over plates are placed. Their wall fixture moves over them.
