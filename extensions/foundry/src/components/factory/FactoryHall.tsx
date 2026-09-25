import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ShieldQuestion, Terminal } from 'lucide-react'
import { useRunObservation } from '../../renderer/use-run-observation.js'
import { layoutHall } from '../../factory/layout.js'
import type { HallMap } from '../../factory/layout.js'
import { createWorld } from '../../factory/sim.js'
import type { World } from '../../factory/sim.js'
import { diffObservation, describeEvent } from '../../factory/events.js'
import type { Observation } from '../../factory/events.js'
import { direct } from '../../factory/director.js'
import { HallScene } from './HallScene.js'
import type { NodeState } from '../../line/run-graph.js'
import type { ToolActivity } from '../../runtime/transcript-tailer.js'
import type { TranscriptLine } from '../../runtime/transcript-excerpt.js'

// One order, drawn as a hall instead of a list of chips.
//
// This is a projection: it owns no state a poll did not put there. `World`
// only ever moves because `direct` was handed a `FactoryEvent` — never
// because a station looked animatable — which is what keeps the hall honest
// about a run it is not itself running.

export interface FactoryHallProps {
  readonly orderId: string
  readonly onOpenInbox: () => void
  readonly onBack: () => void
}

/** How often the activity feed is repolled — same cadence as the run
 *  observation itself, so a tool call shows up within one beat of it. */
const ACTIVITY_POLL_MS = 2000

function invoke(channel: string, payload: unknown = {}): Promise<unknown> {
  return window.electronAPI.extensionBridge.invoke(channel, payload)
}

export function FactoryHall({ orderId, onOpenInbox, onBack }: FactoryHallProps): JSX.Element {
  const { view, problem, pending } = useRunObservation(orderId)
  const [activity, setActivity] = useState<Readonly<Record<string, readonly ToolActivity[]>>>({})
  const [map, setMap] = useState<HallMap | null>(null)
  const [ticker, setTicker] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [attachProblem, setAttachProblem] = useState<string | null>(null)

  // Refs, not state: these are read and written inside the observation
  // effect on every poll, and putting them in state would make the effect
  // re-fire on its own writes.
  const mapRef = useRef<HallMap | null>(null)
  const mapKeyRef = useRef<string | null>(null)
  const worldRef = useRef<World | null>(null)
  const prevObservationRef = useRef<Observation | null>(null)

  const pollActivity = useCallback(async () => {
    const r = (await invoke('foundry:run.activity', { id: orderId })) as {
      activity?: Record<string, readonly ToolActivity[]>
      error?: string
    }
    if (r.error !== undefined) return
    setActivity(r.activity ?? {})
  }, [orderId])

  useEffect(() => {
    void pollActivity()
    const timer = setInterval(() => void pollActivity(), ACTIVITY_POLL_MS)
    return () => clearInterval(timer)
  }, [pollActivity])

  // The one place `direct` is called — on every poll of either the graph or
  // the activity feed, event or no event, with a real clock. A director
  // called only when something changed would miss the honesty rule's other
  // half: a poll that changed nothing still has to leave crew exactly where
  // the last one put them, not reset them.
  useEffect(() => {
    if (view === null) return
    const observation: Observation = {
      graph: view.graph,
      orphaned: view.orphaned ?? [],
      stranded: view.stranded ?? [],
      waiting: view.waiting ?? [],
      activity,
    }

    const nodeKey = [...view.graph.nodes.map((n) => n.id)].sort().join(',')
    if (mapKeyRef.current !== nodeKey) {
      const nextMap = layoutHall(view.graph, view.labels ?? {})
      mapKeyRef.current = nodeKey
      mapRef.current = nextMap
      setMap(nextMap)
      worldRef.current = createWorld(nextMap, observation)
      prevObservationRef.current = observation
      return
    }

    // `mapKeyRef` and `worldRef` are only ever set together, in the branch
    // above — reaching here means both are already populated.
    const world = worldRef.current as World
    const events = diffObservation(prevObservationRef.current, observation)
    worldRef.current = direct(world, events, Date.now())
    prevObservationRef.current = observation
    if (events.length > 0) {
      setTicker(describeEvent(events[events.length - 1], view.labels ?? {}))
    }
  }, [view, activity])

  const openStation = useCallback(
    async (nodeId: string) => {
      setSelected(nodeId)
      setAttachProblem(null)
      const node = view?.graph.nodes.find((n) => n.id === nodeId)
      if (node?.sessionId == null) {
        setTranscript([])
        return
      }
      const r = (await invoke('foundry:run-transcript', {
        sessionId: node.sessionId,
        limit: 12,
      })) as { lines?: TranscriptLine[] }
      setTranscript(r.lines ?? [])
    },
    [view]
  )

  const attach = useCallback(
    async (nodeId: string) => {
      const r = (await invoke('foundry:session.attach', { orderId, nodeId })) as
        | { terminalSessionId: string }
        | { error: string }
      if ('error' in r) {
        setAttachProblem(r.error)
        return
      }
      const gone = (await invoke('foundry:run-terminal', {
        sessionId: r.terminalSessionId,
      })) as { ok?: boolean }
      if (gone.ok !== true) setAttachProblem('That agent is no longer in a terminal.')
    },
    [orderId]
  )

  if (problem !== null && view === null) return <p className="fdry-note">{problem}</p>
  if (view === null || map === null || worldRef.current === null) {
    return <div className="fdry-empty">Loading the hall{'…'}</div>
  }

  const labels = view.labels ?? {}
  const stranded = view.stranded ?? []
  const standing = view.standing
  const states: Record<string, NodeState> = {}
  for (const n of view.graph.nodes) states[n.id] = n.state
  const selectedNode =
    selected === null ? null : (view.graph.nodes.find((n) => n.id === selected) ?? null)

  return (
    <div className="fdry-hall-shell">
      <button type="button" className="fdry-back" onClick={onBack}>
        All halls
      </button>

      {standing !== undefined && standing.turn === 'you' ? (
        <div className="fdry-hall-band">
          <span>{standing.headline}</span>
          <button type="button" className="is-primary" onClick={onOpenInbox}>
            Open Inbox
          </button>
        </div>
      ) : null}

      <div className="fdry-hall-stage">
        <HallScene map={map} worldRef={worldRef as React.MutableRefObject<World>} states={states} />
        <div className="fdry-hall-overlay">
          {map.props
            .filter((prop) => prop.nodeId !== null)
            .map((prop) => {
              const node = view.graph.nodes.find((n) => n.id === prop.nodeId)
              if (node === undefined) return null
              const flagged =
                (node.sessionId !== null && stranded.includes(node.sessionId)) ||
                pending.some((ask) => ask.sessionId === node.sessionId)
              const label = labels[node.id] ?? node.id
              return (
                <button
                  key={prop.id}
                  type="button"
                  className="fdry-hall-station"
                  style={{
                    left: `${(prop.x / map.width) * 100}%`,
                    top: `${(prop.y / map.height) * 100}%`,
                    width: `${(prop.w / map.width) * 100}%`,
                    height: `${(prop.h / map.height) * 100}%`,
                  }}
                  aria-label={`${label}, ${node.role ?? 'unassigned'}, ${node.state}, attempt ${node.attempts}`}
                  onClick={() => void openStation(node.id)}
                >
                  {flagged ? (
                    <ShieldQuestion aria-hidden="true" className="fdry-hall-flag" />
                  ) : null}
                </button>
              )
            })}
        </div>
      </div>

      <p className="fdry-hall-ticker" aria-live="polite">
        {ticker ?? ''}
      </p>

      {selectedNode === null ? null : (
        <section className="fdry-hall-drawer" aria-labelledby="fdry-hall-drawer-h">
          <div className="fdry-hall-drawer-head">
            <h3 id="fdry-hall-drawer-h">{labels[selectedNode.id] ?? selectedNode.id}</h3>
            <button type="button" onClick={() => setSelected(null)}>
              <ArrowLeft aria-hidden="true" /> Close
            </button>
          </div>
          <p className="fdry-note">
            {selectedNode.state} {'·'} attempt {selectedNode.attempts}
          </p>
          <pre className="fdry-transcript">
            {transcript.length === 0 ? 'Nothing yet.' : transcript.map((l) => l.text).join('\n')}
          </pre>
          {attachProblem !== null ? <p className="fdry-problem">{attachProblem}</p> : null}
          <button type="button" className="is-primary" onClick={() => void attach(selectedNode.id)}>
            <Terminal aria-hidden="true" /> Attach
          </button>
        </section>
      )}
    </div>
  )
}
