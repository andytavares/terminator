import React, { useEffect, useRef, useState } from 'react'
import { layoutHall } from '../../factory/layout.js'
import type { HallMap } from '../../factory/layout.js'
import { createWorld } from '../../factory/sim.js'
import type { World } from '../../factory/sim.js'
import type { RunGraph } from '../../line/run-graph.js'
import { HallScene } from './HallScene.js'
import { invoke } from '@terminator/extension-sdk/renderer'

// One still frame of an order's own hall, for its card in the Factory grid.
//
// A card list of thirty orders cannot each run `FactoryHall`'s live poll and
// its own rAF loop — that is thirty simulations ticking for a picture nobody
// is watching move. Instead this fetches the order's graph once, lays it out
// once, and hands `HallScene` its reduced-motion path, which paints a single
// frame and schedules nothing.

export interface HallThumbnailProps {
  readonly orderId: string
  /** For the picture's accessible name: "Factory floor for {title}". */
  readonly title: string
  /**
   * Bumped whenever the order's own standing changes, to refetch the graph —
   * never a timer. The value itself carries no meaning past equality.
   */
  readonly refreshKey: string
}

const PLACEHOLDER_TEXT = 'Not started yet — the floor appears when the work starts.'

/**
 * Whether the element has come within 200px of the screen. Lazy: a card
 * off-screen never fetches. Without an `IntersectionObserver` (a test or odd
 * runtime) there is nothing to wait for, so the card is visible right away.
 */
function useOnScreen(containerRef: React.MutableRefObject<HTMLDivElement | null>): boolean {
  const canObserve = typeof IntersectionObserver !== 'undefined'
  const [intersected, setIntersected] = useState(false)
  useEffect(() => {
    const el = containerRef.current
    if (el === null) return
    if (!canObserve) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setIntersected(true)
      },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [canObserve, containerRef])
  return !canObserve || intersected
}

/** The order's run graph; undefined for an order that has not started. */
async function readThumbnailGraph(orderId: string): Promise<RunGraph | undefined> {
  const r = (await invoke('foundry:run.timeline', { id: orderId })) as {
    graph?: RunGraph
    error?: string
  }
  return r.graph
}

/** The world settled on `graph`, with nothing going on in it. */
function stillWorld(map: HallMap, graph: RunGraph): World {
  return createWorld(map, {
    graph,
    orphaned: [],
    stranded: [],
    waiting: [],
    activity: {},
    ci: null,
    queue: null,
  })
}

interface StillDeps {
  readonly orderId: string
  readonly refreshKey: string
  readonly visible: boolean
  readonly worldRef: React.MutableRefObject<World | null>
}

/**
 * The hall laid out once for the order's graph, fetched again only when
 * `refreshKey` changes; `draft` when there is no graph yet.
 */
function useStillHall({ orderId, refreshKey, visible, worldRef }: StillDeps) {
  const [map, setMap] = useState<HallMap | null>(null)
  const [draft, setDraft] = useState(false)
  const fetchedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!visible) return
    const key = `${orderId}:${refreshKey}`
    if (fetchedFor.current === key) return
    fetchedFor.current = key
    let cancelled = false
    void (async () => {
      const graph = await readThumbnailGraph(orderId)
      if (cancelled) return
      if (graph === undefined) {
        setDraft(true)
        setMap(null)
        return
      }
      const nextMap = layoutHall(graph, {}, false)
      worldRef.current = stillWorld(nextMap, graph)
      setDraft(false)
      setMap(nextMap)
    })()
    return () => {
      cancelled = true
    }
  }, [visible, orderId, refreshKey, worldRef])
  return { map, draft }
}

export function HallThumbnail({
  orderId,
  title,
  refreshKey,
}: HallThumbnailProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const worldRef = useRef<World | null>(null)
  const visible = useOnScreen(containerRef)
  const { map, draft } = useStillHall({ orderId, refreshKey, visible, worldRef })
  return (
    <div ref={containerRef} className="fdry-hall-card-pic">
      <StillPicture
        map={map}
        draft={draft}
        label={`Factory floor for ${title}`}
        worldRef={worldRef}
      />
    </div>
  )
}

interface StillPictureProps {
  readonly map: HallMap | null
  readonly draft: boolean
  readonly label: string
  readonly worldRef: React.MutableRefObject<World | null>
}

/** The hall's one frame, the words for an order not started yet, or an empty frame while it loads. */
function StillPicture({ map, draft, label, worldRef }: StillPictureProps) {
  if (map !== null) {
    return (
      <div role="img" aria-label={label} className="fdry-hall-card-pic-frame">
        <HallScene
          map={map}
          worldRef={worldRef as React.MutableRefObject<World>}
          states={{}}
          reducedMotion
        />
      </div>
    )
  }
  if (!draft) return <div className="fdry-hall-card-pic-frame" aria-hidden="true" />
  return (
    <p role="img" aria-label={label} className="fdry-hall-card-pic-empty">
      {PLACEHOLDER_TEXT}
    </p>
  )
}
