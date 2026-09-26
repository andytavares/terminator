# ADR 060: A factory is a projection

**Status**: Accepted

**Date**: 2026-09-25

## Context

Foundry's running work was watched as text: the Forge's order list and the Floor's chips and bands. `docs/research/foundry-factory-view.md` proposed a second view at the fidelity of StarNet (a lit, detailed 3/4 pixel-art hall where agents visibly walk, sit and work) that the operator can switch to and back from on demand, without changing what Foundry can prove.

StarNet's own rule, "the interface must never assert state the harness cannot prove," is why Foundry's `src/order/standing.ts` exists, and it governs this feature too: a factory that shows a crew walking, a screen lighting or a belt turning for no reason is a UI that lies.

Constitution Principle XII treats every icon-like mark (a toggle, a badge) as a control that must stay lucide-react, flat, sized by CSS and coloured only by `currentColor`. It says nothing about illustration. Whether a pixel sprite drawn to look like a person or a desk falls under that rule, or is closer to a screenshot or a diagram, was an open question in the design document. The user approved reading Constitution XII as covering icon-like marks only — sprites and props are illustration and may use colour — on 2026-09-25, before this ADR was written.

## Decision

**A factory hall is a projection of the run graph. It owns no state of its own.**

- `layoutHall(graph)` is pure and deterministic: the same `RunGraph` always produces the same `HallMap` (tiles, props, belts, seats, anchors). The layout is derived, never authored — there is no layout editor and none is planned, for the same reason `run-graph.ts` documents: an editable picture would drift from the recipe it is supposed to represent.
- `diffObservation(prev, next)` turns two polls of `foundry:run.observe` (plus `foundry:run.activity`) into a list of `FactoryEvent`s. A crew member walks, a screen lights, a belt turns, or a beacon flashes **only** in response to one of these events — never speculatively, never to fill dead time. Idle crew stay in the breakroom; wandering the production floor is not a behavior the sim has.
- The whole render pipeline is Canvas 2D: a static bake per `HallMap`, then a per-frame y-sorted pass over props, crew and crates, then a lightmap with light pools cut from an ambient dark, then an additive glow pass for live sources only (a lit screen, a lamp, a gate beacon). This is StarNet's own technique, written fresh against Foundry's model (graph, lanes, standing) rather than ported — StarNet's renderer is 22k+ lines built for a different domain (rooms as capability grants, an editable layout) and its art's licence is unstated.
- Art is procedural: one draw function per `PropKind` and one per `CrewAnim`, built from a shared detail kit (bevel, rivets, wear, scanline, glow) rather than PNG sheets. Code, not binary assets, so props diff, test and theme like the rest of the extension.
- Every icon-like mark drawn in the DOM layer over the scene — the List/Factory toggle, the `ShieldQuestion` stranded/ask badge — stays lucide-react, flat, `currentColor`, sized by CSS. Only the pixel art inside the `<canvas>` uses colour of its own; Constitution XII's icon rule and this illustration exception are both live in the same surface, deliberately.
- Idling has exactly one place: the breakroom. A node whose state is `waiting`, `passed`, `skipped` or `blocked` sends its crew member there. Nothing walks the production floor without a cause.

## Alternatives considered

- **Port StarNet's renderer.** Rejected: 22k+ lines of globals built for a different simulation model, and its art's provenance is unverified.
- **PixiJS (WebGL).** Rejected for now: a new dependency (Constitution IV) for a scene of tens of actors that Canvas 2D already carries at StarNet's own fidelity. It remains the documented escape hatch if a measured frame budget is missed on a large order — that trigger is a number, not a guess, and none has been measured yet.
- **DOM/CSS sprites.** Rejected: lighting, y-sorting and dozens of walking actors don't fit the box model.
- **An editable hall layout.** Rejected: the graph is derived from the recipe, so a hand-edited picture would drift from the run it claims to represent.

## Consequences

- A factory hall can be deleted and redrawn from `foundry:run.observe` and `foundry:run.activity` at any time with no data loss, because it holds no state that isn't reconstructible from those two channels plus the pure sim clock.
- Every new `PropKind`, `CrewAnim` or `FactoryEvent` variant must be added to the exhaustive switches in `art/props.ts`, `art/crew.ts`, `director.ts` and `events.ts` (enforced by `assertNever` and `npm run typecheck:extensions`); a lookup `Record` keyed by any of these unions is disallowed for exactly the reason ADR history already carries — a missing member ships through a green build and blanks the surface at runtime.
- Toggling List ⇄ Factory changes only the Forge surface (order list and hall); the Inbox, Ledger and Settings are unaffected, and the toggle's preference (`terminator.foundry.view`) is per operator, not per order or per run.
- The scene never asserts anything the harness cannot prove: an orphaned node's crew member is not drawn, a stranded node's crew member visibly raises a hand and waits, and a gate is decided from the same Inbox as everywhere else in the app, not from a control inside the hall itself.

## Addendum: status in the hall, and replay (2026-09-25)

Status is drawn inside the hall rather than beside it: a nameplate per station, a callout rising from the station an event belongs to, and a card pinned over the station waiting on the operator, answered in place through the same channels as the Floor and the Inbox. Finished work rides its belt and waits at the next station until that step starts.

A run can be replayed. The replay is another source of observations, fed through the same diff and director: node states are recorded by `writeRunGraph` whenever they change, and tool calls by the stall watcher, which already reads every live run's transcript, into an append-only `run-timeline.jsonl` beside the order's run graph. Gate waits come from the gate store's own timestamps. A replay shows only what was recorded, so nothing in it is orphaned or stranded, and quiet stretches longer than six seconds are shortened so an overnight wait does not replay as hours of nothing. Tool calls made in a run's last 30 seconds (the watcher's interval) before it ends may be missing from the recording.

## Addendum: breakroom, seats and routed belts (2026-09-26)

Idling's one place is now the breakroom: an enclosed room centred on the median crewed station, replacing the lounge strip. Idle crew take the nearest free seat by walked distance, one person per seat, reserved on the crew member, with a deterministic tie-break by seat id. Crew walk a `walk` grid in which stations, furniture, seats and belts are solid, crossing belts only at drawn step-over plates, placed for connectivity or to cap a detour at 8 tiles. Belts are a routed network, port to port (east side out, west side in), sharing tiles only within one source (splitters) or one target (mergers), with unrelated belts crossing only at right angles. See `docs/research/foundry-hall-breakroom-belts.md` for the full design.
