import React, { useEffect, useRef } from 'react'
import type { HallMap, PropKind } from '../../factory/layout.js'
import { TILE_PX } from '../../factory/layout.js'
import { cratePosition, tick } from '../../factory/sim.js'
import type { World } from '../../factory/sim.js'
import type { NodeState } from '../../line/run-graph.js'
import type { Paint, PaintGradient } from '../../factory/art/kit.js'
import { glow } from '../../factory/art/kit.js'
import { bakeHall, drawProp, drawBelts, drawCrate } from '../../factory/art/props.js'
import { drawCrew } from '../../factory/art/crew.js'

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
}

const DARKNESS = 'rgba(5,8,18,0.42)'
const LIGHT_RADIUS = 70
const MAX_FRAME_MS = 50
// Seating furniture shares its own tile with the crew member who sits or
// stands there — sorted behind them, since its low silhouette (not its tall
// backrest) is what should tie-break against a seat one row down.
const SEAT_FURNITURE: ReadonlySet<PropKind> = new Set(['restbench', 'sofa', 'plant'])

function toPaint(ctx: CanvasRenderingContext2D): Paint {
  return {
    get fillStyle() {
      return ctx.fillStyle as unknown as string
    },
    set fillStyle(value: string | PaintGradient) {
      ctx.fillStyle = value as unknown as string
    },
    get globalCompositeOperation() {
      return ctx.globalCompositeOperation
    },
    set globalCompositeOperation(value: string) {
      ctx.globalCompositeOperation = value as GlobalCompositeOperation
    },
    fillRect: (x, y, w, h) => ctx.fillRect(x, y, w, h),
    createRadialGradient: (x0, y0, r0, x1, y1, r1) =>
      ctx.createRadialGradient(x0, y0, r0, x1, y1, r1),
    drawImage: (image, dx, dy) => ctx.drawImage(image, dx, dy),
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia !== undefined
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
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
    glow(
      paint,
      light.x * TILE_PX + TILE_PX / 2,
      light.y * TILE_PX + TILE_PX / 2,
      LIGHT_RADIUS,
      'rgba(0,0,0,.85)',
      'rgba(0,0,0,0)'
    )
  }
}

function draw(
  paint: Paint,
  bake: CanvasImageSource,
  lightLayer: CanvasImageSource,
  map: HallMap,
  world: World,
  states: Readonly<Record<string, NodeState>>,
  tMs: number
): void {
  paint.globalCompositeOperation = 'source-over'
  paint.drawImage(bake, 0, 0)

  const context = { crew: world.crew, states, gatesWaiting: world.gatesWaiting }

  const moving = new Set(world.crates.map((c) => c.beltId))
  drawBelts(paint, map, moving, tMs)

  type Drawable = { readonly y: number; readonly draw: () => void }
  const drawables: Drawable[] = []
  for (const prop of map.props) {
    const sortY = SEAT_FURNITURE.has(prop.kind) ? prop.y * TILE_PX : (prop.y + prop.h) * TILE_PX
    drawables.push({ y: sortY, draw: () => drawProp(paint, prop, context, tMs) })
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

  paint.globalCompositeOperation = 'source-over'
  paint.drawImage(lightLayer, 0, 0)

  paint.globalCompositeOperation = 'lighter'
  for (const crew of world.crew) {
    if (!crew.present) continue
    if (crew.anim === 'type') {
      glow(paint, crew.x, crew.y - 14, 26, 'rgba(90,200,235,.28)', 'rgba(90,200,235,0)')
    } else if (crew.anim === 'scan') {
      glow(paint, crew.x, crew.y - 14, 26, 'rgba(140,230,120,.3)', 'rgba(140,230,120,0)')
    }
  }
  for (const nodeId of world.gatesWaiting) {
    const gate = map.props.find((p) => p.nodeId === nodeId && p.kind === 'gate')
    if (gate === undefined) continue
    const flashOn = Math.floor(tMs / 250) % 2 === 0
    if (!flashOn) continue
    glow(
      paint,
      (gate.x + gate.w / 2) * TILE_PX,
      gate.y * TILE_PX - 8,
      36,
      'rgba(230,160,60,.5)',
      'rgba(230,160,60,0)'
    )
  }
  paint.globalCompositeOperation = 'source-over'
}

export function HallScene({
  map,
  worldRef,
  states,
  reducedMotion,
  speed = 1,
}: HallSceneProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Read by the running loop each frame, so a speed change does not restart it.
  const speedRef = useRef(speed)
  speedRef.current = speed
  const bakeRef = useRef<{ map: HallMap; canvas: HTMLCanvasElement } | null>(null)
  const lightRef = useRef<{ map: HallMap; canvas: HTMLCanvasElement } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return

    if (bakeRef.current === null || bakeRef.current.map !== map) {
      const bakeCanvas = document.createElement('canvas')
      bakeCanvas.width = map.width * TILE_PX
      bakeCanvas.height = map.height * TILE_PX
      const bakeCtx = bakeCanvas.getContext('2d')
      if (bakeCtx !== null) bakeHall(map, toPaint(bakeCtx))
      bakeRef.current = { map, canvas: bakeCanvas }
    }
    const bake = bakeRef.current.canvas

    if (lightRef.current === null || lightRef.current.map !== map) {
      const lightCanvas = document.createElement('canvas')
      lightCanvas.width = map.width * TILE_PX
      lightCanvas.height = map.height * TILE_PX
      const lightCtx = lightCanvas.getContext('2d')
      if (lightCtx !== null) bakeLight(map, toPaint(lightCtx))
      lightRef.current = { map, canvas: lightCanvas }
    }
    const lightLayer = lightRef.current.canvas

    const paint = toPaint(ctx)
    const reduced = reducedMotion ?? prefersReducedMotion()

    if (reduced) {
      draw(paint, bake, lightLayer, map, worldRef.current, states, worldRef.current.clockMs)
      return
    }

    let rafId = 0
    let running = true
    let last = performance.now()

    function frame(now: number): void {
      if (!running) return
      const dt = Math.min(MAX_FRAME_MS, now - last) * speedRef.current
      last = now
      worldRef.current = tick(worldRef.current, dt)
      draw(paint, bake, lightLayer, map, worldRef.current, states, worldRef.current.clockMs)
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
  }, [map, states, worldRef, reducedMotion])

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
