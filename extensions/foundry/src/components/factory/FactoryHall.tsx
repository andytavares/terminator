import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ShieldQuestion, Terminal, X } from 'lucide-react'
import { useRunObservation } from '../../renderer/use-run-observation.js'
import type { FloorView, PendingAsk } from '../../renderer/use-run-observation.js'
import { layoutHall } from '../../factory/layout.js'
import type { HallMap, HallProp } from '../../factory/layout.js'
import { createWorld } from '../../factory/sim.js'
import type { World } from '../../factory/sim.js'
import { diffObservation, describeEvent } from '../../factory/events.js'
import type { Observation } from '../../factory/events.js'
import { direct } from '../../factory/director.js'
import { calloutFor, interruptionsFor, stateWord } from '../../factory/callouts.js'
import type { Callout, Interruption } from '../../factory/callouts.js'
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
//
// Everything the hall has to say is said inside it: a nameplate on every
// station, a callout rising from the station where something happened, and a
// card pinned over the station that is waiting on you, answerable in place.

export interface FactoryHallProps {
  readonly orderId: string
  readonly onOpenInbox: () => void
  /** Where an order's own controls live — resume, stop, a held call. */
  readonly onOpenInList: () => void
  readonly onBack: () => void
}

/** Same cadence as the run observation, so a tool call lands within one beat of it. */
const ACTIVITY_POLL_MS = 2000
/** How long a callout stays up before it has risen and faded. */
const CALLOUT_MS = 5000
/** Rows from the top of the hall under which a pinned card opens downward instead. */
const CARD_FLIP_ROW = 7
/** Tiles a nameplate may span: a column pitch, less a gap. */
const PLATE_COLUMNS = 4.6

function invoke(channel: string, payload: unknown = {}): Promise<unknown> {
  return window.electronAPI.extensionBridge.invoke(channel, payload)
}

interface Anchor {
  readonly left: number
  readonly top: number
  readonly bottom: number
}

/** Percent box of a station, or of the wait anchor for something no station owns. */
function anchorOf(map: HallMap, nodeId: string | null): Anchor {
  const prop = nodeId === null ? undefined : map.props.find((p) => p.nodeId === nodeId)
  if (prop === undefined) {
    const tile = map.anchors.wait
    return {
      left: ((tile.x + 0.5) / map.width) * 100,
      top: (tile.y / map.height) * 100,
      bottom: ((tile.y + 1) / map.height) * 100,
    }
  }
  return {
    left: ((prop.x + prop.w / 2) / map.width) * 100,
    top: (prop.y / map.height) * 100,
    bottom: ((prop.y + prop.h + 1) / map.height) * 100,
  }
}

function stationStyle(map: HallMap, prop: HallProp): React.CSSProperties {
  return {
    left: `${(prop.x / map.width) * 100}%`,
    top: `${(prop.y / map.height) * 100}%`,
    width: `${(prop.w / map.width) * 100}%`,
    height: `${(prop.h / map.height) * 100}%`,
  }
}

export function FactoryHall({
  orderId,
  onOpenInbox,
  onOpenInList,
  onBack,
}: FactoryHallProps): JSX.Element {
  const { view, problem, pending, refresh } = useRunObservation(orderId)
  const [activity, setActivity] = useState<Readonly<Record<string, readonly ToolActivity[]>>>({})
  const [map, setMap] = useState<HallMap | null>(null)
  const [callouts, setCallouts] = useState<readonly Callout[]>([])
  const [spoken, setSpoken] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [attachProblem, setAttachProblem] = useState<string | null>(null)
  const [answerProblem, setAnswerProblem] = useState<Readonly<Record<string, string>>>({})
  const [busy, setBusy] = useState<string | null>(null)

  // Refs, not state: these are read and written inside the observation
  // effect on every poll, and putting them in state would make the effect
  // re-fire on its own writes.
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

  // Risen callouts leave on their own; nothing has to happen for them to go.
  useEffect(() => {
    if (callouts.length === 0) return
    const timer = setInterval(() => {
      const now = Date.now()
      setCallouts((live) => live.filter((c) => now - c.at < CALLOUT_MS))
    }, 500)
    return () => clearInterval(timer)
  }, [callouts.length])

  // The one place `direct` is called — on every poll of either the graph or
  // the activity feed, event or no event, with a real clock. A call held
  // open across polls only crosses its walking threshold on a poll that
  // brought no new event at all.
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
      setMap(nextMap)
      worldRef.current = createWorld(nextMap, observation)
      prevObservationRef.current = observation
      return
    }

    // `mapKeyRef` and `worldRef` are only ever set together, in the branch
    // above — reaching here means both are already populated.
    const world = worldRef.current as World
    const now = Date.now()
    const events = diffObservation(prevObservationRef.current, observation)
    worldRef.current = direct(world, events, now)
    prevObservationRef.current = observation
    if (events.length === 0) return

    const labels = view.labels ?? {}
    const raised = events
      .map((event) => calloutFor(event, labels, now))
      .filter((c): c is Callout => c !== null)
    if (raised.length > 0) {
      const owners = new Set(raised.map((c) => c.nodeId))
      setCallouts((live) => [...live.filter((c) => !owners.has(c.nodeId)), ...raised])
    }
    setSpoken(events.map((event) => describeEvent(event, labels)).join(' '))
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

  // Answers go through the same channels the Floor and the Inbox use; a
  // refusal is shown on the card it came from, never swallowed.
  const answer = useCallback(
    async (id: string, run: () => Promise<string | null>) => {
      setBusy(id)
      try {
        const failure = await run()
        setAnswerProblem((all) => {
          const { [id]: _dropped, ...rest } = all
          return failure === null ? rest : { ...rest, [id]: failure }
        })
        void refresh()
      } finally {
        setBusy(null)
      }
    },
    [refresh]
  )

  const resolveAsk = (requestId: string, decision: 'allow' | 'deny'): void =>
    void answer(requestId, async () => {
      const r = (await invoke('foundry:permission-resolve', { requestId, decision })) as {
        ok?: boolean
        reason?: string
      }
      return r.ok === true ? null : (r.reason ?? 'That request is no longer waiting.')
    })

  const decideGate = (gateId: string, option: string): void =>
    void answer(gateId, async () => {
      const r = (await invoke('foundry:inbox.decide', { gateId, option })) as { error?: string }
      return r.error ?? null
    })

  const goToTerminal = (id: string, sessionId: string): void =>
    void answer(id, async () => {
      const r = (await invoke('foundry:run-terminal', { sessionId })) as { ok?: boolean }
      return r.ok === true ? null : 'That agent is no longer in a terminal.'
    })

  if (problem !== null && view === null) return <p className="fdry-note">{problem}</p>
  if (view === null || map === null || worldRef.current === null) {
    return <div className="fdry-empty">Loading the hall{'…'}</div>
  }

  const labels = view.labels ?? {}
  const orphaned = new Set(view.orphaned ?? [])
  const interruptions = interruptionsFor({
    graph: view.graph,
    waiting: view.waiting ?? [],
    stranded: view.stranded ?? [],
    pending,
  })
  const flaggedNodes = new Set(interruptions.map((i) => i.nodeId))
  const states: Record<string, NodeState> = {}
  for (const n of view.graph.nodes) states[n.id] = n.state
  const selectedNode =
    selected === null ? null : (view.graph.nodes.find((n) => n.id === selected) ?? null)

  return (
    <div className="fdry-hall-shell">
      <div
        className="fdry-hall-frame"
        style={
          {
            aspectRatio: `${map.width} / ${map.height}`,
            '--fdry-hall-aspect': map.width / map.height,
          } as React.CSSProperties
        }
      >
        <HallScene map={map} worldRef={worldRef as React.MutableRefObject<World>} states={states} />

        <div className="fdry-hall-overlay">
          {map.props
            .filter((prop) => prop.nodeId !== null)
            .map((prop) => {
              const node = view.graph.nodes.find((n) => n.id === prop.nodeId)
              if (node === undefined) return null
              const label = labels[node.id] ?? node.id
              const gone = orphaned.has(node.id)
              return (
                <React.Fragment key={prop.id}>
                  <button
                    type="button"
                    className="fdry-hall-station"
                    title={label}
                    style={stationStyle(map, prop)}
                    aria-label={`${label}, ${node.role ?? 'unassigned'}, ${node.state}, attempt ${node.attempts}`}
                    onClick={() => void openStation(node.id)}
                  >
                    {flaggedNodes.has(node.id) ? (
                      <span className="fdry-hall-flag" aria-hidden="true">
                        <ShieldQuestion />
                      </span>
                    ) : null}
                  </button>
                  <div
                    className="fdry-plate"
                    data-state={gone ? 'gone' : node.state}
                    aria-hidden="true"
                    style={{
                      left: `${anchorOf(map, node.id).left}%`,
                      top: `${anchorOf(map, node.id).top}%`,
                      // Neighbouring stations are one column pitch apart; a
                      // plate wider than that runs into the next one's.
                      maxWidth: `${(PLATE_COLUMNS / map.width) * 100}%`,
                    }}
                  >
                    <span className="fdry-plate__name">{label}</span>
                    <span className="fdry-plate__state">
                      {gone ? 'No agent' : stateWord(node.state)}
                      {node.attempts > 1 ? ` · try ${node.attempts}` : ''}
                    </span>
                  </div>
                </React.Fragment>
              )
            })}

          {callouts.map((c) => {
            const at = anchorOf(map, c.nodeId)
            return (
              <div
                key={c.id}
                className="fdry-callout"
                data-tone={c.tone}
                aria-hidden="true"
                style={{ left: `${at.left}%`, top: `${at.top}%` }}
              >
                {c.text}
              </div>
            )
          })}

          {interruptions.map((item) => (
            <InterruptionCard
              key={`${item.kind}:${item.id}`}
              item={item}
              anchor={anchorOf(map, item.nodeId)}
              flip={anchorOf(map, item.nodeId).top < (CARD_FLIP_ROW / map.height) * 100}
              busy={busy === item.id}
              problem={answerProblem[item.id] ?? null}
              onAllow={() => resolveAsk(item.id, 'allow')}
              onDeny={() => resolveAsk(item.id, 'deny')}
              onDecide={(option) => decideGate(item.id, option)}
              onOpenInbox={onOpenInbox}
              onTerminal={() => {
                const sessionId =
                  item.kind === 'stranded'
                    ? item.id
                    : (pending.find((p: PendingAsk) => p.requestId === item.id)?.sessionId ?? '')
                goToTerminal(item.id, sessionId)
              }}
            />
          ))}
        </div>

        <HallHud
          view={view}
          waitingCount={interruptions.length}
          onBack={onBack}
          onOpenInbox={onOpenInbox}
          onOpenInList={onOpenInList}
        />

        {selectedNode === null ? null : (
          <section className="fdry-hall-inspector" aria-labelledby="fdry-hall-inspector-h">
            <div className="fdry-hall-inspector__head">
              <h3 id="fdry-hall-inspector-h">{labels[selectedNode.id] ?? selectedNode.id}</h3>
              <button type="button" aria-label="Close" onClick={() => setSelected(null)}>
                <X aria-hidden="true" />
              </button>
            </div>
            <p className="fdry-hall-inspector__meta">
              {stateWord(selectedNode.state)} {'·'} attempt {selectedNode.attempts}
              {selectedNode.role !== null ? ` · ${selectedNode.role}` : ''}
            </p>
            <pre className="fdry-hall-inspector__log">
              {transcript.length === 0 ? 'Nothing yet.' : transcript.map((l) => l.text).join('\n')}
            </pre>
            {attachProblem !== null ? <p className="fdry-problem">{attachProblem}</p> : null}
            <button
              type="button"
              className="fdry-hall-btn is-primary"
              onClick={() => void attach(selectedNode.id)}
            >
              <Terminal aria-hidden="true" /> Attach
            </button>
          </section>
        )}
      </div>

      <p className="fdry-sr-only" aria-live="polite">
        {spoken}
      </p>
    </div>
  )
}

interface HallHudProps {
  readonly view: FloorView
  readonly waitingCount: number
  readonly onBack: () => void
  readonly onOpenInbox: () => void
  readonly onOpenInList: () => void
}

/** The order's own status, on the hall's top edge rather than above or below it. */
function HallHud({
  view,
  waitingCount,
  onBack,
  onOpenInbox,
  onOpenInList,
}: HallHudProps): JSX.Element {
  const standing = view.standing
  const done = standing?.done ?? 0
  const total = standing?.total ?? view.graph.nodes.length
  return (
    <div className="fdry-hall-hud">
      <button type="button" className="fdry-hall-btn" onClick={onBack}>
        <ArrowLeft aria-hidden="true" /> All halls
      </button>
      <div className="fdry-hall-hud__order">
        <span className="fdry-hall-hud__title">{view.title ?? view.graph.orderId}</span>
        <span className="fdry-hall-hud__progress" aria-label={`${done} of ${total} steps done`}>
          <span style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }} />
        </span>
        <span className="fdry-hall-hud__steps">
          {done}/{total}
        </span>
      </div>
      {waitingCount > 0 ? (
        <span className="fdry-hall-hud__needs">{waitingCount} need you</span>
      ) : null}
      {/* A move no card owns — a run nothing is running, say — still names
          its place. Only a gate is decided in the Inbox. */}
      {standing !== undefined && standing.turn === 'you' && waitingCount === 0 ? (
        <div className="fdry-hall-hud__alert">
          <span>{standing.headline}</span>
          {standing.gateId !== null ? (
            <button type="button" className="fdry-hall-btn is-primary" onClick={onOpenInbox}>
              Open Inbox
            </button>
          ) : (
            <button type="button" className="fdry-hall-btn is-primary" onClick={onOpenInList}>
              Open in List view
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}

interface InterruptionCardProps {
  readonly item: Interruption
  readonly anchor: Anchor
  readonly flip: boolean
  readonly busy: boolean
  readonly problem: string | null
  readonly onAllow: () => void
  readonly onDeny: () => void
  readonly onDecide: (option: string) => void
  readonly onOpenInbox: () => void
  readonly onTerminal: () => void
}

/** Pinned over the station that is waiting, and answerable where it stands. */
function InterruptionCard({
  item,
  anchor,
  flip,
  busy,
  problem,
  onAllow,
  onDeny,
  onDecide,
  onOpenInbox,
  onTerminal,
}: InterruptionCardProps): JSX.Element {
  const titleId = `fdry-card-${item.kind}-${item.id}`
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className={`fdry-card${flip ? ' is-below' : ''}`}
      style={{
        left: `${Math.min(Math.max(anchor.left, 16), 84)}%`,
        top: `${flip ? anchor.bottom : anchor.top}%`,
      }}
    >
      <div className="fdry-card__head">
        <ShieldQuestion aria-hidden="true" />
        <span id={titleId}>{item.title}</span>
      </div>
      <p className="fdry-card__detail">{item.detail}</p>
      {problem !== null ? <p className="fdry-card__problem">{problem}</p> : null}
      <div className="fdry-card__actions">
        {item.kind === 'ask' ? (
          <>
            <button
              type="button"
              className="fdry-hall-btn is-primary"
              disabled={busy}
              onClick={onAllow}
            >
              Allow
            </button>
            <button type="button" className="fdry-hall-btn" disabled={busy} onClick={onDeny}>
              Deny
            </button>
            <button type="button" className="fdry-hall-btn" disabled={busy} onClick={onTerminal}>
              <Terminal aria-hidden="true" /> Terminal
            </button>
          </>
        ) : item.kind === 'gate' ? (
          item.needsInbox ? (
            <button type="button" className="fdry-hall-btn is-primary" onClick={onOpenInbox}>
              Open Inbox
            </button>
          ) : (
            item.options.map((option) => (
              <button
                key={option.id}
                type="button"
                title={option.consequence}
                className="fdry-hall-btn is-primary"
                disabled={busy}
                onClick={() => onDecide(option.id)}
              >
                {option.label}
              </button>
            ))
          )
        ) : (
          <button
            type="button"
            className="fdry-hall-btn is-primary"
            disabled={busy}
            onClick={onTerminal}
          >
            <Terminal aria-hidden="true" /> Go to terminal
          </button>
        )}
      </div>
    </div>
  )
}
