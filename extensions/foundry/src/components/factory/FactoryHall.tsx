import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, History, Pause, Play, Radio, ShieldQuestion, Terminal, X } from 'lucide-react'
import { useRunObservation } from '../../renderer/use-run-observation.js'
import type { FloorView, PendingAsk } from '../../renderer/use-run-observation.js'
import { layoutHall } from '../../factory/layout.js'
import type { HallMap, HallProp } from '../../factory/layout.js'
import { createWorld } from '../../factory/sim.js'
import type { World } from '../../factory/sim.js'
import { diffObservation, describeEvent } from '../../factory/events.js'
import type { FactoryEvent, Observation } from '../../factory/events.js'
import { direct } from '../../factory/director.js'
import { calloutFor, interruptionsFor, stateWord } from '../../factory/callouts.js'
import type { Callout, Interruption } from '../../factory/callouts.js'
import { momentsOf, observationAt, replayClock } from '../../factory/replay.js'
import type { ReplayClock, Timeline } from '../../factory/replay.js'
import type { Gate } from '../../gates/rules.js'
import type { OrderMetrics } from '../../factory/metrics.js'
import { HallScene } from './HallScene.js'
import type { NodeState, RunGraph } from '../../line/run-graph.js'
import type { ToolActivity } from '../../runtime/transcript-tailer.js'
import type { TranscriptLine } from '../../runtime/transcript-excerpt.js'
import { MarkdownInline } from '../Markdown.js'

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
/** How often a playing replay advances, in ms of replay time at 1x. */
const REPLAY_STEP_MS = 100
/** The longest quiet stretch a replay plays at full length before it is shortened. */
const REPLAY_MAX_GAP_MS = 6000
const REPLAY_SPEEDS = [1, 4, 16] as const
type ReplaySpeed = (typeof REPLAY_SPEEDS)[number]

interface Replay {
  readonly graph: RunGraph
  readonly timeline: Timeline
  readonly gates: readonly Gate[]
  readonly map: HallMap
  readonly clock: ReplayClock
  readonly pos: number
  readonly playing: boolean
  readonly speed: ReplaySpeed
  readonly observation: Observation
}

function clockText(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Percent of the hall's width within which two callouts count as neighbours. */
const CALLOUT_NEAR = 16
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
  const [orderMetrics, setOrderMetrics] = useState<OrderMetrics | null>(null)
  const [map, setMap] = useState<HallMap | null>(null)
  const [callouts, setCallouts] = useState<readonly Callout[]>([])
  const [spoken, setSpoken] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [attachProblem, setAttachProblem] = useState<string | null>(null)
  const [answerProblem, setAnswerProblem] = useState<Readonly<Record<string, string>>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [replay, setReplay] = useState<Replay | null>(null)
  const [replayNote, setReplayNote] = useState<string | null>(null)
  // The replay's own world, beside the live one: live polling carries on
  // underneath a replay, so leaving it lands back on the run as it is now.
  const replayRef = useRef<Replay | null>(null)
  const replayWorldRef = useRef<World | null>(null)
  const replayPrevRef = useRef<Observation | null>(null)

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

  // The order's own numbers for the status wall — same cadence as the
  // activity poll, so a rework or a new CI round shows up within one beat.
  const pollMetrics = useCallback(async () => {
    const r = (await invoke('foundry:factory.metrics', { window: 'all' })) as {
      orders?: OrderMetrics[]
      error?: string
    }
    if (r.error !== undefined) return
    setOrderMetrics(r.orders?.find((o) => o.orderId === orderId) ?? null)
  }, [orderId])

  useEffect(() => {
    void pollMetrics()
    const timer = setInterval(() => void pollMetrics(), ACTIVITY_POLL_MS)
    return () => clearInterval(timer)
  }, [pollMetrics])

  // Risen callouts leave on their own; nothing has to happen for them to go.
  useEffect(() => {
    if (callouts.length === 0) return
    const timer = setInterval(() => {
      const now = Date.now()
      setCallouts((live) => live.filter((c) => now - c.at < CALLOUT_MS))
    }, 500)
    return () => clearInterval(timer)
  }, [callouts.length])

  // What a batch of events says: callouts at their stations, and one sentence
  // for a screen reader. Live polls and a playing replay both come through here.
  const announce = useCallback(
    (events: readonly FactoryEvent[], labels: Readonly<Record<string, string>>) => {
      if (events.length === 0) return
      const now = Date.now()
      const raised = events
        .map((event) => calloutFor(event, labels, now))
        .filter((c): c is Callout => c !== null)
      if (raised.length > 0) {
        const owners = new Set(raised.map((c) => c.nodeId))
        setCallouts((live) => [...live.filter((c) => !owners.has(c.nodeId)), ...raised])
      }
      setSpoken(events.map((event) => describeEvent(event, labels)).join(' '))
    },
    []
  )

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
      ci: view.ci ?? null,
      queue: view.queue ?? null,
    }

    // CI presence joins the key: the dispatch tower has to appear the moment
    // a run first ships a pull, not only the next time the node set changes.
    const nodeKey =
      [...view.graph.nodes.map((n) => n.id)].sort().join(',') +
      (observation.ci === null ? '' : '+ci')
    if (mapKeyRef.current !== nodeKey) {
      const nextMap = layoutHall(view.graph, view.labels ?? {}, observation.ci !== null)
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
    // A replay has the stage; live events still move the live world, silently.
    if (replayRef.current === null) announce(events, view.labels ?? {})
  }, [view, activity, announce])

  const labelsNow = view?.labels

  const startReplay = useCallback(async () => {
    setReplayNote(null)
    const r = (await invoke('foundry:run.timeline', { id: orderId })) as {
      graph?: RunGraph
      timeline?: Timeline
      gates?: Gate[]
      error?: string
    }
    if (r.graph === undefined || r.timeline === undefined || r.timeline.frames.length === 0) {
      setReplayNote('Nothing recorded for this run yet.')
      return
    }
    const gates = r.gates ?? []
    const clock = replayClock(momentsOf(r.timeline, gates), REPLAY_MAX_GAP_MS)
    const observation = observationAt(r.timeline, gates, r.graph, clock.toReal(0))
    const replayMap = layoutHall(r.graph, labelsNow ?? {})
    replayWorldRef.current = createWorld(replayMap, observation)
    replayPrevRef.current = observation
    setCallouts([])
    const next: Replay = {
      graph: r.graph,
      timeline: r.timeline,
      gates,
      map: replayMap,
      clock,
      pos: 0,
      playing: true,
      speed: 1,
      observation,
    }
    replayRef.current = next
    setReplay(next)
  }, [orderId, labelsNow])

  // Move the replay to `pos`. Playing forward goes through the same diff and
  // director as a live poll, so it animates; a seek rebuilds the hall settled
  // at that moment, as a hall opened then would have been.
  const moveReplay = useCallback(
    (pos: number, seek: boolean) => {
      const r = replayRef.current
      if (r === null) return
      const at = Math.min(Math.max(pos, 0), r.clock.duration)
      const real = r.clock.toReal(at)
      const observation = observationAt(r.timeline, r.gates, r.graph, real)
      if (seek) {
        replayWorldRef.current = createWorld(r.map, observation)
        setCallouts([])
      } else {
        const events = diffObservation(replayPrevRef.current, observation)
        replayWorldRef.current = direct(replayWorldRef.current as World, events, real)
        announce(events, labelsNow ?? {})
      }
      replayPrevRef.current = observation
      const next = { ...r, pos: at, observation, playing: r.playing && at < r.clock.duration }
      replayRef.current = next
      setReplay(next)
    },
    [announce, labelsNow]
  )

  const setReplayWith = (change: Partial<Replay>): void => {
    const r = replayRef.current
    if (r === null) return
    const next = { ...r, ...change }
    replayRef.current = next
    setReplay(next)
  }

  const leaveReplay = (): void => {
    replayRef.current = null
    replayWorldRef.current = null
    setCallouts([])
    setReplay(null)
  }

  const replayPlaying = replay?.playing ?? false
  useEffect(() => {
    if (!replayPlaying) return
    const timer = setInterval(() => {
      const r = replayRef.current
      if (r !== null) moveReplay(r.pos + REPLAY_STEP_MS * r.speed, false)
    }, REPLAY_STEP_MS)
    return () => clearInterval(timer)
  }, [replayPlaying, moveReplay])

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
  // In a replay the hall shows the recording; everything else is the run now.
  const shownMap = replay?.map ?? map
  const shownGraph = replay?.observation.graph ?? view.graph
  const shownWorldRef = (
    replay === null ? worldRef : replayWorldRef
  ) as React.MutableRefObject<World>
  const orphaned = new Set(replay === null ? (view.orphaned ?? []) : [])
  const interruptions = interruptionsFor({
    graph: shownGraph,
    waiting: replay?.observation.waiting ?? view.waiting ?? [],
    stranded: replay === null ? (view.stranded ?? []) : [],
    pending: replay === null ? pending : [],
  })
  const flaggedNodes = new Set(interruptions.map((i) => i.nodeId))
  const states: Record<string, NodeState> = {}
  for (const n of shownGraph.nodes) states[n.id] = n.state
  const selectedNode =
    selected === null ? null : (view.graph.nodes.find((n) => n.id === selected) ?? null)

  return (
    <div className="fdry-hall-shell">
      <div
        className="fdry-hall-frame"
        style={
          {
            aspectRatio: `${shownMap.width} / ${shownMap.height}`,
            '--fdry-hall-aspect': shownMap.width / shownMap.height,
          } as React.CSSProperties
        }
      >
        <HallScene
          map={shownMap}
          worldRef={shownWorldRef}
          states={states}
          speed={replay?.speed ?? 1}
          metrics={
            orderMetrics === null
              ? null
              : {
                  leadTimeMs: orderMetrics.leadTimeMs,
                  reworks: orderMetrics.reworks,
                  ciRounds: orderMetrics.ciRounds,
                }
          }
        />

        <div className="fdry-hall-overlay">
          {shownMap.props
            .filter((prop) => prop.nodeId !== null)
            .map((prop) => {
              const node = shownGraph.nodes.find((n) => n.id === prop.nodeId)
              if (node === undefined) return null
              const label = labels[node.id] ?? node.id
              const gone = orphaned.has(node.id)
              return (
                <React.Fragment key={prop.id}>
                  <button
                    type="button"
                    className="fdry-hall-station"
                    title={label}
                    style={stationStyle(shownMap, prop)}
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
                      left: `${anchorOf(shownMap, node.id).left}%`,
                      top: `${anchorOf(shownMap, node.id).top}%`,
                      // Neighbouring stations are one column pitch apart; a
                      // plate wider than that runs into the next one's.
                      maxWidth: `${(PLATE_COLUMNS / shownMap.width) * 100}%`,
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

          {callouts.map((c, index) => {
            const at = anchorOf(shownMap, c.nodeId)
            // Neighbouring stations raise callouts into the same air; each one
            // stacks above the earlier ones near it instead of covering them.
            const stack = callouts.slice(0, index).filter((other) => {
              const there = anchorOf(shownMap, other.nodeId)
              return (
                Math.abs(there.left - at.left) < CALLOUT_NEAR && Math.abs(there.top - at.top) < 1
              )
            }).length
            return (
              <div
                key={c.id}
                className="fdry-callout"
                data-tone={c.tone}
                aria-hidden="true"
                style={
                  {
                    left: `${at.left}%`,
                    top: `${at.top}%`,
                    '--fdry-stack': stack,
                  } as React.CSSProperties
                }
              >
                {c.text}
              </div>
            )
          })}

          {interruptions.map((item) => (
            <InterruptionCard
              key={`${item.kind}:${item.id}`}
              item={item}
              anchor={anchorOf(shownMap, item.nodeId)}
              flip={anchorOf(shownMap, item.nodeId).top < (CARD_FLIP_ROW / shownMap.height) * 100}
              readOnly={replay !== null}
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
          shownGraph={shownGraph}
          replaying={replay !== null}
          waitingCount={interruptions.length}
          note={replayNote}
          onBack={onBack}
          onReplay={() => void startReplay()}
          onOpenInbox={onOpenInbox}
          onOpenInList={onOpenInList}
        />

        {replay === null ? null : (
          <div className="fdry-replay" role="group" aria-label="Replay">
            <button
              type="button"
              className="fdry-hall-btn is-primary"
              aria-label={replay.playing ? 'Pause' : 'Play'}
              onClick={() =>
                replay.playing
                  ? setReplayWith({ playing: false })
                  : replay.pos >= replay.clock.duration
                    ? (moveReplay(0, true), setReplayWith({ playing: true }))
                    : setReplayWith({ playing: true })
              }
            >
              {replay.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            </button>
            <input
              type="range"
              className="fdry-replay__track"
              aria-label="Replay position"
              min={0}
              max={Math.max(replay.clock.duration, 1)}
              step={REPLAY_STEP_MS}
              value={replay.pos}
              onChange={(e) => moveReplay(Number(e.currentTarget.value), true)}
            />
            <span className="fdry-replay__time">
              {clockText(replay.pos)} / {clockText(replay.clock.duration)}
            </span>
            <span className="fdry-replay__speeds">
              {REPLAY_SPEEDS.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  className="fdry-hall-btn"
                  aria-pressed={replay.speed === speed}
                  onClick={() => setReplayWith({ speed })}
                >
                  {speed}x
                </button>
              ))}
            </span>
            <span className="fdry-replay__at">
              {new Date(replay.clock.toReal(replay.pos)).toLocaleTimeString()}
            </span>
            <button type="button" className="fdry-hall-btn" onClick={leaveReplay}>
              <Radio aria-hidden="true" /> Back to live
            </button>
          </div>
        )}

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
  /** The graph on show: the run now, or the moment a replay stands at. */
  readonly shownGraph: RunGraph
  readonly replaying: boolean
  readonly waitingCount: number
  readonly note: string | null
  readonly onBack: () => void
  readonly onReplay: () => void
  readonly onOpenInbox: () => void
  readonly onOpenInList: () => void
}

/** The order's own status, on the hall's top edge rather than above or below it. */
function HallHud({
  view,
  shownGraph,
  replaying,
  waitingCount,
  note,
  onBack,
  onReplay,
  onOpenInbox,
  onOpenInList,
}: HallHudProps): JSX.Element {
  const standing = replaying ? undefined : view.standing
  const finished = (s: NodeState): boolean => s === 'passed' || s === 'skipped'
  const done = standing?.done ?? shownGraph.nodes.filter((n) => finished(n.state)).length
  const total = standing?.total ?? shownGraph.nodes.length
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
      {replaying ? (
        <span className="fdry-hall-hud__tag">Replay</span>
      ) : (
        <button type="button" className="fdry-hall-btn" onClick={onReplay}>
          <History aria-hidden="true" /> Replay
        </button>
      )}
      {note !== null ? <span className="fdry-hall-hud__note">{note}</span> : null}
      {!replaying && waitingCount > 0 ? (
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
  /** A replayed wait: shown where it happened, with nothing left to answer. */
  readonly readOnly: boolean
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
  readOnly,
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
      <p className="fdry-card__detail">
        {item.kind === 'ask' && item.prose ? <MarkdownInline text={item.detail} /> : item.detail}
      </p>
      {problem !== null ? <p className="fdry-card__problem">{problem}</p> : null}
      {readOnly ? (
        <p className="fdry-card__history">Waited on you here.</p>
      ) : (
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
      )}
    </div>
  )
}
