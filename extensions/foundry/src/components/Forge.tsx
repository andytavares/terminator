import { Markdown } from './Markdown.js'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Check, X, CircleDot, Terminal, Play, Wand, AlertCircle } from 'lucide-react'
import type { WorkOrder } from '../order/schema.js'
import type { CompileResult, CheckId } from '../order/compile.js'
import { coverageMatrix } from '../order/coverage-matrix.js'
import { surfacedQuestions } from '../forge/interview.js'
import { liveAssumptions } from '../forge/assumptions.js'
import type { StateMapping, TransitionIntent, WriteBack } from '../order/schema.js'
import type { CapabilityReport } from '../trackers/write-back.js'

// The Forge.
//
// The document is the subject and the conversation is behind it. The operator's
// whole job on this screen is in the left rail: six checks, and at most three
// questions. Everything else the Forge decided is a strikeable assumption
// rather than something they were asked about.

export interface OrderView {
  order: WorkOrder
  compile: CompileResult
  changed?: string[]
  unavailableChecks?: string[]
  /** The session the architect is drafting in, while it is drafting. */
  converging?: string
}

/** How often the document is refetched while the architect is working. */
const REDRAFT_POLL_MS = 3000

interface StatesView {
  capability?: CapabilityReport
  mapping?: StateMapping
  error?: string
}

/** One shape of work this order could take, and why not where it cannot. */
interface RecipeOption {
  name: string
  available: boolean
  unmet: string[]
  rung: string | null
  description?: string
}

interface RecipesView {
  recipes?: RecipeOption[]
  proposed?: string
  /** Why that shape was proposed (FR-014) — the grounds, not just the answer. */
  proposedWhy?: string
  error?: string
}

const INTENTS: readonly TransitionIntent[] = ['started', 'in_review', 'done']

/** What this order writes back to its issue, and what each one is. */
const WRITE_BACKS: readonly { id: WriteBack; label: string }[] = [
  { id: 'summary_comment', label: 'The agreed order, as a comment' },
  { id: 'status', label: 'Move its workflow state' },
  { id: 'pr_link', label: 'The pull request links' },
]

/** What each intent means in plain terms — the tracker's words are its own. */
const INTENT_LABELS: Record<TransitionIntent, string> = {
  started: 'When work starts',
  in_review: 'When the draft opens',
  done: 'When it merges',
}

const CHECK_LABELS: Record<CheckId, string> = {
  questions: 'No open questions',
  verifiable: 'Criteria falsifiable',
  coverage: 'Coverage both ways',
  risk: 'Risk graded',
  redTeam: 'Red team resolved',
  budgets: 'Budgets set',
}

const CHECK_ORDER: CheckId[] = ['questions', 'verifiable', 'coverage', 'risk', 'redTeam', 'budgets']

/**
 * What the operator does about a failing check.
 *
 * Either the control that clears it is already on this screen and the row
 * takes you to it, or the thing that has to change is the plan and the row
 * asks the architect for it in as many words. A check that states what is
 * wrong and stops is the state this screen was in: the red team findings were
 * the only one of the six with any move attached, and `verifiable` was the
 * worst of the other five — its own failure text names an escape ("accept it
 * as unverifiable in writing") that nothing in the application could reach.
 */
type Remedy =
  /** Take me to the control that clears this, elsewhere on the screen. */
  | { readonly kind: 'goto'; readonly label: string; readonly target: string }
  /** Redraft, carrying this instruction to the architect. */
  | { readonly kind: 'ask'; readonly label: string; readonly message: string }

const CHECK_REMEDIES: Record<CheckId, readonly Remedy[]> = {
  questions: [{ kind: 'goto', label: 'Answer them', target: 'fdry-needs-you-h' }],
  verifiable: [
    {
      kind: 'ask',
      label: 'Ask for proof',
      message:
        'Every acceptance criterion needs something that can actually decide it. Give each one a command, a named test, or a rubric with named evidence — and where a unit changes a file a person looks at, add a criterion whose verify kind is "screenshot", with the target named, because a command cannot say whether it renders.',
    },
    { kind: 'goto', label: 'Or mark one unprovable', target: 'fdry-acceptance' },
  ],
  coverage: [
    {
      kind: 'ask',
      label: 'Ask for the gap to be closed',
      message:
        'The coverage check fails. Every criterion needs a unit that builds it and every unit needs a criterion it satisfies; where lanes share a file, declare exactly one of them the producer.',
    },
  ],
  risk: [
    {
      kind: 'ask',
      label: 'Ask for a regrade',
      message:
        'The risk grade was not taken against this plan. Declare a blast radius that covers everything the plan touches, and grade the risk against it.',
    },
  ],
  redTeam: [{ kind: 'goto', label: 'Clear them', target: 'fdry-redteam' }],
  budgets: [
    {
      kind: 'ask',
      label: 'Ask it to fit the budget',
      message:
        'The plan does not fit its budgets. Either propose budgets this plan fits, or cut the plan down to the budgets the order already has.',
    },
  ],
}

/**
 * Take the operator to the control that clears a check.
 *
 * Focused as well as scrolled: the rail is sticky, so a failing check stays on
 * screen while the thing that clears it is hundreds of pixels away in either
 * direction, and a page that silently jumped would leave a keyboard user's
 * focus behind in the rail.
 */
function goTo(target: string): void {
  const element = document.getElementById(target)
  if (element === null) return
  element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  element.focus({ preventScroll: true })
}

function invoke(channel: string, payload: unknown): Promise<unknown> {
  return window.electronAPI.extensionBridge.invoke(channel, payload)
}

export interface ForgeProps {
  readonly orderId: string
  /** The run has begun; the caller swaps this surface for the Floor. */
  readonly onStarted?: (orderId: string) => void
}

/**
 * Take me to the terminal the architect is in.
 *
 * The backstop the whole design rests on: the agent runs in a real terminal
 * and you can go and type at it.
 */
async function attachToArchitect(sessionId: string): Promise<string | null> {
  const r = (await invoke('foundry:run-terminal', { sessionId })) as { ok?: boolean }
  return r.ok === true ? null : 'that conversation no longer has a terminal'
}

export function Forge({ orderId, onStarted }: ForgeProps): JSX.Element {
  const [view, setView] = useState<OrderView | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  /** Set when a start was refused for backpressure, which the operator may override. */
  const [heldBack, setHeldBack] = useState<{ unreviewed: number; limit: number } | null>(null)
  const [states, setStates] = useState<StatesView | null>(null)
  /** What the last turn moved, so the operator can see the redraw (FR-007). */
  const [moved, setMoved] = useState<string[]>([])
  const [accepting, setAccepting] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  /** The criterion being accepted as unverifiable, and why. Kept apart from
      the red team's own reason so two open forms never share a box. */
  const [unproven, setUnproven] = useState<string | null>(null)
  const [unprovenReason, setUnprovenReason] = useState('')
  /**
   * The architect is working, until the document says otherwise.
   *
   * Its own state rather than a field on the view: the view is replaced on
   * every poll by `order.compile`, which knows nothing about a session, so
   * deriving it from there cleared the flag after one tick and stopped the
   * poll — and a redraft landing a minute later never appeared.
   */
  const [drafting, setDrafting] = useState(false)
  const [recipes, setRecipes] = useState<RecipesView | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const next = (await invoke('foundry:order.compile', { id: orderId, commit: false })) as
      | OrderView
      | { error: string }
    if ('error' in next) return
    setView(next)
  }, [orderId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Read once, not on every redraw: this is a request to the tracker, and
  // polling it would spend the operator's rate limit on a panel that does not
  // change.
  useEffect(() => {
    let live = true
    void (async () => {
      const next = (await invoke('foundry:order.states', { id: orderId })) as StatesView
      if (live) setStates(next)
    })()
    return () => {
      live = false
    }
  }, [orderId])

  // Read once, alongside the document. What shapes of work this repository can
  // actually support is a fact about the repository, not about the draft.
  useEffect(() => {
    let live = true
    void (async () => {
      const next = (await invoke('foundry:run.recipes', { id: orderId })) as RecipesView
      if (live) setRecipes(next)
    })()
    return () => {
      live = false
    }
  }, [orderId])

  const setWriteBack = useCallback(
    async (writeBack: WriteBack[]) => {
      const next = (await invoke('foundry:order.writeBack', { id: orderId, writeBack })) as
        | OrderView
        | { error: string }
      if ('order' in next) setView(next)
    },
    [orderId]
  )

  const mapIntent = useCallback(
    async (intent: TransitionIntent, optionId: string | null) => {
      const next = (await invoke('foundry:order.mapState', { id: orderId, intent, optionId })) as {
        mapping?: StateMapping
      }
      if (next.mapping !== undefined) {
        setStates((current) => (current === null ? current : { ...current, mapping: next.mapping }))
      }
    },
    [orderId]
  )

  const turn = useCallback(
    async (payload: Record<string, unknown>) => {
      setBusy(true)
      setProblem(null)
      try {
        const next = (await invoke('foundry:order.turn', { id: orderId, ...payload })) as
          | (OrderView & { error?: string })
          | { error: string }
        // A turn can both move the document and report a problem — intake that
        // refused a proposal returns the order as it stands *and* why.
        if ('order' in next) {
          setView(next)
          setMoved(next.changed ?? [])
        }
        if (next.error !== undefined) setProblem(next.error)
      } finally {
        setBusy(false)
      }
    },
    [orderId]
  )

  /** Ask the architect for a draft, or a redraft. */
  const converge = useCallback(
    async (message?: string) => {
      setBusy(true)
      setProblem(null)
      try {
        decisionsAtStart.current = view?.order.provenance.decisions.length ?? 0
        const next = (await invoke('foundry:order.converge', {
          id: orderId,
          ...(message === undefined ? {} : { message }),
        })) as (OrderView & { error?: string; converging?: string }) | { error: string }
        if ('order' in next) setView(next)
        if (next.error !== undefined) setProblem(next.error)
        setDrafting('converging' in next && next.converging !== undefined)
      } finally {
        setBusy(false)
      }
    },
    [orderId, view]
  )

  // The architect answers in minutes, not in the call that started it, so the
  // document is refetched while it works and the redraft appears when it
  // lands. What stops the poll is the record growing — the architect writes a
  // line whether it redrafted, refused or found nothing to change — rather
  // than a timeout, which would either give up early or poll for ever.
  const decisionsAtStart = useRef(0)
  useEffect(() => {
    if (!drafting) return
    const timer = setInterval(() => void refresh(), REDRAFT_POLL_MS)
    return () => clearInterval(timer)
  }, [drafting, refresh])

  useEffect(() => {
    if (!drafting || view === null) return
    if (view.order.provenance.decisions.length > decisionsAtStart.current) setDrafting(false)
  }, [drafting, view])

  /**
   * Compile, agree, and start the Line.
   *
   * One action, because "handed off" that leaves the order sitting agreed with
   * nothing running is the failure this button exists to avoid — the operator
   * pressed hand off, and work has to start.
   *
   * The run is started separately from the agreement rather than inside it:
   * agreeing is a decision and is recorded; starting can fail on a recipe this
   * repository cannot support, and that must not un-agree what was agreed.
   */
  const handOff = useCallback(
    async (force = false) => {
      setBusy(true)
      setProblem(null)
      try {
        const next = (await invoke('foundry:order.compile', { id: orderId, commit: true })) as
          | OrderView
          | { error: string }
        if ('error' in next) {
          setProblem(next.error)
          return
        }
        setView(next)
        if (next.order.status !== 'agreed') return

        const started = (await invoke('foundry:run.start', {
          id: orderId,
          // Only when the operator picked one. Absent means the proposal
          // stands, and the ledger records which of the two it was.
          ...(chosen === null ? {} : { recipe: chosen }),
          ...(force ? { force: true } : {}),
        })) as {
          error?: string
          order?: { status: string }
          backpressure?: { unreviewed: number; limit: number }
        }
        if (started.error !== undefined) {
          setProblem(`The order is agreed, but the run did not start: ${started.error}`)
          // A refusal for backpressure is the one the operator can answer: it is
          // about their own review queue, not about the order.
          setHeldBack(started.backpressure ?? null)
          return
        }
        setHeldBack(null)
        onStarted?.(orderId)
      } finally {
        setBusy(false)
      }
    },
    [orderId, onStarted, chosen]
  )

  if (view === null) {
    return <div className="fdry-empty">Loading the order…</div>
  }

  const { order, compile } = view
  const failed = new Set(compile.failures.map((f) => f.check))
  const matrix = coverageMatrix(order)
  const questions = surfacedQuestions(order.openQuestions)
  const assumptions = liveAssumptions(order)
  const openFindings = order.redTeam.filter((f) => f.status === 'open')

  return (
    <div className="fdry-forge">
      {/* The one thing on this screen that is waiting on a person, and so the
          first thing on it.

          This was the third panel down the left rail, under six convergence
          checks and up to six recipe cards — below the fold on any window
          narrower than about 1200px, and on a wider one placed wherever the
          rail's own grid happened to put it. An operator reported it took them
          for ever to find. A question you have to go hunting for is a question
          that does not get answered, and every unanswered one holds the whole
          order at "no open questions" failing. */}
      {questions.length > 0 ? (
        <section className="fdry-needs-you" aria-labelledby="fdry-needs-you-h">
          <h2 className="fdry-needs-you-h" id="fdry-needs-you-h" tabIndex={-1}>
            <AlertCircle aria-hidden="true" />
            Needs you — {questions.length}
          </h2>
          <div className="fdry-needs-you-list">
            {questions.map((question) => (
              <div key={question.id} className="fdry-question">
                <b>{question.text}</b>
                {question.why !== '' ? <p>{question.why}</p> : null}
                <div className="fdry-options">
                  {question.options.map((option, index) => (
                    <button
                      key={option}
                      type="button"
                      className={index === question.recommended ? 'is-recommended' : ''}
                      disabled={busy}
                      onClick={() =>
                        void turn({ answer: { questionId: question.id, option: index } })
                      }
                    >
                      {option}
                      {index === question.recommended ? ' (recommended)' : ''}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <aside className="fdry-rail">
        <section className="fdry-panel">
          <h2 className="fdry-panel-h">Convergence</h2>
          {CHECK_ORDER.map((id) => {
            const bad = failed.has(id)
            const failure = compile.failures.find((f) => f.check === id)
            return (
              <div key={id} className={`fdry-check ${bad ? 'is-fail' : 'is-pass'}`}>
                <span className="fdry-check-mark" aria-hidden="true">
                  {bad ? <X /> : <Check />}
                </span>
                <span>
                  <b>{CHECK_LABELS[id]}</b>
                  {bad && failure !== undefined ? <small>{failure.detail}</small> : null}
                  {/* Saying what is wrong is half of it. A check that names no
                      move is one the operator stares at — which is what every
                      one of these but the red team did. */}
                  {bad && order.status === 'draft' ? (
                    <span className="fdry-remedy">
                      {CHECK_REMEDIES[id].map((remedy) => (
                        <button
                          key={remedy.label}
                          type="button"
                          disabled={busy || (remedy.kind === 'ask' && drafting)}
                          onClick={() =>
                            remedy.kind === 'goto'
                              ? goTo(remedy.target)
                              : void converge(remedy.message)
                          }
                        >
                          {remedy.label}
                        </button>
                      ))}
                    </span>
                  ) : null}
                </span>
              </div>
            )
          })}
          {/* The plan does not write itself. Until the architect has run, the
              six checks below are a list of everything that is missing — so
              this is the action, and hand-off is the one after it. */}
          {order.status === 'draft' ? (
            <button
              type="button"
              className="fdry-converge"
              disabled={busy || drafting}
              onClick={() => void converge()}
            >
              <Wand aria-hidden="true" />
              {drafting
                ? 'The architect is working…'
                : order.acceptance.length === 0
                  ? 'Draft the plan'
                  : 'Redraft'}
            </button>
          ) : null}
          <button
            type="button"
            className="fdry-compile"
            disabled={!compile.ok || busy || order.status !== 'draft'}
            onClick={() => void handOff()}
          >
            <Play aria-hidden="true" />
            {order.status !== 'draft'
              ? `Handed off — ${order.status}`
              : compile.ok
                ? 'Compile & hand off'
                : `Blocked by ${compile.failures.length}`}
          </button>
          {problem !== null ? <p className="fdry-problem">{problem}</p> : null}
          {/* The one refusal the operator can answer: it is about their own
              review queue, not about the order. Overriding is one click, and
              the depth they ignored goes in the record (FR-054). */}
          {heldBack !== null ? (
            <button
              type="button"
              className="fdry-compile"
              disabled={busy}
              onClick={() => void handOff(true)}
            >
              <Play aria-hidden="true" /> Start anyway — {heldBack.unreviewed} waiting for review
            </button>
          ) : null}
        </section>

        {/* The shape of work. Proposed rather than chosen — a proposal nobody
            can predict is worse than a plain one — and overridden in one
            click, with the override recorded. */}
        {(recipes?.recipes?.length ?? 0) > 0 && order.status === 'draft' ? (
          <section className="fdry-panel">
            <h2 className="fdry-panel-h">Shape of work</h2>
            {recipes?.proposedWhy !== undefined && recipes.proposedWhy !== '' ? (
              <p className="fdry-note">
                {recipes.proposed} proposed — {recipes.proposedWhy}.
              </p>
            ) : null}
            {recipes?.recipes?.map((option) => {
              const isChosen = (chosen ?? recipes.proposed) === option.name
              return (
                <button
                  key={option.name}
                  type="button"
                  className={`fdry-recipe ${isChosen ? 'is-on' : ''}`}
                  disabled={!option.available || busy}
                  title={option.available ? option.description : option.unmet.join('; ')}
                  onClick={() => setChosen(option.name)}
                >
                  <b>{option.name}</b>
                  <small>
                    {option.available
                      ? (option.description ?? `from ${option.rung ?? 'built-in'}`)
                      : option.unmet.join('; ')}
                  </small>
                  {option.name === recipes.proposed && chosen === null ? (
                    <span className="fdry-recipe-mark">proposed</span>
                  ) : null}
                </button>
              )
            })}
          </section>
        ) : null}

        {states?.capability !== undefined && states.capability.transitions !== 'no_issue' ? (
          <section className="fdry-panel">
            <h2 className="fdry-panel-h">Tracker write-back</h2>
            {states.capability.transitions === 'unsupported' ? (
              <p className="fdry-note">
                {order.source.tracker} cannot be asked to move an issue, so {order.source.key} will
                not change state. The summary comment and the pull request links still go across.
              </p>
            ) : (
              <>
                <p className="fdry-note">
                  Which of {order.source.tracker}&rsquo;s own states each moment means. Left alone,
                  the tracker resolves it.
                </p>
                {INTENTS.map((intent) => (
                  <label key={intent} className="fdry-map">
                    <span>{INTENT_LABELS[intent]}</span>
                    <select
                      value={states.mapping?.[intent] ?? ''}
                      onChange={(event) =>
                        void mapIntent(
                          intent,
                          event.target.value === '' ? null : event.target.value
                        )
                      }
                    >
                      <option value="">
                        {states.capability?.unreachable.includes(intent) === true
                          ? 'nowhere to go — skipped'
                          : 'let the tracker decide'}
                      </option>
                      {states.capability?.states.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </>
            )}

            {/* Per order, defaulting from configuration (FR-062). A run
                against somebody else's repository is a reason to turn one off
                without changing the setting for every order after it. */}
            <div className="fdry-writebacks">
              {WRITE_BACKS.map((kind) => (
                <label key={kind.id} className="fdry-writeback">
                  <input
                    type="checkbox"
                    checked={order.writeBack.includes(kind.id)}
                    onChange={(event) =>
                      void setWriteBack(
                        event.target.checked
                          ? [...order.writeBack, kind.id]
                          : order.writeBack.filter((w) => w !== kind.id)
                      )
                    }
                  />
                  {kind.label}
                </label>
              ))}
            </div>
          </section>
        ) : null}

        {view.unavailableChecks !== undefined && view.unavailableChecks.length > 0 ? (
          <section className="fdry-panel">
            <h2 className="fdry-panel-h">Not measurable here</h2>
            <p className="fdry-note">
              This repository has no command for {view.unavailableChecks.join(', ')}. Those checks
              will report &ldquo;not measured&rdquo; rather than passing.
            </p>
          </section>
        ) : null}
      </aside>

      <main className="fdry-doc">
        <header className="fdry-doc-head">
          <h1>{order.title}</h1>
          {order.source.key !== null ? (
            <span className="fdry-src">
              {order.source.tracker} {order.source.key}
            </span>
          ) : null}
          <span className="fdry-id">{order.id}</span>
          {/* The conversation that wrote this plan. Rendered from the order's
              own record rather than a prop nobody passed — which is why this
              control never appeared in the running application at all. */}
          {order.provenance.forgeSession !== null ? (
            <button
              type="button"
              className="fdry-attach"
              onClick={() =>
                void attachToArchitect(order.provenance.forgeSession ?? '').then(setProblem)
              }
            >
              <Terminal aria-hidden="true" /> Attach
            </button>
          ) : null}
        </header>
        <p className="fdry-doc-sub">
          recipe <b>{order.recipe ?? 'not chosen'}</b> · risk {order.risk.grade} ·{' '}
          {order.plan.units.length} units · {order.status}
        </p>

        <section className={`fdry-field ${moved.includes('intent') ? 'is-redrawn' : ''}`}>
          <h2 className="fdry-panel-h">Intent</h2>
          {/* A tracker's description is markdown, and it was rendered inside a
              `<p>` — which collapses every newline, so a ticket's headings and
              acceptance list arrived as one unbroken line. */}
          <p className="fdry-md-label">
            <b>Problem.</b>
            {order.intent.problem === '' ? ' not stated yet' : null}
          </p>
          <Markdown text={order.intent.problem} />
          <p className="fdry-md-label">
            <b>Outcome.</b>
            {order.intent.outcome === '' ? ' not stated yet' : null}
          </p>
          <Markdown text={order.intent.outcome} />
        </section>

        <section className={`fdry-field ${moved.includes('acceptance') ? 'is-redrawn' : ''}`}>
          <h2 className="fdry-panel-h" id="fdry-acceptance" tabIndex={-1}>
            Acceptance &amp; how it is proven
          </h2>
          {order.acceptance.length === 0 ? (
            <p className="fdry-note">
              {order.source.kind === 'tracker'
                ? `Nothing under an acceptance heading in ${order.source.key ?? 'the ticket'}. Press “Draft the plan” and the architect will write the criteria from what it does say.`
                : 'No criteria yet. Nothing writes them but the architect — press “Draft the plan”.'}
            </p>
          ) : (
            order.acceptance.map((criterion) => {
              const uncovered = matrix.uncoveredCriteria.includes(criterion.id)
              const excused = criterion.unverifiable?.accepted === true
              return (
                <div key={criterion.id} className={`fdry-ac ${uncovered ? 'is-gap' : ''}`}>
                  <span className="fdry-ac-id">{criterion.id}</span>
                  <div>
                    <p>{criterion.statement}</p>
                    <span className="fdry-verify">
                      {criterion.verify.kind}
                      {uncovered ? ' · no unit satisfies this' : ''}
                    </span>
                    {/* The escape the falsifiable check has always named and
                        nothing could reach: a criterion nothing here can prove
                        may be accepted anyway, in writing, and the reason
                        travels with the order. */}
                    {excused ? (
                      <p className="fdry-ac-excused">
                        accepted as unverifiable — {criterion.unverifiable?.reason}
                      </p>
                    ) : order.status === 'draft' && unproven !== criterion.id ? (
                      <button
                        type="button"
                        className="fdry-ac-excuse"
                        disabled={busy}
                        onClick={() => setUnproven(criterion.id)}
                      >
                        Nothing here can prove this
                      </button>
                    ) : null}
                    {unproven === criterion.id && !excused ? (
                      <form
                        className="fdry-accept"
                        onSubmit={(event) => {
                          event.preventDefault()
                          if (unprovenReason.trim() === '') return
                          void turn({
                            unverifiable: {
                              criterionId: criterion.id,
                              reason: unprovenReason.trim(),
                            },
                          })
                          setUnproven(null)
                          setUnprovenReason('')
                        }}
                      >
                        <input
                          aria-label={`Why ${criterion.id} cannot be proven`}
                          placeholder="Why nothing can prove it…"
                          value={unprovenReason}
                          onChange={(event) => setUnprovenReason(event.target.value)}
                        />
                        <button type="submit" disabled={unprovenReason.trim() === ''}>
                          Accept it
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
              )
            })
          )}
        </section>

        {matrix.criteria.length > 0 && matrix.units.length > 0 ? (
          <section className="fdry-field">
            <h2 className="fdry-panel-h">Coverage</h2>
            <div className="fdry-scroll">
              <table className="fdry-matrix">
                <thead>
                  <tr>
                    <th aria-label="criterion" />
                    {matrix.units.map((unit) => (
                      <th key={unit}>{unit}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.criteria.map((criterion, row) => (
                    <tr key={criterion}>
                      <td className="fdry-matrix-row">{criterion}</td>
                      {matrix.cells[row].map((hit, column) => (
                        <td
                          key={matrix.units[column]}
                          className={
                            hit
                              ? 'is-hit'
                              : matrix.uncoveredCriteria.includes(criterion)
                                ? 'is-gap'
                                : ''
                          }
                        >
                          {hit ? '●' : '·'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {assumptions.length > 0 ? (
          <section className={`fdry-field ${moved.includes('assumptions') ? 'is-redrawn' : ''}`}>
            <h2 className="fdry-panel-h">Assumptions — strike any that are wrong</h2>
            <div className="fdry-assume">
              {assumptions.map((assumption) => (
                <button
                  key={assumption.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void turn({ strike: assumption.id })}
                >
                  {assumption.text} <X aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* Every one of these has to be cleared before the order can be handed
            off. Showing them without a way to clear them is what blocked the
            gate for ever. */}
        {openFindings.length > 0 ? (
          <section className={`fdry-field ${moved.includes('redTeam') ? 'is-redrawn' : ''}`}>
            <h2 className="fdry-panel-h" id="fdry-redteam" tabIndex={-1}>
              Red team — {openFindings.length} open
            </h2>
            {openFindings.map((finding) => (
              <div key={finding.id} className="fdry-finding">
                <CircleDot aria-hidden="true" />
                <span>{finding.text}</span>
                <span className="fdry-finding-actions">
                  <button
                    type="button"
                    disabled={busy}
                    title="It is fixed"
                    onClick={() => void turn({ finding: { id: finding.id, decision: 'resolved' } })}
                  >
                    Fixed
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    title="It stands, and here is why"
                    onClick={() => setAccepting(finding.id)}
                  >
                    Accept
                  </button>
                </span>
              </div>
            ))}
            {accepting !== null ? (
              <form
                className="fdry-accept"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (reason.trim() === '') return
                  void turn({
                    finding: { id: accepting, decision: 'accepted', reason: reason.trim() },
                  })
                  setAccepting(null)
                  setReason('')
                }}
              >
                <input
                  aria-label="Why this finding is accepted"
                  placeholder="Why it stands…"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <button type="submit" disabled={reason.trim() === ''}>
                  Accept it
                </button>
              </form>
            ) : null}
          </section>
        ) : null}

        <form
          className="fdry-input"
          onSubmit={(event) => {
            event.preventDefault()
            if (draft.trim() === '') return
            // Straight to the architect. `turn` routes free text there too;
            // going directly says what the button does.
            void converge(draft)
            setDraft('')
          }}
        >
          <input
            aria-label="Tell the architect what is wrong, or what you want instead"
            placeholder="Tell the architect what's wrong, or what you want instead…"
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" disabled={busy || draft.trim() === ''}>
            Send
          </button>
        </form>
      </main>
    </div>
  )
}
