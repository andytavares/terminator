import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { ArrowLeft, History, Pause, Play, Radio, ShieldQuestion, Terminal } from 'lucide-react'
import { useRunObservation } from '../../renderer/use-run-observation.js'
import type { FloorView, PendingAsk } from '../../renderer/use-run-observation.js'
import { layoutHall, TILE_PX } from '../../factory/layout.js'
import type { HallMap, HallProp } from '../../factory/layout.js'
import { createWorld } from '../../factory/sim.js'
import type { World } from '../../factory/sim.js'
import { diffObservation, describeEvent } from '../../factory/events.js'
import { hallSigns } from '../../factory/signs.js'
import type { HallSign } from '../../factory/signs.js'
import { stepFacts } from '../../factory/step-facts.js'
import type { FactoryEvent, Observation } from '../../factory/events.js'
import { direct } from '../../factory/director.js'
import { createLiveHall, statesOf } from '../../factory/live-hall.js'
import type { LiveHall } from '../../factory/live-hall.js'
import type { CiState } from '../../line/ci-state.js'
import { createBeats, release, schedule } from '../../factory/beats.js'
import type { Beats } from '../../factory/beats.js'
import {
  calloutLevels,
  calloutsFor,
  ciWaitingCallout,
  interruptionsFor,
  stateWord,
} from '../../factory/callouts.js'
import type { Callout, CalloutBox, Interruption } from '../../factory/callouts.js'
import { momentsOf, observationAt, replayClock } from '../../factory/replay.js'
import type { ReplayClock, Timeline } from '../../factory/replay.js'
import type { Gate } from '../../gates/rules.js'
import type { OrderMetrics } from '../../factory/metrics.js'
import { HallScene } from './HallScene.js'
import { StationMonitor } from './StationMonitor.js'
import type { MonitorStatus } from './StationMonitor.js'
import type { NodeState, RunGraph } from '../../line/run-graph.js'
import type { ToolActivity } from '../../runtime/transcript-tailer.js'
import type { TranscriptLine } from '../../runtime/transcript-excerpt.js'
import { openInBrowser } from '@terminator/extension-sdk/renderer'
import { attachTo } from '../../renderer/attach-to-step.js'
import { GateCard } from '../GateCard.js'
import { OpenDocumentButton, OrderLinks } from '../OrderLinks.js'
import type { DocumentLink } from '../../line/document-kind.js'
import { Markdown, usePolling, everyWhileVisible } from '@terminator/extension-ui'
import { usePushed, ANY_RECORD } from '../../renderer/use-pushed.js'
import './hall.css'
import { invoke } from '@terminator/extension-sdk/renderer'

/** Half of a gate card's width, `min(360px, 60%)`, plus 16px to the scene's edge. */
const GATE_CARD_INSET = 'calc(min(180px, 30%) + 16px)'

// One order, drawn as a hall instead of a list of chips.
//
// This is a projection: it owns no state a poll did not put there. `World`
// only ever moves because `direct` was handed a `FactoryEvent` — never
// because a station looked animatable — which is what keeps the hall honest
// about a run it is not itself running.
//
// Everything the hall has to say is said inside it: the station names are
// stencilled on its floor, a callout rising from the station where something happened, and a
// card pinned over the station that is waiting on you, answerable in place.

export interface FactoryHallProps {
  readonly orderId: string
  /** Where an order's own controls live — resume, stop, a held call. */
  readonly onOpenInList: () => void
  readonly onBack: () => void
}

/** Same cadence as the run observation, so a tool call lands within one beat of it. */
const ACTIVITY_POLL_MS = 2000

/** How much of an open station's transcript its monitor keeps on screen. */
const MONITOR_LINES = 40
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
  /** What each station is showing: the states the beat scheduler has released so far. */
  readonly shown: Readonly<Record<string, NodeState>>
  /** The refinery queue the replayed world is standing in. */
  readonly queue: World['queue']
}

/** How often held beats are looked at, between polls. */
const BEAT_CHECK_MS = 200

function clockText(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Pixels between a station's top edge and a callout's tail on the ground level. */
const CALLOUT_BASE_PX = 30
/** Pixels each level of a callout stack lifts it: a callout's height, plus air. */
const CALLOUT_PITCH_PX = 26

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

export function FactoryHall({ orderId, onOpenInList, onBack }: FactoryHallProps): JSX.Element {
  // The overlay the callouts are measured in. Held here, apart from the rest
  // of the hall, so that what the parts draw from is never a ref.
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const hall = useFactoryHall(orderId, overlayRef)
  const { view, problem } = hall.observed
  const map = hall.live.map
  if (problem !== null && view === null) return <p className="fdry-note">{problem}</p>
  if (view === null || map === null) {
    return <div className="fdry-empty">Loading the hall{'…'}</div>
  }
  const model = hallModel(hall, { view, map })
  return (
    <HallStage hall={hall} model={model} nav={{ onBack, onOpenInList }} overlayRef={overlayRef} />
  )
}

type Activity = Readonly<Record<string, readonly ToolActivity[]>>
type Labels = Readonly<Record<string, string>>

/** Everything the hall keeps, with its hooks and effects in the order they ran. */
function useFactoryHall(orderId: string, overlayRef: OverlayRef) {
  const observed = useRunObservation(orderId)
  const [activity, setActivity] = useState<Activity>({})
  const rp = useReplayState()
  const { liveHall, live } = useLiveStore()
  const orderMetrics = useOrderMetrics(orderId)
  const talk = useCallouts()
  useLiveFeed(liveHall, {
    view: observed.view,
    activity,
    announce: talk.announce,
    replayRef: rp.refs.replayRef,
  })
  const replay = useReplay(orderId, { labels: observed.view?.labels, talk, refs: rp.refs })
  usePlayback(rp.replay?.playing ?? false, { moveReplay: replay.moveReplay, refs: rp.refs })
  const shownCi = (rp.replay === null ? observed.view?.ci : rp.replay.observation.ci) ?? null
  const liveMap = rp.replay?.map ?? live.map
  const layout = useCalloutLayout({ liveMap, shownCi, talk, overlayRef })
  const station = useStation(orderId, { view: observed.view, setActivity })
  const answers = useAnswers(observed.refresh)
  const parts = { orderId, observed, rp, liveHall, live, orderMetrics, talk, replay }
  return { ...parts, shownCi, layout, station, answers }
}

type Hall = ReturnType<typeof useFactoryHall>

// The replay on show, what it last said and its own world's refs, beside the live
// one: live polling carries on under a replay, so leaving it lands on the run as it
// is now. `refs` keeps one identity for the life of the hall.
function useReplayState() {
  const [replay, setReplay] = useState<Replay | null>(null)
  const [replayNote, setReplayNote] = useState<string | null>(null)
  const replayRef = useRef<Replay | null>(null)
  const replayWorldRef = useRef<World | null>(null)
  const replayPrevRef = useRef<Observation | null>(null)
  const replayBeatsRef = useRef<Beats | null>(null)
  const refs = useMemo(
    () => ({ replayRef, replayWorldRef, replayPrevRef, replayBeatsRef, setReplay, setReplayNote }),
    []
  )
  return { replay, replayNote, refs }
}

type ReplayRefs = ReturnType<typeof useReplayState>['refs']

/** The live world and its beats live outside React; a render reads only what it draws. */
function useLiveStore() {
  const [liveHall] = useState(createLiveHall)
  const live = useSyncExternalStore(liveHall.subscribe, liveHall.snapshot)
  return { liveHall, live }
}

/** This order's numbers from the factory's metrics; undefined when they could not be read. */
async function readOrderMetrics(orderId: string): Promise<OrderMetrics | null | undefined> {
  const r = (await invoke('foundry:factory.metrics', { window: 'all' })) as {
    orders?: OrderMetrics[]
    error?: string
  }
  if (r.error !== undefined) return undefined
  return r.orders?.find((o) => o.orderId === orderId) ?? null
}

/** The order's numbers for the status wall, read again when any record of it changes. */
function useOrderMetrics(orderId: string): OrderMetrics | null {
  const [orderMetrics, setOrderMetrics] = useState<OrderMetrics | null>(null)
  const read = useCallback(() => readOrderMetrics(orderId), [orderId])
  const show = useCallback((read: OrderMetrics | null | undefined) => {
    if (read !== undefined) setOrderMetrics(read)
  }, [])
  usePushed(read, show, { kinds: ANY_RECORD, orderId })
  return orderMetrics
}

/** The callouts raised at their stations, how high each is stacked, and the sentence for a screen reader. */
function useCallouts() {
  const [callouts, setCallouts] = useState<readonly Callout[]>([])
  const [calloutLift, setCalloutLift] = useState<Readonly<Record<string, number>>>({})
  const [spoken, setSpoken] = useState('')
  // Risen callouts leave on their own; nothing has to happen for them to go.
  useEffect(() => {
    if (callouts.length === 0) return
    return everyWhileVisible(() => {
      const now = Date.now()
      setCallouts((live) => live.filter((c) => now - c.at < CALLOUT_MS))
    }, 500)
  }, [callouts.length])
  // What a batch of events says: callouts at their stations, and one sentence
  // for a screen reader. Live polls and a playing replay both come through here.
  const announce = useCallback((events: readonly FactoryEvent[], labels: Labels) => {
    if (events.length === 0) return
    const now = Date.now()
    const raised = calloutsFor(events, labels, now)
    if (raised.length > 0) {
      const owners = new Set(raised.map((c) => c.nodeId))
      setCallouts((live) => [...live.filter((c) => !owners.has(c.nodeId)), ...raised])
    }
    setSpoken(events.map((event) => describeEvent(event, labels)).join(' '))
  }, [])
  return { callouts, setCallouts, calloutLift, setCalloutLift, spoken, announce }
}

type Talk = ReturnType<typeof useCallouts>

/** What the live hall is handed: the run as observed, with the tool activity polled beside it. */
function observationOf(view: FloorView, activity: Activity): Observation {
  return {
    graph: view.graph,
    orphaned: view.orphaned ?? [],
    stranded: view.stranded ?? [],
    waiting: view.waiting ?? [],
    activity,
    ci: view.ci ?? null,
    queue: view.queue ?? null,
  }
}

interface LiveFeedDeps {
  readonly view: FloorView | null
  readonly activity: Activity
  readonly announce: Talk['announce']
  readonly replayRef: React.MutableRefObject<Replay | null>
}

function useLiveFeed(liveHall: LiveHall, { view, activity, announce, replayRef }: LiveFeedDeps) {
  useEffect(
    () =>
      liveHall.onEvents((events, eventLabels) => {
        // A replay has the stage; live events still move the live world, silently.
        if (replayRef.current === null) announce(events, eventLabels)
      }),
    [liveHall, announce, replayRef]
  )
  // The one place the live hall gets an observation: every poll, event or not, with
  // a real clock, since a call held open crosses its walking threshold on a quiet poll.
  useEffect(() => {
    if (view === null) return
    liveHall.observe(observationOf(view, activity), view.labels ?? {}, Date.now())
  }, [liveHall, view, activity])
  // A held beat comes due with no poll to carry it.
  const liveLabels = view?.labels
  useEffect(() => {
    return everyWhileVisible(() => liveHall.releaseDue(liveLabels ?? {}, Date.now()), BEAT_CHECK_MS)
  }, [liveHall, liveLabels])
}

interface Recording {
  readonly graph: RunGraph
  readonly timeline: Timeline
  readonly gates: readonly Gate[]
}

/** The run as recorded; null when nothing was. */
async function readRecording(orderId: string): Promise<Recording | null> {
  const r = (await invoke('foundry:run.timeline', { id: orderId })) as {
    graph?: RunGraph
    timeline?: Timeline
    gates?: Gate[]
    error?: string
  }
  if (r.graph === undefined || r.timeline === undefined || r.timeline.frames.length === 0) {
    return null
  }
  return { graph: r.graph, timeline: r.timeline, gates: r.gates ?? [] }
}

/** A replay of `recording` from its start, with its world and beats set in `refs`. */
function beginReplay(
  recording: Recording,
  { labels, refs }: { labels: Labels; refs: ReplayRefs }
): Replay {
  const { graph, timeline, gates } = recording
  const clock = replayClock(momentsOf(timeline, gates), REPLAY_MAX_GAP_MS)
  const observation = observationAt({ timeline, gates, base: graph }, clock.toReal(0))
  // A recording that wrote CI down has a tower to wait at.
  const map = layoutHall(graph, labels, (timeline.ci?.length ?? 0) > 0)
  const world = createWorld(map, observation)
  const beats = createBeats(statesOf(observation.graph))
  refs.replayWorldRef.current = world
  refs.replayPrevRef.current = observation
  refs.replayBeatsRef.current = beats
  const start = { pos: 0, playing: true, speed: 1 as const }
  return {
    graph,
    timeline,
    gates,
    map,
    clock,
    ...start,
    observation,
    shown: beats.shown,
    queue: world.queue,
  }
}

/** Puts `next` on show. */
function showReplay(refs: ReplayRefs, next: Replay): void {
  refs.replayRef.current = next
  refs.setReplay(next)
}

/** Changes the replay on show, if there is one. */
function patchReplay(refs: ReplayRefs, change: Partial<Replay>): void {
  const r = refs.replayRef.current
  if (r === null) return
  showReplay(refs, { ...r, ...change })
}

/** Back to the run as it is now. */
function leaveReplay(refs: ReplayRefs, setCallouts: Talk['setCallouts']): void {
  refs.replayRef.current = null
  refs.replayWorldRef.current = null
  refs.replayBeatsRef.current = null
  setCallouts([])
  refs.setReplay(null)
}

/** Rebuilds the replayed hall settled at `observation`, as a hall opened then would have been. */
function settleReplay(r: Replay, observation: Observation, refs: ReplayRefs): void {
  refs.replayWorldRef.current = createWorld(r.map, observation)
  refs.replayBeatsRef.current = createBeats(statesOf(observation.graph))
}

// Plays the replay forward to `observation` at replay time `at`, through the same
// diff and director as a live poll; the events that came due.
function playReplay(
  r: Replay,
  [observation, at]: readonly [Observation, number],
  refs: ReplayRefs
): readonly FactoryEvent[] {
  const real = r.clock.toReal(at)
  const seen = diffObservation(refs.replayPrevRef.current, observation)
  const held = schedule(
    refs.replayBeatsRef.current as Beats,
    { events: seen, nodes: r.graph.nodes },
    real
  )
  // The recording's end shows everything still held rather than cutting it off.
  const { beats, events } = release(held, at >= r.clock.duration ? Infinity : real)
  refs.replayBeatsRef.current = beats
  refs.replayWorldRef.current = direct(refs.replayWorldRef.current as World, events, real)
  return events
}

interface ReplayMove {
  readonly at: number
  readonly seek: boolean
  readonly refs: ReplayRefs
}

/** The replay moved to `at`, and what playing there said; null for a seek, which says nothing. */
function replayTo(
  r: Replay,
  { at, seek, refs }: ReplayMove
): { readonly next: Replay; readonly events: readonly FactoryEvent[] | null } {
  const observation = observationAt(
    { timeline: r.timeline, gates: r.gates, base: r.graph },
    r.clock.toReal(at)
  )
  let events: readonly FactoryEvent[] | null = null
  if (seek) settleReplay(r, observation, refs)
  else events = playReplay(r, [observation, at], refs)
  refs.replayPrevRef.current = observation
  const next: Replay = {
    ...r,
    pos: at,
    observation,
    shown: (refs.replayBeatsRef.current as Beats).shown,
    queue: (refs.replayWorldRef.current as World).queue,
    playing: r.playing && at < r.clock.duration,
  }
  return { next, events }
}

interface ReplayDeps {
  readonly labels: Labels | undefined
  readonly talk: Talk
  readonly refs: ReplayRefs
}

/** Starting a replay, and moving one: a seek rebuilds the hall, playing forward animates it. */
function useReplay(orderId: string, { labels, talk, refs }: ReplayDeps) {
  const { announce, setCallouts } = talk
  const startReplay = useCallback(async () => {
    refs.setReplayNote(null)
    const recording = await readRecording(orderId)
    if (recording === null) {
      refs.setReplayNote('Nothing recorded for this run yet.')
      return
    }
    const next = beginReplay(recording, { labels: labels ?? {}, refs })
    setCallouts([])
    showReplay(refs, next)
  }, [orderId, labels, refs, setCallouts])
  const moveReplay = useCallback(
    (pos: number, seek: boolean) => {
      const r = refs.replayRef.current
      if (r === null) return
      const at = Math.min(Math.max(pos, 0), r.clock.duration)
      const { next, events } = replayTo(r, { at, seek, refs })
      if (events === null) setCallouts([])
      else announce(events, labels ?? {})
      showReplay(refs, next)
    },
    [announce, labels, refs, setCallouts]
  )
  return { startReplay, moveReplay }
}

type ReplayMoves = ReturnType<typeof useReplay>

/** A playing replay advances on its own. */
function usePlayback(
  playing: boolean,
  { moveReplay, refs }: { moveReplay: ReplayMoves['moveReplay']; refs: ReplayRefs }
): void {
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      const r = refs.replayRef.current
      if (r !== null) moveReplay(r.pos + REPLAY_STEP_MS * r.speed, false)
    }, REPLAY_STEP_MS)
    return () => clearInterval(timer)
  }, [playing, moveReplay, refs])
}

/** Where each callout would sit on the ground, measured on the laid-out page. */
function calloutBoxes(
  overlay: HTMLElement,
  { map, callouts }: { map: HallMap; callouts: readonly Callout[] }
): CalloutBox[] {
  const width = overlay.clientWidth
  const height = overlay.clientHeight
  const raised = new Map(
    [...overlay.querySelectorAll<HTMLElement>('[data-callout-id]')].map((el) => [
      el.dataset.calloutId,
      el,
    ])
  )
  return callouts.map((c) => {
    const el = raised.get(c.id)
    const at = anchorOf(map, c.nodeId)
    const x = (at.left / 100) * width
    const y = (at.top / 100) * height
    return {
      id: c.id,
      x,
      y: y - CALLOUT_BASE_PX,
      w: el?.offsetWidth ?? 0,
      h: el?.offsetHeight ?? 0,
    }
  })
}

/** `kept` when `next` says the same, so an unchanged stack does not render again. */
function sameOrNext(
  kept: Readonly<Record<string, number>>,
  next: Readonly<Record<string, number>>
): Readonly<Record<string, number>> {
  const same =
    Object.keys(next).length === Object.keys(kept).length &&
    Object.entries(next).every(([id, level]) => kept[id] === level)
  return same ? kept : next
}

type OverlayRef = React.MutableRefObject<HTMLDivElement | null>

interface LayoutDeps {
  readonly overlayRef: OverlayRef
  readonly liveMap: HallMap | null
  readonly shownCi: CiState | null
  readonly talk: Talk
}

// Callouts are sized by their text, so only the laid-out page knows which overlap.
// Measured before paint, so a callout is never seen at the level it is leaving.
function useCalloutLayout({ liveMap, shownCi, talk, overlayRef }: LayoutDeps) {
  const { callouts, setCalloutLift } = talk
  // Pinned to the tower while any check is pending; stacked like a raised one.
  const pinnedWait = useMemo(() => ciWaitingCallout(shownCi), [shownCi])
  useLayoutEffect(() => {
    const overlay = overlayRef.current
    if (overlay === null || liveMap === null) return
    const everything = pinnedWait === null ? callouts : [pinnedWait, ...callouts]
    const boxes = calloutBoxes(overlay, { map: liveMap, callouts: everything })
    setCalloutLift((kept) =>
      sameOrNext(kept, calloutLevels(boxes, { obstacles: [], kept }, CALLOUT_PITCH_PX))
    )
  }, [callouts, liveMap, pinnedWait, setCalloutLift, overlayRef])
  return { pinnedWait }
}

async function readActivity(orderId: string): Promise<Activity | null> {
  const r = (await invoke('foundry:run.activity', { id: orderId })) as {
    activity?: Record<string, readonly ToolActivity[]>
    error?: string
  }
  return r.error === undefined ? (r.activity ?? {}) : null
}

/** The open station's transcript; null when no station with a session is open. */
async function readStationLines(sessionId: string | null): Promise<TranscriptLine[] | null> {
  if (sessionId === null) return null
  const r = (await invoke('foundry:run-transcript', {
    sessionId,
    limit: MONITOR_LINES,
  })) as { lines?: TranscriptLine[] }
  return r.lines ?? []
}

interface AgentWordsDeps {
  readonly selectedSessionId: string | null
  readonly setActivity: (activity: Activity) => void
  readonly setTranscript: (lines: TranscriptLine[]) => void
}

// The one poll left on this view: tool activity and a station's transcript come from
// the agents' transcript files, which nothing Foundry writes announces. An open
// station's transcript is read with the activity, only while it stays open.
function useAgentWords(orderId: string, deps: AgentWordsDeps): void {
  const { selectedSessionId, setActivity, setTranscript } = deps
  const readTranscript = useCallback(() => readStationLines(selectedSessionId), [selectedSessionId])
  const readAgentWords = useCallback(
    async () => ({ activity: await readActivity(orderId), lines: await readTranscript() }),
    [orderId, readTranscript]
  )
  const showAgentWords = useCallback(
    (read: { activity: Activity | null; lines: TranscriptLine[] | null }) => {
      if (read.activity !== null) setActivity(read.activity)
      if (read.lines !== null) setTranscript(read.lines)
    },
    [setActivity, setTranscript]
  )
  usePolling(readAgentWords, showAgentWords, ACTIVITY_POLL_MS)
}

/** A station opened on another session starts with an empty transcript. */
function useForgetTranscript(
  selectedSessionId: string | null,
  setTranscript: (lines: TranscriptLine[]) => void
): void {
  const [transcriptFor, setTranscriptFor] = useState(selectedSessionId)
  if (transcriptFor !== selectedSessionId) {
    setTranscriptFor(selectedSessionId)
    setTranscript([])
  }
}

function sessionOf(view: FloorView | null, selected: string | null): string | null {
  if (selected === null) return null
  return view?.graph.nodes.find((n) => n.id === selected)?.sessionId ?? null
}

interface StationDeps {
  readonly view: FloorView | null
  readonly setActivity: (activity: Activity) => void
}

/** The station open on its monitor, what its agent is saying, and attaching to it. */
function useStation(orderId: string, { view, setActivity }: StationDeps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [attachProblem, setAttachProblem] = useState<string | null>(null)
  const selectedSessionId = sessionOf(view, selected)
  useAgentWords(orderId, { selectedSessionId, setActivity, setTranscript })
  useForgetTranscript(selectedSessionId, setTranscript)
  const openStation = useCallback((nodeId: string) => {
    setSelected(nodeId)
    setAttachProblem(null)
  }, [])
  const attach = useCallback(
    async (nodeId: string) => {
      const trouble = await attachTo(orderId, nodeId)
      if (trouble !== null) setAttachProblem(trouble)
    },
    [orderId]
  )
  return { selected, setSelected, transcript, attachProblem, openStation, attach }
}

/** Answers use the Floor's and the Inbox's channels; a refusal shows on its card. */
function useAnswers(refresh: () => Promise<void>) {
  const [answerProblem, setAnswerProblem] = useState<Readonly<Record<string, string>>>({})
  const [busy, setBusy] = useState<string | null>(null)
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
  return { answerProblem, busy, answer }
}

/** Allows or denies a held call; why not, when it is no longer waiting. */
function askResolved(requestId: string, decision: 'allow' | 'deny') {
  return async (): Promise<string | null> => {
    const r = (await invoke('foundry:permission-resolve', { requestId, decision })) as {
      ok?: boolean
      reason?: string
    }
    return r.ok === true ? null : (r.reason ?? 'That request is no longer waiting.')
  }
}

/** Answers a gate; why not, when it was refused. */
function gateDecided(gateId: string, [option, limit]: readonly [string, (number | null)?]) {
  return async (): Promise<string | null> => {
    const payload = limit === undefined ? { gateId, option } : { gateId, option, limit }
    const r = (await invoke('foundry:inbox.decide', payload)) as { error?: string }
    return r.error ?? null
  }
}

/** Goes to an agent's terminal; why not, when it has none. */
function terminalOpened(sessionId: string) {
  return async (): Promise<string | null> => {
    const r = (await invoke('foundry:run-terminal', { sessionId })) as { ok?: boolean }
    return r.ok === true ? null : 'That agent is no longer in a terminal.'
  }
}

interface LiveSight {
  readonly view: FloorView
  readonly map: HallMap
}

/** In a replay the hall shows the recording; everything else is the run now. */
function shownOf(hall: Hall, { view, map }: LiveSight) {
  const { replay } = hall.rp
  return {
    view,
    replay,
    labels: view.labels ?? {},
    map: replay?.map ?? map,
    graph: replay?.observation.graph ?? view.graph,
    worldRef: (replay === null
      ? hall.liveHall.world
      : hall.rp.refs.replayWorldRef) as React.MutableRefObject<World>,
  }
}

/** What is waiting on you in what is on show; a replay's past waits only, and nothing to answer. */
function waitsOf(hall: Hall, view: FloorView) {
  const { replay } = hall.rp
  const live = replay === null
  return {
    orphaned: new Set(live ? (view.orphaned ?? []) : []),
    waiting: replay?.observation.waiting ?? view.waiting ?? [],
    stranded: live ? (view.stranded ?? []) : [],
    pending: live ? hall.observed.pending : [],
  }
}

/** What each station shows: what the beat scheduler has released, not the raw graph. */
function shownStatesOf(hall: Hall, graph: RunGraph): Record<string, NodeState> {
  const { replay } = hall.rp
  const shownStates = replay === null ? hall.live.shown : replay.shown
  const states: Record<string, NodeState> = {}
  for (const n of graph.nodes) states[n.id] = shownStates[n.id] ?? n.state
  return states
}

type HallNode = RunGraph['nodes'][number]

function monitorStatusOf(
  node: HallNode | null,
  { flagged, orphaned }: { flagged: ReadonlySet<string | null>; orphaned: ReadonlySet<string> }
): MonitorStatus {
  if (node === null) return 'idle'
  if (flagged.has(node.id)) return 'waiting'
  if (orphaned.has(node.id)) return 'gone'
  if (node.state === 'failed' || node.state === 'blocked') return 'failed'
  return node.state === 'running' ? 'running' : 'idle'
}

interface AlertFacts {
  readonly interruptions: readonly Interruption[]
  readonly node: HallNode | null
  readonly standing: FloorView['standing']
}

function monitorAlertOf(status: MonitorStatus, { interruptions, node, standing }: AlertFacts) {
  if (status === 'waiting') {
    return `WAITING FOR YOU: ${interruptions.find((i) => i.nodeId === node?.id)?.title ?? ''}`
      .trim()
      .toUpperCase()
  }
  if (status !== 'failed') return null
  return (standing === undefined ? 'FAILED' : `FAILED: ${standing.headline}`).toUpperCase()
}

function metricsOf(orderMetrics: OrderMetrics | null) {
  if (orderMetrics === null) return null
  const { leadTimeMs, reworks, ciRounds } = orderMetrics
  return { leadTimeMs, reworks, ciRounds }
}

function signsOf(hall: Hall, map: HallMap, labels: Labels): readonly HallSign[] {
  const { replay } = hall.rp
  const { shownCi } = hall
  const ciChecks = Object.fromEntries(
    (shownCi?.pulls ?? []).flatMap((pull) => pull.checks.map((c) => [c.name, c.bucket] as const))
  )
  return hallSigns(map, {
    labels,
    metrics: metricsOf(hall.orderMetrics),
    queue: replay === null ? hall.live.queue : replay.queue,
    ci: shownCi === null ? null : { checks: ciChecks },
  })
}

interface FactsFor {
  readonly shown: ReturnType<typeof shownOf>
  readonly waiting: readonly Gate[]
}

function monitorFactsOf(hall: Hall, node: HallNode | null, { shown, waiting }: FactsFor) {
  if (node === null) return null
  return stepFacts({
    node,
    graph: shown.graph,
    labels: shown.labels,
    pulls: shown.view.pulls,
    ci: hall.shownCi,
    waiting,
  })
}

/** Everything the hall draws, from what it keeps and the run as it stands. */
function hallModel(hall: Hall, sight: LiveSight) {
  const shown = shownOf(hall, sight)
  const waits = waitsOf(hall, sight.view)
  const interruptions = interruptionsFor({ graph: shown.graph, ...waits })
  const flaggedNodes = new Set(interruptions.map((i) => i.nodeId))
  const node = selectedNodeOf(sight.view, hall.station.selected)
  const monitorStatus = monitorStatusOf(node, { flagged: flaggedNodes, orphaned: waits.orphaned })
  const monitorFacts = monitorFactsOf(hall, node, { shown, waiting: waits.waiting })
  return {
    ...shown,
    orphaned: waits.orphaned,
    interruptions,
    flaggedNodes,
    states: shownStatesOf(hall, shown.graph),
    selectedNode: node,
    monitorStatus,
    monitorAlert: monitorAlertOf(monitorStatus, {
      interruptions,
      node,
      standing: sight.view.standing,
    }),
    signs: signsOf(hall, shown.map, shown.labels),
    monitorFacts,
    agentClosed: agentClosedOf(node, monitorFacts),
  }
}

function selectedNodeOf(view: FloorView, selected: string | null): HallNode | null {
  return selected === null ? null : (view.graph.nodes.find((n) => n.id === selected) ?? null)
}

/** An agent step that has finished has closed its agent; there is nothing to attach to. */
function agentClosedOf(node: HallNode | null, facts: unknown): boolean {
  return node !== null && facts === null && (node.state === 'passed' || node.state === 'skipped')
}

type HallModel = ReturnType<typeof hallModel>

interface StageProps {
  readonly hall: Hall
  readonly model: HallModel
}

interface Nav {
  readonly onBack: () => void
  readonly onOpenInList: () => void
}

interface OverlayProps extends StageProps {
  readonly overlayRef: OverlayRef
}

function HallStage({ hall, model, nav, overlayRef }: OverlayProps & { readonly nav: Nav }) {
  const { map } = model
  return (
    <div
      className="fdry-hall-shell"
      style={{ '--fdry-hall-aspect': map.width / map.height } as React.CSSProperties}
    >
      <HallHud
        view={model.view}
        shownGraph={model.graph}
        replaying={model.replay !== null}
        waitingCount={model.interruptions.length}
        note={hall.rp.replayNote}
        onBack={nav.onBack}
        onReplay={() => void hall.replay.startReplay()}
        onOpenInList={nav.onOpenInList}
      />
      <HallFrame hall={hall} model={model} overlayRef={overlayRef} />
      <p className="fdry-sr-only" aria-live="polite">
        {hall.talk.spoken}
      </p>
    </div>
  )
}

function HallFrame({ hall, model, overlayRef }: OverlayProps) {
  const { map, replay, selectedNode } = model
  return (
    <div className="fdry-hall-frame" style={{ aspectRatio: `${map.width} / ${map.height}` }}>
      <HallScene
        map={map}
        worldRef={model.worldRef}
        states={model.states}
        needsYou={[...model.flaggedNodes].filter((id): id is string => id !== null)}
        orphaned={[...model.orphaned]}
        speed={replay?.speed ?? 1}
        metrics={metricsOf(hall.orderMetrics)}
      />
      <HallOverlay hall={hall} model={model} overlayRef={overlayRef} />
      {replay === null ? null : <ReplayBar hall={hall} replay={replay} />}
      {selectedNode === null ? null : (
        <StationPanel hall={hall} model={model} node={selectedNode} />
      )}
    </div>
  )
}

function liftOf(hall: Hall, id: string): number {
  return CALLOUT_BASE_PX + (hall.talk.calloutLift[id] ?? 0) * CALLOUT_PITCH_PX
}

function HallOverlay({ hall, model, overlayRef }: OverlayProps) {
  const { map } = model
  const { pinnedWait } = hall.layout
  return (
    <div className="fdry-hall-overlay" ref={overlayRef}>
      {map.props
        .filter((prop) => prop.nodeId !== null)
        .map((prop) => (
          <StationButton key={prop.id} hall={hall} model={model} prop={prop} />
        ))}
      {hall.talk.callouts.map((c) => (
        <CalloutBubble key={c.id} callout={c} map={map} lift={liftOf(hall, c.id)} />
      ))}
      {pinnedWait === null ? null : (
        <CalloutBubble callout={pinnedWait} map={map} lift={liftOf(hall, pinnedWait.id)} pinned />
      )}
      {model.signs.map((sign) => (
        <HallSignLabel key={sign.id} sign={sign} map={map} />
      ))}
      {model.interruptions.map((item) => (
        <HallInterruption key={`${item.kind}:${item.id}`} hall={hall} model={model} item={item} />
      ))}
    </div>
  )
}

function StationButton({ hall, model, prop }: StageProps & { readonly prop: HallProp }) {
  const node = model.graph.nodes.find((n) => n.id === prop.nodeId)
  if (node === undefined) return null
  const label = model.labels[node.id] ?? node.id
  const standing = model.orphaned.has(node.id) ? 'no agent' : stateWord(node.state)
  return (
    <button
      type="button"
      className="fdry-hall-station"
      title={`${label} · ${standing}${node.attempts > 1 ? ` · try ${node.attempts}` : ''}`}
      style={stationStyle(model.map, prop)}
      aria-label={`${label}, ${node.role ?? 'unassigned'}, ${standing}, attempt ${node.attempts}`}
      onClick={() => hall.station.openStation(node.id)}
    >
      {model.flaggedNodes.has(node.id) ? (
        <span className="fdry-hall-flag" aria-hidden="true">
          <ShieldQuestion />
        </span>
      ) : null}
    </button>
  )
}

interface CalloutBubbleProps {
  readonly callout: Callout
  readonly map: HallMap
  readonly lift: number
  /** The CI wait, pinned to the tower rather than risen and gone. */
  readonly pinned?: boolean
}

function CalloutBubble({ callout, map, lift, pinned = false }: CalloutBubbleProps) {
  const at = anchorOf(map, callout.nodeId)
  return (
    <div
      className="fdry-callout"
      data-tone={callout.tone}
      data-pinned={pinned ? 'true' : undefined}
      data-callout-id={callout.id}
      aria-hidden="true"
      style={
        {
          left: `${at.left}%`,
          top: `${at.top}%`,
          '--fdry-lift': `${lift}px`,
        } as React.CSSProperties
      }
    >
      <span className="fdry-callout__text">{callout.text}</span>
    </div>
  )
}

/** The session an interruption's terminal is: the stranded agent's own, or the held call's. */
function terminalSessionOf(item: Interruption, pending: readonly PendingAsk[]): string {
  if (item.kind === 'stranded') return item.id
  return pending.find((p: PendingAsk) => p.requestId === item.id)?.sessionId ?? ''
}

function HallInterruption({ hall, model, item }: StageProps & { readonly item: Interruption }) {
  const { map, view } = model
  const { answer, busy, answerProblem } = hall.answers
  const anchor = anchorOf(map, item.nodeId)
  return (
    <InterruptionCard
      item={item}
      anchor={anchor}
      flip={anchor.top < (CARD_FLIP_ROW / map.height) * 100}
      readOnly={model.replay !== null}
      busy={busy === item.id}
      problem={answerProblem[item.id] ?? null}
      onAllow={() => void answer(item.id, askResolved(item.id, 'allow'))}
      onDeny={() => void answer(item.id, askResolved(item.id, 'deny'))}
      onDecide={(option, limit) => void answer(item.id, gateDecided(item.id, [option, limit]))}
      pulls={view.pulls}
      source={view.source}
      document={view.document}
      onTerminal={() =>
        void answer(item.id, terminalOpened(terminalSessionOf(item, hall.observed.pending)))
      }
    />
  )
}

/** Play or pause; at the end, playing starts again from the beginning. */
function togglePlay(hall: Hall, replay: Replay): void {
  const { refs } = hall.rp
  if (replay.playing) {
    patchReplay(refs, { playing: false })
    return
  }
  if (replay.pos >= replay.clock.duration) hall.replay.moveReplay(0, true)
  patchReplay(refs, { playing: true })
}

interface ReplayBarProps {
  readonly hall: Hall
  readonly replay: Replay
}

function ReplayBar({ hall, replay }: ReplayBarProps) {
  return (
    <div className="fdry-replay" role="group" aria-label="Replay">
      <button
        type="button"
        className="fdry-hall-btn is-primary"
        aria-label={replay.playing ? 'Pause' : 'Play'}
        onClick={() => togglePlay(hall, replay)}
      >
        {replay.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      </button>
      <ReplayTrack hall={hall} replay={replay} />
      <ReplaySpeeds hall={hall} replay={replay} />
      <span className="fdry-replay__at">
        {new Date(replay.clock.toReal(replay.pos)).toLocaleTimeString()}
      </span>
      <button
        type="button"
        className="fdry-hall-btn"
        onClick={() => leaveReplay(hall.rp.refs, hall.talk.setCallouts)}
      >
        <Radio aria-hidden="true" /> Back to live
      </button>
    </div>
  )
}

function ReplayTrack({ hall, replay }: ReplayBarProps) {
  return (
    <>
      <input
        type="range"
        className="fdry-replay__track"
        aria-label="Replay position"
        min={0}
        max={Math.max(replay.clock.duration, 1)}
        step={REPLAY_STEP_MS}
        value={replay.pos}
        onChange={(e) => hall.replay.moveReplay(Number(e.currentTarget.value), true)}
      />
      <span className="fdry-replay__time">
        {clockText(replay.pos)} / {clockText(replay.clock.duration)}
      </span>
    </>
  )
}

function ReplaySpeeds({ hall, replay }: ReplayBarProps) {
  return (
    <span className="fdry-replay__speeds">
      {REPLAY_SPEEDS.map((speed) => (
        <button
          key={speed}
          type="button"
          className="fdry-hall-btn"
          aria-pressed={replay.speed === speed}
          onClick={() => patchReplay(hall.rp.refs, { speed })}
        >
          {speed}x
        </button>
      ))}
    </span>
  )
}

function StationPanel({ hall, model, node }: StageProps & { readonly node: HallNode }) {
  const { station } = hall
  return (
    <StationMonitor
      node={node}
      label={model.labels[node.id] ?? node.id}
      sign={model.map.props.find((p) => p.nodeId === node.id)?.sign ?? null}
      orderId={hall.orderId}
      lines={station.transcript}
      status={model.monitorStatus}
      alert={model.monitorAlert}
      attachProblem={station.attachProblem}
      facts={model.monitorFacts}
      attachable={!model.agentClosed}
      onAttach={() => void station.attach(node.id)}
      onClose={() => station.setSelected(null)}
    />
  )
}

function AskButtons({
  busy,
  onAllow,
  onDeny,
  onTerminal,
}: Pick<InterruptionCardProps, 'busy' | 'onAllow' | 'onDeny' | 'onTerminal'>) {
  return (
    <>
      <button type="button" className="fdry-hall-btn is-primary" disabled={busy} onClick={onAllow}>
        Allow
      </button>
      <button type="button" className="fdry-hall-btn" disabled={busy} onClick={onDeny}>
        Deny
      </button>
      <button type="button" className="fdry-hall-btn" disabled={busy} onClick={onTerminal}>
        <Terminal aria-hidden="true" /> Terminal
      </button>
    </>
  )
}

/** Where a fixture's tip sits, and the box it covers, as fractions of the hall. */
function signPlacement(sign: HallSign, map: HallMap) {
  const width = map.width * TILE_PX
  const height = map.height * TILE_PX
  const { left, top, right, bottom } = sign.rect
  const centre = (left + right) / 2 / width
  return {
    align: centre > 0.75 ? 'end' : centre < 0.25 ? 'start' : 'middle',
    place: top / height < 0.25 ? 'below' : 'above',
    style: {
      left: `${(left / width) * 100}%`,
      top: `${(top / height) * 100}%`,
      width: `${((right - left) / width) * 100}%`,
      height: `${((bottom - top) / height) * 100}%`,
    },
  }
}

/** A fixture's one sentence: its accessible name, and a tip on hover or focus. */
function HallSignLabel({
  sign,
  map,
}: {
  readonly sign: HallSign
  readonly map: HallMap
}): JSX.Element {
  const { align, place, style } = signPlacement(sign, map)
  return (
    <div
      role="img"
      tabIndex={0}
      aria-label={sign.text}
      className="fdry-hall-sign"
      data-align={align}
      data-place={place}
      style={style}
    >
      <span className="fdry-hall-sign__tip" aria-hidden="true">
        {sign.text}
      </span>
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
  readonly onOpenInList: () => void
}

/** The order's own status, on the hall's top edge rather than above or below it. */
function HallHud(props: HallHudProps): JSX.Element {
  const { view, replaying, waitingCount, note } = props
  const standing = replaying ? undefined : view.standing
  return (
    <div className="fdry-hall-hud">
      <button type="button" className="fdry-hall-btn" onClick={props.onBack}>
        <ArrowLeft aria-hidden="true" /> All halls
      </button>
      <HudOrder view={view} shownGraph={props.shownGraph} standing={standing} />
      {replaying ? (
        <span className="fdry-hall-hud__tag">Replay</span>
      ) : (
        <button type="button" className="fdry-hall-btn" onClick={props.onReplay}>
          <History aria-hidden="true" /> Replay
        </button>
      )}
      <HudLinks view={view} standing={standing} />
      {note !== null ? <span className="fdry-hall-hud__note">{note}</span> : null}
      {!replaying && waitingCount > 0 ? (
        <span className="fdry-hall-hud__needs">{waitingCount} need you</span>
      ) : null}
      <HudAlert standing={standing} waitingCount={waitingCount} onOpenInList={props.onOpenInList} />
    </div>
  )
}

/** The order's links, and the one move on a finished order's document. */
function HudLinks({
  view,
  standing,
}: {
  readonly view: FloorView
  readonly standing: FloorView['standing']
}) {
  const document = view.document ?? null
  const hasLinks = (view.pulls?.length ?? 0) > 0 || view.source != null || document !== null
  if (!hasLinks) return null
  return (
    <span className="fdry-hall-hud__links">
      <OrderLinks document={document} pulls={view.pulls} source={view.source} />
      {document !== null && standing?.kind === 'done' ? (
        <OpenDocumentButton document={document} />
      ) : null}
    </span>
  )
}

interface HudOrderProps {
  readonly view: FloorView
  readonly shownGraph: RunGraph
  readonly standing: FloorView['standing']
}

function HudOrder({ view, shownGraph, standing }: HudOrderProps) {
  const finished = (s: NodeState): boolean => s === 'passed' || s === 'skipped'
  const done = standing?.done ?? shownGraph.nodes.filter((n) => finished(n.state)).length
  const total = standing?.total ?? shownGraph.nodes.length
  return (
    <div className="fdry-hall-hud__order">
      <span className="fdry-hall-hud__title">{view.title ?? view.graph.orderId}</span>
      <span className="fdry-hall-hud__progress" aria-label={`${done} of ${total} steps done`}>
        <span style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }} />
      </span>
      <span className="fdry-hall-hud__steps">
        {done}/{total}
      </span>
    </div>
  )
}

interface HudAlertProps {
  readonly standing: FloorView['standing']
  readonly waitingCount: number
  readonly onOpenInList: () => void
}

// A move no card owns (a run nothing is running, say) still names its place. A gate
// is decided in the queue above the hall.
function HudAlert({ standing, waitingCount, onOpenInList }: HudAlertProps) {
  if (standing === undefined || standing.turn !== 'you' || waitingCount !== 0) return null
  return (
    <div className="fdry-hall-hud__alert">
      <span>{standing.headline}</span>
      {standing.gateId !== null ? null : (
        <button type="button" className="fdry-hall-btn is-primary" onClick={onOpenInList}>
          Open in List view
        </button>
      )}
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
  readonly onDecide: (option: string, limit?: number | null) => void
  readonly pulls?: readonly { readonly number: number; readonly url: string }[]
  readonly source?: { readonly key: string; readonly url: string } | null
  readonly document?: DocumentLink | null
  readonly onTerminal: () => void
}

type GateItem = Extract<Interruption, { kind: 'gate' }>
type AskItem = Exclude<Interruption, { kind: 'gate' }>

/** Pinned over the station that is waiting, and answerable where it stands. */
function InterruptionCard(props: InterruptionCardProps): JSX.Element {
  const { item } = props
  return item.kind === 'gate' ? (
    <GateInterruption {...props} item={item} />
  ) : (
    <AskInterruption {...props} item={item} />
  )
}

function gateCardStyle(anchor: Anchor, flip: boolean): React.CSSProperties {
  return {
    // Centred on its anchor but kept whole inside the scene: the inset is
    // half the card's own width (see .fdry-card--gate) plus a margin.
    left: `clamp(${GATE_CARD_INSET}, ${anchor.left}%, calc(100% - ${GATE_CARD_INSET}))`,
    top: `${flip ? anchor.bottom : anchor.top}%`,
    // An opened reason grows the card toward the scene's edge; past this
    // it scrolls instead of running off it. The offsets mirror the card's
    // transform (34px above, 10px below) plus 16px of air.
    '--fdry-card-room': flip
      ? `calc(${100 - anchor.bottom}% - 26px)`
      : `calc(${anchor.top}% - 50px)`,
  } as React.CSSProperties
}

// The one-line gate the list views draw: answers on the line, the reason a click
// away as markdown. A replay shows it where it happened, every answer disabled.
function GateInterruption(props: InterruptionCardProps & { readonly item: GateItem }) {
  const { item, readOnly, flip, problem } = props
  return (
    <div
      role="group"
      aria-label={item.title}
      className={`fdry-card fdry-card--gate${flip ? ' is-below' : ''}`}
      style={gateCardStyle(props.anchor, flip)}
    >
      <GateCard
        gate={item.gate}
        busy={props.busy || readOnly}
        pulls={props.pulls}
        source={props.source}
        document={props.document}
        onDecide={props.onDecide}
      />
      {problem !== null ? <p className="fdry-card__problem">{problem}</p> : null}
      {readOnly ? <p className="fdry-card__history">Waited on you here.</p> : null}
    </div>
  )
}

function AskInterruption(props: InterruptionCardProps & { readonly item: AskItem }) {
  const { item, anchor, flip, problem } = props
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
      <AskDetail item={item} />
      {problem !== null ? <p className="fdry-card__problem">{problem}</p> : null}
      {props.readOnly ? (
        <p className="fdry-card__history">Waited on you here.</p>
      ) : (
        <AskActions {...props} />
      )}
    </div>
  )
}

function AskDetail({ item }: { readonly item: AskItem }) {
  return (
    <p className="fdry-card__detail">
      {item.kind === 'ask' && item.prose ? (
        <Markdown inline fetchesNothing className="fdry-md-inline" onOpenLink={openInBrowser}>
          {item.detail}
        </Markdown>
      ) : (
        item.detail
      )}
    </p>
  )
}

function AskActions({ item, busy, onAllow, onDeny, onTerminal }: InterruptionCardProps) {
  return (
    <div className="fdry-card__actions">
      {item.kind === 'ask' ? (
        <AskButtons busy={busy} onAllow={onAllow} onDeny={onDeny} onTerminal={onTerminal} />
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
  )
}
