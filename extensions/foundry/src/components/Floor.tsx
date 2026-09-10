import React, { useCallback, useEffect, useState } from 'react'
import {
  Terminal,
  ShieldQuestion,
  Square,
  CornerDownLeft,
  Check,
  X,
  ScanEye,
  BellOff,
  AlertCircle,
  Loader,
  CheckCircle2,
} from 'lucide-react'
import type { RunGraph, RunNode } from '../line/run-graph.js'
import type { Standing } from '../order/standing.js'
import type { Gate } from '../gates/rules.js'
import { ConfirmButton } from './ConfirmButton.js'

// Where you watch, not where you act.
//
// Everything actionable has already been lifted out into the inbox, so this
// surface is read-only by design — with one exception. Attach drops you into
// any running agent's live session, because however good a structured view
// gets, there are moments when the only useful thing is to be in the terminal
// typing at it.

interface Blocked {
  id: string
  reason: string
}

/** One repository this order spans, and what it is waiting for. */
interface LaneRow {
  ord: number
  repo: string
  role: 'producer' | 'consumer' | null
  collisions: string[]
  blockedBy: number[]
  /** Why this lane cannot merge yet, in the rule's own words. Null when it can. */
  hold: string | null
}

interface FloorView {
  graph: RunGraph
  /** What the operator called this order. The heading was two identifiers. */
  title?: string | null
  /**
   * Where the run stands, and whose move it is.
   *
   * Optional because this is polled and a host part way through an upgrade
   * answers without one — the panel draws the run and no band rather than
   * blanking.
   */
  standing?: Standing
  /** Gates holding this order, undecided. Answerable from here. */
  waiting?: Gate[]
  /**
   * Agents parked at their terminal's own prompt.
   *
   * A tool call nobody answered in time is handed back there, and an
   * unattended run never reaches it — so the agent stops with its process
   * alive and its node still `running`. The only thing that answers one is
   * going to that terminal, which is what these are for.
   */
  stranded?: string[]
  /** What to call each node, keyed by id — worked out where the order is. */
  labels?: Record<string, string>
  ready: string[]
  blocked: Blocked[]
  lanes?: LaneRow[]
  /**
   * Steps the graph calls running that nothing is actually running.
   *
   * An agent's terminal is a child of the application, so quitting kills every
   * one while the graph goes on saying `running`. Without this the chips for a
   * dead run and a working one are the same chips.
   */
  orphaned?: string[]
}

/** A tool call an agent is holding at, waiting for an answer. */
interface PendingAsk {
  requestId: string
  sessionId: string
  toolName: string
  summary: string
  detail: string | null
  at: number
}

/** A finished run whose change nobody has looked at yet. */
interface ReviewItem {
  sessionId: string
  branch: string
  grade: 'P0' | 'P1' | 'P2' | 'P3'
  gradeTrigger: string
  diffSummary: { files: number; added: number; removed: number }
  /** Where this review has got to: intent, risk, structure, tests. */
  step: 'intent' | 'risk' | 'structure' | 'tests'
}

/** What each review step is asking, in the reviewer's terms. */
const STEP_ASKS: Record<ReviewItem['step'], string> = {
  intent: 'Is this what was asked for?',
  risk: 'What does it put at risk?',
  structure: 'Does it fit the code around it?',
  tests: 'Is it proven?',
}

interface Hunk {
  id: string
  newStart: number
  lines: string[]
  decision: 'accept' | 'reject' | null
}

interface HunkFile {
  file: string
  hunks: Hunk[]
}

/** The request set against what the agent says it did. */
interface IntentReview {
  unexpectedFiles: string[]
  untouchedFiles: string[]
  hasScopeConcern: boolean
}

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

/** Why a new run would be refused, and how deep the queue is. */
interface Backpressure {
  allowed: boolean
  unreviewed: number
  limit: number
  reason: string | null
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

/** How often the live half is refetched. Slow enough to be cheap, fast
 *  enough that an agent is not left holding a tool call for a visible pause. */
const LIVE_POLL_MS = 2000

const STATE_LABEL: Record<RunNode['state'], string> = {
  waiting: 'waiting',
  ready: 'ready',
  running: 'building',
  verifying: 'verifying',
  passed: 'verified',
  failed: 'failed',
  blocked: 'blocked',
  skipped: 'skipped',
}

function invoke(channel: string, payload: unknown = {}): Promise<unknown> {
  return window.electronAPI.extensionBridge.invoke(channel, payload)
}

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

export interface FloorProps {
  readonly orderId: string
}

export function Floor({ orderId }: FloorProps): JSX.Element {
  const [view, setView] = useState<FloorView | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAsk[]>([])
  const [transcript, setTranscript] = useState<string[]>([])
  const [watching, setWatching] = useState<string | null>(null)
  const [redirect, setRedirect] = useState('')
  const [review, setReview] = useState<ReviewItem[]>([])
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [hunks, setHunks] = useState<HunkFile[] | null>(null)
  const [intent, setIntent] = useState<IntentReview | null>(null)
  const [decided, setDecided] = useState(false)
  const [fullReject, setFullReject] = useState(false)
  const [step, setStep] = useState<ReviewItem['step'] | null>(null)
  const [feed, setFeed] = useState<FeedEntry[]>([])
  const [mutes, setMutes] = useState<MuteRule[]>([])
  const [backpressure, setBackpressure] = useState<Backpressure | null>(null)
  const [stalls, setStalls] = useState<StallFiring[]>([])
  const [shadowMode, setShadowMode] = useState(true)

  const refresh = useCallback(async () => {
    const next = (await invoke('foundry:run.observe', { id: orderId })) as
      | FloorView
      | { error: string }
    if ('error' in next) {
      setProblem(next.error)
      return
    }
    setProblem(null)
    setView(next)
  }, [orderId])

  // Polled, not fetched once.
  //
  // This was a single call on mount, so every state chip on the screen was a
  // snapshot of whenever the panel happened to open: a run that halted, failed
  // or finished while you were looking at it went on drawing `building` until
  // you navigated away and back.
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), LIVE_POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  // The live half: what an agent is holding at, and what it has been saying.
  //
  // Polled rather than pushed because a surface that misses one event shows a
  // stale answer for ever, and a held tool call shown as answered is the worst
  // of those — the agent is genuinely stopped, waiting on somebody who has
  // been told there is nothing to do.
  const pollLive = useCallback(async () => {
    const asks = (await invoke('foundry:permissions-list')) as { pending?: PendingAsk[] }
    setPending(asks.pending ?? [])
    const snapshot = (await invoke('foundry:supervision-snapshot')) as {
      review?: ReviewItem[]
      backpressure?: Backpressure
    }
    setReview(snapshot.review ?? [])
    setBackpressure(snapshot.backpressure ?? null)
    const stalled = (await invoke('foundry:stalls-list')) as {
      firings?: StallFiring[]
      shadowMode?: boolean
    }
    setStalls(stalled.firings ?? [])
    setShadowMode(stalled.shadowMode ?? true)
    const activity = (await invoke('foundry:feed-list')) as {
      entries?: FeedEntry[]
      mutes?: MuteRule[]
    }
    setFeed((activity.entries ?? []).slice(-12).reverse())
    setMutes(activity.mutes ?? [])
    if (watching !== null) {
      const tail = (await invoke('foundry:run-transcript', {
        sessionId: watching,
        limit: 40,
      })) as { lines?: string[] }
      setTranscript(tail.lines ?? [])
    }
  }, [watching])

  useEffect(() => {
    void pollLive()
    const timer = setInterval(() => void pollLive(), LIVE_POLL_MS)
    return () => clearInterval(timer)
  }, [pollLive])

  const answer = useCallback(
    async (ask: PendingAsk, decision: 'allow' | 'deny') => {
      const result = (await invoke('foundry:permission-resolve', {
        requestId: ask.requestId,
        decision,
      })) as { ok: boolean; reason?: string }
      // A click that did nothing is worse than a refusal that says why.
      if (!result.ok) setProblem(result.reason ?? 'that request is no longer waiting')
      await pollLive()
    },
    [pollLive]
  )

  const handBack = useCallback(
    async (ask: PendingAsk) => {
      const given = (await invoke('foundry:permission-hand-back', {
        requestId: ask.requestId,
      })) as { ok?: boolean }
      if (given.ok !== true) {
        setProblem('that request is no longer waiting')
        await pollLive()
        return
      }
      // Handing back and going there are two things, and the second can fail on
      // its own: a run whose terminal has been closed accepts the hand-back and
      // has nowhere to send you. Silently, until this said so.
      const gone = (await invoke('foundry:run-terminal', { sessionId: ask.sessionId })) as {
        ok?: boolean
      }
      if (gone.ok !== true) {
        setProblem('handed back, but that run no longer has a terminal to open')
      }
      await pollLive()
    },
    [pollLive]
  )

  const control = useCallback(
    async (channel: string, payload: Record<string, unknown>) => {
      const result = (await invoke(channel, payload)) as { ok?: boolean }
      if (result.ok !== true) setProblem('that run is no longer live')
      await pollLive()
    },
    [pollLive]
  )

  const openReview = useCallback(
    async (item: ReviewItem) => {
      setReviewing(item.sessionId)
      const next = (await invoke('foundry:review-hunks', { sessionId: item.sessionId })) as {
        files: HunkFile[] | null
        complete?: boolean
        fullReject?: boolean
      }
      setDecided(next.complete === true)
      setFullReject(next.fullReject === true)
      // Null is "the runtime never started", which is not the same as "this
      // change was empty" — a panel that cannot tell them apart shows an empty
      // review for a run that never happened.
      setHunks(next.files)

      // The request against the agent's own account of it. The step every diff
      // viewer skips, and the one that catches work that is defensible in
      // isolation and was never asked for.
      const checked = (await invoke('foundry:review-intent', {
        sessionId: item.sessionId,
        request: view?.graph.orderId ?? '',
        agentAccount: item.branch,
      })) as { intent: IntentReview | null }
      setIntent(checked.intent)

      // Move the queue on, and keep what it moved to: a reviewer working
      // through four questions should be told which one they are on.
      const advanced = (await invoke('foundry:review-advance', {
        sessionId: item.sessionId,
      })) as { step: ReviewItem['step'] | null }
      setStep(advanced.step ?? item.step)
    },
    [view]
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

  const decideHunk = useCallback(
    async (hunkId: string, decision: 'accept' | 'reject') => {
      if (reviewing === null) return
      const took = (await invoke('foundry:review-decide-hunk', {
        sessionId: reviewing,
        hunkId,
        decision,
      })) as { ok?: boolean }
      if (took.ok !== true) setProblem('that review is no longer open')
      const next = (await invoke('foundry:review-hunks', { sessionId: reviewing })) as {
        files: HunkFile[] | null
        complete?: boolean
        fullReject?: boolean
      }
      setHunks(next.files)
      setDecided(next.complete === true)
      setFullReject(next.fullReject === true)
    },
    [reviewing]
  )

  const applyReview = useCallback(async () => {
    if (reviewing === null) return
    const result = (await invoke('foundry:review-apply', { sessionId: reviewing })) as {
      ok: boolean
      reverted?: number
      error?: string
    }
    if (!result.ok) {
      setProblem(result.error ?? 'the decisions could not be applied')
      return
    }
    // Said out loud: rejecting a hunk takes lines back out of the working
    // copy, and "applied" without a count reads as though nothing happened.
    setProblem(
      (result.reverted ?? 0) === 0
        ? 'Applied. Nothing was reverted.'
        : `Applied. ${result.reverted} ${result.reverted === 1 ? 'hunk' : 'hunks'} reverted.`
    )
    await invoke('foundry:review-done', { sessionId: reviewing })
    setReviewing(null)
    setHunks(null)
    setIntent(null)
    setDecided(false)
    setFullReject(false)
    setStep(null)
    await pollLive()
  }, [reviewing, pollLive])

  const unmute = useCallback(
    async (rule: MuteRule) => {
      await invoke('foundry:feed-unmute', rule)
      await pollLive()
    },
    [pollLive]
  )

  const attach = useCallback(
    async (nodeId: string) => {
      const r = (await invoke('foundry:session.attach', { orderId, nodeId })) as
        | { terminalSessionId: string }
        | { error: string }
      if ('error' in r) {
        setProblem(r.error)
        return
      }
      // And then actually go there. This resolved the session and dropped it,
      // so the button labelled "Attach" navigated nowhere at all — the one
      // control on a read-only surface, and it did nothing.
      const gone = (await invoke('foundry:run-terminal', {
        sessionId: r.terminalSessionId,
      })) as { ok?: boolean }
      if (gone.ok !== true) setProblem('That agent is no longer in a terminal.')
    },
    [orderId]
  )

  /**
   * Pick the run back up, or stop it.
   *
   * The two answers to a run nothing is running. `run.resume` has existed and
   * been registered the whole time with no surface calling it: the only way to
   * restart a run was to happen to have a gate open in the inbox.
   */
  const [busy, setBusy] = useState(false)
  const decideRun = useCallback(
    async (channel: 'foundry:run.resume' | 'foundry:run.stop' | 'foundry:run.reset') => {
      setBusy(true)
      try {
        const r = (await invoke(channel, { id: orderId })) as { error?: string }
        // Said out loud. A refusal that leaves the band exactly as it was reads
        // as a button that does nothing, which is what sent people to the
        // terminal to find out.
        setProblem(r.error ?? null)
        await refresh()
      } finally {
        setBusy(false)
      }
    },
    [orderId, refresh]
  )

  /**
   * Answer the gate holding this order, from the screen that shows the order.
   *
   * The same channel the inbox answers it with — this is not a second queue,
   * it is the one blocking thing on this order put where the person looking at
   * the order will see it. The inbox stays the cross-order queue.
   */
  const decideGate = useCallback(
    async (gateId: string, option: string) => {
      setBusy(true)
      try {
        const r = (await invoke('foundry:inbox.decide', { gateId, option })) as {
          error?: string
          actionError?: string
        }
        setProblem(r.error ?? r.actionError ?? null)
        await refresh()
      } finally {
        setBusy(false)
      }
    },
    [refresh]
  )

  if (problem !== null && view === null) return <p className="fdry-note">{problem}</p>
  if (view === null) return <div className="fdry-empty">Loading the run…</div>

  const lanes = [...new Set(view.graph.nodes.map((n) => n.lane ?? 0))].sort((a, b) => a - b)
  const orphaned = view.orphaned ?? []

  const standing = view.standing
  const waiting = view.waiting ?? []
  const stranded = view.stranded ?? []

  return (
    <div className="fdry-shell">
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

      {/* Where the run stands, and the move that takes it forward.

          First on the screen and across its width, because everything below is
          detail about a run whose state this is the only statement of. Without
          it the panel opened on a wall of grey chips: a run halted two hours
          earlier at an undecided gate drew the same chips as one mid-build,
          the gate holding it was named nowhere, and the list that sent you
          here called the same order "ready to hand off". */}
      {standing === undefined ? null : (
        <section
          className={`fdry-standing is-${standing.kind}${standing.turn === 'you' ? ' is-yours' : ''}`}
          aria-labelledby="fdry-standing-h"
        >
          <div className="fdry-standing-head">
            <span className="fdry-standing-mark" aria-hidden="true">
              {standing.turn === 'you' ? (
                <AlertCircle />
              ) : standing.kind === 'done' ? (
                <CheckCircle2 />
              ) : (
                <Loader />
              )}
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

          {standing.total === 0 ? null : (
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
          )}

          {/* An agent stopped at a prompt only a person can clear.

              Nothing on this screen could answer it: the bridge had already
              taken the question out of the UI and put it in the terminal, so
              the one move is to go there. */}
          {standing.kind === 'stranded' && stranded.length > 0 ? (
            <div className="fdry-standing-gate">
              <div className="fdry-standing-options">
                {stranded.map((session) => (
                  <div key={session} className="fdry-standing-option">
                    <button
                      type="button"
                      className="is-primary"
                      disabled={busy}
                      onClick={() => void control('foundry:run-terminal', { sessionId: session })}
                    >
                      <Terminal aria-hidden="true" /> Go to its terminal
                    </button>
                    <small>
                      {view.graph.nodes.find((n) => n.sessionId === session) === undefined
                        ? session
                        : (view.labels?.[
                            view.graph.nodes.find((n) => n.sessionId === session)?.id ?? ''
                          ] ?? session)}
                    </small>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* A run nothing is running, and the one thing to do about it.

              This was its own panel below the band, which meant the screen
              said "nothing is running this" twice in two different voices.
              The band states it; this is the move. */}
          {standing.kind === 'adrift' ? (
            <div className="fdry-standing-gate">
              <p className="fdry-note">
                {orphaned.map((id) => view.labels?.[id] ?? id).join(', ')}
              </p>
              <div className="fdry-standing-options">
                <div className="fdry-standing-option">
                  <button
                    type="button"
                    className="is-primary"
                    disabled={busy}
                    onClick={() => void decideRun('foundry:run.resume')}
                  >
                    Pick it back up
                  </button>
                  <small>Every step that stopped is started again where it left off.</small>
                </div>
              </div>
            </div>
          ) : null}

          {/* The gate's own options, on the screen showing the order it holds.
              A check that names a problem and offers no reachable control is a
              wall: this one was answerable only from a tab the operator had no
              reason to connect to the run they were looking at. */}
          {waiting.map((gate) => (
            <div key={gate.id} className="fdry-standing-gate">
              <p className="fdry-standing-gate-h">{gate.summary}</p>
              <p className="fdry-note">{gate.why}</p>
              <div className="fdry-standing-options">
                {/* One recommended action, not two. Every rule lists the
                    affirmative — carry on, approve, raise — first, and the
                    ways of stopping after it; drawing "Stop here" as loudly as
                    "Raise the budget" makes the operator read three buttons to
                    find out which one keeps the work alive. */}
                {gate.options.map((option, index) => (
                  <div key={option.id} className="fdry-standing-option">
                    <button
                      type="button"
                      className={index === 0 ? 'is-primary' : undefined}
                      disabled={busy}
                      onClick={() => void decideGate(gate.id, option.id)}
                    >
                      {option.label}
                    </button>
                    <small>{option.consequence}</small>
                  </div>
                ))}
              </div>
              {/* What happens if this is left alone, in the option's own
                  words. It printed the option id — "this holds: hold" — which
                  is a token from a rules file, not a sentence. */}
              <p className="fdry-note">
                Nothing happens until you answer. Left alone, Foundry takes &ldquo;
                {gate.options.find((o) => o.id === gate.defaultIfIgnored)?.label ??
                  gate.defaultIfIgnored}
                &rdquo;.
              </p>
            </div>
          ))}
        </section>
      )}

      {/* Always here, not only when the run is orphaned.

          Both of these lived inside the "nothing is running this" band, so a
          run that was live — or halted at a gate — had no way out on this
          screen at all, and `order.cancel` refuses a running order and points
          back at the gate. Three orders for one ask, all `cancelled`, and four
          branches cut by hand, is what that cost. */}
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

      {/* Held tool calls, oldest first — the order they must be answered in.
          This is the UI-first half of the promise: the terminal is the
          backstop, not the only way to answer.

          Above the run graph rather than under it. A held call is the only
          thing on this screen that is waiting on a person; it used to sit
          below every lane and every unit, which on a real run is a scroll —
          and an agent blocked at a PreToolUse hook looks exactly like an agent
          that has gone quiet. */}
      {pending.length > 0 ? (
        <section className="fdry-needs-you" aria-labelledby="fdry-waiting-h">
          <h3 className="fdry-needs-you-h" id="fdry-waiting-h">
            <ShieldQuestion aria-hidden="true" />
            Waiting on you — {pending.length}
          </h3>
          <div className="fdry-needs-you-list">
            {pending.map((ask) => (
              <div key={ask.requestId} className="fdry-ask">
                <span className="fdry-ask-icon" aria-hidden="true">
                  <ShieldQuestion />
                </span>
                <div className="fdry-ask-main">
                  <b>{ask.summary}</b>
                  <small>
                    <code>{ask.toolName}</code>
                  </small>
                  {ask.detail !== null ? <pre className="fdry-ask-detail">{ask.detail}</pre> : null}
                </div>
                <div className="fdry-ask-actions">
                  <button
                    type="button"
                    className="is-primary"
                    onClick={() => void answer(ask, 'allow')}
                  >
                    Allow
                  </button>
                  <button type="button" onClick={() => void answer(ask, 'deny')}>
                    Deny
                  </button>
                  <button
                    type="button"
                    title="Answer it in the terminal instead"
                    onClick={() => void handBack(ask)}
                  >
                    <Terminal aria-hidden="true" /> In the terminal
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Only where there is more than one repository. A single-lane order
          gets no merge-order section at all, because "1 of 1, merges first"
          is ceremony over nothing (FR-068). */}
      {(view.lanes?.length ?? 0) > 1 ? (
        <section className="fdry-panel" style={{ marginBottom: 12 }}>
          <h3 className="fdry-panel-h">Merge order</h3>
          <ol className="fdry-merge">
            {view.lanes?.map((row) => (
              <li key={row.ord} className={row.hold === null ? '' : 'is-held'}>
                <b>{row.repo}</b>
                {row.role === null ? null : <span className="fdry-role">{row.role}</span>}
                {row.collisions.length > 0 ? (
                  <small>shares {row.collisions.join(', ')}</small>
                ) : null}
                {row.hold === null ? (
                  <small>free to merge</small>
                ) : (
                  <small className="fdry-hold">{row.hold}</small>
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {lanes.map((lane) => (
        <div key={lane} className="fdry-lane">
          <div className="fdry-lane-name">
            <b>{laneName(view, lane)}</b>
          </div>
          <div className="fdry-units">
            {view.graph.nodes
              .filter((n) => (n.lane ?? 0) === lane)
              .map((node) => {
                // A node the graph calls running that nothing is running.
                // Drawn as what it is: left alone the chip read "building"
                // under a band saying nothing was running it, and a surface
                // that contradicts itself is worse than one that says less.
                const gone = orphaned.includes(node.id)
                return (
                  <span
                    key={node.id}
                    className={`fdry-unit is-${node.state}${gone ? ' is-orphaned' : ''}`}
                    // The id stays reachable because it is what the ledger and
                    // the graph call this node, but it is not what a person
                    // watching the run needs to read.
                    title={node.id}
                  >
                    {view.labels?.[node.id] ?? node.id}
                    <u>{gone ? 'stopped' : STATE_LABEL[node.state]}</u>
                    {node.sessionId !== null && !gone ? (
                      <>
                        <button
                          type="button"
                          className="fdry-unit-attach"
                          aria-label={`Watch ${view.labels?.[node.id] ?? node.id}`}
                          onClick={() => setWatching(node.sessionId)}
                        >
                          <ShieldQuestion aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="fdry-unit-attach"
                          aria-label={`Attach to ${view.labels?.[node.id] ?? node.id}`}
                          onClick={() => void attach(node.id)}
                        >
                          <Terminal aria-hidden="true" />
                        </button>
                      </>
                    ) : null}
                  </span>
                )
              })}
          </div>
        </div>
      ))}

      {/* What the agent has been saying, and the three things you can do to it
          without leaving. */}
      {watching !== null ? (
        <section className="fdry-panel" style={{ marginTop: 12 }}>
          <h3 className="fdry-panel-h">{watching}</h3>
          <pre className="fdry-transcript">
            {transcript.length === 0 ? 'Nothing yet.' : transcript.join('\n')}
          </pre>
          <form
            className="fdry-redirect"
            onSubmit={(event) => {
              event.preventDefault()
              if (redirect.trim() === '') return
              void control('foundry:run-redirect', {
                sessionId: watching,
                message: redirect.trim(),
              })
              setRedirect('')
            }}
          >
            <input
              aria-label="Tell it what to do instead"
              placeholder="Tell it what to do instead…"
              value={redirect}
              onChange={(event) => setRedirect(event.target.value)}
            />
            <button type="submit" disabled={redirect.trim() === ''}>
              <CornerDownLeft aria-hidden="true" /> Redirect
            </button>
            <button
              type="button"
              onClick={() => void control('foundry:run-interrupt', { sessionId: watching })}
            >
              Interrupt
            </button>
            <button
              type="button"
              onClick={() =>
                void control('foundry:run-stop', {
                  sessionId: watching,
                  reason: 'stopped from the floor',
                })
              }
            >
              <Square aria-hidden="true" /> Stop
            </button>
          </form>
        </section>
      ) : null}

      {/* Finished work nobody has looked at, worst risk first. Rejecting is
          hunk by hunk, because one file routinely holds both the change you
          asked for and the one you did not. */}
      {review.length > 0 ? (
        <section className="fdry-panel" style={{ marginTop: 12 }}>
          <h3 className="fdry-panel-h">To review — {review.length}</h3>
          {review.map((item) => (
            <div key={item.sessionId} className="fdry-review-row">
              <span className={`fdry-grade is-${item.grade.toLowerCase()}`}>{item.grade}</span>
              <div className="fdry-review-main">
                <b>{item.branch}</b>
                <small>
                  {item.gradeTrigger} · {item.diffSummary.files} files, +{item.diffSummary.added}/−
                  {item.diffSummary.removed}
                </small>
              </div>
              <button type="button" onClick={() => void openReview(item)}>
                <ScanEye aria-hidden="true" /> Review
              </button>
            </div>
          ))}
        </section>
      ) : null}

      {reviewing !== null ? (
        <section className="fdry-panel" style={{ marginTop: 12 }}>
          <h3 className="fdry-panel-h">
            Reviewing {reviewing}
            {step === null ? '' : ` — ${STEP_ASKS[step]}`}
          </h3>
          {intent?.hasScopeConcern === true ? (
            <p className="fdry-note fdry-scope">
              {intent.unexpectedFiles.length > 0
                ? `Touched without being asked: ${intent.unexpectedFiles.join(', ')}.`
                : ''}
              {intent.untouchedFiles.length > 0
                ? ` Asked for and never touched: ${intent.untouchedFiles.join(', ')}.`
                : ''}
            </p>
          ) : null}
          {hunks === null ? (
            <p className="fdry-note">
              The supervision runtime is not running, so there is no diff to show. That is not the
              same as a change that touched nothing.
            </p>
          ) : hunks.length === 0 ? (
            <p className="fdry-note">This run changed nothing.</p>
          ) : (
            hunks.map((file) => (
              <div key={file.file} className="fdry-hunk-file">
                <code>{file.file}</code>
                {file.hunks.map((hunk) => (
                  <div key={hunk.id} className={`fdry-hunk is-${hunk.decision ?? 'undecided'}`}>
                    <pre>{hunk.lines.join('\n')}</pre>
                    <div className="fdry-hunk-actions">
                      <button
                        type="button"
                        aria-label={`Accept ${hunk.id}`}
                        className={hunk.decision === 'accept' ? 'is-primary' : ''}
                        onClick={() => void decideHunk(hunk.id, 'accept')}
                      >
                        <Check aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Reject ${hunk.id}`}
                        className={hunk.decision === 'reject' ? 'is-primary' : ''}
                        onClick={() => void decideHunk(hunk.id, 'reject')}
                      >
                        <X aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
          {fullReject ? (
            <p className="fdry-note fdry-scope">
              Every hunk is rejected. Applying this takes the whole change back out.
            </p>
          ) : null}
          <div className="fdry-hunk-actions" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="is-primary"
              // Half a review is not a review: applying it would accept by
              // default every hunk nobody looked at.
              disabled={!decided}
              title={decided ? '' : 'Decide every hunk first'}
              onClick={() => void applyReview()}
            >
              {decided ? 'Apply what I decided' : 'Decide every hunk first'}
            </button>
            <button
              type="button"
              onClick={() => {
                setReviewing(null)
                setHunks(null)
                setIntent(null)
                setStep(null)
              }}
            >
              Close
            </button>
          </div>
        </section>
      ) : null}

      {/* What happened while you were away. Every row can be cleared, and a
          run that keeps interrupting can be muted without hiding what it
          does — a feed you cannot clear a line from is one you stop reading. */}
      {feed.length > 0 || mutes.length > 0 ? (
        <section className="fdry-panel" style={{ marginTop: 12 }}>
          <h3 className="fdry-panel-h">Activity</h3>
          {mutes.length > 0 ? (
            <p className="fdry-note">
              Silenced:{' '}
              {mutes.map((rule) => (
                <button
                  key={`${rule.sessionId ?? ''}-${rule.author ?? ''}`}
                  type="button"
                  className="fdry-unmute"
                  aria-label={`Unmute ${rule.sessionId ?? rule.author ?? 'everything'}`}
                  onClick={() => void unmute(rule)}
                >
                  {rule.sessionId ?? rule.author ?? 'everything'} ✕
                </button>
              ))}
            </p>
          ) : null}
          {feed.map((entry) => (
            <div key={entry.id} className="fdry-feed-row">
              <span className="fdry-feed-author">{entry.author}</span>
              <span className="fdry-feed-summary">{entry.summary}</span>
              <button
                type="button"
                aria-label={`Dismiss ${entry.id}`}
                onClick={() => void dismiss(entry, false)}
              >
                <X aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Mute ${entry.sessionId}`}
                title="Stop this run interrupting, without hiding what it does"
                onClick={() => void dismiss(entry, true)}
              >
                <BellOff aria-hidden="true" />
              </button>
            </div>
          ))}
        </section>
      ) : null}

      {/* Why a new run would be refused. Overriding is one click and is
          recorded with how deep the queue was at the time. */}
      {backpressure !== null && !backpressure.allowed ? (
        <p className="fdry-note fdry-scope">
          {backpressure.reason ??
            `${backpressure.unreviewed} diffs are unreviewed, and the limit is ${backpressure.limit}.`}{' '}
          A new run is refused until one is reviewed.
        </p>
      ) : null}

      {/* Work that stopped making progress without asking for anything — the
          failure nobody instruments, because it looks exactly like work. */}
      {stalls.length > 0 ? (
        <section className="fdry-panel" style={{ marginTop: 12 }}>
          <h3 className="fdry-panel-h">
            Stopped making progress — {stalls.length}
            {shadowMode ? ' (recorded, not acted on)' : ''}
          </h3>
          {stalls.slice(-5).map((entry) => {
            const session = entry.firing.sessionId
            // What the operator calls it. The panel printed the session id,
            // which is a uuid nobody chose, beside this extension's own word
            // for the signal.
            const node = view.graph.nodes.find((n) => n.sessionId === session)
            return (
              <div key={`${session}-${entry.firing.firedAt}`} className="fdry-ask">
                <div className="fdry-ask-main">
                  <b>{node === undefined ? session : (view.labels?.[node.id] ?? node.id)}</b>
                  <small>
                    {stallInWords(entry.firing)}
                    {entry.shadow ? ' · shadow' : ''}
                  </small>
                </div>
                {/* A panel that names a stall and offers nothing is a wall.
                    These are the three things you do about one, and every
                    channel behind them already existed. */}
                <div className="fdry-ask-actions">
                  <button type="button" onClick={() => setWatching(session)}>
                    <ScanEye aria-hidden="true" /> Read what it was saying
                  </button>
                  <button
                    type="button"
                    onClick={() => void control('foundry:run-terminal', { sessionId: session })}
                  >
                    <Terminal aria-hidden="true" /> Take it over
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void control('foundry:run-stop', {
                        sessionId: session,
                        reason: 'stopped from the Floor: it had stopped making progress',
                      })
                    }
                  >
                    <Square aria-hidden="true" /> End this agent
                  </button>
                </div>
              </div>
            )
          })}
          {shadowMode ? (
            <p className="fdry-note">
              Shadow mode: these are recorded and never notified, until the thresholds have earned
              it. Turn it off in settings once they have.
            </p>
          ) : null}
        </section>
      ) : null}

      {view.blocked.length > 0 ? (
        <section className="fdry-panel" style={{ marginTop: 12 }}>
          <h3 className="fdry-panel-h">Blocked</h3>
          {view.blocked.map((entry) => (
            <p key={entry.id} className="fdry-note" title={entry.id}>
              <b>{view.labels?.[entry.id] ?? entry.id}</b> — {entry.reason}
            </p>
          ))}
        </section>
      ) : null}

      {problem !== null ? <p className="fdry-problem">{problem}</p> : null}
    </div>
  )
}
