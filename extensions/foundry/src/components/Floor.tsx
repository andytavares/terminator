import { GateCard } from './GateCard.js'
import React, { useCallback, useEffect, useState } from 'react'
import {
  Terminal,
  ScrollText,
  ShieldQuestion,
  Square,
  CornerDownLeft,
  X,
  ScanEye,
  BellOff,
  AlertCircle,
  Loader,
  CheckCircle2,
  Eye,
  ExternalLink as OpenOutside,
  Copy,
  FileText,
  Sparkles,
} from 'lucide-react'
import type { RunNode } from '../line/run-graph.js'
import { ciLabel } from '../line/ci-label.js'
import { pullNumber } from '../line/pull-number.js'
import type { TranscriptLine } from '../runtime/transcript-excerpt.js'
import { ConfirmButton } from './ConfirmButton.js'
import { ordinal } from '../factory/format.js'
import { Button, IconButton, Markdown, RelativeTime, usePolling } from '@terminator/extension-ui'
import { usePushed } from '../renderer/use-pushed.js'
import { openInBrowser } from '@terminator/extension-sdk/renderer'
import { ExternalLink } from './ExternalLink.js'
import { OrderLinks } from './OrderLinks.js'
import { DocumentChip, openDocument } from './DocumentChip.js'
import { OPEN_LABEL } from '../line/document-kind.js'
import type { DocumentLink } from '../line/document-kind.js'
import { attachTo } from '../renderer/attach-to-step.js'
import {
  useRunObservation,
  type FloorView,
  type PendingAsk,
} from '../renderer/use-run-observation.js'
import { invoke } from '@terminator/extension-sdk/renderer'

// Where you watch, not where you act.
//
// Everything actionable has already been lifted out into the inbox, so this
// surface is read-only by design — with one exception. Attach drops you into
// any running agent's live session, because however good a structured view
// gets, there are moments when the only useful thing is to be in the terminal
// typing at it.

interface FeedEntry {
  id: string
  at: number
  sessionId: string
  author: string
  summary: string
}

/** A run whose posts are silenced. Shown, because a mute you cannot find is
 *  a mute you never undo. */
interface MuteRule {
  sessionId?: string
  author?: string
}

/** A run that stopped making progress without asking for anything. */
interface StallFiring {
  firing: {
    sessionId: string
    /** The detector's own vocabulary: these two and nothing else. */
    signal: 'silence' | 'loop'
    firedAt: number
    /** The values that satisfied the condition, so the row can say them. */
    inputs?: { toolSilenceMs: number }
  }
  featureDir: string
  shadow: boolean
}

/**
 * What a firing means, in a sentence.
 *
 * The panel printed `signal` — "s-1 — silence" — which is this extension's own
 * vocabulary shown to the person using it, beside an id they did not choose.
 */
function stallInWords(firing: StallFiring['firing']): string {
  if (firing.signal === 'loop') {
    return 'going round in circles on one file, with nothing to show for it'
  }
  const minutes = Math.round((firing.inputs?.toolSilenceMs ?? 0) / 60_000)
  return `no tool call for ${minutes} minutes`
}

// How often an agent's words are refetched while the view is visible. Foundry's own
// changes are pushed; a transcript is written by the agent's process, so it is polled.
const LIVE_POLL_MS = 2000

/** How many of a running agent's last lines the standing band shows. */
const LIVE_LINES = 5

/** A message is written as one line per block; the live rows show one per message. */
function byMessage(lines: TranscriptLine[]): TranscriptLine[] {
  const messages: TranscriptLine[] = []
  for (const line of lines) {
    const last = messages.length - 1
    if (last >= 0 && line.at !== 0 && messages[last].at === line.at) {
      messages[last] = { ...messages[last], text: `${messages[last].text}\n${line.text}` }
    } else {
      messages.push(line)
    }
  }
  return messages
}

/** A node an agent is working on now. An orphan says running and is not. */
function isLive(node: RunNode, orphaned: readonly string[]): boolean {
  return node.state === 'running' && node.sessionId !== null && !orphaned.includes(node.id)
}

const STATE_LABEL: Record<RunNode['state'], string> = {
  waiting: 'waiting',
  running: 'building',
  passed: 'done',
  failed: 'failed',
  blocked: 'blocked',
  skipped: 'skipped',
}

/** The git extension's review of one pull request, by its full command id. */
const REVIEW_COMMAND = 'terminator.git-integration.command.review-pull-request'

/**
 * The repository, where the order names one.
 *
 * "lane 2" is a number the operator did not choose and cannot map to
 * anything; `cli-flow` is where the work is happening.
 */
function laneName(view: FloorView, lane: number): string {
  // Lane 0 is not a lane: it is where the nodes that belong to the order as a
  // whole sit — the shipping gate, the joins. "steps" said nothing about which
  // ones those were.
  if (lane === 0) return 'the whole order'
  const named = view.lanes?.find((row) => row.ord === lane)
  return named === undefined ? `lane ${lane}` : named.repo
}

interface LiveRead {
  readonly stalls: StallFiring[]
  readonly shadowMode: boolean
  readonly feed: FeedEntry[]
  readonly mutes: MuteRule[]
}

async function readLiveState(): Promise<LiveRead> {
  const stalled = (await invoke('foundry:stalls-list')) as {
    firings?: StallFiring[]
    shadowMode?: boolean
  }
  const activity = (await invoke('foundry:feed-list')) as {
    entries?: FeedEntry[]
    mutes?: MuteRule[]
  }
  return {
    stalls: stalled.firings ?? [],
    shadowMode: stalled.shadowMode ?? true,
    feed: (activity.entries ?? []).slice(-12).reverse(),
    mutes: activity.mutes ?? [],
  }
}

/** The transcript of the agent being watched; null when none is. */
async function readWatched(watching: string | null): Promise<TranscriptLine[] | null> {
  if (watching === null) return null
  const tail = (await invoke('foundry:run-transcript', { sessionId: watching, limit: 40 })) as {
    lines?: TranscriptLine[]
  }
  return tail.lines ?? []
}

/** Every running agent's own words, by session; nothing to read when none is running. */
async function readRunningTails(
  runningSessions: string
): Promise<Record<string, TranscriptLine[]>> {
  const tails: Record<string, TranscriptLine[]> = {}
  for (const sessionId of runningSessions === '' ? [] : runningSessions.split(' ')) {
    const tail = (await invoke('foundry:run-transcript', {
      sessionId,
      limit: LIVE_LINES * 3,
    })) as { lines?: TranscriptLine[] }
    // The agent's own words and calls. The user side is the brief and
    // tool results, which are either enormous or empty here.
    tails[sessionId] = byMessage((tail.lines ?? []).filter((l) => l.role === 'assistant'))
  }
  return tails
}

export interface FloorProps {
  readonly orderId: string
}

export function Floor({ orderId }: FloorProps): JSX.Element {
  const floor = useFloor(orderId)
  const { view, problem } = floor
  if (problem !== null && view === null) return <p className="fdry-note">{problem}</p>
  if (view === null) return <div className="fdry-empty">Loading the run…</div>
  return <FloorPage floor={floor} view={view} />
}

/** Everything the Floor keeps: the run observed, what the agents say, and the moves on it. */
function useFloor(orderId: string) {
  const { view, problem: observeProblem, pending, refresh } = useRunObservation(orderId)
  // Errors an action raises here — a click that failed, a decision the run
  // refused — live alongside whatever the observation poll last said, so one
  // does not silently overwrite the other.
  const [actionProblem, setProblem] = useState<string | null>(null)
  const watch = useWatch()
  const activity = useActivity(watch)
  const asks = useAskAnswers(setProblem, activity.pollLive)
  const sessions = useSessionControl(setProblem, activity.pollLive)
  const review = useReview(view, setProblem)
  const attach = useAttach(orderId)
  const decisions = useDecisions(orderId, setProblem, refresh)
  const words = useAgentWords(view, watch)
  const problem = actionProblem ?? observeProblem
  return {
    view,
    pending,
    problem,
    watch,
    ...activity,
    ...asks,
    ...sessions,
    ...review,
    ...attach,
    ...decisions,
    ...words,
  }
}

type FloorModel = ReturnType<typeof useFloor>

/** The agent being read, what it last said, and what you are typing to send it instead. */
function useWatch() {
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [watching, setWatching] = useState<string | null>(null)
  const [redirect, setRedirect] = useState('')
  return { transcript, setTranscript, watching, setWatching, redirect, setRedirect }
}

type Watch = ReturnType<typeof useWatch>

const NO_LIVE: LiveRead = { stalls: [], shadowMode: true, feed: [], mutes: [] }

// The feed and the stall firings, which are pushed. What the agents say is read by
// the one fallback poll (`useAgentWords`), and by `pollLive` after an action.
function useActivity({ watching, setTranscript }: Watch) {
  const [activity, showLive] = useState<LiveRead>(NO_LIVE)
  usePushed(readLiveState, showLive, { kinds: ['live'] })
  const pollLive = useCallback(async () => {
    showLive(await readLiveState())
    const lines = await readWatched(watching)
    if (lines !== null) setTranscript(lines)
  }, [watching, setTranscript])
  return { ...activity, pollLive }
}

type SetProblem = (problem: string | null) => void

/** Allows or denies a held call; why not, when it is no longer waiting. */
async function resolveAsk(ask: PendingAsk, decision: 'allow' | 'deny'): Promise<string | null> {
  const result = (await invoke('foundry:permission-resolve', {
    requestId: ask.requestId,
    decision,
  })) as { ok: boolean; reason?: string }
  // A click that did nothing is worse than a refusal that says why.
  return result.ok ? null : (result.reason ?? 'that request is no longer waiting')
}

/** Hands a held call back to its terminal and goes there; what went wrong, if anything. */
async function handAskBack(ask: PendingAsk): Promise<string | null> {
  const given = (await invoke('foundry:permission-hand-back', {
    requestId: ask.requestId,
  })) as { ok?: boolean }
  if (given.ok !== true) return 'that request is no longer waiting'
  // Handing back and going there are two things, and the second can fail on
  // its own: a run whose terminal has been closed accepts the hand-back and
  // has nowhere to send you. Silently, until this said so.
  const gone = (await invoke('foundry:run-terminal', { sessionId: ask.sessionId })) as {
    ok?: boolean
  }
  return gone.ok === true ? null : 'handed back, but that run no longer has an agent tab to open'
}

function useAskAnswers(setProblem: SetProblem, pollLive: () => Promise<void>) {
  const answer = useCallback(
    async (ask: PendingAsk, decision: 'allow' | 'deny') => {
      const trouble = await resolveAsk(ask, decision)
      if (trouble !== null) setProblem(trouble)
      await pollLive()
    },
    [pollLive, setProblem]
  )
  const handBack = useCallback(
    async (ask: PendingAsk) => {
      const trouble = await handAskBack(ask)
      if (trouble !== null) setProblem(trouble)
      await pollLive()
    },
    [pollLive, setProblem]
  )
  return { answer, handBack }
}

/** Steering a live agent, and clearing or silencing what the feed says. */
function useSessionControl(setProblem: SetProblem, pollLive: () => Promise<void>) {
  const control = useCallback(
    async (channel: string, payload: Record<string, unknown>) => {
      const result = (await invoke(channel, payload)) as { ok?: boolean }
      if (result.ok !== true) setProblem('that run is no longer live')
      await pollLive()
    },
    [pollLive, setProblem]
  )
  const dismiss = useCallback(
    async (entry: FeedEntry, mute: boolean) => {
      await invoke(mute ? 'foundry:feed-mute' : 'foundry:feed-dismiss', {
        id: entry.id,
        sessionId: entry.sessionId,
      })
      await pollLive()
    },
    [pollLive]
  )
  const unmute = useCallback(
    async (rule: MuteRule) => {
      await invoke('foundry:feed-unmute', rule)
      await pollLive()
    },
    [pollLive]
  )
  return { control, dismiss, unmute }
}

/** Whether the git extension's review can be reached; null until asked, asked once there are pulls. */
function useReviewable(hasPulls: boolean) {
  const [reviewable, setReviewable] = useState<boolean | null>(null)
  useEffect(() => {
    if (!hasPulls) return
    let cancelled = false
    void window.electronAPI.extension?.hasCommand(REVIEW_COMMAND).then((found) => {
      if (!cancelled) setReviewable(found)
    })
    return () => {
      cancelled = true
    }
  }, [hasPulls])
  return [reviewable, setReviewable] as const
}

function openOutside(url: string): void {
  void window.electronAPI.shell?.openExternal(url)
}

// Review a pull request in the git extension, or open it on GitHub when that is not
// installed. Foundry no longer draws a second, worse review of its own.
function useReview(view: FloorView | null, setProblem: SetProblem) {
  const [reviewable, setReviewable] = useReviewable((view?.pulls ?? []).length > 0)
  const review = useCallback(
    async (pull: { url: string; number: number; cwd: string }) => {
      setProblem(null)
      if (reviewable === false) {
        openOutside(pull.url)
        return
      }
      const opened = await window.electronAPI.extension?.runCommand(REVIEW_COMMAND, {
        repoRoot: pull.cwd,
        number: pull.number,
      })
      if (opened === undefined || opened.ok) return
      if (opened.reason === 'not-registered') {
        setReviewable(false)
        openOutside(pull.url)
        return
      }
      setProblem(`The review could not open: ${opened.reason}`)
    },
    [reviewable, setProblem, setReviewable]
  )
  return { reviewable, review }
}

/** The refusals by step, with this one's said or cleared. */
function withRefusal(
  was: Record<string, string>,
  [nodeId, message]: [string, string | null]
): Record<string, string> {
  const next = { ...was }
  if (message === null) delete next[nodeId]
  else next[nodeId] = message
  return next
}

/** What a step's attach was refused with, beside the step that asked. */
function useAttach(orderId: string) {
  const [attachProblems, setAttachProblems] = useState<Record<string, string>>({})
  const attach = useCallback(
    async (nodeId: string) => {
      // Said beside the step that was clicked: a refusal at the foot of a page
      // this long was a refusal nobody could connect to what they had pressed.
      const refuse = (message: string | null): void =>
        setAttachProblems((was) => withRefusal(was, [nodeId, message]))
      refuse(null)
      const trouble = await attachTo(orderId, nodeId)
      if (trouble !== null) refuse(trouble)
    },
    [orderId]
  )
  return { attachProblems, attach }
}

type RunChannel = 'foundry:run.resume' | 'foundry:run.stop' | 'foundry:run.reset'

// Resume or stop a run nothing is running, and answer the gate holding this order on
// the inbox's own channel: one queue, shown where the person looking at the order is.
function useDecisions(orderId: string, setProblem: SetProblem, refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const decide = useCallback(
    async (channel: string, payload: Record<string, unknown>) => {
      setBusy(true)
      try {
        const r = (await invoke(channel, payload)) as { error?: string; actionError?: string }
        // Said out loud. A refusal that leaves the band exactly as it was reads
        // as a button that does nothing, which is what sent people to the
        // terminal to find out.
        setProblem(r.error ?? r.actionError ?? null)
        await refresh()
      } finally {
        setBusy(false)
      }
    },
    [refresh, setProblem]
  )
  const decideRun = useCallback(
    (channel: RunChannel) => decide(channel, { id: orderId }),
    [orderId, decide]
  )
  const decideGate = useCallback(
    (gateId: string, option: string, limit?: number | null) =>
      decide(
        'foundry:inbox.decide',
        limit === undefined ? { gateId, option } : { gateId, option, limit }
      ),
    [decide]
  )
  return { busy, decideRun, decideGate }
}

// Every running agent's session, without choosing one to watch, so the band says
// more than "0 of 3 steps done" for the whole of a build step.
function runningSessionsOf(view: FloorView | null): string {
  return (view?.graph.nodes ?? [])
    .filter((n) => isLive(n, view?.orphaned ?? []))
    .map((n) => n.sessionId)
    .join(' ')
}

interface AgentWords {
  readonly watched: TranscriptLine[] | null
  readonly tails: Record<string, TranscriptLine[]>
}

// The one poll left on this view: an agent's words change in its own process, and
// nothing Foundry writes announces it.
function useAgentWords(view: FloorView | null, { watching, setTranscript }: Watch) {
  /** The last few things each running agent said, by session. */
  const [live, setLive] = useState<Record<string, TranscriptLine[]>>({})
  /** When the tails were last read: the "now" their ages are counted against. */
  const [tailsReadAt, setTailsReadAt] = useState(0)
  const runningSessions = runningSessionsOf(view)
  const readAgentWords = useCallback(
    async (): Promise<AgentWords> => ({
      watched: await readWatched(watching),
      tails: await readRunningTails(runningSessions),
    }),
    [watching, runningSessions]
  )
  const showAgentWords = useCallback(
    (read: AgentWords): void => {
      if (read.watched !== null) setTranscript(read.watched)
      setLive(read.tails)
      setTailsReadAt(Date.now())
    },
    [setTranscript]
  )
  usePolling(readAgentWords, showAgentWords, LIVE_POLL_MS)
  useForgetTails(runningSessions, setLive)
  return { live, tailsReadAt }
}

/** Nothing running, nothing said: the tails go when the last running agent does. */
function useForgetTails(
  runningSessions: string,
  setLive: (live: Record<string, TranscriptLine[]>) => void
): void {
  const [polledSessions, setPolledSessions] = useState(runningSessions)
  if (polledSessions !== runningSessions) {
    setPolledSessions(runningSessions)
    if (runningSessions === '') setLive({})
  }
}

/** What a step is called: its label, its role, or "this step". */
function stepName(view: FloorView, node: RunNode): string {
  return view.labels?.[node.id] ?? node.role ?? 'this step'
}

/** What a session is called: the step running it, or the session itself when no step does. */
function sessionName(view: FloorView, session: string): string {
  const node = view.graph.nodes.find((n) => n.sessionId === session)
  return node === undefined ? session : stepName(view, node)
}

interface PageProps {
  readonly floor: FloorModel
  readonly view: FloorView
}

function FloorPage({ floor, view }: PageProps) {
  return (
    <div className="fdry-shell">
      <OrderHeading view={view} />
      <FloorLinks view={view} reviewable={floor.reviewable} review={floor.review} />
      <RefineryQueue view={view} />
      <StandingBand floor={floor} view={view} />
      <RunControls view={view} busy={floor.busy} decideRun={floor.decideRun} />
      <HeldCalls pending={floor.pending} answer={floor.answer} handBack={floor.handBack} />
      <MergeOrder view={view} />
      <CiPanel view={view} />
      <Lanes floor={floor} view={view} />
      <ActivityPanel floor={floor} />
      <StallsPanel floor={floor} view={view} />
      <BlockedPanel view={view} />
      {floor.problem !== null ? <p className="fdry-problem">{floor.problem}</p> : null}
    </div>
  )
}

function OrderHeading({ view }: { readonly view: FloorView }) {
  return (
    <>
      {/* What the order is, then what it is called by the records. The heading
          used to be the id and the recipe name — two identifiers nobody chose
          — on a screen whose whole job is to say which piece of work this is. */}
      <h2 className="fdry-order-title">{view.title ?? view.graph.orderId}</h2>
      <p className="fdry-order-sub">
        {/* The id belongs under the title, not as it — and never twice, which
            is what happens when the title is what the id is falling back to. */}
        {view.title === null || view.title === undefined
          ? view.graph.recipe
          : `${view.graph.orderId} · ${view.graph.recipe}`}
      </p>
    </>
  )
}

type Pull = NonNullable<FloorView['pulls']>[number]

interface FloorLinksProps {
  readonly view: FloorView
  readonly reviewable: boolean | null
  readonly review: (pull: Pull) => Promise<void>
}

function FloorDocument({ view }: { readonly view: FloorView }) {
  return view.document == null ? null : <DocumentChip document={view.document} />
}

/** The pull requests the work opened and the ticket it came from, with a review of each. */
function FloorLinks({ view, reviewable, review }: FloorLinksProps) {
  const pulls = view.pulls ?? []
  const source = view.source ?? null
  if (pulls.length === 0 && source === null && view.document == null) return null
  return (
    <p className="fdry-order-links">
      <FloorDocument view={view} />
      <OrderLinks pulls={pulls} source={source} />
      {pulls.map((pull) => (
        <Button
          key={pull.url}
          size="sm"
          icon={reviewable === false ? OpenOutside : Eye}
          onClick={() => void review(pull)}
        >
          {reviewLabel(reviewable, pull, pulls.length)}
        </Button>
      ))}
    </p>
  )
}

function reviewLabel(reviewable: boolean | null, pull: Pull, pullCount: number): string {
  if (reviewable === false) return 'Open on GitHub'
  return pullCount > 1 ? `Review #${pull.number}` : 'Review'
}

// The refinery's file-overlap queue: what this order sits behind and why — a collision
// between orders, which the merge-order section (lanes of one order) cannot see (R5).
function RefineryQueue({ view }: { readonly view: FloorView }) {
  const queue = view.queue
  if (queue === null || queue === undefined || queue.behind.length === 0) return null
  return (
    <section className="fdry-queue" aria-label="Refinery queue">
      {queue.behind.map((entry) => (
        <p key={entry.orderId} className="fdry-note">
          {`Queued ${ordinal(view.queue?.position ?? 0)}, behind ${entry.title} (${entry.files.length} shared ${entry.files.length === 1 ? 'file' : 'files'})`}
        </p>
      ))}
    </section>
  )
}

type StandingOf = NonNullable<FloorView['standing']>

// Where the run stands and the move that takes it forward, first and full width:
// without it a run halted at an undecided gate drew the same chips as one mid-build.
function StandingBand({ floor, view }: PageProps) {
  const standing = view.standing
  if (standing === undefined) return null
  return (
    <section
      className={`fdry-standing is-${standing.kind}${standing.turn === 'you' ? ' is-yours' : ''}`}
      aria-labelledby="fdry-standing-h"
    >
      <StandingHead standing={standing} />
      <StandingBar standing={standing} />
      <DoneDocument standing={standing} view={view} />
      <LiveAgents floor={floor} view={view} />
      <StrandedGate floor={floor} view={view} />
      <AdriftGate floor={floor} view={view} />
      <StoppedGate floor={floor} view={view} />
      {/* The gate's own options, on the screen showing the order it holds.
          A check that names a problem and offers no reachable control is a
          wall: this one was answerable only from a tab the operator had no
          reason to connect to the run they were looking at. */}
      <WaitingGates floor={floor} view={view} />
    </section>
  )
}

function WaitingGates({ floor, view }: PageProps) {
  return (
    <>
      {(view.waiting ?? []).map((gate) => (
        <GateCard
          key={gate.id}
          gate={gate}
          busy={floor.busy}
          pulls={view.pulls ?? []}
          source={view.source ?? null}
          onDecide={(option, limit) => void floor.decideGate(gate.id, option, limit)}
        />
      ))}
    </>
  )
}

function DoneDocument({
  standing,
  view,
}: {
  readonly standing: StandingOf
  readonly view: FloorView
}) {
  if (standing.kind !== 'done' || !view.document) return null
  return <DocumentActions document={view.document} />
}

function StandingHead({ standing }: { readonly standing: StandingOf }) {
  return (
    <div className="fdry-standing-head">
      <span className="fdry-standing-mark" aria-hidden="true">
        <StandingMark standing={standing} />
      </span>
      <div className="fdry-standing-main">
        <h3 className="fdry-standing-h" id="fdry-standing-h">
          {standing.headline}
        </h3>
        <p className="fdry-standing-detail">{standing.detail}</p>
      </div>
      {standing.total === 0 ? null : (
        <span className="fdry-standing-count">
          {standing.done} of {standing.total}
        </span>
      )}
    </div>
  )
}

function StandingMark({ standing }: { readonly standing: StandingOf }) {
  if (standing.turn === 'you') return <AlertCircle />
  return standing.kind === 'done' ? <CheckCircle2 /> : <Loader />
}

function StandingBar({ standing }: { readonly standing: StandingOf }) {
  if (standing.total === 0) return null
  return (
    <div
      className="fdry-standing-bar"
      role="progressbar"
      aria-valuenow={standing.done}
      aria-valuemin={0}
      aria-valuemax={standing.total}
      aria-label="steps done"
    >
      <span style={{ width: `${(standing.done / standing.total) * 100}%` }} />
    </div>
  )
}

function LiveAgents({ floor, view }: PageProps) {
  const running = view.graph.nodes.filter((n) => isLive(n, view.orphaned ?? []))
  if (running.length === 0) return null
  return (
    <ul className="fdry-live" aria-label="What the agents are doing">
      {running.map((node) => (
        <LiveAgent
          key={node.id}
          name={stepName(view, node)}
          lines={(floor.live[node.sessionId ?? ''] ?? []).slice(-LIVE_LINES)}
          now={floor.tailsReadAt}
        />
      ))}
    </ul>
  )
}

interface LiveAgentProps {
  readonly name: string
  readonly lines: TranscriptLine[]
  readonly now: number
}

function LiveAgent({ name, lines, now }: LiveAgentProps) {
  const last = lines.at(-1)
  return (
    <li className="fdry-live-agent">
      <div className="fdry-live-head">
        <b>{name}</b>
        {last === undefined ? null : <RelativeTime value={last.at} now={now} />}
      </div>
      {lines.length === 0 ? (
        <p className="fdry-live-empty">Starting — nothing yet.</p>
      ) : (
        <ol className="fdry-live-lines">
          {lines.map((line, index) => (
            <li
              key={`${line.at}-${index}`}
              className={index === lines.length - 1 ? 'is-latest' : undefined}
            >
              {line.text.split('\n')[0]}
            </li>
          ))}
        </ol>
      )}
    </li>
  )
}

// An agent stopped at a prompt only a person can clear. The bridge has already put
// the question in the terminal, so the one move is to go there.
function StrandedGate({ floor, view }: PageProps) {
  const stranded = view.stranded ?? []
  if (view.standing?.kind !== 'stranded' || stranded.length === 0) return null
  return (
    <div className="fdry-standing-gate">
      <div className="fdry-standing-options">
        {stranded.map((session) => (
          <div key={session} className="fdry-standing-option">
            <Button
              variant="primary"
              icon={Terminal}
              disabled={floor.busy}
              onClick={() => void floor.control('foundry:run-terminal', { sessionId: session })}
            >
              Go to its agent tab
            </Button>
            <small>{strandedLabel(view, session)}</small>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The label of the step a stranded session belongs to; the session when it has none. */
function strandedLabel(view: FloorView, session: string): string {
  const node = view.graph.nodes.find((n) => n.sessionId === session)
  return node === undefined ? session : (view.labels?.[node.id] ?? session)
}

interface ResumeOptionProps {
  readonly floor: FloorModel
  readonly label: string
  readonly children: React.ReactNode
}

/** Starting the run again: one primary button, and what it will do. */
function ResumeOption({ floor, label, children }: ResumeOptionProps) {
  return (
    <div className="fdry-standing-options">
      <div className="fdry-standing-option">
        <Button
          variant="primary"
          disabled={floor.busy}
          onClick={() => void floor.decideRun('foundry:run.resume')}
        >
          {label}
        </Button>
        <small>{children}</small>
      </div>
    </div>
  )
}

// A run nothing is running, and the one move. The band states the fact; this is
// only the move, so the screen does not say it twice.
function AdriftGate({ floor, view }: PageProps) {
  if (view.standing?.kind !== 'adrift') return null
  return (
    <div className="fdry-standing-gate">
      <p className="fdry-note">
        {(view.orphaned ?? []).map((id) => view.labels?.[id] ?? id).join(', ')}
      </p>
      <ResumeOption floor={floor} label="Pick it back up">
        Every step that stopped is started again where it left off.
      </ResumeOption>
    </div>
  )
}

// Every step passed but no pull request opened, or the run failed: a fresh run would
// redo finished steps, so the one move is to have Foundry check the work again.
function StoppedGate({ floor, view }: PageProps) {
  if (view.standing?.kind !== 'stopped') return null
  return (
    <div className="fdry-standing-gate">
      <ResumeOption floor={floor} label="Try again">
        Finished steps stay finished. Once every step has passed, Foundry checks the work again and
        tries to open the pull request.
      </ResumeOption>
    </div>
  )
}

interface RunControlsProps {
  readonly view: FloorView
  readonly busy: boolean
  readonly decideRun: (channel: RunChannel) => Promise<void>
}

// Always shown, not only for an orphaned run: `order.cancel` refuses a running order,
// so a live or gated run needs its own way out here.
function RunControls({ view, busy, decideRun }: RunControlsProps) {
  return (
    <div className="fdry-run-controls">
      <ConfirmButton
        label="Stop the run"
        confirmLabel="Stop it"
        warning={`This ends every agent still working on ${view.graph.orderId}. What is in the worktree stays there.`}
        disabled={busy}
        onConfirm={() => void decideRun('foundry:run.stop')}
      />
      <ConfirmButton
        label="Start over"
        confirmLabel="Destroy it and start over"
        warning={`This destroys the checkout, the branch, the run graph and every gate ${view.graph.orderId} raised. The order, its criteria and its plan stay, and it can be run again from the beginning.`}
        disabled={busy}
        onConfirm={() => void decideRun('foundry:run.reset')}
      />
    </div>
  )
}

interface HeldCallsProps {
  readonly pending: PendingAsk[]
  readonly answer: (ask: PendingAsk, decision: 'allow' | 'deny') => Promise<void>
  readonly handBack: (ask: PendingAsk) => Promise<void>
}

// Held tool calls, oldest first — the order they must be answered in. Above the run
// graph: the only thing here waiting on a person, and a held agent looks just like a
// quiet one. The terminal is the backstop, not the only way to answer.
function HeldCalls({ pending, answer, handBack }: HeldCallsProps) {
  if (pending.length === 0) return null
  return (
    <section className="fdry-needs-you" aria-labelledby="fdry-waiting-h">
      <h3 className="fdry-needs-you-h" id="fdry-waiting-h">
        <ShieldQuestion aria-hidden="true" />
        Waiting on you — {pending.length}
      </h3>
      <div className="fdry-needs-you-list">
        {pending.map((ask) => (
          <HeldCall key={ask.requestId} ask={ask} answer={answer} handBack={handBack} />
        ))}
      </div>
    </section>
  )
}

type HeldCallProps = Omit<HeldCallsProps, 'pending'> & { readonly ask: PendingAsk }

function HeldCall({ ask, answer, handBack }: HeldCallProps) {
  return (
    <div className="fdry-ask">
      <span className="fdry-ask-icon" aria-hidden="true">
        <ShieldQuestion />
      </span>
      <div className="fdry-ask-main">
        <b>{ask.summary}</b>
        <small>
          <code>{ask.toolName}</code>
        </small>
        <AskDetail ask={ask} />
      </div>
      <AskActions ask={ask} answer={answer} handBack={handBack} />
    </div>
  )
}

function AskActions({ ask, answer, handBack }: HeldCallProps) {
  return (
    <div className="fdry-ask-actions">
      <Button variant="primary" size="sm" onClick={() => void answer(ask, 'allow')}>
        Allow
      </Button>
      <Button size="sm" onClick={() => void answer(ask, 'deny')}>
        Deny
      </Button>
      <Button
        size="sm"
        icon={Terminal}
        title="Answer it in the agent tab instead"
        onClick={() => void handBack(ask)}
      >
        In the agent tab
      </Button>
    </div>
  )
}

/** An agent's question is prose; any other tool's input is literal, and rendering it would eat a command's `*`s. */
function AskDetail({ ask }: { readonly ask: PendingAsk }) {
  if (ask.detail === null) return null
  if (ask.toolName !== 'AskUserQuestion') return <pre className="fdry-ask-detail">{ask.detail}</pre>
  return (
    <Markdown fetchesNothing className="fdry-md" onOpenLink={openInBrowser}>
      {ask.detail}
    </Markdown>
  )
}

/** Only for more than one repository: "1 of 1, merges first" is ceremony (FR-068). */
function MergeOrder({ view }: { readonly view: FloorView }) {
  if ((view.lanes?.length ?? 0) <= 1) return null
  return (
    <section className="fdry-panel" style={{ marginBottom: 12 }}>
      <h3 className="fdry-panel-h">Merge order</h3>
      <ol className="fdry-merge">
        {view.lanes?.map((row) => <MergeRow key={row.ord} row={row} />)}
      </ol>
    </section>
  )
}

function MergeRow({ row }: { readonly row: NonNullable<FloorView['lanes']>[number] }) {
  return (
    <li className={row.hold === null ? '' : 'is-held'}>
      <b>{row.repo}</b>
      {row.role === null ? null : <span className="fdry-role">{row.role}</span>}
      {row.collisions.length > 0 ? <small>shares {row.collisions.join(', ')}</small> : null}
      {row.hold === null ? (
        <small>free to merge</small>
      ) : (
        <small className="fdry-hold">{row.hold}</small>
      )}
    </li>
  )
}

type CiOf = NonNullable<FloorView['ci']>

/** Present only once the ship tail has written a CI state (ADR-060). */
function CiPanel({ view }: { readonly view: FloorView }) {
  const ci = view.ci
  if (!ci) return null
  const allChecks = ci.pulls.flatMap((pull) => pull.checks)
  return (
    <section className="fdry-panel" style={{ marginBottom: 12 }} aria-labelledby="fdry-ci-h">
      <h3 className="fdry-panel-h" id="fdry-ci-h">
        CI
      </h3>
      <CiStatus ci={ci} />
      {allChecks.length === 0 ? null : (
        <p className="fdry-note">
          {allChecks.filter((check) => check.bucket !== 'pending').length} of {allChecks.length}{' '}
          checks done
        </p>
      )}
      {ci.pulls.map((pull) => (
        <ExternalLink key={pull.url} href={pull.url} className="fdry-ci-pull">
          Pull request #{pullNumber(pull.url)}
        </ExternalLink>
      ))}
      <CiChecks ci={ci} />
    </section>
  )
}

function CiStatus({ ci }: { readonly ci: CiOf }) {
  return (
    <p className="fdry-ci-status">
      {ci.status === 'watching' || ci.status === 'reworking' ? (
        <span className="fdry-ci-spin" role="status" aria-label="Checks are running">
          <Loader className="fdry-spin" aria-hidden="true" />
        </span>
      ) : null}
      {ciLabel(ci)}
    </p>
  )
}

function CiChecks({ ci }: { readonly ci: CiOf }) {
  return (
    <ul className="fdry-ci-checks">
      {ci.pulls.flatMap((pull, pullIndex) =>
        pull.checks.map((check, checkIndex) => (
          <li key={`${pullIndex}-${checkIndex}`}>
            <ExternalLink href={check.link}>{check.name}</ExternalLink>
            <span className="fdry-ci-bucket" data-bucket={check.bucket}>
              {check.bucket}
            </span>
          </li>
        ))
      )}
    </ul>
  )
}

// The step being read, so its transcript opens under that step's row. A session no
// step owns (a stall names one by session) goes at the foot.
function watchedNodeOf(view: FloorView, watching: string | null): RunNode | undefined {
  return watching === null ? undefined : view.graph.nodes.find((n) => n.sessionId === watching)
}

function Lanes({ floor, view }: PageProps) {
  const lanes = [...new Set(view.graph.nodes.map((n) => n.lane ?? 0))].sort((a, b) => a - b)
  const watchedNode = watchedNodeOf(view, floor.watch.watching)
  const watchedLane = watchedNode === undefined ? null : (watchedNode.lane ?? 0)
  const watchPanel = <WatchPanel floor={floor} view={view} node={watchedNode} />
  return (
    <>
      {lanes.map((lane) => (
        <div key={lane} className="fdry-lane">
          <div className="fdry-lane-name">
            <b>{laneName(view, lane)}</b>
          </div>
          <div className="fdry-units">
            {view.graph.nodes
              .filter((n) => (n.lane ?? 0) === lane)
              .map((node) => (
                <Unit key={node.id} node={node} floor={floor} view={view} />
              ))}
          </div>
          {/* Under the row of the step it belongs to, not at the foot of the
              page — which on a long run is a scroll away from the chip that
              was clicked. */}
          {watchedLane === lane ? watchPanel : null}
        </div>
      ))}
      {watchedLane === null ? watchPanel : null}
    </>
  )
}

/** Why a skipped step did not run, when it says; null for every other step. */
function skipNote(node: RunNode): string | null {
  if (node.state !== 'skipped' || node.skipReason == null || node.skipReason === '') return null
  return `Skipped: ${node.skipReason}`
}

interface UnitProps extends PageProps {
  readonly node: RunNode
}

function Unit({ node, floor, view }: UnitProps) {
  const attachProblem = floor.attachProblems[node.id]
  const skills = view.skills?.[node.id] ?? []
  return (
    <>
      <UnitChip node={node} floor={floor} view={view} />
      {attachProblem === undefined ? null : (
        <p className="fdry-unit-problem" role="alert">
          {attachProblem}
        </p>
      )}
      {skills.length > 0 ? (
        <p className="fdry-unit-skills">{`Skills: ${skills.join(', ')}`}</p>
      ) : null}
      {node.feedback.length > 0 ? <UnitFeedback feedback={node.feedback} /> : null}
    </>
  )
}

function UnitChip({ node, floor, view }: UnitProps) {
  // A node the graph calls running that nothing is running is drawn as gone, not
  // "building" under a band saying nothing runs it.
  const gone = (view.orphaned ?? []).includes(node.id)
  const skipped = skipNote(node)
  return (
    <span
      className={`fdry-unit is-${node.state}${gone ? ' is-orphaned' : ''}`}
      // The id stays reachable because it is what the ledger and the graph call
      // this node, but it is not what a person watching the run needs to read.
      // A skipped step is better explained by why it did not run.
      title={skipped ?? node.id}
      aria-describedby={skipped === null ? undefined : `fdry-skip-${node.id}`}
    >
      <span className="fdry-unit-label">{stepName(view, node)}</span>
      <u>{gone ? 'stopped' : STATE_LABEL[node.state]}</u>
      {skipped === null ? null : (
        <span id={`fdry-skip-${node.id}`} className="fdry-sr-only">
          {skipped}
        </span>
      )}
      {node.reworks > 0 ? (
        <span className="fdry-unit-rework">{`Sent back ${node.reworks}×`}</span>
      ) : null}
      {node.sessionId !== null && !gone ? (
        <UnitButtons node={node} floor={floor} view={view} />
      ) : null}
    </span>
  )
}

function UnitButtons({ node, floor, view }: UnitProps) {
  return (
    <>
      <IconButton
        icon={ScrollText}
        size="sm"
        label="Transcript"
        onClick={() => floor.watch.setWatching(node.sessionId)}
      />
      {/* A finished step's session is closed (ADR 076), so there is nothing
          to go to. */}
      {node.state === 'running' ? (
        <IconButton
          icon={Terminal}
          size="sm"
          label={`Attach to ${stepName(view, node)}`}
          onClick={() => void floor.attach(node.id)}
        />
      ) : null}
    </>
  )
}

function UnitFeedback({ feedback }: { readonly feedback: RunNode['feedback'] }) {
  return (
    <details className="fdry-unit-feedback">
      <summary>Why it was sent back</summary>
      <ul>
        {feedback.map((entry, index) => (
          <li key={index}>
            <code>{entry.command ?? 'a check'}</code>
            {' — exit '}
            {entry.exitCode ?? 'unknown'}
            <pre className="fdry-ask-detail">{entry.excerpt}</pre>
          </li>
        ))}
      </ul>
    </details>
  )
}

interface WatchPanelProps extends PageProps {
  readonly node: RunNode | undefined
}

function WatchPanel({ floor, view, node }: WatchPanelProps) {
  const { watching, transcript } = floor.watch
  if (watching === null) return null
  return (
    <section
      className="fdry-panel fdry-watch"
      style={{ marginTop: 12 }}
      aria-labelledby="fdry-watching-h"
    >
      <h3 className="fdry-panel-h" id="fdry-watching-h">
        {node === undefined ? watching : stepName(view, node)}
      </h3>
      <pre className="fdry-transcript">
        {transcript.length === 0 ? 'Nothing yet.' : transcript.map((l) => l.text).join('\n')}
      </pre>
      <RedirectForm watch={floor.watch} watching={watching} control={floor.control} />
    </section>
  )
}

interface RedirectFormProps {
  readonly watch: Watch
  readonly watching: string
  readonly control: FloorModel['control']
}

function RedirectForm({ watch, watching, control }: RedirectFormProps) {
  const { redirect, setRedirect } = watch
  return (
    <form
      className="fdry-redirect"
      onSubmit={(event) => {
        event.preventDefault()
        if (redirect.trim() === '') return
        void control('foundry:run-redirect', { sessionId: watching, message: redirect.trim() })
        setRedirect('')
      }}
    >
      <RedirectInput redirect={redirect} setRedirect={setRedirect} />
      <WatchedButtons watching={watching} control={control} />
    </form>
  )
}

function RedirectInput({ redirect, setRedirect }: Pick<Watch, 'redirect' | 'setRedirect'>) {
  return (
    <>
      <input
        aria-label="Tell it what to do instead"
        placeholder="Tell it what to do instead…"
        value={redirect}
        onChange={(event) => setRedirect(event.target.value)}
      />
      <Button
        type="submit"
        size="sm"
        variant="primary"
        icon={CornerDownLeft}
        disabled={redirect.trim() === ''}
      >
        Redirect
      </Button>
    </>
  )
}

function WatchedButtons({ watching, control }: Omit<RedirectFormProps, 'watch'>) {
  return (
    <>
      <Button
        size="sm"
        onClick={() => void control('foundry:run-interrupt', { sessionId: watching })}
      >
        Interrupt
      </Button>
      <Button
        size="sm"
        variant="danger"
        icon={Square}
        onClick={() =>
          void control('foundry:run-stop', {
            sessionId: watching,
            reason: 'stopped from the floor',
          })
        }
      >
        Stop
      </Button>
    </>
  )
}

// What happened while you were away. Every row can be cleared and a noisy run muted
// without hiding what it does: a feed you cannot clear is one you stop reading.
function ActivityPanel({ floor }: { readonly floor: FloorModel }) {
  const { feed, mutes } = floor
  if (feed.length === 0 && mutes.length === 0) return null
  return (
    <section className="fdry-panel" style={{ marginTop: 12 }}>
      <h3 className="fdry-panel-h">Activity</h3>
      {mutes.length > 0 ? <MuteList mutes={mutes} unmute={floor.unmute} /> : null}
      {feed.map((entry) => (
        <FeedRow key={entry.id} entry={entry} dismiss={floor.dismiss} />
      ))}
    </section>
  )
}

function MuteList({ mutes, unmute }: Pick<FloorModel, 'mutes' | 'unmute'>) {
  return (
    <p className="fdry-note">
      Silenced:{' '}
      {mutes.map((rule) => (
        <Button
          key={`${rule.sessionId ?? ''}-${rule.author ?? ''}`}
          variant="ghost"
          size="sm"
          className="fdry-unmute"
          aria-label={`Unmute ${rule.sessionId ?? rule.author ?? 'everything'}`}
          onClick={() => void unmute(rule)}
        >
          {rule.sessionId ?? rule.author ?? 'everything'}
          <X aria-hidden="true" className="tm-icon-sm" />
        </Button>
      ))}
    </p>
  )
}

function FeedRow({ entry, dismiss }: { readonly entry: FeedEntry } & Pick<FloorModel, 'dismiss'>) {
  return (
    <div className="fdry-feed-row">
      <span className="fdry-feed-author">{entry.author}</span>
      <span className="fdry-feed-summary">
        <Markdown inline fetchesNothing className="fdry-md-inline" onOpenLink={openInBrowser}>
          {entry.summary}
        </Markdown>
      </span>
      <IconButton
        icon={X}
        size="sm"
        label={`Dismiss: ${entry.summary}`}
        onClick={() => void dismiss(entry, false)}
      />
      <IconButton
        icon={BellOff}
        size="sm"
        label={`Mute ${entry.sessionId}`}
        description="Stop this run interrupting, without hiding what it does"
        onClick={() => void dismiss(entry, true)}
      />
    </div>
  )
}

/** Work that stopped making progress without asking for anything: it looks like work. */
function StallsPanel({ floor, view }: PageProps) {
  const { stalls, shadowMode } = floor
  if (stalls.length === 0) return null
  return (
    <section className="fdry-panel" style={{ marginTop: 12 }}>
      <h3 className="fdry-panel-h">
        Stopped making progress — {stalls.length}
        {shadowMode ? ' (recorded, not acted on)' : ''}
      </h3>
      {stalls.slice(-5).map((entry) => (
        <StallRow
          key={`${entry.firing.sessionId}-${entry.firing.firedAt}`}
          entry={entry}
          floor={floor}
          view={view}
        />
      ))}
      {shadowMode ? (
        <p className="fdry-note">
          Shadow mode: these are recorded and never notified, until the thresholds have earned it.
          Turn it off in settings once they have.
        </p>
      ) : null}
    </section>
  )
}

function StallRow({ entry, floor, view }: PageProps & { readonly entry: StallFiring }) {
  const session = entry.firing.sessionId
  return (
    <div className="fdry-ask">
      <div className="fdry-ask-main">
        {/* What the operator calls it. The panel printed the session id, which
            is a uuid nobody chose, beside this extension's own word for the
            signal. */}
        <b>{sessionName(view, session)}</b>
        <small>
          {stallInWords(entry.firing)}
          {entry.shadow ? ' · shadow' : ''}
        </small>
      </div>
      <StallActions session={session} floor={floor} />
    </div>
  )
}

/** The three things you do about a stall, each over a channel that already existed. */
interface StallActionsProps {
  readonly session: string
  readonly floor: FloorModel
}

function StallActions({ session, floor }: StallActionsProps) {
  return (
    <div className="fdry-ask-actions">
      <Button size="sm" icon={ScanEye} onClick={() => floor.watch.setWatching(session)}>
        Read what it was saying
      </Button>
      <Button
        size="sm"
        icon={Terminal}
        onClick={() => void floor.control('foundry:run-terminal', { sessionId: session })}
      >
        Take it over
      </Button>
      <EndAgent session={session} floor={floor} />
    </div>
  )
}

function EndAgent({ session, floor }: StallActionsProps) {
  return (
    <Button
      size="sm"
      variant="danger"
      icon={Square}
      onClick={() =>
        void floor.control('foundry:run-stop', {
          sessionId: session,
          reason: 'stopped from the Floor: it had stopped making progress',
        })
      }
    >
      End this agent
    </Button>
  )
}

function BlockedPanel({ view }: { readonly view: FloorView }) {
  if (view.blocked.length === 0) return null
  return (
    <section className="fdry-panel" style={{ marginTop: 12 }}>
      <h3 className="fdry-panel-h">Blocked</h3>
      {view.blocked.map((entry) => (
        <p key={entry.id} className="fdry-note" title={entry.id}>
          <b>{view.labels?.[entry.id] ?? entry.id}</b> — {entry.reason}
        </p>
      ))}
    </section>
  )
}

/** The moves on a finished order's document: open it, open the local copy, copy the link. */
function DocumentActions({ document }: { readonly document: DocumentLink }): JSX.Element {
  return (
    <div className="fdry-doc-actions">
      <Button variant="primary" icon={Sparkles} onClick={() => openDocument(document)}>
        {OPEN_LABEL[document.kind]}
      </Button>
      {document.kind === 'file' ? null : (
        <Button
          variant="secondary"
          icon={FileText}
          onClick={() => void window.electronAPI.shell.openPath(document.path)}
        >
          Open local copy
        </Button>
      )}
      {document.url === null ? null : <CopyLink url={document.url} />}
    </div>
  )
}

function CopyLink({ url }: { readonly url: string }) {
  return (
    <Button
      variant="ghost"
      icon={Copy}
      onClick={() => void navigator.clipboard.writeText(url).catch(() => undefined)}
    >
      Copy link
    </Button>
  )
}
