import React, { useEffect, useState } from 'react'
import { getSpeckitAPI, type LaneViewJson } from '../types/electron.js'

// A card that touches more than one repository, in merge order.
//
// Renders nothing at all for a single-repository card, which is almost all of
// them: the lanes come from the `workitem.json` the plan phase writes, and a
// card with no such file has one repository rather than a broken work item.
//
// Merge order is the whole point. A consumer that merges before its producer is
// building against a contract that has not landed, and the collision flags are
// there to say so before the agents start rather than after they conflict.

export interface LaneStripProps {
  featureDir: string
  /** Lanes already merged, so the strip can say which may go next. */
  merged?: number[]
}

export function LaneStrip({ featureDir, merged = [] }: LaneStripProps): JSX.Element {
  const [lanes, setLanes] = useState<LaneViewJson[]>([])
  const [blocked, setBlocked] = useState<Record<number, string>>({})

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { lanes: views } = await getSpeckitAPI().lanes({ featureDir })
      if (cancelled) return
      setLanes(views)

      // Asked per lane rather than derived here: the rule about whether an
      // ordering is a constraint or a preference lives in one place, and a
      // second copy of it in the renderer is a second answer.
      const reasons: Record<number, string> = {}
      for (const view of views) {
        const decision = await getSpeckitAPI().laneMayMerge({
          featureDir,
          ord: view.lane.ord,
          merged,
        })
        if (!decision.allowed && decision.reason !== null) reasons[view.lane.ord] = decision.reason
      }
      if (!cancelled) setBlocked(reasons)
    })()
    return () => {
      cancelled = true
    }
    // `merged` is a list of numbers; comparing by value keeps a fresh array
    // literal from re-running this on every render.
  }, [featureDir, merged.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  if (lanes.length < 2) return <></>

  return (
    <div className="sk-lanes">
      <div className="sk-lanes__head">Merge order</div>
      {lanes.map((view) => (
        <div className="sk-lanes__row" key={view.lane.ord}>
          <span className="sk-lanes__ord">{view.lane.ord}</span>
          <span className="sk-sup__main">
            <div className="sk-sup__title">
              {view.lane.repo}
              {view.lane.role !== undefined && (
                <span className="sk-sup__author"> {view.lane.role}</span>
              )}
            </div>
            <div className="sk-sup__meta">
              {view.lane.branch}
              {view.blockedBy.length > 0 && ` · waits on ${view.blockedBy.join(', ')}`}
              {/* Flagged on every lane that touches the file, not just the
                  producer — the point is to warn each agent before it starts. */}
              {view.collisions.length > 0 && ` · shares ${view.collisions.join(', ')}`}
            </div>
            {blocked[view.lane.ord] !== undefined && (
              <div className="sk-sup__warn">{blocked[view.lane.ord]}</div>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
