# Foundry Factory View

Design document · Foundry extension · revision 2 · 2026-09-25 · status: accepted

A lit, detailed pixel-art factory hall drawn from the run Foundry is already doing. The crew walks between stations because something really happened. You can switch between this view and today's list and Floor at any time.

_The published artifact carries an animated pixel mock of one hall: plan → two lanes → tool calls → verification → merge → gate._

See `docs/research/foundry-hall-breakroom-belts.md` for the current breakroom, seating and belt layout.

## Context

Foundry's running work is watched as text: the Forge list, and the Floor's chips and bands. The request is a second view at the fidelity of [StarNet](https://github.com/androoAGI/starnet) ([starnetos.com](https://starnetos.com/)): a detailed, lit station where agents visibly walk, sit and work, and where the operator can switch to it and back on demand. Revision 1 of this document proposed a coarse tile grid with static workers, and it was rejected as too blocky and cartoony. This revision sets StarNet as the target for detail and motion. It keeps StarNet's own rule, _“the interface must never assert state the harness cannot prove”_, which is also why Foundry's `src/order/standing.ts` exists.

## Goals

- **Detail at StarNet's level.** A 3/4 top-down hall with wall faces, props that have depth, a lightmap with glow from live screens and lamps, and characters with walk cycles in four directions.
- **A crew that moves.** Agents walk to their station when their step starts, go to the archive or the terminal rack when they call a tool, carry work between stations, go to the gate or to the operator when they need an answer, and go back to the breakroom when their work is done.
- **Every movement has a cause.** A walk, a lit screen or a moving belt is caused by a node transition, a tool call, a held ask or a gate. Idle crew stay in the breakroom and never wander past a workstation.
- **A List ⇄ Factory toggle** in the app bar and as a quick action, remembered across restarts.
- Anything waiting on you stays a full-width band at the top, as it is on the Floor.

### Non-goals

- No layout editing. StarNet's layout _is_ the workflow. Foundry's is derived from the recipe (`run-graph.ts`: “derived, never authored”).
- No pixel forms of the Forge conversation, Inbox, Ledger or Settings.
- No sound, no camera director, no reuse of StarNet code or art.

## How StarNet gets its detail and motion

These facts come from a clone of `main` taken on 2026-09-25. They set the bar and the technique.

| Technique                            | Evidence                                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas 2D, pixel-snapped             | `frontend/app/world.js` is 10,497 lines (`wc -l`). It uses `imageSmoothingEnabled = false` and a `requestAnimationFrame` loop.                                                                          |
| Small world tile, scaled up          | `TILE = 12` world px (`worldmodel.js:36`, `propsprites.js:21`), “authored for camera scale 2” (`propsprites.js:11437`).                                                                                 |
| Procedural props with detail helpers | `propsprites.js` is 11,901 lines of draw functions. Its helpers include bevel, rivets, wear, scanlines, glow and blink (`PROPS.md`).                                                                    |
| Layered render                       | A static bake, then props and agents drawn every frame and y-sorted, then the lightmap (`PROPS.md`, `world.js:6363`).                                                                                   |
| Light from live sources              | Lit screens and lamps are painted additively over the lightmap (`world.js:6987`).                                                                                                                       |
| Character sprite tracks              | Tracks are rotations, walk, idle, sit and gesture, in 8 directions (`assets/agent-animation-0914/manifest.json`). Walks are 9 frames. Source frames are 1254×1254 px, downscaled at draw time (`sips`). |
| Honest conveyors                     | “Boxes are never auto-spawned: a box exists only for a real work-item” (`CONVEYOR.md`).                                                                                                                 |
| Waiting is a walk                    | When a run blocks on a permission prompt, the body walks to a wait anchor and waits there (`world.js:140`).                                                                                             |
| Only one agent walks                 | Only the hero walks. The other crew are “static figures standing at their bays” (`world.js:122`). Foundry goes further here: every agent walks.                                                         |

## Current state in Foundry

All paths are under `extensions/foundry/`.

| Piece                   | Where                                 | What the factory takes from it                                                                                                                                                                          |
| ----------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surface switcher        | `src/renderer/App.tsx`                | The `inbox`, `forge` and `ledger` tabs. The toggle goes in this app bar.                                                                                                                                |
| Order list              | `src/components/Orders.tsx`           | `foundry:order.list`, polled every 4000 ms, with a `standing` on each row.                                                                                                                              |
| Floor                   | `src/components/Floor.tsx`            | `foundry:run.observe`, polled every 2000 ms. It carries `graph`, `standing`, `waiting`, `stranded`, `orphaned`, `labels` and `lanes`. Held calls come from `foundry:permissions-list`.                  |
| Attach                  | `Floor.tsx:475`                       | `foundry:session.attach` then `foundry:run-terminal`.                                                                                                                                                   |
| Run graph               | `src/line/run-graph.ts`               | `RunNode`: `kind`, `state`, `lane`, `role`, `dependsOn`, `attempts`, `sessionId`.                                                                                                                       |
| Step kinds              | `src/recipe/parse.ts:63`              | agent, run, judge, gate, fanout, join                                                                                                                                                                   |
| Roles                   | `roles/*.yaml`                        | architect, author, builder, foreman, inspector, integrator, red-team, scout, scribe, verifier                                                                                                           |
| Tool activity           | `src/runtime/transcript-tailer.ts:10` | `ToolActivity`: `tool_started` / `tool_finished`, `toolName`, `isShell`, `path`, `at`. Today only `stall-watcher.ts` and `evaluate-stall.ts` consume it. **No IPC channel carries it to the renderer.** |
| Settings, quick actions | `src/index.ts:2398`, `:2520`          | `api.settings.register` and `api.commands.register` + `api.window.broadcast`.                                                                                                                           |

## Options considered

**Option A: Port StarNet's renderer.** It would give us the look immediately. Against it: 22k+ lines of globals across `world.js` and `propsprites.js`, built for a model where rooms are capability grants and the player edits the layout. The art's provenance is unstated in `NOTICE.md`.

**Option B: PixiJS 8.21.0 (WebGL).** Lighting and blending come cheap with filters, and it has headroom for hundreds of actors. Against it: a new dependency under Constitution IV, and a WebGL canvas still needs a DOM layer for accessibility and e2e. Our scene is tens of actors.

**Option C · chosen: Canvas 2D scene renderer, StarNet's technique, our code.** Static bake, then per-frame y-sorted props, crew and crates, then a lightmap and an additive glow pass. Props are procedural draw functions and the crew are sprite sheets. The simulation is separate and pure. No dependency. StarNet shows Canvas 2D carries this fidelity.

**Option D: DOM/CSS sprites.** Rejected for this fidelity: lighting, y-sorting and dozens of walking actors don't fit the box model.

**Decision: C.** StarNet is the existence proof that Canvas 2D handles a lit, y-sorted, animated station. Writing our own keeps the code in Foundry's model (graph, lanes, standing) and adds nothing to `package.json`. PixiJS remains the escape hatch if the frame budget is missed on a large order. That trigger is a measured number, not a guess.

## Design

### Art direction

- **Projection:** 3/4 top-down, like StarNet. Walls show a front face, and props show a top and a front.
- **Scale:** a 16 px world tile at an integer camera scale (×2 or ×3, picked from the panel size). The mock renders 480×272 world px.
- **Crew:** about 12×22 px figures in four directions. Each has a walk cycle of at least 8 frames, plus idle breathing, sit-and-type, reach, scan, wave and sip. Roles differ by silhouette: a builder's hard hat, a foreman's hi-vis vest, a verifier's visor.
- **Props:** procedural draw functions with a shared detail kit (bevel, rivets, wear, scanline, blink), as in `propsprites.js`. Code, not PNGs, so props diff, test and theme like the rest of the extension.
- **Light:** ceiling pools are cut out of an ambient dark, then an additive pass adds screen phosphor, lamps, the gate beacon and press sparks. Glow comes only from a live source.
- **Palette:** an industrial steel floor, amber hazard trim, cyan screens and green passed-lamps. The world palette is fixed across themes, and the chrome uses `--tm-*` tokens.

### Hall anatomy: every place is a Foundry concept

| Place                 | Means                                                                                      | Source                     |
| --------------------- | ------------------------------------------------------------------------------------------ | -------------------------- |
| Intake airlock (left) | Where crew enter when their node becomes `ready`                                           | `RunNode.state`            |
| Architect's office    | Steps with `lane === null` before the fan-out                                              | `RunNode.lane`, `kind`     |
| Production lines      | One per lane, with belts, workstations and test rigs                                       | `FloorView.lanes`          |
| Workstation           | An `agent` or `fanout` node. Screens are lit only while its agent is seated and running.   | `kind`, `state`            |
| Archive shelves       | Read, Grep and Glob calls                                                                  | `ToolActivity.toolName`    |
| Terminal rack         | Bash calls (`isShell`)                                                                     | `ToolActivity.isShell`     |
| Test rig              | `run` steps. Its lamp lights when the step has passed.                                     | `kind`, `state`            |
| Inspection bench      | `judge` steps                                                                              | `kind`                     |
| Merge press           | `join`. It stamps when every inbound crate has arrived.                                    | `kind`, `dependsOn`        |
| Gate + beacon         | `gate`. The beacon flashes while the gate is undecided.                                    | `FloorView.waiting`        |
| Status wall           | Per-lane progress, taken from node counts                                                  | `standing.done / total`    |
| Exit dock (right)     | The draft PR ships                                                                         | `standing.kind === 'done'` |
| Breakroom             | Crew whose nodes are waiting, passed or skipped. The only place idle wandering is allowed. | `RunNode.state`            |
| Foreman's booth       | Where the foreman waits when no gate is up                                                 | none                       |

### What makes an agent move

| Event (derived by diffing polls)      | On screen                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| node → `ready`                        | The agent enters at the airlock, or leaves the breakroom, and walks to its station (A\* over the walkable grid).                           |
| node → `running`                      | The agent sits and types, and the screens light and scroll.                                                                                |
| `tool_started` Read/Grep/Glob         | The agent walks to the archive and reaches for a binder, then returns when the call finishes.                                              |
| `tool_started` with `isShell`         | The agent walks to the terminal rack, then returns when the call finishes.                                                                 |
| `tool_started` Edit/Write             | The agent stays seated and the screen changes.                                                                                             |
| upstream `passed`, downstream `ready` | A crate rides the belt to the next station. The belt treads move only while a crate is on them.                                            |
| node → `verifying`                    | The verifier walks to the rig and scans. Waveform and beam are on.                                                                         |
| held ask / `stranded`                 | The agent stands and walks to a wait anchor near the band with a raised hand. It carries a lucide `ShieldQuestion` badge in the DOM layer. |
| gate waiting                          | The foreman walks to the gate and waves, the beacon flashes, and the band appears.                                                         |
| node → `failed`                       | The agent slumps at the station, the lamp goes out, and attempt pips show.                                                                 |
| node in `orphaned`                    | The station goes dark and the chair is empty. The agent is not drawn.                                                                      |
| node → `passed`                       | The lamp lights green and the agent walks to the breakroom.                                                                                |

Tool calls shorter than a walk would make the crew thrash between the desk and the shelves. The director coalesces them: an agent starts a walk only for a call still open after 1.5 s, or for a run of three or more calls of the same kind, and stays at the prop while calls of that kind keep coming. The ticker under the scene (an `aria-live` region) states each event in words, so the motion never carries meaning on its own.

### Architecture

| File                                           | Responsibility                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/factory/layout.ts`                        | **Pure.** `layoutHall(graph, lanes)` returns a `HallMap`: rooms, props, belts, the walkable grid, seats, wait anchors and lights. The column is the longest-path depth over `dependsOn`, and the row is the lane. The same input always gives the same map.                                                                   |
| `src/factory/events.ts`                        | **Pure.** `diffObservation(prev, next, activity)` returns `FactoryEvent[]` for the transitions in the table above.                                                                                                                                                                                                            |
| `src/factory/director.ts`                      | **Pure.** Turns events into per-agent intents (go, sit, reach, scan, wave, breakroom), with coalescing, one queue per agent, and exhaustive switches with `assertNever`.                                                                                                                                                      |
| `src/factory/sim.ts`                           | **Pure, deterministic.** `tick(world, dtMs)` advances walks along A\* paths, crates along belts, press cycles and gate state. The clock is injected and there is no RNG, so it can be replayed in tests.                                                                                                                      |
| `src/factory/path.ts`                          | A\* on the walkable grid. Belts are walkable, as in StarNet.                                                                                                                                                                                                                                                                  |
| `src/factory/art/props.ts`, `art/kit.ts`       | Procedural prop draw functions and the detail kit.                                                                                                                                                                                                                                                                            |
| `src/renderer/assets/crew-*.png` + `crew.json` | Crew sprite sheets: per-role tracks for walk, idle, sit-type, reach, scan, wave and slump, in four directions.                                                                                                                                                                                                                |
| `src/components/factory/HallScene.tsx`         | The renderer: the bake cache, then the y-sorted pass, then the lightmap, then glow. It uses rAF, pauses on `visibilitychange` and unmount, and draws a single settled frame under `prefers-reduced-motion`.                                                                                                                   |
| `src/components/factory/FactoryHall.tsx`       | Band, scene, DOM station buttons (role, name, focus), ticker and inspector drawer. Clicking an agent hit-tests to its node. The drawer carries the label, state, attempts, transcript excerpt and **Attach**.                                                                                                                 |
| `src/components/factory/FactorySite.tsx`       | Every order as a small lit hall. A shaping order opens today's Forge.                                                                                                                                                                                                                                                         |
| `src/renderer/use-run-observation.ts`          | The Floor's polling, extracted and shared.                                                                                                                                                                                                                                                                                    |
| `src/index.ts`                                 | Adds the `terminator.foundry.view` setting (`'list' \| 'factory'`), the `foundry:ui.view` / `ui.set-view` handlers and the `toggle-view` quick action. It also adds **one new read channel**, `foundry:run.activity`, which returns the last 20 `ToolActivity` per node from a bounded ring the stall watcher's tailer fills. |
| `src/renderer/App.tsx`                         | The List/Factory segmented control (lucide `List` and `Factory`) on the Forge surface.                                                                                                                                                                                                                                        |

### Sequence of changes

- `feat(foundry): derive a factory hall from the run graph`: layout + path
- `feat(foundry): expose recent tool activity per node`: the ring + `run.activity`
- `feat(foundry): turn run changes into factory events`: events + director
- `feat(foundry): simulate the factory floor`: sim
- `refactor(foundry): share the Floor's run observation`
- `feat(foundry): draw the factory hall`: art kit, props, crew sheets, scene, hall, site
- `feat(foundry): switch between list and factory views`
- `test(foundry): e2e factory view` + docs + ADR-060 “A factory is a projection”

## Testing and verification

- `tests/factory/layout.spec.ts`: lanes become rows and depth becomes columns. Every seat and anchor is reachable by A\*. Output is identical for identical input. Fixtures are real graphs from `standard.yaml` and `bugfix.yaml`.
- `tests/factory/events.spec.ts`: every NodeState transition yields its event, a Bash `tool_started` yields a rack event, and an orphaned node yields no work event.
- `tests/factory/director.spec.ts`: coalescing (a 200 ms Read causes no walk; a 2 s Read does), breakroom-only idling, and exhaustiveness.
- `tests/factory/sim.spec.ts`: replay a recorded run's polls and check that the agent reaches its seat, a crate reaches the press only after upstream passed, and the gate beacon is lit only while the gate is waiting.
- `tests/components/factory/*.spec.tsx` (jsdom): stations are addressable by role, Attach navigates, reduced motion draws one frame, and the toggle persists.
- `tests/e2e/foundry-factory-view.spec.ts`: toggle to Factory, find a station by role, reload, confirm Factory is still selected, then toggle back.

```sh
npm run format
npm run lint
npm run typecheck:extensions
npm run build:extensions
npx vitest run --coverage        # all pass, patch coverage ≥ 80%
npx playwright test tests/e2e/foundry-factory-view.spec.ts
```

Then do one live run: a real two-lane order with the factory open. Capture the WebContentsView with `capturePage` and record frame time. Check every walk against the Floor's chips and the transcript at the same moment.

## Risks and mitigations

| Risk                                                                                                      | Mitigation                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The crew sprites are the long pole. StarNet's are 1254 px source frames across 8 directions and 5 tracks. | Use four directions and fewer tracks at first. Props are procedural, so only the crew needs drawn art. The art source is an open question.                                                                  |
| Motion implies work that isn't happening.                                                                 | Only the director moves crew, and only on events. Idle crew stay in the breakroom. Sim tests assert the negative cases.                                                                                     |
| Thrash from short tool calls.                                                                             | Coalescing thresholds, unit-tested.                                                                                                                                                                         |
| Frame cost in a hidden or large view.                                                                     | The bake is cached, the loop pauses when hidden, and glow gradients are cached per source as in StarNet. Frame time is **not measured** yet; the live run measures it and the PixiJS trigger depends on it. |
| Motion sensitivity.                                                                                       | `prefers-reduced-motion` draws a settled frame. The ticker and the DOM carry all meaning.                                                                                                                   |
| A new union member blanks the view.                                                                       | Exhaustive switches and `typecheck:extensions`.                                                                                                                                                             |

## Open questions

- **Crew art source.** The options are to commission sheets, to generate and hand-clean them (StarNet's pipeline is unstated), or a CC0 base [UNVERIFIED which pack]. StarNet's own art stays off the table until its licence is known.
- **Constitution XII.** This design treats sprites and props as illustration, not icons. Every icon-like mark stays lucide, but the sprites use colour. This reading needs your explicit approval.
- **Toggle scope.** Only the Forge surface changes. Should the Inbox get a form too, such as a mail room?
- **Preference scope.** Per user (assumed here) or per workspace?
- **Acting from the factory.** This design keeps answering gates and attaching. Stop, resume and reset stay in the List view.

## Alternatives rejected

- Revision 1's coarse tile grid with static workers: it was rejected as too blocky and not alive.
- Port StarNet's renderer: 22k+ lines built for a different model, and the art's provenance is unknown.
- PixiJS now: a dependency before a measured need. It stays the escape hatch.
- Idle wandering across the floor: it would show work that isn't happening, so wandering stays in the breakroom.
- An editable layout: the graph is derived from the recipe, so edits to the picture would drift from the run.

## As built

After review, status moved into the hall (nameplates, rising callouts, pinned answerable cards) and runs became replayable from a recorded timeline; see the addendum to ADR 060.

Four points where the shipped factory differs from this design:

- **`World` remembers open tool calls.** `direct` only ever sees the events since the last poll, and a long-running Read emits `tool_started` exactly once — so the 1.5 s "walk to the prop" rule could never re-fire on a later poll. The world now keeps each open call and re-checks its age against `nowMs` on every `direct`, not only at the moment it opened.
- **Same-depth stations stand side by side.** The design's column-per-depth rule left two nodes at one depth in one band on the same tiles. A depth column is now as wide as its most crowded band.
- **The `join` press is drawn within a 2-row footprint**, not up into the wall face it previously overlapped.
- **A gate is decided in the Inbox, not at the turnstile.** The design left it open whether standing at the gate prop itself would raise a decision UI in the hall. It does not: the only control is the full-width band at the top of the hall (shown when `standing.turn === 'you'`), whose "Open Inbox" button hands off to the existing Inbox surface — one decision surface for every gate, in the hall or out of it. A move with no gate behind it (a run nothing is running, a held call) shows "Open in List view" instead, which opens the order where its resume and answer controls live.

## References

- [github.com/androoAGI/starnet](https://github.com/androoAGI/starnet) · [starnetos.com](https://starnetos.com/)
- MDN: [imageSmoothingEnabled](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/imageSmoothingEnabled) · [image-rendering](https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering) · [requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) · [visibilitychange](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event) · [prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
