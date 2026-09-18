import { Markdown } from './Markdown.js'
import React, { useCallback, useEffect, useState } from 'react'
import { Check, X, CircleDot, Terminal, Play, Wand, AlertCircle, LoaderCircle } from 'lucide-react'
import type { WorkOrder } from '../order/schema.js'
import type { CompileResult, CheckId } from '../order/compile.js'
import { coverageMatrix } from '../order/coverage-matrix.js'
import { surfacedQuestions } from '../forge/interview.js'
import { liveAssumptions } from '../forge/assumptions.js'
import type { StateMapping, TransitionIntent, WriteBack } from '../order/schema.js'
import type { CapabilityReport } from '../trackers/write-back.js'
import type { IntakeOutcome } from '../forge/intake-outcome.js'
import { PROPOSAL_FILE } from '../order/proposal.js'
import { forgeSteps, openingStep, type StepId } from '../forge/steps.js'
import { budgetsInWords } from '../order/render.js'
import { BudgetForm } from './BudgetForm.js'

// The Forge.
//
// Walked as steps, one full-width screen each: what is asked, the plan, the red
// team, the shape of work, the tracker, hand-off. It was a document with a
// 260px rail of checks, recipe cards and tracker settings beside it, and an
// operator reported the rail's cards as too condensed to read. The six checks
// are still the gate; each failing one now sits on the step that clears it,
// and the step list marks which steps are holding hand-off up.

export interface OrderView {
  order: WorkOrder
  compile: CompileResult
  changed?: string[]
  unavailableChecks?: string[]
  /** The session the architect is drafting in, while it is drafting. */
  converging?: string
  /** How the last intake turn ended. Absent only on a channel that predates it. */
  intake?: IntakeOutcome
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
}

const CHECK_ORDER: CheckId[] = ['questions', 'verifiable', 'coverage', 'risk', 'redTeam']

const STEP_LABELS: Record<StepId, string> = {
  intent: 'Intent',
  plan: 'Plan',
  redTeam: 'Red team',
  shape: 'Shape',
  tracker: 'Tracker',
  handOff: 'Hand off',
}

const STEP_TITLES: Record<StepId, string> = {
  intent: 'What is being asked',
  plan: 'The plan and how it is proven',
  redTeam: 'Red team findings',
  shape: 'Shape of work',
  tracker: 'Tracker write-back',
  handOff: 'Checks before hand-off',
}

/** Which of a turn's redrawn fields each step shows. */
const STEP_FIELDS: Record<StepId, readonly string[]> = {
  intent: ['intent'],
  plan: ['acceptance', 'assumptions'],
  redTeam: ['redTeam'],
  shape: [],
  tracker: [],
  handOff: [],
}

const STEP_HEADING = 'fdry-step-h'

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
  /** Take me to the control that clears this, on its step — or, with no step, in the band. */
  | {
      readonly kind: 'goto'
      readonly label: string
      readonly step: StepId | null
      readonly target: string
    }
  /** Redraft, carrying this instruction to the architect. */
  | { readonly kind: 'ask'; readonly label: string; readonly message: string }

const CHECK_REMEDIES: Record<CheckId, readonly Remedy[]> = {
  questions: [{ kind: 'goto', label: 'Answer them', step: null, target: 'fdry-needs-you-h' }],
  verifiable: [
    {
      kind: 'ask',
      label: 'Ask for proof',
      message:
        'Every acceptance criterion needs something that can actually decide it. Give each one a command, a named test, or a rubric with named evidence — and where a unit changes a file a person looks at, add a criterion whose verify kind is "screenshot", with the target named, because a command cannot say whether it renders.',
    },
    { kind: 'goto', label: 'Or mark one unprovable', step: 'plan', target: 'fdry-acceptance' },
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
  redTeam: [{ kind: 'goto', label: 'Clear them', step: 'redTeam', target: STEP_HEADING }],
}

/** What the architect is told when asked to clear one red team finding. */
function findingAsk(finding: { readonly id: string; readonly text: string }): string {
  return `The red team finding ${finding.id} is open: "${finding.text}" Change the order so it no longer holds, and change nothing else.`
}

/**
 * Where the operator asked, in place of the button they pressed.
 *
 * The button used to go faintly disabled and keep its label, and the only word
 * that anything had started was in the header, out of view. So the ask becomes
 * the answer on the spot, and while it runs nothing offers a second one.
 */
function Asked(): JSX.Element {
  return (
    <span role="status" aria-label="Asked" className="fdry-asked">
      <LoaderCircle aria-hidden="true" />
      Asked — the architect is working on it. This clears when the redraft lands.
    </span>
  )
}

/**
 * Take the operator to a control or a step's heading.
 *
 * Focused as well as scrolled: a page that silently changed under a keyboard
 * user would leave their focus on a button that is no longer there.
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
  const [recipes, setRecipes] = useState<RecipesView | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  /** The step the operator went to. Until they pick one, the order opens where
      the next thing to do is, and follows it as the architect's turns land. */
  const [picked, setPicked] = useState<StepId | null>(null)
  /** Focused once the step it is on has rendered. */
  const [focusTarget, setFocusTarget] = useState<string | null>(null)

  useEffect(() => {
    if (focusTarget === null) return
    goTo(focusTarget)
    setFocusTarget(null)
  }, [focusTarget])

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

  const setBudgets = useCallback(
    async (budgets: Record<string, number | null>) => {
      setBusy(true)
      setProblem(null)
      try {
        const next = (await invoke('foundry:order.budgets', { id: orderId, budgets })) as
          | OrderView
          | { error: string }
        if ('order' in next) setView(next)
        else setProblem(next.error)
      } finally {
        setBusy(false)
      }
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
        const next = (await invoke('foundry:order.converge', {
          id: orderId,
          ...(message === undefined ? {} : { message }),
        })) as (OrderView & { error?: string; converging?: string }) | { error: string }
        if ('order' in next) setView(next)
        if (next.error !== undefined) setProblem(next.error)
      } finally {
        setBusy(false)
      }
    },
    [orderId]
  )

  /**
   * Whether an architect is working on this order, from the record.
   *
   * Its own `useState` before, set when the converge call returned and cleared
   * when `provenance.decisions` grew. Both halves were wrong. A refusal grows
   * nothing — the proposal failed validation, so there is no redraft to save
   * and the document is untouched — so the flag was never cleared and the
   * button read "The architect is working…" for ever, over a turn that had
   * ended minutes earlier. And a flag set by a click cannot survive leaving
   * the screen, so coming back mid-turn showed a draft that looked idle.
   *
   * The ledger knows both. `intake` is the last of this order's three intake
   * lines, and a turn is running exactly while the last one is its start.
   */
  const intake: IntakeOutcome = view?.intake ?? { kind: 'none' }
  const drafting = intake.kind === 'running'
  /** The instruction the running turn was started with, to find the ask it answers. */
  const asked = intake.kind === 'running' ? intake.asked : null

  // The architect answers in minutes, not in the call that started it, so the
  // document is refetched while it works and the outcome — a redraft, or the
  // reason it was refused — appears when it lands.
  useEffect(() => {
    if (!drafting) return
    const timer = setInterval(() => void refresh(), REDRAFT_POLL_MS)
    return () => clearInterval(timer)
  }, [drafting, refresh])

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
  const isDraft = order.status === 'draft'
  const matrix = coverageMatrix(order)
  const questions = surfacedQuestions(order.openQuestions)
  const assumptions = liveAssumptions(order)
  const openFindings = order.redTeam.filter((f) => f.status === 'open')

  const steps = forgeSteps(compile, {
    shape: (recipes?.recipes?.length ?? 0) > 0 && isDraft,
    tracker: states?.capability !== undefined && states.capability.transitions !== 'no_issue',
  })
  // A picked step can stop being offered — the shape of work, once handed off.
  const pickedIndex = steps.findIndex((each) => each.id === picked)
  const index =
    pickedIndex !== -1
      ? pickedIndex
      : steps.findIndex((each) => each.id === openingStep(order, steps))
  const step = steps[index]
  const previous = steps[index - 1]
  const next = steps[index + 1]

  const openStep = (id: StepId): void => {
    setPicked(id)
    setFocusTarget(STEP_HEADING)
  }

  const noCriteria =
    order.source.kind === 'tracker'
      ? `Nothing under an acceptance heading in ${order.source.key ?? 'the ticket'}. Press “Draft the plan” and the architect will write the criteria from what it does say.`
      : 'No criteria yet. Nothing writes them but the architect — press “Draft the plan”.'

  /** One of the checks: what is wrong, and the move that clears it. */
  const renderCheck = (id: CheckId): JSX.Element => {
    const failure = compile.failures.find((f) => f.check === id)
    const bad = failure !== undefined
    return (
      <div key={id} className={`fdry-check ${bad ? 'is-fail' : 'is-pass'}`}>
        <span className="fdry-check-mark" aria-hidden="true">
          {bad ? <X /> : <Check />}
        </span>
        <span>
          <b>{CHECK_LABELS[id]}</b>
          {bad ? <small>{failure.detail}</small> : null}
          {/* Saying what is wrong is half of it. A check that names no move is
              one the operator stares at. */}
          {bad && isDraft ? (
            <span className="fdry-remedy">
              {CHECK_REMEDIES[id].map((remedy) => {
                if (remedy.kind === 'ask' && drafting) {
                  return asked === remedy.message ? <Asked key={remedy.label} /> : null
                }
                return (
                  <button
                    key={remedy.label}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (remedy.kind === 'ask') {
                        void converge(remedy.message)
                        return
                      }
                      if (remedy.step !== null) setPicked(remedy.step)
                      setFocusTarget(remedy.target)
                    }}
                  >
                    {remedy.label}
                  </button>
                )
              })}
            </span>
          ) : null}
        </span>
      </div>
    )
  }

  return (
    <div className="fdry-forge">
      {/* The turn that ended with nothing to show for it.

          Above the questions and above every step, because until this is
          answered nothing else on the screen will move: the checks are the
          checks the refused plan would have cleared, and answering a question
          the architect asked before it was refused changes a document no
          architect is currently reading.

          It was recorded in the ledger and rendered nowhere. The operator's
          report was two sentences — "no way to recover from this" and "there's
          also zero indication anything has even gone wrong" — and both were
          exactly right: the screen said the architect was working, and it had
          stopped forty minutes earlier. */}
      {intake.kind === 'refused' && isDraft ? (
        <section className="fdry-refused" aria-labelledby="fdry-refused-h">
          <h2 className="fdry-refused-h" id="fdry-refused-h" tabIndex={-1}>
            <AlertCircle aria-hidden="true" />
            The architect&rsquo;s plan was refused
          </h2>
          <p>
            Nothing on this order was changed. The proposal did not fit the shape an order has to
            be, so none of it was taken.
          </p>
          <p className="fdry-refused-why">{intake.reason}</p>
          <div className="fdry-options">
            {/* The move, not just the news. The reason goes back with it: the
                architect cannot read its own refusal — it ended before the
                validation ran — and on the run this was found on it also
                could not parse the JSON it had just written, because `node
                -e`, `python3 -c` and redirects are all off intake's read-only
                allowlist. Told what was wrong, it fixes it in one turn. */}
            <button
              type="button"
              className="is-recommended"
              disabled={busy}
              onClick={() =>
                void converge(
                  `Your last proposal was refused and nothing was changed. The reason: ${intake.reason}. Write ${PROPOSAL_FILE} again, fixing exactly that and changing nothing else.`
                )
              }
            >
              Tell the architect what was wrong
            </button>
            <button type="button" disabled={busy} onClick={() => void converge()}>
              Start the turn over
            </button>
          </div>
        </section>
      ) : null}

      {/* The one thing on this screen that is waiting on a person, and so the
          first thing on it, above whichever step is open.

          It was the third panel down a 260px rail, under six convergence checks
          and up to six recipe cards. An operator reported it took them for ever
          to find. A question you have to go hunting for is a question that
          does not get answered, and every unanswered one holds the whole order
          at "no open questions" failing. */}
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
                  {question.options.map((option, optionIndex) => (
                    <button
                      key={option}
                      type="button"
                      className={optionIndex === question.recommended ? 'is-recommended' : ''}
                      disabled={busy}
                      onClick={() =>
                        void turn({ answer: { questionId: question.id, option: optionIndex } })
                      }
                    >
                      {option}
                      {optionIndex === question.recommended ? ' (recommended)' : ''}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* The steps, in one box: the list at the top, the open step scrolling
          itself, and the way forward pinned under it. Its own box so the bands
          above keep the full width. */}
      <div className="fdry-wizard">
        <header className="fdry-wizard-head">
          <div className="fdry-order-head">
            <h1>{order.title}</h1>
            {order.source.key !== null ? (
              <span className="fdry-src">
                {order.source.tracker} {order.source.key}
              </span>
            ) : null}
            <span className="fdry-id">{order.id}</span>
            <span className="fdry-order-actions">
              {/* The conversation that wrote this plan, from the order's own
                  record rather than a prop nobody passed. */}
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
              {/* The plan does not write itself, and a redraft can be wanted from
                  any step — so this is in the header of all of them. */}
              {isDraft ? (
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
            </span>
          </div>
          <p className="fdry-order-sub">
            recipe <b>{order.recipe ?? 'not chosen'}</b> · risk {order.risk.grade} ·{' '}
            {order.plan.units.length} units · {order.status}
          </p>
          <nav aria-label="Steps">
            <ol className="fdry-steps">
              {steps.map((each, position) => {
                const blocking = each.blocking.length > 0
                const redrawn = STEP_FIELDS[each.id].some((field) => moved.includes(field))
                return (
                  <li key={each.id}>
                    <button
                      type="button"
                      className={`fdry-step-link${blocking ? ' is-blocking' : ''}${redrawn ? ' is-redrawn' : ''}`}
                      aria-current={each === step ? 'step' : undefined}
                      aria-label={
                        blocking ? `${STEP_LABELS[each.id]}, blocking hand-off` : undefined
                      }
                      onClick={() => openStep(each.id)}
                    >
                      <span className="fdry-step-mark" aria-hidden="true">
                        {blocking ? <X /> : position + 1}
                      </span>
                      {STEP_LABELS[each.id]}
                    </button>
                  </li>
                )
              })}
            </ol>
          </nav>
        </header>

        <section className="fdry-step" aria-labelledby={STEP_HEADING}>
          <div className="fdry-step-body">
            <h2 className="fdry-step-h" id={STEP_HEADING} tabIndex={-1}>
              {STEP_TITLES[step.id]}
            </h2>

            {step.id === 'intent' ? (
              <>
                <p className="fdry-step-intro">
                  The problem and the outcome this order is for. The architect plans everything else
                  from them.
                </p>
                <section className={`fdry-field ${moved.includes('intent') ? 'is-redrawn' : ''}`}>
                  {/* A tracker's description is markdown; a `<p>` would collapse
                      every newline in it into one unbroken line. */}
                  <h3 className="fdry-field-h">Problem</h3>
                  {order.intent.problem === '' ? (
                    <p className="fdry-note">Not stated yet.</p>
                  ) : (
                    <Markdown text={order.intent.problem} />
                  )}
                  <h3 className="fdry-field-h">Outcome</h3>
                  {order.intent.outcome === '' ? (
                    <p className="fdry-note">Not stated yet.</p>
                  ) : (
                    <Markdown text={order.intent.outcome} />
                  )}
                </section>
                {order.acceptance.length === 0 ? (
                  <p className="fdry-step-callout">{noCriteria}</p>
                ) : null}
              </>
            ) : null}

            {step.id === 'plan' ? (
              <>
                <p className="fdry-step-intro">
                  What has to be true when the work is done, how each part is proven, and what the
                  architect assumed.
                </p>
                {step.blocking.length > 0 ? (
                  <div className="fdry-blockers">{step.blocking.map(renderCheck)}</div>
                ) : null}

                <section
                  className={`fdry-field ${moved.includes('acceptance') ? 'is-redrawn' : ''}`}
                >
                  <h3 className="fdry-field-h" id="fdry-acceptance" tabIndex={-1}>
                    Acceptance criteria
                  </h3>
                  {order.acceptance.length === 0 ? (
                    <p className="fdry-note">{noCriteria}</p>
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
                              proven by {criterion.verify.kind}
                              {uncovered ? ' · no unit satisfies this' : ''}
                            </span>
                            {/* The escape the falsifiable check has always named:
                                a criterion nothing here can prove may be
                                accepted anyway, in writing, and the reason
                                travels with the order. */}
                            {excused ? (
                              <p className="fdry-ac-excused">
                                accepted as unverifiable — {criterion.unverifiable?.reason}
                              </p>
                            ) : isDraft && unproven !== criterion.id ? (
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
                    <h3 className="fdry-field-h">Coverage</h3>
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
                  <section
                    className={`fdry-field ${moved.includes('assumptions') ? 'is-redrawn' : ''}`}
                  >
                    <h3 className="fdry-field-h">Assumptions</h3>
                    <p className="fdry-note">
                      Strike any that are wrong. What depended on it is redrawn.
                    </p>
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

                <section className="fdry-field" aria-labelledby="fdry-budgets">
                  <h3 className="fdry-field-h" id="fdry-budgets" tabIndex={-1}>
                    Budgets
                  </h3>
                  <p className="fdry-note">
                    Where the run pauses and asks you. New orders start with the limits in Settings;
                    these are this order&rsquo;s.
                  </p>
                  {isDraft ? (
                    <BudgetForm
                      key={JSON.stringify(order.budgets)}
                      rows={[
                        { key: 'agents', label: 'Agents at once', value: order.budgets.agents },
                        {
                          key: 'wallClockMinutes',
                          label: 'Minutes',
                          value: order.budgets.wallClockMinutes,
                        },
                      ]}
                      submitLabel="Save budgets"
                      disabled={busy}
                      onSubmit={(budgets) => void setBudgets(budgets)}
                    />
                  ) : (
                    <p>{budgetsInWords(order.budgets)}</p>
                  )}
                </section>
              </>
            ) : null}

            {step.id === 'redTeam' ? (
              <>
                <p className="fdry-step-intro">
                  {openFindings.length === 0
                    ? 'Nothing is open. An adversarial pass read the plan and left nothing to clear.'
                    : `${openFindings.length} open. Ask the architect to clear each one, mark it fixed, or accept it with a reason — nothing hands off while one is open.`}
                </p>
                <section className={`fdry-field ${moved.includes('redTeam') ? 'is-redrawn' : ''}`}>
                  {openFindings.map((finding) => (
                    <div key={finding.id} className="fdry-finding">
                      <CircleDot aria-hidden="true" />
                      <span>
                        {finding.text}
                        {/* Under the finding rather than beside it: in the
                            button row it squeezed the finding to one word a
                            line. */}
                        {isDraft && drafting && asked === findingAsk(finding) ? <Asked /> : null}
                      </span>
                      {isDraft ? (
                        <span className="fdry-finding-actions">
                          {drafting ? null : (
                            <button
                              type="button"
                              disabled={busy}
                              title="Have the architect change the order so this no longer holds"
                              onClick={() => void converge(findingAsk(finding))}
                            >
                              Ask the architect
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            title="It is fixed"
                            onClick={() =>
                              void turn({ finding: { id: finding.id, decision: 'resolved' } })
                            }
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
                      ) : null}
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
              </>
            ) : null}

            {/* Proposed rather than chosen — a proposal nobody can predict is
                worse than a plain one — and overridden in one click, with the
                override recorded. One that cannot run here is shown with the
                requirement it does not meet rather than hidden. */}
            {step.id === 'shape' ? (
              <>
                <p className="fdry-step-intro">
                  How the work runs.{' '}
                  {recipes?.proposedWhy !== undefined && recipes.proposedWhy !== ''
                    ? `${recipes.proposed} proposed — ${recipes.proposedWhy}.`
                    : null}{' '}
                  Pick another if it fits better; the override is recorded.
                </p>
                <div className="fdry-recipes">
                  {recipes?.recipes?.map((option) => {
                    const isChosen = (chosen ?? recipes.proposed) === option.name
                    return (
                      <button
                        key={option.name}
                        type="button"
                        className={`fdry-recipe ${isChosen ? 'is-on' : ''}`}
                        aria-pressed={isChosen}
                        disabled={!option.available || busy}
                        onClick={() => setChosen(option.name)}
                      >
                        <span className="fdry-recipe-name">
                          <b>{option.name}</b>
                          {option.name === recipes.proposed ? (
                            <span className="fdry-recipe-mark">Proposed</span>
                          ) : null}
                        </span>
                        <small>
                          {option.available
                            ? (option.description ?? `from ${option.rung ?? 'built-in'}`)
                            : option.unmet.join('; ')}
                        </small>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : null}

            {step.id === 'tracker' ? (
              <>
                <p className="fdry-step-intro">
                  What this order tells {order.source.tracker} {order.source.key} as it moves.
                </p>
                {states?.capability?.transitions === 'unsupported' ? (
                  <p className="fdry-note">
                    {order.source.tracker} cannot be asked to move an issue, so {order.source.key}{' '}
                    will not change state. The summary comment and the pull request links still go
                    across.
                  </p>
                ) : (
                  <section className="fdry-field">
                    <h3 className="fdry-field-h">Workflow states</h3>
                    <p className="fdry-note">
                      Which of {order.source.tracker}&rsquo;s own states each moment means. Left
                      alone, the tracker resolves it.
                    </p>
                    {INTENTS.map((intent) => (
                      <label key={intent} className="fdry-map">
                        <span>{INTENT_LABELS[intent]}</span>
                        <select
                          value={states?.mapping?.[intent] ?? ''}
                          onChange={(event) =>
                            void mapIntent(
                              intent,
                              event.target.value === '' ? null : event.target.value
                            )
                          }
                        >
                          <option value="">
                            {states?.capability?.unreachable.includes(intent) === true
                              ? 'nowhere to go — skipped'
                              : 'let the tracker decide'}
                          </option>
                          {states?.capability?.states.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </section>
                )}

                {/* Per order, defaulting from configuration (FR-062). A run
                    against somebody else's repository is a reason to turn one
                    off without changing the setting for every order after it. */}
                <section className="fdry-field">
                  <h3 className="fdry-field-h">What goes back to the issue</h3>
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
              </>
            ) : null}

            {step.id === 'handOff' ? (
              <>
                <p className="fdry-step-intro">
                  All of them must pass. Handing off agrees the order and starts the work.
                </p>
                <div className="fdry-checks">{CHECK_ORDER.map(renderCheck)}</div>
                {view.unavailableChecks !== undefined && view.unavailableChecks.length > 0 ? (
                  <section className="fdry-field">
                    <h3 className="fdry-field-h">Not measurable here</h3>
                    <p className="fdry-note">
                      This repository has no command for {view.unavailableChecks.join(', ')}. Those
                      checks will report &ldquo;not measured&rdquo; rather than passing.
                    </p>
                  </section>
                ) : null}
              </>
            ) : null}

            {isDraft ? (
              <form
                className="fdry-input"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (draft.trim() === '') return
                  // Straight to the architect. `turn` routes free text there
                  // too; going directly says what the button does.
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
            ) : null}
          </div>
        </section>

        <footer className="fdry-wizard-foot">
          {problem !== null ? <p className="fdry-problem">{problem}</p> : null}
          <div className="fdry-wizard-nav">
            {previous !== undefined ? (
              <button type="button" className="fdry-nav-back" onClick={() => openStep(previous.id)}>
                Back
              </button>
            ) : null}
            <span className="fdry-wizard-forward">
              {/* The one refusal the operator can answer: it is about their own
                  review queue, not about the order. Overriding is one click,
                  and the depth they ignored goes in the record (FR-054). */}
              {step.id === 'handOff' && heldBack !== null ? (
                <button
                  type="button"
                  className="fdry-nav-next"
                  disabled={busy}
                  onClick={() => void handOff(true)}
                >
                  <Play aria-hidden="true" /> Start anyway — {heldBack.unreviewed} waiting for
                  review
                </button>
              ) : null}
              {step.id === 'handOff' ? (
                <button
                  type="button"
                  className="fdry-nav-next"
                  disabled={!compile.ok || busy || !isDraft}
                  onClick={() => void handOff()}
                >
                  <Play aria-hidden="true" />
                  {!isDraft
                    ? `Handed off — ${order.status}`
                    : compile.ok
                      ? 'Compile & hand off'
                      : `Blocked by ${compile.failures.length} ${compile.failures.length === 1 ? 'check' : 'checks'}`}
                </button>
              ) : next !== undefined ? (
                <button type="button" className="fdry-nav-next" onClick={() => openStep(next.id)}>
                  Next: {STEP_LABELS[next.id]}
                </button>
              ) : null}
            </span>
          </div>
        </footer>
      </div>
    </div>
  )
}
