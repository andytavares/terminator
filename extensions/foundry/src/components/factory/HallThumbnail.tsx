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

export function HallThumbnail({
  orderId,
  title,
  refreshKey,
}: HallThumbnailProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Without an `IntersectionObserver` (a test or odd runtime) there is nothing
  // to wait for, so the card is visible and fetches right away.
  const canObserve = typeof IntersectionObserver !== 'undefined'
  const [intersected, setIntersected] = useState(false)
  const visible = !canObserve || intersected
  const [map, setMap] = useState<HallMap | null>(null)
  const [draft, setDraft] = useState(false)
  const worldRef = useRef<World | null>(null)
  const fetchedFor = useRef<string | null>(null)

  // Lazy: a card off-screen never fetches.
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
  }, [canObserve])

  useEffect(() => {
    if (!visible) return
    const key = `${orderId}:${refreshKey}`
    if (fetchedFor.current === key) return
    fetchedFor.current = key
    let cancelled = false
    void (async () => {
      const r = (await invoke('foundry:run.timeline', { id: orderId })) as {
        graph?: RunGraph
        error?: string
      }
      if (cancelled) return
      if (r.graph === undefined) {
        setDraft(true)
        setMap(null)
        return
      }
      const nextMap = layoutHall(r.graph, {}, false)
      worldRef.current = createWorld(nextMap, {
        graph: r.graph,
        orphaned: [],
        stranded: [],
        waiting: [],
        activity: {},
        ci: null,
        queue: null,
      })
      setDraft(false)
      setMap(nextMap)
    })()
    return () => {
      cancelled = true
    }
  }, [visible, orderId, refreshKey])

  const label = `Factory floor for ${title}`

  return (
    <div ref={containerRef} className="fdry-hall-card-pic">
      {map !== null ? (
        <div role="img" aria-label={label} className="fdry-hall-card-pic-frame">
          <HallScene
            map={map}
            worldRef={worldRef as React.MutableRefObject<World>}
            states={{}}
            reducedMotion
          />
        </div>
      ) : draft ? (
        <p role="img" aria-label={label} className="fdry-hall-card-pic-empty">
          {PLACEHOLDER_TEXT}
        </p>
      ) : (
        <div className="fdry-hall-card-pic-frame" aria-hidden="true" />
      )}
    </div>
  )
}
