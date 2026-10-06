import { Markdown, MarkdownInline } from './Markdown.js'
import React, { useCallback, useEffect, useState } from 'react'
import {
  Check,
  X,
  Terminal,
  Play,
  Wand,
  AlertCircle,
  LoaderCircle,
  User,
  Pause,
  Lock,
  Info,
  List,
} from 'lucide-react'
import { isBlocking } from '../order/schema.js'
import type { WorkOrder } from '../order/schema.js'
import type { Standing } from '../order/standing.js'
import type { CompileResult, CheckId } from '../order/compile.js'
import { coverageMatrix } from '../order/coverage-matrix.js'
import { surfacedQuestions } from '../forge/interview.js'
import { liveAssumptions } from '../forge/assumptions.js'
import type { StateMapping, TransitionIntent, WriteBack } from '../order/schema.js'
import type { CapabilityReport } from '../trackers/write-back.js'
import type { IntakeOutcome } from '../forge/intake-outcome.js'
import { PROPOSAL_FILE } from '../order/proposal.js'
import { openingStep, forgeSteps, type StepId } from '../forge/steps.js'
import { budgetsInWords } from '../order/render.js'
import { BudgetForm } from './BudgetForm.js'
import { ReasonButton } from './ReasonButton.js'
import {
  readiness,
  capitalise,
  shapeUnavailable,
  LOCAL_REASONS,
  type LoopFacts,
  type AgreedFacts,
  type Row,
  type StepView,
  type FindingView,
  type FindingGroup,
  type StripAction,
  type StripIcon,
  type StepMark,
} from '../forge/readiness.js'

// The Forge.
//
// One box, one derivation. `readiness()` (ADR 074) is the one answer every
// piece of this screen reads: who holds the order, the status strip, the
// step rail, the six hand-off rows, the red-team findings by who acts on
// them, and why every control that can be unavailable is unavailable. This
// component draws what it returns and decides nothing about state itself.

export interface OrderView {
  order: WorkOrder
  compile: CompileResult
  changed?: string[]
  unavailableChecks?: string[]
  /** The session the architect is drafting in, while it is drafting. */
  converging?: string
  intake?: IntakeOutcome
  loop?: LoopFacts
  agreed?: AgreedFacts | null
  turnEndedAt?: string | null
  advisory?: string | null
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
  /** The operator's saved pick (`order.recipe`), and when it was made. */
  chosen?: string | null
  chosenAt?: string | null
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
  handOff: 'Ready to hand off?',
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
  questions: [{ kind: 'goto', label: 'Answer them', step: 'plan', target: 'fdry-questions-h' }],
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

/**
 * One decision the operator has made about a blocking finding, waiting in the
 * band until Send collects it with everything else.
 */
interface FindingChoice {
  readonly mode: 'ask' | 'fix' | 'accept'
  /** The fix or the accept reason; unused for `ask`. */
  readonly text: string
}

function findingDecided(choice: FindingChoice | undefined): boolean {
  return choice !== undefined && (choice.mode === 'ask' || choice.text.trim() !== '')
}

/** What one settle turn asks the backend to do in a single converge call. */
interface Settle {
  readonly answers: readonly { readonly questionId: string; readonly option: number }[]
  readonly accepts: readonly { readonly findingId: string; readonly reason: string }[]
  readonly fixes: readonly { readonly findingId: string; readonly how: string }[]
  readonly asks: readonly string[]
}

/**
 * Fold every local selection into the one payload `foundry:order.converge`
 * takes as `settle`.
 *
 * Only a decided finding counts: choosing "Fix it…" and leaving the box empty
 * is not a fix, the same shrug a blank accept reason always was.
 */
function buildSettle(
  questionChoices: Readonly<Record<string, number>>,
  findingChoice: Readonly<Record<string, FindingChoice>>
): Settle {
  const answers = Object.entries(questionChoices).map(([questionId, option]) => ({
    questionId,
    option,
  }))
  const accepts: { findingId: string; reason: string }[] = []
  const fixes: { findingId: string; how: string }[] = []
  const asks: string[] = []
  for (const [findingId, choice] of Object.entries(findingChoice)) {
    if (choice.mode === 'ask') asks.push(findingId)
    else if (choice.mode === 'fix' && choice.text.trim() !== '') {
      fixes.push({ findingId, how: choice.text.trim() })
    } else if (choice.mode === 'accept' && choice.text.trim() !== '') {
      accepts.push({ findingId, reason: choice.text.trim() })
    }
  }
  return { answers, accepts, fixes, asks }
}

const TURN_REMEDY_LABEL = 'Tell the architect what was wrong'

function Asked(): JSX.Element {
  return (
    <span role="status" aria-label="Asked" className="fdry-asked">
      <LoaderCircle aria-hidden="true" />
      Asked — the architect is working on it. This clears when the redraft lands.
    </span>
  )
}

function goTo(target: string): void {
  const element = document.getElementById(target)
  if (element === null) return
  element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  element.focus({ preventScroll: true })
}

function invoke(channel: string, payload: unknown): Promise<unknown> {
  return window.electronAPI.extensionBridge.invoke(channel, payload)
}

function clockOf(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export interface ForgeProps {
  readonly orderId: string
  readonly onStarted?: (orderId: string) => void
  /** Where the run stands, once there is one: the hand-off pill says whose move it is. */
  readonly standing?: Standing
}

async function attachToSession(sessionId: string): Promise<string | null> {
  const r = (await invoke('foundry:run-terminal', { sessionId })) as { ok?: boolean }
  return r.ok === true ? null : 'that conversation no longer has a terminal'
}

/** One row's icon, from its state. */
function RowIcon({ state }: { readonly state: Row['state'] }): JSX.Element {
  if (state === 'passed') return <Check aria-hidden="true" />
  if (state === 'in-progress') return <LoaderCircle aria-hidden="true" className="fdry-spin" />
  if (state === 'needs-you') return <AlertCircle aria-hidden="true" />
  return <X aria-hidden="true" />
}

const ROW_PILL: Record<Row['state'], { readonly label: string; readonly cls: string }> = {
  passed: { label: 'Passed', cls: 'pass' },
  'in-progress': { label: 'In progress', cls: 'work' },
  'needs-you': { label: 'Needs you', cls: 'you' },
  failing: { label: 'Failing', cls: 'bad' },
}

function StripIconGlyph({ icon }: { readonly icon: StripIcon }): JSX.Element {
  if (icon === 'load') return <LoaderCircle aria-hidden="true" className="fdry-spin" />
  if (icon === 'user') return <User aria-hidden="true" />
  if (icon === 'check') return <Check aria-hidden="true" />
  if (icon === 'play') return <Play aria-hidden="true" />
  if (icon === 'pause') return <Pause aria-hidden="true" />
  return <AlertCircle aria-hidden="true" />
}

function RailMark({ mark }: { readonly mark: StepMark; readonly position: number }): JSX.Element {
  if (mark === 'check') return <Check aria-hidden="true" />
  if (mark === 'spin') return <LoaderCircle aria-hidden="true" className="fdry-spin" />
  if (mark === 'alert') return <AlertCircle aria-hidden="true" />
  if (mark === 'x') return <X aria-hidden="true" />
  return <></>
}

const STEP_STATE_CLASS: Record<StepView['state'], string> = {
  done: 'done',
  work: 'work',
  you: 'you',
  bad: 'bad',
  'not-yet': 'not-yet',
}

const GROUP_META: Record<FindingGroup, { readonly heading: string; readonly cls: string }> = {
  fixing: { heading: 'The architect is fixing', cls: 'work' },
  'needs-you': { heading: 'Needs your decision', cls: 'you' },
  notes: { heading: 'Notes, nothing to do', cls: 'note' },
  resolved: { heading: 'Resolved', cls: 'done' },
}

export function Forge({ orderId, onStarted, standing }: ForgeProps): JSX.Element {
  const [view, setView] = useState<OrderView | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [states, setStates] = useState<StatesView | null>(null)
  const [moved, setMoved] = useState<string[]>([])
  const [questionChoices, setQuestionChoices] = useState<Record<string, number>>({})
  const [findingChoice, setFindingChoice] = useState<Record<string, FindingChoice>>({})
  const [queuedSettle, setQueuedSettle] = useState<Settle | null>(null)
  const [unproven, setUnproven] = useState<string | null>(null)
  const [unprovenReason, setUnprovenReason] = useState('')
  const [recipes, setRecipes] = useState<RecipesView | null>(null)
  const [picked, setPicked] = useState<StepId | null>(null)
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

  const refreshRecipes = useCallback(async () => {
    const next = (await invoke('foundry:run.recipes', { id: orderId })) as RecipesView
    setRecipes(next)
  }, [orderId])

  useEffect(() => {
    void refreshRecipes()
  }, [refreshRecipes])

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

  const holdOrder = useCallback(
    async (held: boolean) => {
      setBusy(true)
      try {
        await invoke('foundry:order.hold', { id: orderId, held })
        await refresh()
      } finally {
        setBusy(false)
      }
    },
    [orderId, refresh]
  )

  const pickRecipe = useCallback(
    async (recipe: string | null) => {
      await invoke('foundry:order.recipe', { id: orderId, recipe })
      await Promise.all([refresh(), refreshRecipes()])
    },
    [orderId, refresh, refreshRecipes]
  )

  const intake: IntakeOutcome = view?.intake ?? { kind: 'none' }
  const drafting = intake.kind === 'running'
  const asked = intake.kind === 'running' ? intake.asked : null
  const locked = busy || drafting

  const orderStatus = view === null ? null : view.order.status
  useEffect(() => {
    if (orderStatus !== 'draft') return
    const timer = setInterval(() => void refresh(), REDRAFT_POLL_MS)
    return () => clearInterval(timer)
  }, [orderStatus, refresh])

  const applySettle = useCallback(
    async (settle: Settle) => {
      setBusy(true)
      setProblem(null)
      try {
        const next = (await invoke('foundry:order.converge', { id: orderId, settle })) as
          | (OrderView & { error?: string; converging?: string })
          | { error: string }
        if ('order' in next) setView(next)
        if (next.error !== undefined) setProblem(next.error)
      } finally {
        setBusy(false)
      }
    },
    [orderId]
  )

  useEffect(() => {
    if (drafting || queuedSettle === null) return
    const toSend = queuedSettle
    setQueuedSettle(null)
    void applySettle(toSend)
  }, [drafting, queuedSettle, applySettle])

  const handOff = useCallback(async () => {
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
        ...(recipes?.chosen != null ? { recipe: recipes.chosen } : {}),
      })) as {
        error?: string
        order?: { status: string }
      }
      if (started.error !== undefined) {
        setProblem(`The order is agreed, but the run did not start: ${started.error}`)
        return
      }
      onStarted?.(orderId)
    } finally {
      setBusy(false)
    }
  }, [orderId, onStarted, recipes?.chosen])

  if (view === null) {
    return <div className="fdry-empty">Loading the order…</div>
  }

  const { order, compile } = view
  const isDraft = order.status === 'draft'
  const matrix = coverageMatrix(order)
  const questions = surfacedQuestions(order.openQuestions)
  const assumptions = liveAssumptions(order)
  const blockingFindings = order.redTeam.filter((f) => f.status === 'open' && isBlocking(f))

  const offers = {
    shape: (recipes?.recipes?.length ?? 0) > 0,
    tracker: states?.capability !== undefined && states.capability.transitions !== 'no_issue',
  }

  const shapeName = recipes?.chosen ?? recipes?.proposed ?? order.recipe ?? null
  const shapeYours =
    recipes?.chosen !== null && recipes?.chosen !== undefined && recipes.chosen !== recipes.proposed

  const r = readiness({
    order,
    compile,
    intake,
    loop: view.loop ?? { rounds: [], heldAt: null, exhausted: false },
    agreed: view.agreed ?? null,
    turnEndedAt: view.turnEndedAt ?? null,
    shape: { name: shapeName, yours: shapeYours },
    offers,
    turn: standing?.turn,
    clock: clockOf,
  })

  const forgeStepList = forgeSteps(compile, offers)
  const pickedIndex = r.steps.findIndex((each) => each.id === picked)
  const index =
    pickedIndex !== -1
      ? pickedIndex
      : r.steps.findIndex((each) => each.id === openingStep(order, forgeStepList))
  const stepView = r.steps[Math.max(index, 0)]
  const previous = r.steps[index - 1]
  const next = r.steps[index + 1]

  const openStep = (id: StepId): void => {
    setPicked(id)
    setFocusTarget(STEP_HEADING)
  }

  const noCriteria =
    order.source.kind === 'tracker'
      ? `Nothing under an acceptance heading in ${order.source.key ?? 'the ticket'}. Press “Draft the plan” and the architect will write the criteria from what it does say.`
      : 'No criteria yet. Nothing writes them but the architect — press “Draft the plan”.'

  const askReason = locked ? (r.locks.redraft ?? LOCAL_REASONS.saving) : null

  /**
   * What the operator can do about a row.
   *
   * A row the machine is closing offers nothing but the "Asked" marker for the
   * ask it is answering; a failing or needs-you row offers its moves.
   */
  const renderMoves = (row: Row): JSX.Element | null => {
    if (row.state === 'passed') return null
    if (row.id === 'turn') {
      if (row.state !== 'failing' || intake.kind !== 'refused') return null
      const reason = intake.reason
      return (
        <div className="fdry-chk-moves">
          <ReasonButton
            reason={askReason}
            onClick={() =>
              void converge(
                `Your last proposal was refused and nothing was changed. The reason: ${reason}. Write ${PROPOSAL_FILE} again, fixing exactly that and changing nothing else.`
              )
            }
          >
            {TURN_REMEDY_LABEL}
          </ReasonButton>
        </div>
      )
    }
    const remedies = CHECK_REMEDIES[row.id]
    if (row.state === 'in-progress') {
      const answering = remedies.find((remedy) => remedy.kind === 'ask' && asked === remedy.message)
      return answering === undefined ? null : (
        <div className="fdry-chk-moves">
          <Asked />
        </div>
      )
    }
    return (
      <div className="fdry-chk-moves">
        {remedies.map((remedy) => {
          if (remedy.kind === 'ask' && drafting) {
            return asked === remedy.message ? <Asked key={remedy.label} /> : null
          }
          if (remedy.kind === 'goto') {
            return (
              <button
                key={remedy.label}
                type="button"
                className="fdry-btn"
                onClick={() => {
                  if (remedy.step !== null) setPicked(remedy.step)
                  setFocusTarget(remedy.target)
                }}
              >
                {remedy.label}
              </button>
            )
          }
          return (
            <ReasonButton
              key={remedy.label}
              reason={askReason}
              onClick={() => void converge(remedy.message)}
            >
              {remedy.label}
            </ReasonButton>
          )
        })}
      </div>
    )
  }

  const renderRow = (row: Row): JSX.Element => (
    <div key={row.id} className={`fdry-chk${row.state === 'in-progress' ? ' fdry-chk--work' : ''}`}>
      <span className="fdry-chk-icon" aria-hidden="true">
        <RowIcon state={row.state} />
      </span>
      <div>
        <b>{row.label}</b>
        <small>{row.detail}</small>
        {renderMoves(row)}
      </div>
      <span className={`fdry-pill fdry-pill--${ROW_PILL[row.state].cls}`}>
        {ROW_PILL[row.state].label}
      </span>
    </div>
  )

  /** A failing or in-progress plan check, on the step that clears it. */
  const renderCheckRow = (id: CheckId): JSX.Element | null => {
    const row = r.rows.find((each) => each.id === id)
    return row === undefined || row.state === 'passed' ? null : renderRow(row)
  }

  /** The six hand-off rows, one per `readiness.rows` entry. */
  const renderHandOffRow = renderRow

  // Findings grouped by who acts on them, in the fixed order the rendering
  // shows: fixing, needs-you, notes, resolved. An empty group is not shown.
  const findingsByGroup: Record<FindingGroup, FindingView[]> = {
    fixing: [],
    'needs-you': [],
    notes: [],
    resolved: [],
  }
  for (const finding of r.findings) findingsByGroup[finding.group].push(finding)
  const needsYouFindings = findingsByGroup['needs-you']
  const findingsDecided = needsYouFindings.filter((f) => findingDecided(findingChoice[f.id])).length

  const openQuestions = questions
  const questionsDecided = openQuestions.filter((q) => questionChoices[q.id] !== undefined).length

  const stepNeedsYou =
    stepView.id === 'redTeam'
      ? { total: needsYouFindings.length, decided: findingsDecided }
      : stepView.id === 'plan'
        ? { total: openQuestions.length, decided: questionsDecided }
        : { total: 0, decided: 0 }

  const sendReason =
    stepNeedsYou.total === 0
      ? null
      : queuedSettle !== null
        ? LOCAL_REASONS.queued
        : stepNeedsYou.decided === 0
          ? LOCAL_REASONS.nothingDecided
          : null

  const sendDecisionsOnThisStep = (): void => {
    if (stepView.id === 'redTeam') {
      const settle = buildSettle({}, findingChoice)
      setFindingChoice({})
      if (drafting) {
        setQueuedSettle(settle)
        return
      }
      void applySettle(settle)
      return
    }
    if (stepView.id === 'plan') {
      const settle = buildSettle(questionChoices, {})
      setQuestionChoices({})
      if (drafting) {
        setQueuedSettle(settle)
        return
      }
      void applySettle(settle)
    }
  }

  const handleAttach = (sessionId: string): void => {
    void attachToSession(sessionId).then(setProblem)
  }

  const runStripAction = (action: StripAction): void => {
    if (action === 'hold') void holdOrder(true)
    else if (action === 'release') void holdOrder(false)
    else if (action === 'watch') {
      if (intake.kind === 'running') handleAttach(intake.sessionId)
    } else if (action === 'tell-architect') {
      if (intake.kind === 'refused') {
        void converge(
          `Your last proposal was refused and nothing was changed. The reason: ${intake.reason}. Write ${PROPOSAL_FILE} again, fixing exactly that and changing nothing else.`
        )
      }
    } else if (action === 'start-over') void converge()
    else if (action === 'open-run') onStarted?.(orderId)
    else if (action === 'draft') void converge()
  }

  const STRIP_ACTION_LABEL: Record<StripAction, string> = {
    hold: 'Hold for me',
    release: 'Let it continue',
    watch: intake.kind === 'running' ? `Watch the ${intake.actor}` : 'Watch',
    'tell-architect': 'Tell the architect what was wrong',
    'start-over': 'Start the turn over',
    'open-run': 'Open the run',
    draft: 'Draft the plan',
  }

  return (
    <div className="fdry-forge">
      <div className="fdry-wizard">
        <header className="fdry-wiz-head">
          <div className="fdry-wiz-title">
            <b>{order.title}</b>
            <div className="fdry-wiz-sub">
              {order.source.kind === 'signal' ? (
                <span className="fdry-chip">From a sensor signal</span>
              ) : order.source.key !== null ? (
                <span className="fdry-chip">
                  {capitalise(order.source.tracker ?? '')} {order.source.key}
                </span>
              ) : null}
              <span>{r.summary}</span>
            </div>
          </div>
          <div className="fdry-wiz-actions">
            {intake.kind === 'running' ? (
              <button
                type="button"
                className="fdry-btn fdry-btn--quiet"
                onClick={() => handleAttach(intake.sessionId)}
              >
                <Terminal aria-hidden="true" /> {STRIP_ACTION_LABEL.watch}
              </button>
            ) : order.provenance.forgeSession !== null ? (
              <button
                type="button"
                className="fdry-btn fdry-btn--quiet"
                onClick={() => handleAttach(order.provenance.forgeSession ?? '')}
              >
                <Terminal aria-hidden="true" /> Attach
              </button>
            ) : null}
            {isDraft && !r.strip.actions.includes('draft') ? (
              <ReasonButton
                reason={r.locks.redraft}
                className="fdry-btn"
                onClick={() => void converge()}
              >
                <Wand aria-hidden="true" />
                {order.plan.units.length === 0 ? 'Draft the plan' : 'Redraft'}
              </ReasonButton>
            ) : null}
          </div>
        </header>

        <div className={`fdry-strip fdry-strip--${r.strip.tone}`}>
          <div className="fdry-strip-who">
            <span className="fdry-strip-icon" aria-hidden="true">
              <StripIconGlyph icon={r.strip.icon} />
            </span>
            <div>
              <b>{r.strip.headline}</b>
              <small>{r.strip.detail}</small>
            </div>
          </div>
          {r.strip.actions.length > 0 ? (
            <div className="fdry-strip-acts">
              {r.strip.actions.map((action) => (
                <button
                  key={action}
                  type="button"
                  className={`fdry-btn${action === 'tell-architect' ? ' fdry-btn--primary' : ''}`}
                  onClick={() => runStripAction(action)}
                >
                  {action === 'hold' ? <Pause aria-hidden="true" /> : null}
                  {action === 'watch' ? <Terminal aria-hidden="true" /> : null}
                  {STRIP_ACTION_LABEL[action]}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="fdry-body">
          <nav aria-label="Steps" className="fdry-rail">
            {r.steps.map((each, position) => (
              <button
                key={each.id}
                type="button"
                className={`fdry-rail-step fdry-rail-step--${STEP_STATE_CLASS[each.state]}${each === stepView ? ' is-on' : ''}`}
                aria-current={each === stepView ? 'step' : undefined}
                onClick={() => openStep(each.id)}
              >
                <span className="fdry-mk" aria-hidden="true">
                  {each.mark === 'number' ? (
                    position + 1
                  ) : (
                    <RailMark mark={each.mark} position={position} />
                  )}
                </span>
                <span>
                  <b>{STEP_LABELS[each.id]}</b>
                  <small>{each.word}</small>
                </span>
              </button>
            ))}
          </nav>

          <section className="fdry-main" aria-labelledby={STEP_HEADING}>
            <h2 className="fdry-step-h" id={STEP_HEADING} tabIndex={-1}>
              {stepView.id === 'handOff' && !isDraft
                ? `Agreed at ${clockOf(view.agreed?.at ?? order.agreedAt ?? '')} by ${view.agreed?.by === 'automatic' ? 'automatic hand-off' : 'you'}`
                : STEP_TITLES[stepView.id]}
            </h2>

            {stepView.id === 'intent' ? (
              <>
                <p className="fdry-step-intro">
                  The problem and the outcome this order is for. The architect plans everything else
                  from them.
                </p>
                <section className={`fdry-field ${moved.includes('intent') ? 'is-redrawn' : ''}`}>
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

            {stepView.id === 'plan' ? (
              <>
                <p className="fdry-step-intro">
                  What has to be true when the work is done, how each part is proven, and what the
                  architect assumed.
                </p>

                {(['verifiable', 'coverage', 'risk'] as const).some(
                  (id) => r.rows.find((row) => row.id === id)?.state !== 'passed'
                ) ? (
                  <div className="fdry-checks">
                    {renderCheckRow('verifiable')}
                    {renderCheckRow('coverage')}
                    {renderCheckRow('risk')}
                  </div>
                ) : null}

                {openQuestions.length > 0 ? (
                  <div className="fdry-group">
                    <div
                      className="fdry-group-h fdry-group-h--you"
                      id="fdry-questions-h"
                      tabIndex={-1}
                    >
                      <AlertCircle aria-hidden="true" />
                      Needs your answer{' '}
                      <span className="fdry-cnt">
                        {questionsDecided} of {openQuestions.length} decided
                      </span>
                    </div>
                    {openQuestions.map((question) => (
                      <div key={question.id} className="fdry-fnd">
                        <b>
                          <MarkdownInline text={question.text} />
                        </b>
                        {question.why !== '' ? <Markdown text={question.why} /> : null}
                        <div className="fdry-fnd-acts">
                          {question.options.map((option, optionIndex) => (
                            <button
                              key={option}
                              type="button"
                              aria-pressed={questionChoices[question.id] === optionIndex}
                              className={
                                questionChoices[question.id] === optionIndex ? 'fdry-btn--sel' : ''
                              }
                              onClick={() =>
                                setQuestionChoices((current) => ({
                                  ...current,
                                  [question.id]: optionIndex,
                                }))
                              }
                            >
                              <MarkdownInline text={option} />
                              {optionIndex === question.recommended ? ' (recommended)' : ''}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
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
                            <Markdown text={criterion.statement} />
                            <span className="fdry-verify">
                              proven by {criterion.verify.kind}
                              {uncovered ? ' · no unit satisfies this' : ''}
                            </span>
                            {excused ? (
                              <p className="fdry-ac-excused">
                                accepted as unverifiable — {criterion.unverifiable?.reason}
                              </p>
                            ) : isDraft && unproven !== criterion.id ? (
                              <ReasonButton
                                className="fdry-ac-excuse"
                                reason={askReason}
                                onClick={() => setUnproven(criterion.id)}
                              >
                                Nothing here can prove this
                              </ReasonButton>
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
                                <ReasonButton
                                  type="submit"
                                  reason={
                                    unprovenReason.trim() === ''
                                      ? LOCAL_REASONS.acceptEmpty
                                      : askReason
                                  }
                                >
                                  Accept it
                                </ReasonButton>
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
                        <ReasonButton
                          key={assumption.id}
                          reason={askReason}
                          onClick={() => void turn({ strike: assumption.id })}
                        >
                          <MarkdownInline text={assumption.text} /> <X aria-hidden="true" />
                        </ReasonButton>
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
                      disabled={locked}
                      onSubmit={(budgets) => void setBudgets(budgets)}
                    />
                  ) : (
                    <p>{budgetsInWords(order.budgets)}</p>
                  )}
                </section>
              </>
            ) : null}

            {stepView.id === 'redTeam' ? (
              <>
                {findingsByGroup.fixing.length > 0 ? (
                  <div className="fdry-group">
                    <div className={`fdry-group-h fdry-group-h--${GROUP_META.fixing.cls}`}>
                      <LoaderCircle aria-hidden="true" className="fdry-spin" />
                      {GROUP_META.fixing.heading}{' '}
                      <span className="fdry-cnt">{findingsByGroup.fixing.length}</span>
                    </div>
                    {findingsByGroup.fixing.map((finding) => (
                      <div key={finding.id} className="fdry-fnd">
                        <span className="fdry-fnd-text">
                          <MarkdownInline text={finding.text} />
                        </span>
                        <span className="fdry-fnd-meta">{finding.meta}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {needsYouFindings.length > 0 ? (
                  <div className="fdry-group">
                    <div className={`fdry-group-h fdry-group-h--${GROUP_META['needs-you'].cls}`}>
                      <AlertCircle aria-hidden="true" />
                      {GROUP_META['needs-you'].heading}{' '}
                      <span className="fdry-cnt">
                        {findingsDecided} of {needsYouFindings.length} decided
                      </span>
                    </div>
                    {needsYouFindings.map((finding) => {
                      const choice = findingChoice[finding.id]
                      return (
                        <div key={finding.id} className="fdry-fnd">
                          <span className="fdry-fnd-text">
                            <MarkdownInline text={finding.text} />
                          </span>
                          <span className="fdry-fnd-meta">{finding.meta}</span>
                          <div className="fdry-fnd-acts">
                            <button
                              type="button"
                              aria-pressed={choice?.mode === 'ask'}
                              className={choice?.mode === 'ask' ? 'fdry-btn--sel' : ''}
                              title="Have the architect change the order so this no longer holds"
                              onClick={() =>
                                setFindingChoice((current) => ({
                                  ...current,
                                  [finding.id]: { mode: 'ask', text: '' },
                                }))
                              }
                            >
                              Ask the architect
                            </button>
                            <button
                              type="button"
                              aria-pressed={choice?.mode === 'fix'}
                              className={choice?.mode === 'fix' ? 'fdry-btn--sel' : ''}
                              title="Say how, and the architect changes the order that way"
                              onClick={() =>
                                setFindingChoice((current) => ({
                                  ...current,
                                  [finding.id]: {
                                    mode: 'fix',
                                    text: choice?.mode === 'fix' ? choice.text : '',
                                  },
                                }))
                              }
                            >
                              Fix it…
                            </button>
                            <button
                              type="button"
                              aria-pressed={choice?.mode === 'accept'}
                              className={choice?.mode === 'accept' ? 'fdry-btn--sel' : ''}
                              title="It stands, and here is why"
                              onClick={() =>
                                setFindingChoice((current) => ({
                                  ...current,
                                  [finding.id]: {
                                    mode: 'accept',
                                    text: choice?.mode === 'accept' ? choice.text : '',
                                  },
                                }))
                              }
                            >
                              Accept it
                            </button>
                          </div>
                          {choice?.mode === 'fix' ? (
                            <textarea
                              aria-label={`How should "${finding.text}" be fixed?`}
                              placeholder="How should it be fixed?"
                              rows={3}
                              value={choice.text}
                              onChange={(event) =>
                                setFindingChoice((current) => ({
                                  ...current,
                                  [finding.id]: { mode: 'fix', text: event.target.value },
                                }))
                              }
                            />
                          ) : null}
                          {choice?.mode === 'accept' ? (
                            <input
                              aria-label={`Why "${finding.text}" is accepted`}
                              placeholder="Why it stands…"
                              value={choice.text}
                              onChange={(event) =>
                                setFindingChoice((current) => ({
                                  ...current,
                                  [finding.id]: { mode: 'accept', text: event.target.value },
                                }))
                              }
                            />
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ) : null}

                {findingsByGroup.notes.length > 0 ? (
                  <div className="fdry-group">
                    <div className={`fdry-group-h fdry-group-h--${GROUP_META.notes.cls}`}>
                      <List aria-hidden="true" />
                      {GROUP_META.notes.heading}{' '}
                      <span className="fdry-cnt">{findingsByGroup.notes.length}</span>
                    </div>
                    {findingsByGroup.notes.map((finding) => (
                      <div key={finding.id} className="fdry-fnd">
                        <span className="fdry-fnd-text">
                          <MarkdownInline text={finding.text} />
                        </span>
                        <span className="fdry-fnd-meta">{finding.meta}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {findingsByGroup.resolved.length > 0 ? (
                  <details className="fdry-group fdry-group--resolved">
                    <summary className={`fdry-group-h fdry-group-h--${GROUP_META.resolved.cls}`}>
                      <Check aria-hidden="true" />
                      {GROUP_META.resolved.heading}{' '}
                      <span className="fdry-cnt">{findingsByGroup.resolved.length}</span>
                    </summary>
                    {findingsByGroup.resolved.map((finding) => (
                      <div key={finding.id} className="fdry-fnd">
                        <span className="fdry-fnd-text">
                          <MarkdownInline text={finding.text} />
                        </span>
                        <span className="fdry-fnd-meta">{finding.meta}</span>
                      </div>
                    ))}
                  </details>
                ) : null}

                {blockingFindings.length === 0 &&
                findingsByGroup.notes.length === 0 &&
                findingsByGroup.resolved.length === 0 ? (
                  <p className="fdry-step-intro">
                    Nothing here blocks hand-off. An adversarial pass read the plan and left nothing
                    that would make the change wrong.
                  </p>
                ) : null}
              </>
            ) : null}

            {stepView.id === 'shape' ? (
              <>
                <p className="fdry-step-intro">
                  {recipes?.proposed !== undefined
                    ? `${capitalise(recipes.proposed)} is proposed: ${recipes.proposedWhy ?? ''}. Pick any shape. Your choice is saved and used at hand-off.`
                    : 'Pick any shape. Your choice is saved and used at hand-off.'}
                </p>
                {recipes?.chosen !== null &&
                recipes?.chosen !== undefined &&
                recipes.chosen !== recipes.proposed ? (
                  <div className="fdry-saved">
                    <Check aria-hidden="true" />
                    Saved{' '}
                    {recipes.chosenAt !== null && recipes.chosenAt !== undefined
                      ? clockOf(recipes.chosenAt)
                      : ''}
                    : {capitalise(recipes.chosen)}.
                    <button
                      type="button"
                      className="fdry-btn fdry-btn--quiet"
                      onClick={() => void pickRecipe(null)}
                    >
                      Use the proposal
                    </button>
                  </div>
                ) : null}
                <div className="fdry-shapes">
                  {recipes?.recipes?.map((option) => {
                    const isSelected = (recipes.chosen ?? recipes.proposed) === option.name
                    if (!option.available || (!isDraft && r.locks.handOff !== null)) {
                      const reason = !option.available
                        ? shapeUnavailable(option.name, option.unmet)
                        : r.locks.handOff
                      return (
                        <ReasonButton
                          key={option.name}
                          tip="fit"
                          reason={reason}
                          className={`fdry-shape${isSelected ? ' is-on' : ''} fdry-shape--off`}
                        >
                          <span className="fdry-shape-nm">
                            <b>{capitalise(option.name)}</b>
                            <Lock aria-hidden="true" />
                          </span>
                          <small>
                            {option.available
                              ? (option.description ?? '')
                              : `Unavailable: ${option.unmet.join('; ')}`}
                          </small>
                        </ReasonButton>
                      )
                    }
                    return (
                      <button
                        key={option.name}
                        type="button"
                        className={`fdry-shape${isSelected ? ' is-on' : ''}`}
                        aria-pressed={isSelected}
                        onClick={() => void pickRecipe(option.name)}
                      >
                        <span className="fdry-shape-nm">
                          <b>{capitalise(option.name)}</b>
                          {option.name === recipes.proposed ? (
                            <span className="fdry-mark">Proposed</span>
                          ) : null}
                          {option.name === recipes.chosen && option.name !== recipes.proposed ? (
                            <span className="fdry-mark fdry-mark--you">Your choice</span>
                          ) : null}
                        </span>
                        <small>{option.description ?? ''}</small>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : null}

            {stepView.id === 'tracker' ? (
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
                          disabled={locked}
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

                <section className="fdry-field">
                  <h3 className="fdry-field-h">What goes back to the issue</h3>
                  <div className="fdry-writebacks">
                    {WRITE_BACKS.map((kind) => (
                      <label key={kind.id} className="fdry-writeback">
                        <input
                          type="checkbox"
                          checked={order.writeBack.includes(kind.id)}
                          disabled={locked}
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

            {stepView.id === 'handOff' ? (
              <>
                {isDraft ? (
                  <p className="fdry-step-intro">
                    {view.intake?.kind === 'refused'
                      ? 'These rows describe the order as it stood before the refused turn.'
                      : 'Hand-off agrees the order and starts the work. Every row must pass.'}
                  </p>
                ) : null}
                {isDraft ? (
                  <div className="fdry-checks">{r.rows.map(renderHandOffRow)}</div>
                ) : (
                  <>
                    <p className="fdry-step-intro">
                      All six rows passed at agreement. The order is now read-only. Changes go
                      through the run.
                    </p>
                    <div className="fdry-checks">
                      <div className="fdry-chk">
                        <span className="fdry-chk-icon" aria-hidden="true">
                          <Check aria-hidden="true" />
                        </span>
                        <div>
                          <b>Six of six rows passed</b>
                          <small>
                            Questions, proof, coverage, risk, red team, nobody changing the plan.
                          </small>
                        </div>
                        <span className="fdry-pill fdry-pill--pass">Agreed</span>
                      </div>
                      <div className="fdry-chk">
                        <span className="fdry-chk-icon" aria-hidden="true">
                          <Play aria-hidden="true" />
                        </span>
                        <div>
                          <b>Run started with {capitalise(shapeName ?? 'the proposed')}</b>
                          <small>
                            {recipes?.recipes?.find((r2) => r2.name === shapeName)?.description ??
                              ''}
                          </small>
                        </div>
                        <span className="fdry-pill fdry-pill--work">{r.runState}</span>
                      </div>
                    </div>
                  </>
                )}
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
                  void converge(draft)
                  setDraft('')
                }}
              >
                <input
                  aria-label="Tell the architect what is wrong, or what you want instead"
                  placeholder="Tell the architect what's wrong, or what you want instead…"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <ReasonButton
                  type="submit"
                  reason={
                    r.locks.message ?? (draft.trim() === '' ? LOCAL_REASONS.emptyMessage : null)
                  }
                >
                  Send
                </ReasonButton>
              </form>
            ) : null}
          </section>
        </div>

        {isDraft || problem !== null || view.advisory != null ? (
          <footer className="fdry-foot">
            {problem !== null ? <p className="fdry-problem">{problem}</p> : null}
            {previous !== undefined ? (
              <button type="button" className="fdry-btn" onClick={() => openStep(previous.id)}>
                Back
              </button>
            ) : null}
            {r.handOffWhy !== null && stepView.id === 'handOff' ? (
              <span className="fdry-why">
                <Info aria-hidden="true" />
                {r.handOffWhy}
              </span>
            ) : stepNeedsYou.decided > 0 && stepNeedsYou.total !== stepNeedsYou.decided ? (
              <span className="fdry-why">
                <Info aria-hidden="true" />
                Send now or decide the {stepNeedsYou.total === 2 ? 'second' : 'next'} finding first.
                Undecided findings stay open.
              </span>
            ) : (
              <span className="fdry-why" />
            )}

            {stepView.id === 'handOff' ? (
              <>
                {view.agreed !== undefined && !isDraft ? null : (
                  <ReasonButton
                    className="fdry-btn fdry-btn--primary"
                    reason={r.locks.handOff}
                    onClick={() => void handOff()}
                  >
                    {r.canHandOff ? <Play aria-hidden="true" /> : <Lock aria-hidden="true" />}
                    {r.canHandOff
                      ? `Hand off with ${capitalise(shapeName ?? 'the proposed')}`
                      : 'Hand off'}
                  </ReasonButton>
                )}
              </>
            ) : stepNeedsYou.total > 0 ? (
              <ReasonButton
                className="fdry-btn fdry-btn--primary"
                reason={sendReason}
                onClick={sendDecisionsOnThisStep}
              >
                {stepNeedsYou.decided === 0
                  ? 'Send decisions'
                  : `Send ${stepNeedsYou.decided} decision${stepNeedsYou.decided === 1 ? '' : 's'}`}
              </ReasonButton>
            ) : next !== undefined ? (
              <button
                type="button"
                className="fdry-btn fdry-btn--primary"
                onClick={() => openStep(next.id)}
              >
                Next: {STEP_LABELS[next.id]}
              </button>
            ) : null}

            {stepView.id === 'handOff' && view.advisory != null ? (
              <p className="fdry-note fdry-advisory">{view.advisory}</p>
            ) : null}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
