import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { HallMap, HallProp, PropKind } from '../../factory/layout.js'
import { TILE_PX } from '../../factory/layout.js'
import { cratePosition, tick, tileOf } from '../../factory/sim.js'
import type { World } from '../../factory/sim.js'
import type { NodeState } from '../../line/run-graph.js'
import type { ToolProp } from '../../factory/events.js'
import type { Paint } from '../../factory/art/kit.js'
import { glow } from '../../factory/art/kit.js'
import {
  bakeHall,
  drawProp,
  drawBelts,
  drawCrate,
  drawQueuePlate,
} from '../../factory/art/props.js'
import type { SceneContext } from '../../factory/art/props.js'
import { drawCrew } from '../../factory/art/crew.js'
import { prefersReducedMotion, toPaint } from './canvas.js'

// The one place the hall gets painted. Everything here is a projection: it
// owns no state of its own, reads `worldRef.current` on every frame, and
// writes it back after `tick` — nothing is ever inferred that the run itself
// did not already report through `direct`/`diffObservation` upstream.

export interface HallSceneProps {
  readonly map: HallMap
  readonly worldRef: React.MutableRefObject<World>
  readonly states: Readonly<Record<string, NodeState>>
  readonly reducedMotion?: boolean
  /** How fast the world moves: 1 live, more when a replay is fast-forwarded. */
  readonly speed?: number
  /** This order's own numbers, for the status wall — see `SceneContext`. */
  readonly metrics?: SceneContext['metrics']
  /** Stations whose lamp burns orange — see `SceneContext`. */
  readonly needsYou?: readonly string[]
  /** Stations whose lamp burns red for want of an agent — see `SceneContext`. */
  readonly orphaned?: readonly string[]
}

type Lamps = Pick<SceneContext, 'needsYou' | 'orphaned' | 'steady'>

const DARKNESS = 'rgba(5,8,18,0.42)'
const LIGHT_RADIUS = 70
const MAX_FRAME_MS = 50
// Seating furniture shares its own tile with the crew member who sits or
// stands there — sorted behind them, since its low silhouette (not its tall
// backrest) is what should tie-break against a seat one row down.
const SEAT_FURNITURE: ReadonlySet<PropKind> = new Set(['restbench', 'sofa', 'plant'])
// The breakroom partition spans the whole room, but only its top row is a
// wall: sorted at its floor it would be drawn over everyone inside.
const WALL_KINDS: ReadonlySet<PropKind> = new Set(['partition'])

/** The y a prop sorts at against crew and crates: its top, its first row, or its floor edge. */
export function drawOrderY(prop: HallProp): number {
  if (WALL_KINDS.has(prop.kind)) return (prop.y + 1) * TILE_PX
  return SEAT_FURNITURE.has(prop.kind) ? prop.y * TILE_PX : (prop.y + prop.h) * TILE_PX
}

/** Each station's newest open tool call. */
function newestTools(world: World): Record<string, ToolProp> {
  const newest = new Map<string, { at: number; prop: ToolProp }>()
  for (const call of world.openCalls) {
    const held = newest.get(call.nodeId)
    if (held === undefined || call.at >= held.at) {
      newest.set(call.nodeId, { at: call.at, prop: call.prop as ToolProp })
    }
  }
  return Object.fromEntries([...newest].map(([nodeId, { prop }]) => [nodeId, prop]))
}

/** The shared fixtures somebody is standing at and using. */
function reachingFixtures(world: World): ('archive' | 'rack')[] {
  const { archive, rack } = world.map.anchors
  const reaching: ('archive' | 'rack')[] = []
  for (const crew of world.crew) {
    if (!crew.present || crew.anim !== 'reach' || crew.goal !== null) continue
    const at = tileOf(crew.x, crew.y)
    if (at.x === archive.x && at.y === archive.y) reaching.push('archive')
    else if (at.x === rack.x && at.y === rack.y) reaching.push('rack')
  }
  return reaching
}

/**
 * What the world is doing at the fixtures, in the terms the art draws it:
 * each station's newest open tool, the fresh verdicts, and which shared
 * fixtures somebody is standing at and using. Pure, so it needs no canvas.
 */
export function sceneActivity(
  world: World
): Required<Pick<SceneContext, 'tools' | 'verdicts' | 'reaching'>> {
  const tools = newestTools(world)
  return { tools, verdicts: world.verdicts, reaching: reachingFixtures(world) }
}

const SCREEN_TINT: Readonly<Record<ToolProp, string>> = {
  rack: '140,230,120',
  archive: '232,197,106',
  desk: '90,200,235',
}

/**
 * The darkness-with-pools-cut-out layer, baked once per map onto its own
 * canvas.
 *
 * `destination-out` has to run on a canvas that holds *only* the darkness —
 * run directly on the scene canvas it would erase the floor and props
 * underneath it, not just dim them. Baking it once also means the pools
 * never move: `map.lights` is a property of the map's shape, not of the run.
 */
function bakeLight(map: HallMap, paint: Paint): void {
  paint.globalCompositeOperation = 'source-over'
  paint.fillStyle = DARKNESS
  paint.fillRect(0, 0, map.width * TILE_PX, map.height * TILE_PX)
  paint.globalCompositeOperation = 'destination-out'
  for (const light of map.lights) {
    glow(paint, [light.x * TILE_PX + TILE_PX / 2, light.y * TILE_PX + TILE_PX / 2, LIGHT_RADIUS], {
      rgba0: 'rgba(0,0,0,.85)',
      rgba1: 'rgba(0,0,0,0)',
    })
  }
}

/** The two layers baked once per map: the floor and fixtures, and the light. */
interface Layers {
  readonly bake: CanvasImageSource
  readonly lightLayer: CanvasImageSource
}

/** One frame's worth of what is drawn: the world as it stands, at its own clock. */
interface Frame {
  readonly map: HallMap
  readonly world: World
  readonly states: Readonly<Record<string, NodeState>>
  readonly tMs: number
  readonly metrics: SceneContext['metrics']
  readonly lamps: Lamps
}

type FrameContext = ReturnType<typeof frameContext>

/** What the art is told about the frame. */
function frameContext({ world, states, metrics, lamps }: Frame) {
  return {
    crew: world.crew,
    states,
    gatesWaiting: world.gatesWaiting,
    ci: world.ci,
    metrics,
    queue: world.queue,
    ...lamps,
    ...sceneActivity(world),
  }
}

type Drawable = { readonly y: number; readonly draw: () => void }

/** Fixtures, crew and crates, back to front. */
function drawSorted(paint: Paint, frame: Frame, context: FrameContext): void {
  const { map, world, tMs } = frame
  const drawables: Drawable[] = []
  for (const prop of map.props) {
    drawables.push({ y: drawOrderY(prop), draw: () => drawProp(paint, prop, { context, tMs }) })
  }
  for (const crew of world.crew) {
    drawables.push({ y: crew.y, draw: () => drawCrew(paint, crew, tMs) })
  }
  for (const crate of world.crates) {
    const belt = map.belts.find((b) => b.id === crate.beltId)
    if (belt === undefined || belt.path.length === 0) continue
    const { x, y } = cratePosition(belt, crate.progress)
    drawables.push({ y: y + 4, draw: () => drawCrate(paint, x, y) })
  }
  drawables.sort((a, b) => a.y - b.y).forEach((d) => d.draw())
}

/** The glow over a crew member typing at a desk or scanning at the rack. */
function crewGlows(paint: Paint, world: World): void {
  for (const crew of world.crew) {
    if (!crew.present) continue
    if (crew.anim === 'type') {
      glow(paint, [crew.x, crew.y - 14, 26], {
        rgba0: 'rgba(90,200,235,.28)',
        rgba1: 'rgba(90,200,235,0)',
      })
    } else if (crew.anim === 'scan') {
      glow(paint, [crew.x, crew.y - 14, 26], {
        rgba0: 'rgba(140,230,120,.3)',
        rgba1: 'rgba(140,230,120,0)',
      })
    }
  }
}

/** A gate that is waiting flashes, a quarter second on and a quarter off. */
function gateFlashes(paint: Paint, { map, world, tMs }: Frame): void {
  for (const nodeId of world.gatesWaiting) {
    const gate = map.props.find((p) => p.nodeId === nodeId && p.kind === 'gate')
    if (gate === undefined) continue
    const flashOn = Math.floor(tMs / 250) % 2 === 0
    if (!flashOn) continue
    glow(paint, [(gate.x + gate.w / 2) * TILE_PX, gate.y * TILE_PX - 8, 36], {
      rgba0: 'rgba(230,160,60,.5)',
      rgba1: 'rgba(230,160,60,0)',
    })
  }
}

/** A desk's screen, lit in the colour of the tool in use, while someone types or a call is open. */
function deskGlow(
  paint: Paint,
  prop: HallProp,
  [frame, context]: readonly [Frame, FrameContext]
): void {
  const nodeId = prop.nodeId as string
  const typing = frame.world.crew.some(
    (c) => c.present && c.nodeId === prop.nodeId && c.anim === 'type'
  )
  const tool = context.tools[nodeId]
  if (!typing && tool === undefined) return
  const tint = SCREEN_TINT[tool ?? 'desk']
  glow(paint, [(prop.x + prop.w / 2) * TILE_PX, prop.y * TILE_PX - 2, 30], {
    rgba0: `rgba(${tint},.16)`,
    rgba1: `rgba(${tint},0)`,
  })
}

/** A press whose step is running glows hot. */
function pressGlow(paint: Paint, prop: HallProp, frame: Frame): void {
  if (frame.states[prop.nodeId as string] !== 'running') return
  glow(paint, [(prop.x + prop.w / 2) * TILE_PX, prop.y * TILE_PX - TILE_PX - 4, 18], {
    rgba0: 'rgba(230,160,60,.35)',
    rgba1: 'rgba(230,160,60,0)',
  })
}

/** The stations' own light: a lit desk screen, a hot press. */
function stationGlows(paint: Paint, frame: Frame, context: FrameContext): void {
  for (const prop of frame.map.props) {
    if (prop.nodeId === null) continue
    if (prop.kind === 'desk') deskGlow(paint, prop, [frame, context])
    else if (prop.kind === 'press') pressGlow(paint, prop, frame)
  }
}

function draw(paint: Paint, { bake, lightLayer }: Layers, frame: Frame): void {
  const { map, world, tMs } = frame
  paint.globalCompositeOperation = 'source-over'
  paint.drawImage(bake, 0, 0)

  const context = frameContext(frame)
  const moving = new Set(world.crates.map((c) => c.beltId))
  drawBelts(paint, map, { movingBeltIds: moving, tMs })
  drawQueuePlate(paint, map.anchors.exit, { context, tMs })
  drawSorted(paint, frame, context)

  paint.globalCompositeOperation = 'source-over'
  paint.drawImage(lightLayer, 0, 0)

  paint.globalCompositeOperation = 'lighter'
  crewGlows(paint, world)
  gateFlashes(paint, frame)
  stationGlows(paint, frame, context)
  paint.globalCompositeOperation = 'source-over'
}

/**
 * The previous record when the next one holds the same entries.
 *
 * Callers build `states` afresh on every render; an effect that depends on the
 * object itself would restart on each of them.
 */
function useStableRecord<T>(next: Readonly<Record<string, T>>): Readonly<Record<string, T>> {
  const [held, setHeld] = useState(next)
  const keys = Object.keys(next)
  const same =
    keys.length === Object.keys(held).length &&
    keys.every((key) => key in held && held[key] === next[key])
  if (!same) setHeld(next)
  return same ? held : next
}

type Baked = { map: HallMap; canvas: HTMLCanvasElement } | null

/** The layer `bakeRef` holds for `map`, baked with `bakeWith` when it holds another map's or none. */
function bakedFor(
  bakeRef: React.MutableRefObject<Baked>,
  map: HallMap,
  bakeWith: (map: HallMap, paint: Paint) => void
): HTMLCanvasElement {
  if (bakeRef.current === null || bakeRef.current.map !== map) {
    const canvas = document.createElement('canvas')
    canvas.width = map.width * TILE_PX
    canvas.height = map.height * TILE_PX
    const ctx = canvas.getContext('2d')
    if (ctx !== null) bakeWith(map, toPaint(ctx))
    bakeRef.current = { map, canvas }
  }
  return bakeRef.current.canvas
}

/** What the running loop reads afresh on every frame, so a change to it does not restart the loop. */
interface Live {
  readonly speedRef: React.MutableRefObject<number>
  readonly metricsRef: React.MutableRefObject<SceneContext['metrics']>
  readonly lampsRef: React.MutableRefObject<Lamps>
}

interface Loop {
  readonly paint: Paint
  readonly layers: Layers
  readonly map: HallMap
  readonly worldRef: React.MutableRefObject<World>
  readonly states: Readonly<Record<string, NodeState>>
  readonly live: Live
}

/** Draws the world as it stands, at its own clock. */
function drawNow({ paint, layers, map, worldRef, states, live }: Loop): void {
  draw(paint, layers, {
    map,
    world: worldRef.current,
    states,
    tMs: worldRef.current.clockMs,
    metrics: live.metricsRef.current,
    lamps: live.lampsRef.current,
  })
}

/**
 * Ticks and draws the world on every animation frame, pausing while the page
 * is hidden; the function that stops it.
 */
function runLoop(loop: Loop): () => void {
  let rafId = 0
  let running = true
  let last = performance.now()

  function frame(now: number): void {
    if (!running) return
    const dt = Math.min(MAX_FRAME_MS, now - last) * loop.live.speedRef.current
    last = now
    loop.worldRef.current = tick(loop.worldRef.current, dt)
    drawNow(loop)
    rafId = requestAnimationFrame(frame)
  }

  function onVisibility(): void {
    if (document.hidden) {
      running = false
      cancelAnimationFrame(rafId)
    } else if (!running) {
      running = true
      last = performance.now()
      rafId = requestAnimationFrame(frame)
    }
  }

  rafId = requestAnimationFrame(frame)
  document.addEventListener('visibilitychange', onVisibility)

  return () => {
    running = false
    cancelAnimationFrame(rafId)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

/** The refs the loop reads each frame, written after every render and before the loop's effect. */
function useLiveRefs({
  speed,
  metrics,
  lamps,
}: {
  speed: number
  metrics: SceneContext['metrics']
  lamps: Lamps
}): Live {
  // Read by the running loop each frame, so a speed change does not restart it.
  const speedRef = useRef(speed)
  // Same reasoning: a metrics poll landing mid-run should not restart the
  // rAF loop, just be read on the next frame it already draws.
  const metricsRef = useRef(metrics)
  const lampsRef = useRef<Lamps>(lamps)
  // Declared before the loop's effect, so the loop's first frame reads these.
  useEffect(() => {
    speedRef.current = speed
    metricsRef.current = metrics
    lampsRef.current = lamps
  })
  return useMemo(() => ({ speedRef, metricsRef, lampsRef }), [])
}

interface SceneLoopDeps extends Pick<Loop, 'map' | 'states' | 'worldRef' | 'live'> {
  readonly reducedMotion: boolean | undefined
}

/**
 * Bakes the map's layers once each, then draws the world once for someone
 * who asked for less motion, or on every frame for everyone else.
 */
function useSceneLoop(
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>,
  { map, states, worldRef, reducedMotion, live }: SceneLoopDeps
): void {
  const bakeRef = useRef<Baked>(null)
  const lightRef = useRef<Baked>(null)
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d') ?? null
    if (ctx === null) return
    const layers = {
      bake: bakedFor(bakeRef, map, bakeHall),
      lightLayer: bakedFor(lightRef, map, bakeLight),
    }
    const loop: Loop = { paint: toPaint(ctx), layers, map, worldRef, states, live }
    if (reducedMotion ?? prefersReducedMotion()) {
      drawNow(loop)
      return
    }
    return runLoop(loop)
  }, [canvasRef, map, states, worldRef, reducedMotion, live])
}

export function HallScene({
  map,
  worldRef,
  states: statesThisRender,
  reducedMotion,
  speed = 1,
  metrics = null,
  needsYou = [],
  orphaned = [],
}: HallSceneProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const states = useStableRecord(statesThisRender)
  // A beacon that would blink burns steadily for someone who asked for less motion.
  const steady = reducedMotion ?? prefersReducedMotion()
  const live = useLiveRefs({ speed, metrics, lamps: { needsYou, orphaned, steady } })
  useSceneLoop(canvasRef, { map, states, worldRef, reducedMotion, live })
  return (
    <canvas
      ref={canvasRef}
      width={map.width * TILE_PX}
      height={map.height * TILE_PX}
      aria-hidden="true"
      style={{ imageRendering: 'pixelated', width: '100%' }}
    />
  )
}
