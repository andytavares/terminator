import { Button, Markdown } from '@terminator/extension-ui'
import { openInBrowser } from '@terminator/extension-sdk/renderer'
import React, { useCallback, useEffect, useRef, useState } from 'react'
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
import { usePushed } from '../renderer/use-pushed.js'
import { ReasonButton } from './ReasonButton.js'
import {
  readiness,
  capitalise,
  shapeUnavailable,
  LOCAL_REASONS,
  type LoopFacts,
  type AgreedFacts,
  type EnvironmentFacts,
  type Row,
  type StepView,
  type FindingView,
  type FindingGroup,
  type StripAction,
  type StripIcon,
  type StepMark,
} from '../forge/readiness.js'
import { invoke } from '@terminator/extension-sdk/renderer'

// The Forge.
//
// One box, one derivation. `readiness()` (ADR 074) is the one answer every
// piece of this screen reads: who holds the order, the status strip, the
// step rail, the seven hand-off rows, the red-team findings by who acts on
// them, and why every control that can be unavailable is unavailable. This
// component draws what it returns and decides nothing about state itself.

interface OrderView {
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
  environment?: EnvironmentFacts
  advisory?: string | null
  /** Why hand-off was turned down, when the base branch check held it. */
  refused?: string
}

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
  readonly answers: readonly {
    readonly questionId: string
    readonly option: number | readonly number[]
  }[]
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
  questionChoices: Readonly<Record<string, readonly number[]>>,
  findingChoice: Readonly<Record<string, FindingChoice>>,
  questions: readonly Pick<Question, 'id' | 'multiple'>[]
): Settle {
  const answers = Object.entries(questionChoices)
    .filter(([, picked]) => picked.length > 0)
    .map(([questionId, picked]) => ({
      questionId,
      option: questions.find((q) => q.id === questionId)?.multiple === true ? picked : picked[0],
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

async function readCompiled(orderId: string): Promise<OrderView | null> {
  const next = (await invoke('foundry:order.compile', { id: orderId, commit: false })) as
    | OrderView
    | { error: string }
  return 'error' in next ? null : next
}

async function readRecipes(orderId: string): Promise<RecipesView> {
  return (await invoke('foundry:run.recipes', { id: orderId })) as RecipesView
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

/** A group's findings, each its text and where it came from. */
function FindingRows({ findings }: { readonly findings: readonly FindingView[] }): JSX.Element {
  return (
    <>
      {findings.map((finding) => (
        <div key={finding.id} className="fdry-fnd">
          <span className="fdry-fnd-text">
            <Markdown inline fetchesNothing className="fdry-md-inline" onOpenLink={openInBrowser}>
              {finding.text}
            </Markdown>
          </span>
          <span className="fdry-fnd-meta">{finding.meta}</span>
        </div>
      ))}
    </>
  )
}

export function Forge({ orderId, onStarted, standing }: ForgeProps): JSX.Element {
  const state = useForgeState(orderId, onStarted)
  if (state.view === null) {
    return <div className="fdry-empty">Loading the order…</div>
  }
  return <ForgeWizard forge={deriveForge(state, state.view, standing)} />
}

/** Everything the Forge keeps, with its hooks and effects in the order they ran. */
function useForgeState(orderId: string, onStarted: ForgeProps['onStarted']) {
  const setFocusTarget = useFocusTarget()
  const choices = useChoices()
  const shown = useOrderView(orderId)
  const tracker = useTrackerStates(orderId)
  const shapes = useRecipes(orderId)
  const writeBack = useWriteBack(orderId, shown.setView)
  const edits = useOrderEdits(orderId, shown)
  const talk = useConverge(orderId, shown)
  const moves = useOrderMoves(orderId, { shown, shapes })
  const moveEnvironment = useEnvironmentMove(orderId, shown)
  const handOff = useHandOff({ orderId, onStarted, shown, shapes })
  useQueuedSettle(shown.view, choices, talk.applySettle)
  return {
    orderId,
    onStarted,
    setFocusTarget,
    ...choices,
    ...shown,
    ...tracker,
    ...writeBack,
    handOff,
    ...shapes,
    ...edits,
    ...talk,
    ...moves,
    moveEnvironment,
  }
}

type ForgeState = ReturnType<typeof useForgeState>

/** Moves focus to an element by id. An object, so asking for the same target twice is two requests. */
function useFocusTarget() {
  const [focusTarget, setFocusTarget] = useState<{ readonly target: string } | null>(null)
  useEffect(() => {
    if (focusTarget !== null) goTo(focusTarget.target)
  }, [focusTarget])
  return setFocusTarget
}

/** What the operator has chosen on this screen and not yet sent. */
function useChoices() {
  const [draft, setDraft] = useState('')
  const [questionChoices, setQuestionChoices] = useState<Record<string, number[]>>({})
  const [findingChoice, setFindingChoice] = useState<Record<string, FindingChoice>>({})
  const [queuedSettle, setQueuedSettle] = useState<Settle | null>(null)
  const [picked, setPicked] = useState<StepId | null>(null)
  return {
    draft,
    setDraft,
    questionChoices,
    setQuestionChoices,
    findingChoice,
    setFindingChoice,
    queuedSettle,
    setQueuedSettle,
    picked,
    setPicked,
    ...useUnproven(),
  }
}

/** The criterion being marked unprovable, and the reason typed for it. */
function useUnproven() {
  const [unproven, setUnproven] = useState<string | null>(null)
  const [unprovenReason, setUnprovenReason] = useState('')
  return { unproven, setUnproven, unprovenReason, setUnprovenReason }
}

type Choices = ReturnType<typeof useChoices>

/** Whether a change is in flight, and what the last one said; `busyWith` brackets one. */
function useBusy() {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const busyWith = useCallback(async (work: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setProblem(null)
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, setBusy, problem, setProblem, busyWith }
}

/** The order as compiled, what the last turn moved, and reading it again. */
function useOrderView(orderId: string) {
  const [view, setView] = useState<OrderView | null>(null)
  const busy = useBusy()
  const [moved, setMoved] = useState<string[]>([])
  const showCompiled = useCallback((next: OrderView | null): void => {
    if (next !== null) setView(next)
  }, [])
  const refresh = useCallback(
    () => readCompiled(orderId).then(showCompiled),
    [orderId, showCompiled]
  )
  // While the architect is redrafting, the order, its ledger and the intake
  // session change under this view; Foundry says when. Nothing is pushed for a
  // settled order, so only a draft listens.
  const readThisOrder = useCallback(() => readCompiled(orderId), [orderId])
  usePushed(readThisOrder, showCompiled, {
    kinds: view?.order.status === 'draft' ? ['order', 'ledger', 'live', 'graph'] : [],
    orderId,
  })
  return { view, setView, ...busy, moved, setMoved, refresh }
}

type Shown = ReturnType<typeof useOrderView>

/** The tracker's states and this order's mapping onto them. */
function useTrackerStates(orderId: string) {
  const [states, setStates] = useState<StatesView | null>(null)
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
  return { states, mapIntent }
}

/** The shapes this order could take, and reading them again. */
function useRecipes(orderId: string) {
  const [recipes, setRecipes] = useState<RecipesView | null>(null)
  const refreshRecipes = useCallback(() => readRecipes(orderId).then(setRecipes), [orderId])
  useEffect(() => {
    void readRecipes(orderId).then(setRecipes)
  }, [orderId])
  return { recipes, refreshRecipes }
}

type Shapes = ReturnType<typeof useRecipes>

/** What this order writes back to its issue. */
function useWriteBack(orderId: string, setView: Shown['setView']) {
  const setWriteBack = useCallback(
    async (writeBack: WriteBack[]) => {
      const next = (await invoke('foundry:order.writeBack', { id: orderId, writeBack })) as
        | OrderView
        | { error: string }
      if ('order' in next) setView(next)
    },
    [orderId, setView]
  )
  return { setWriteBack }
}

/** Edits that are not a turn of the architect's: budgets, and a struck or excused line. */
function useOrderEdits(orderId: string, { setView, setProblem, setMoved, busyWith }: Shown) {
  const setBudgets = useCallback(
    (budgets: Record<string, number | null>) =>
      busyWith(async () => {
        const next = (await invoke('foundry:order.budgets', { id: orderId, budgets })) as
          | OrderView
          | { error: string }
        if ('order' in next) setView(next)
        else setProblem(next.error)
      }),
    [orderId, busyWith, setView, setProblem]
  )
  const turn = useCallback(
    (payload: Record<string, unknown>) =>
      busyWith(async () => {
        const next = (await invoke('foundry:order.turn', { id: orderId, ...payload })) as
          | (OrderView & { error?: string })
          | { error: string }
        if ('order' in next) {
          setView(next)
          setMoved(next.changed ?? [])
        }
        if (next.error !== undefined) setProblem(next.error)
      }),
    [orderId, busyWith, setView, setMoved, setProblem]
  )
  return { setBudgets, turn }
}

/** One converge turn: a message from the operator, or a settle of the plan. */
function useConverge(orderId: string, { setView, setProblem, busyWith }: Shown) {
  const sendConverge = useCallback(
    (turn: { message?: string; settle?: Settle }) =>
      busyWith(async () => {
        const next = (await invoke('foundry:order.converge', { id: orderId, ...turn })) as
          | (OrderView & { error?: string; converging?: string })
          | { error: string }
        if ('order' in next) setView(next)
        if (next.error !== undefined) setProblem(next.error)
      }),
    [orderId, busyWith, setView, setProblem]
  )
  const converge = useCallback(
    (message?: string) => sendConverge(message === undefined ? {} : { message }),
    [sendConverge]
  )
  const applySettle = useCallback((settle: Settle) => sendConverge({ settle }), [sendConverge])
  return { converge, applySettle }
}

/** Agrees the order; what compile said, which is the order or why not. */
async function commitOrder(orderId: string): Promise<OrderView | { error: string }> {
  return (await invoke('foundry:order.compile', { id: orderId, commit: true })) as
    | OrderView
    | { error: string }
}

/** Starts the agreed order's run in the shape chosen, if one was; why not, when it did not start. */
async function startAgreedRun(
  orderId: string,
  chosen: string | null | undefined
): Promise<string | null> {
  const started = (await invoke('foundry:run.start', {
    id: orderId,
    ...(chosen != null ? { recipe: chosen } : {}),
  })) as {
    error?: string
    order?: { status: string }
  }
  return started.error ?? null
}

/** Checking the base branch again, or handing off without it. */
function useEnvironmentMove(
  orderId: string,
  { setView, setProblem }: Pick<Shown, 'setView' | 'setProblem'>
) {
  return useCallback(
    async (move: 'check' | 'waive') => {
      const next = (await invoke('foundry:forge.environment', { id: orderId, move })) as
        | OrderView
        | { error: string }
      if ('error' in next) setProblem(next.error)
      else if ('order' in next) setView(next)
    },
    [orderId, setView, setProblem]
  )
}

/** Holding the order, and picking its shape. */
function useOrderMoves(orderId: string, { shown, shapes }: Pick<HandOffDeps, 'shown' | 'shapes'>) {
  const { setBusy, refresh } = shown
  const { refreshRecipes } = shapes
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
    [orderId, refresh, setBusy]
  )
  const pickRecipe = useCallback(
    async (recipe: string | null) => {
      await invoke('foundry:order.recipe', { id: orderId, recipe })
      await Promise.all([refresh(), refreshRecipes()])
    },
    [orderId, refresh, refreshRecipes]
  )
  return { holdOrder, pickRecipe }
}

interface HandOffDeps {
  readonly orderId: string
  readonly onStarted: ForgeProps['onStarted']
  readonly shown: Shown
  readonly shapes: Shapes
}

/** Agrees the order and starts its run in the shape chosen. */
function useHandOff({ orderId, onStarted, shown, shapes }: HandOffDeps) {
  const { setView, setProblem, busyWith } = shown
  const chosen = shapes.recipes?.chosen
  return useCallback(
    () =>
      busyWith(async () => {
        const next = await commitOrder(orderId)
        if ('error' in next) {
          setProblem(next.error)
          return
        }
        setView(next)
        if (next.refused !== undefined) {
          setProblem(next.refused)
          return
        }
        if (next.order.status !== 'agreed') return
        const trouble = await startAgreedRun(orderId, chosen)
        if (trouble !== null) {
          setProblem(`The order is agreed, but the run did not start: ${trouble}`)
          return
        }
        onStarted?.(orderId)
      }),
    [orderId, onStarted, chosen, busyWith, setView, setProblem]
  )
}

/** The turn that was queued behind is sent once; it clears when it has been. */
function useQueuedSettle(
  view: OrderView | null,
  { queuedSettle, setQueuedSettle }: Choices,
  applySettle: (settle: Settle) => Promise<void>
): void {
  const drafting = view?.intake?.kind === 'running'
  const sentSettle = useRef<Settle | null>(null)
  useEffect(() => {
    if (drafting || queuedSettle === null || sentSettle.current === queuedSettle) return
    sentSettle.current = queuedSettle
    void applySettle(queuedSettle).then(() => setQueuedSettle(null))
  }, [drafting, queuedSettle, applySettle, setQueuedSettle])
}

/** The shapes on offer and whether the tracker step is: what decides which steps there are. */
function offersOf({ recipes, states }: Pick<ForgeState, 'recipes' | 'states'>) {
  return {
    shape: (recipes?.recipes?.length ?? 0) > 0,
    tracker: states?.capability !== undefined && states.capability.transitions !== 'no_issue',
  }
}

/** The shape the operator picked, when it is not the one proposed; null otherwise. */
function ownChoice(recipes: RecipesView | null): string | null {
  const chosen = recipes?.chosen
  return chosen !== null && chosen !== undefined && chosen !== recipes?.proposed ? chosen : null
}

function shapeNameOf(recipes: RecipesView | null, order: WorkOrder): string | null {
  return recipes?.chosen ?? recipes?.proposed ?? order.recipe ?? null
}

/** What the loop, the agreement and the last turn say, with what each means when absent. */
function settledFacts(view: OrderView) {
  return {
    loop: view.loop ?? { rounds: [], heldAt: null, exhausted: false },
    agreed: view.agreed ?? null,
    turnEndedAt: view.turnEndedAt ?? null,
    environment: view.environment,
  }
}

interface StepPlace {
  readonly order: WorkOrder
  readonly compile: CompileResult
  readonly offers: ReturnType<typeof offersOf>
  readonly picked: StepId | null
}

/** The step on screen — the one picked, or the one the order opens on — and its neighbours. */
function stepsAround(
  r: ReturnType<typeof readiness>,
  { order, compile, offers, picked }: StepPlace
) {
  const forgeStepList = forgeSteps(compile, offers)
  const pickedIndex = r.steps.findIndex((each) => each.id === picked)
  const index =
    pickedIndex !== -1
      ? pickedIndex
      : r.steps.findIndex((each) => each.id === openingStep(order, forgeStepList))
  return {
    stepView: r.steps[Math.max(index, 0)],
    previous: r.steps[index - 1],
    next: r.steps[index + 1],
  }
}

// Findings grouped by who acts on them, in the order the rendering shows: fixing,
// needs-you, notes, resolved. An empty group is not shown.
function groupFindings(findings: readonly FindingView[]): Record<FindingGroup, FindingView[]> {
  const byGroup: Record<FindingGroup, FindingView[]> = {
    fixing: [],
    'needs-you': [],
    notes: [],
    resolved: [],
  }
  for (const finding of findings) byGroup[finding.group].push(finding)
  return byGroup
}

/** What `readiness()` says of the order as kept, with what it was asked from. */
function readinessOf(state: ForgeState, view: OrderView, standing: Standing | undefined) {
  const { order, compile } = view
  const intake: IntakeOutcome = view.intake ?? { kind: 'none' }
  const offers = offersOf(state)
  const shapeName = shapeNameOf(state.recipes, order)
  const r = readiness({
    order,
    compile,
    intake,
    ...settledFacts(view),
    shape: { name: shapeName, yours: ownChoice(state.recipes) !== null },
    offers,
    turn: standing?.turn,
    clock: clockOf,
  })
  return { order, compile, intake, offers, shapeName, r }
}

/** Everything the Forge draws from: what it keeps, and what `readiness()` says of it. */
function deriveForge(state: ForgeState, view: OrderView, standing: Standing | undefined) {
  const { order, compile, intake, offers, shapeName, r } = readinessOf(state, view, standing)
  const locked = state.busy || intake.kind === 'running'
  const forge = {
    ...state,
    view,
    order,
    isDraft: order.status === 'draft',
    intake,
    drafting: intake.kind === 'running',
    asked: intake.kind === 'running' ? intake.asked : null,
    locked,
    r,
    shapeName,
    ...stepsAround(r, { order, compile, offers, picked: state.picked }),
    findingsByGroup: groupFindings(r.findings),
    askReason: locked ? (r.locks.redraft ?? LOCAL_REASONS.saving) : null,
  }
  return { ...forge, stepNeedsYou: needsYouOn(forge) }
}

type ForgeModel = ReturnType<typeof deriveForge>
interface ForgeProp {
  readonly forge: ForgeModel
}

function decidedFindings(
  findings: readonly FindingView[],
  findingChoice: Readonly<Record<string, FindingChoice>>
): number {
  return findings.filter((f) => findingDecided(findingChoice[f.id])).length
}

function decidedQuestions(
  questions: readonly { readonly id: string }[],
  questionChoices: Readonly<Record<string, readonly number[]>>
): number {
  return questions.filter((q) => (questionChoices[q.id] ?? []).length > 0).length
}

interface StepDecisions extends Pick<ForgeState, 'findingChoice' | 'questionChoices'> {
  readonly stepView: StepView
  readonly findingsByGroup: Record<FindingGroup, FindingView[]>
  readonly order: WorkOrder
}

/** How many decisions the step on screen asks of the operator, and how many are made. */
function needsYouOn(forge: StepDecisions): { readonly total: number; readonly decided: number } {
  if (forge.stepView.id === 'redTeam') {
    const findings = forge.findingsByGroup['needs-you']
    return { total: findings.length, decided: decidedFindings(findings, forge.findingChoice) }
  }
  if (forge.stepView.id === 'plan') {
    const questions = surfacedQuestions(forge.order.openQuestions)
    return { total: questions.length, decided: decidedQuestions(questions, forge.questionChoices) }
  }
  return { total: 0, decided: 0 }
}

function sendReasonOf({ stepNeedsYou, queuedSettle }: ForgeModel): string | null {
  if (stepNeedsYou.total === 0) return null
  if (queuedSettle !== null) return LOCAL_REASONS.queued
  return stepNeedsYou.decided === 0 ? LOCAL_REASONS.nothingDecided : null
}

function openStep(forge: ForgeModel, id: StepId): void {
  forge.setPicked(id)
  forge.setFocusTarget({ target: STEP_HEADING })
}

/** The decisions made on this step, as one settle, cleared from the screen. */
function takeDecisions(forge: ForgeModel): Settle | null {
  if (forge.stepView.id === 'redTeam') {
    const settle = buildSettle({}, forge.findingChoice, [])
    forge.setFindingChoice({})
    return settle
  }
  if (forge.stepView.id === 'plan') {
    const settle = buildSettle(forge.questionChoices, {}, forge.order.openQuestions)
    forge.setQuestionChoices({})
    return settle
  }
  return null
}

/** Sends this step's decisions now, or queues them behind the turn the architect is taking. */
function sendDecisionsOnThisStep(forge: ForgeModel): void {
  const settle = takeDecisions(forge)
  if (settle === null) return
  if (forge.drafting) {
    forge.setQueuedSettle(settle)
    return
  }
  void forge.applySettle(settle)
}

function handleAttach(forge: ForgeModel, sessionId: string): void {
  void attachToSession(sessionId).then(forge.setProblem)
}

/** What the architect is told after a refused proposal: the reason, and to change nothing else. */
function refusedRetry(reason: string): string {
  return `Your last proposal was refused and nothing was changed. The reason: ${reason}. Write ${PROPOSAL_FILE} again, fixing exactly that and changing nothing else.`
}

const STRIP_MOVES: Record<StripAction, (forge: ForgeModel) => void> = {
  hold: (forge) => void forge.holdOrder(true),
  release: (forge) => void forge.holdOrder(false),
  watch: (forge) => {
    if (forge.intake.kind === 'running') handleAttach(forge, forge.intake.sessionId)
  },
  'tell-architect': (forge) => {
    if (forge.intake.kind === 'refused') void forge.converge(refusedRetry(forge.intake.reason))
  },
  'start-over': (forge) => void forge.converge(),
  'open-run': (forge) => forge.onStarted?.(forge.orderId),
  draft: (forge) => void forge.converge(),
}

function stripLabels(intake: IntakeOutcome): Record<StripAction, string> {
  return {
    hold: 'Hold for me',
    release: 'Let it continue',
    watch: intake.kind === 'running' ? `Watch the ${intake.actor}` : 'Watch',
    'tell-architect': 'Tell the architect what was wrong',
    'start-over': 'Start the turn over',
    'open-run': 'Open the run',
    draft: 'Draft the plan',
  }
}

function ForgeWizard({ forge }: ForgeProp) {
  return (
    <div className="fdry-forge">
      <div className="fdry-wizard">
        <ForgeHeader forge={forge} />
        <StatusStrip forge={forge} />
        <div className="fdry-body">
          <StepRail forge={forge} />
          <section className="fdry-main" aria-labelledby={STEP_HEADING}>
            <h2 className="fdry-step-h" id={STEP_HEADING} tabIndex={-1}>
              {stepTitle(forge)}
            </h2>
            <CurrentStep forge={forge} />
            {forge.isDraft ? <MessageForm forge={forge} /> : null}
          </section>
        </div>
        <ForgeFooter forge={forge} />
      </div>
    </div>
  )
}

function ForgeHeader({ forge }: ForgeProp) {
  const { order, r } = forge
  return (
    <header className="fdry-wiz-head">
      <div className="fdry-wiz-title">
        <b>{order.title}</b>
        <div className="fdry-wiz-sub">
          <SourceChip source={order.source} />
          <span>{r.summary}</span>
        </div>
      </div>
      <div className="fdry-wiz-actions">
        <WatchButton forge={forge} />
        {forge.isDraft && !r.strip.actions.includes('draft') ? (
          <ReasonButton reason={r.locks.redraft} icon={Wand} onClick={() => void forge.converge()}>
            {order.plan.units.length === 0 ? 'Draft the plan' : 'Redraft'}
          </ReasonButton>
        ) : null}
      </div>
    </header>
  )
}

function SourceChip({ source }: { readonly source: WorkOrder['source'] }) {
  if (source.kind === 'signal') return <span className="fdry-chip">From a sensor signal</span>
  if (source.key === null) return null
  return (
    <span className="fdry-chip">
      {capitalise(source.tracker ?? '')} {source.key}
    </span>
  )
}

/** Watching the architect at work, or attaching to the conversation the order was shaped in. */
function WatchButton({ forge }: ForgeProp) {
  const { intake, order } = forge
  if (intake.kind === 'running') {
    return (
      <Button variant="ghost" icon={Terminal} onClick={() => handleAttach(forge, intake.sessionId)}>
        {stripLabels(intake).watch}
      </Button>
    )
  }
  if (order.provenance.forgeSession === null) return null
  return (
    <Button
      variant="ghost"
      icon={Terminal}
      onClick={() => handleAttach(forge, order.provenance.forgeSession ?? '')}
    >
      Attach
    </Button>
  )
}

function StatusStrip({ forge }: ForgeProp) {
  const { strip } = forge.r
  return (
    <div className={`fdry-strip fdry-strip--${strip.tone}`}>
      <div className="fdry-strip-who">
        <span className="fdry-strip-icon" aria-hidden="true">
          <StripIconGlyph icon={strip.icon} />
        </span>
        <div>
          <b>{strip.headline}</b>
          <small>{strip.detail}</small>
        </div>
      </div>
      {strip.actions.length > 0 ? <StripActions forge={forge} /> : null}
    </div>
  )
}

function StripActions({ forge }: ForgeProp) {
  const labels = stripLabels(forge.intake)
  return (
    <div className="fdry-strip-acts">
      {forge.r.strip.actions.map((action) => (
        <Button
          key={action}
          variant={action === 'tell-architect' ? 'primary' : 'secondary'}
          icon={action === 'hold' ? Pause : action === 'watch' ? Terminal : undefined}
          onClick={() => STRIP_MOVES[action](forge)}
        >
          {labels[action]}
        </Button>
      ))}
    </div>
  )
}

function StepRail({ forge }: ForgeProp) {
  return (
    <nav aria-label="Steps" className="fdry-rail">
      {forge.r.steps.map((each, position) => (
        <RailStep key={each.id} forge={forge} each={each} position={position} />
      ))}
    </nav>
  )
}

interface RailStepProps extends ForgeProp {
  readonly each: StepView
  readonly position: number
}

function RailStep({ forge, each, position }: RailStepProps) {
  const on = each === forge.stepView
  return (
    <button
      type="button"
      className={`fdry-rail-step fdry-rail-step--${STEP_STATE_CLASS[each.state]}${on ? ' is-on' : ''}`}
      aria-current={on ? 'step' : undefined}
      onClick={() => openStep(forge, each.id)}
    >
      <span className="fdry-mk" aria-hidden="true">
        {each.mark === 'number' ? position + 1 : <RailMark mark={each.mark} position={position} />}
      </span>
      <span>
        <b>{STEP_LABELS[each.id]}</b>
        <small>{each.word}</small>
      </span>
    </button>
  )
}

function stepTitle({ stepView, isDraft, view, order }: ForgeModel): string {
  if (stepView.id !== 'handOff' || isDraft) return STEP_TITLES[stepView.id]
  const by = view.agreed?.by === 'automatic' ? 'automatic hand-off' : 'you'
  return `Agreed at ${clockOf(view.agreed?.at ?? order.agreedAt ?? '')} by ${by}`
}

const STEP_BODIES: Record<StepId, (props: ForgeProp) => JSX.Element> = {
  intent: IntentStep,
  plan: PlanStep,
  redTeam: RedTeamStep,
  shape: ShapeStep,
  tracker: TrackerStep,
  handOff: HandOffStep,
}

function CurrentStep({ forge }: ForgeProp) {
  const Body = STEP_BODIES[forge.stepView.id]
  return <Body forge={forge} />
}

function noCriteria(order: WorkOrder): string {
  return order.source.kind === 'tracker'
    ? `Nothing under an acceptance heading in ${order.source.key ?? 'the ticket'}. Press “Draft the plan” and the architect will write the criteria from what it does say.`
    : 'No criteria yet. Nothing writes them but the architect — press “Draft the plan”.'
}

function redrawn(forge: ForgeModel, field: string): string {
  return forge.moved.includes(field) ? 'is-redrawn' : ''
}

function IntentStep({ forge }: ForgeProp) {
  const { order } = forge
  return (
    <>
      <p className="fdry-step-intro">
        The problem and the outcome this order is for. The architect plans everything else from
        them.
      </p>
      <section className={`fdry-field ${redrawn(forge, 'intent')}`}>
        <IntentField heading="Problem" text={order.intent.problem} />
        <IntentField heading="Outcome" text={order.intent.outcome} />
      </section>
      {order.acceptance.length === 0 ? (
        <p className="fdry-step-callout">{noCriteria(order)}</p>
      ) : null}
    </>
  )
}

function IntentField({ heading, text }: { readonly heading: string; readonly text: string }) {
  return (
    <>
      <h3 className="fdry-field-h">{heading}</h3>
      {text === '' ? (
        <p className="fdry-note">Not stated yet.</p>
      ) : (
        <Markdown fetchesNothing className="fdry-md" onOpenLink={openInBrowser}>
          {text}
        </Markdown>
      )}
    </>
  )
}

function PlanStep({ forge }: ForgeProp) {
  return (
    <>
      <p className="fdry-step-intro">
        What has to be true when the work is done, how each part is proven, and what the architect
        assumed.
      </p>
      <PlanChecks forge={forge} />
      <QuestionsGroup forge={forge} />
      <AcceptanceSection forge={forge} />
      <CoverageSection order={forge.order} />
      <AssumptionsSection forge={forge} />
      <BudgetsSection forge={forge} />
    </>
  )
}

const PLAN_CHECKS = ['verifiable', 'coverage', 'risk'] as const

function PlanChecks({ forge }: ForgeProp) {
  const failing = PLAN_CHECKS.some(
    (id) => forge.r.rows.find((row) => row.id === id)?.state !== 'passed'
  )
  if (!failing) return null
  return (
    <div className="fdry-checks">
      {PLAN_CHECKS.map((id) => (
        <PlanCheck key={id} forge={forge} id={id} />
      ))}
    </div>
  )
}

/** A failing or in-progress plan check, on the step that clears it. */
function PlanCheck({ forge, id }: ForgeProp & { readonly id: CheckId }) {
  const row = forge.r.rows.find((each) => each.id === id)
  return row === undefined || row.state === 'passed' ? null : <CheckRow forge={forge} row={row} />
}

function CheckRow({ forge, row }: ForgeProp & { readonly row: Row }) {
  return (
    <div className={`fdry-chk${row.state === 'in-progress' ? ' fdry-chk--work' : ''}`}>
      <span className="fdry-chk-icon" aria-hidden="true">
        <RowIcon state={row.state} />
      </span>
      <div>
        <b>{row.label}</b>
        <small>{row.detail}</small>
        <RowMoves forge={forge} row={row} />
      </div>
      <span className={`fdry-pill fdry-pill--${ROW_PILL[row.state].cls}`}>
        {ROW_PILL[row.state].label}
      </span>
    </div>
  )
}

// What the operator can do about a row: one the machine is closing shows only the
// "Asked" marker; a failing or needs-you row offers its moves.
function RowMoves({ forge, row }: ForgeProp & { readonly row: Row }) {
  if (row.state === 'passed') return null
  if (row.id === 'turn') return <TurnMoves forge={forge} row={row} />
  if (row.id === 'environment') return <EnvironmentMoves forge={forge} row={row} />
  const remedies = CHECK_REMEDIES[row.id]
  if (row.state === 'in-progress') {
    const answering = remedies.some(
      (remedy) => remedy.kind === 'ask' && forge.asked === remedy.message
    )
    return answering ? (
      <div className="fdry-chk-moves">
        <Asked />
      </div>
    ) : null
  }
  return (
    <div className="fdry-chk-moves">
      {remedies.map((remedy) => (
        <RemedyMove key={remedy.label} forge={forge} remedy={remedy} />
      ))}
    </div>
  )
}

// Not proven: check it again, or skip this check. A check under way has no move.
function EnvironmentMoves({ forge, row }: ForgeProp & { readonly row: Row }) {
  return (
    <div className="fdry-chk-moves">
      {row.state === 'in-progress' ? null : (
        <Button size="sm" onClick={() => void forge.moveEnvironment('check')}>
          Check again
        </Button>
      )}
      <Button size="sm" onClick={() => void forge.moveEnvironment('waive')}>
        Skip this check
      </Button>
    </div>
  )
}

function TurnMoves({ forge, row }: ForgeProp & { readonly row: Row }) {
  const { intake } = forge
  if (row.state !== 'failing' || intake.kind !== 'refused') return null
  return (
    <div className="fdry-chk-moves">
      <ReasonButton
        size="sm"
        reason={forge.askReason}
        onClick={() => void forge.converge(refusedRetry(intake.reason))}
      >
        {TURN_REMEDY_LABEL}
      </ReasonButton>
    </div>
  )
}

function RemedyMove({ forge, remedy }: ForgeProp & { readonly remedy: Remedy }) {
  if (remedy.kind === 'ask' && forge.drafting) {
    return forge.asked === remedy.message ? <Asked /> : null
  }
  if (remedy.kind === 'goto') {
    return (
      <Button
        size="sm"
        onClick={() => {
          if (remedy.step !== null) forge.setPicked(remedy.step)
          forge.setFocusTarget({ target: remedy.target })
        }}
      >
        {remedy.label}
      </Button>
    )
  }
  return (
    <ReasonButton
      size="sm"
      reason={forge.askReason}
      onClick={() => void forge.converge(remedy.message)}
    >
      {remedy.label}
    </ReasonButton>
  )
}

type Question = ReturnType<typeof surfacedQuestions>[number]

function QuestionsGroup({ forge }: ForgeProp) {
  const questions = surfacedQuestions(forge.order.openQuestions)
  if (questions.length === 0) return null
  return (
    <div className="fdry-group">
      <div className="fdry-group-h fdry-group-h--you" id="fdry-questions-h" tabIndex={-1}>
        <AlertCircle aria-hidden="true" />
        Needs your answer{' '}
        <span className="fdry-cnt">
          {decidedQuestions(questions, forge.questionChoices)} of {questions.length} decided
        </span>
      </div>
      {questions.map((question) => (
        <QuestionCard key={question.id} forge={forge} question={question} />
      ))}
    </div>
  )
}

function QuestionCard({ forge, question }: ForgeProp & { readonly question: Question }) {
  return (
    <div className="fdry-fnd">
      <b>
        <Markdown inline fetchesNothing className="fdry-md-inline" onOpenLink={openInBrowser}>
          {question.text}
        </Markdown>
      </b>
      {question.why !== '' ? (
        <Markdown fetchesNothing className="fdry-md" onOpenLink={openInBrowser}>
          {question.why}
        </Markdown>
      ) : null}
      <fieldset className="fdry-opts">
        <legend className="fdry-opts-legend">
          {question.multiple ? 'Choose any' : 'Choose one'}
        </legend>
        {question.options.map((option, optionIndex) => (
          <QuestionOption
            key={option}
            forge={forge}
            question={question}
            at={[option, optionIndex]}
          />
        ))}
      </fieldset>
    </div>
  )
}

interface QuestionOptionProps extends ForgeProp {
  readonly question: Question
  readonly at: readonly [option: string, optionIndex: number]
}

/** The options a question has ticked: one for a single choice, any number for a multiple one. */
function pickOption(
  picked: readonly number[],
  optionIndex: number,
  multiple: boolean
): readonly number[] {
  if (!multiple) return [optionIndex]
  return picked.includes(optionIndex)
    ? picked.filter((index) => index !== optionIndex)
    : [...picked, optionIndex].sort((a, b) => a - b)
}

function toggleOption(forge: ForgeProp['forge'], question: Question, optionIndex: number): void {
  forge.setQuestionChoices((current) => ({
    ...current,
    [question.id]: [...pickOption(current[question.id] ?? [], optionIndex, question.multiple)],
  }))
}

function QuestionOption({ forge, question, at: [option, optionIndex] }: QuestionOptionProps) {
  const chosen = (forge.questionChoices[question.id] ?? []).includes(optionIndex)
  return (
    <label className="fdry-opt">
      <input
        type={question.multiple ? 'checkbox' : 'radio'}
        name={`question-${question.id}`}
        checked={chosen}
        onChange={() => toggleOption(forge, question, optionIndex)}
      />
      <span className="fdry-opt-text">
        <Markdown inline fetchesNothing className="fdry-md-inline" onOpenLink={openInBrowser}>
          {option}
        </Markdown>
        {optionIndex === question.recommended ? (
          <>
            {' '}
            <span className="fdry-opt-tag">Recommended</span>
          </>
        ) : null}
      </span>
    </label>
  )
}

type Criterion = WorkOrder['acceptance'][number]
type Matrix = ReturnType<typeof coverageMatrix>

function AcceptanceSection({ forge }: ForgeProp) {
  const { order } = forge
  const matrix = coverageMatrix(order)
  return (
    <section className={`fdry-field ${redrawn(forge, 'acceptance')}`}>
      <h3 className="fdry-field-h" id="fdry-acceptance" tabIndex={-1}>
        Acceptance criteria
      </h3>
      {order.acceptance.length === 0 ? (
        <p className="fdry-note">{noCriteria(order)}</p>
      ) : (
        order.acceptance.map((criterion) => (
          <CriterionRow key={criterion.id} forge={forge} criterion={criterion} matrix={matrix} />
        ))
      )}
    </section>
  )
}

interface CriterionProps extends ForgeProp {
  readonly criterion: Criterion
  readonly matrix: Matrix
}

function CriterionRow({ forge, criterion, matrix }: CriterionProps) {
  const uncovered = matrix.uncoveredCriteria.includes(criterion.id)
  const excused = criterion.unverifiable?.accepted === true
  return (
    <div className={`fdry-ac ${uncovered ? 'is-gap' : ''}`}>
      <span className="fdry-ac-id">{criterion.id}</span>
      <div>
        <Markdown fetchesNothing className="fdry-md" onOpenLink={openInBrowser}>
          {criterion.statement}
        </Markdown>
        <span className="fdry-verify">
          proven by {criterion.verify.kind}
          {uncovered ? ' · no unit satisfies this' : ''}
        </span>
        <CriterionExcuse forge={forge} criterion={criterion} />
        {forge.unproven === criterion.id && !excused ? (
          <UnprovenForm forge={forge} criterion={criterion} />
        ) : null}
      </div>
    </div>
  )
}

function CriterionExcuse({ forge, criterion }: ForgeProp & { readonly criterion: Criterion }) {
  if (criterion.unverifiable?.accepted === true) {
    return (
      <p className="fdry-ac-excused">accepted as unverifiable — {criterion.unverifiable?.reason}</p>
    )
  }
  if (!forge.isDraft || forge.unproven === criterion.id) return null
  return (
    <ReasonButton
      variant="ghost"
      size="sm"
      className="fdry-ac-excuse"
      reason={forge.askReason}
      onClick={() => forge.setUnproven(criterion.id)}
    >
      Nothing here can prove this
    </ReasonButton>
  )
}

/** Accepts a criterion as unprovable, with the reason typed for it. */
function acceptUnproven(forge: ForgeModel, criterionId: string): void {
  if (forge.unprovenReason.trim() === '') return
  void forge.turn({
    unverifiable: {
      criterionId,
      reason: forge.unprovenReason.trim(),
    },
  })
  forge.setUnproven(null)
  forge.setUnprovenReason('')
}

function UnprovenForm({ forge, criterion }: ForgeProp & { readonly criterion: Criterion }) {
  const { unprovenReason } = forge
  return (
    <form
      className="fdry-accept"
      onSubmit={(event) => {
        event.preventDefault()
        acceptUnproven(forge, criterion.id)
      }}
    >
      <input
        aria-label={`Why ${criterion.id} cannot be proven`}
        placeholder="Why nothing can prove it…"
        value={unprovenReason}
        onChange={(event) => forge.setUnprovenReason(event.target.value)}
      />
      <ReasonButton
        type="submit"
        size="sm"
        reason={unprovenReason.trim() === '' ? LOCAL_REASONS.acceptEmpty : forge.askReason}
      >
        Accept it
      </ReasonButton>
    </form>
  )
}

function CoverageSection({ order }: { readonly order: WorkOrder }) {
  const matrix = coverageMatrix(order)
  if (matrix.criteria.length === 0 || matrix.units.length === 0) return null
  return (
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
          <MatrixBody matrix={matrix} />
        </table>
      </div>
    </section>
  )
}

function MatrixBody({ matrix }: { readonly matrix: Matrix }) {
  return (
    <tbody>
      {matrix.criteria.map((criterion, row) => (
        <tr key={criterion}>
          <td className="fdry-matrix-row">{criterion}</td>
          {matrix.cells[row].map((hit, column) => (
            <td key={matrix.units[column]} className={cellClass(matrix, [criterion, hit])}>
              {hit ? '●' : '·'}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

function cellClass(matrix: Matrix, [criterion, hit]: readonly [string, boolean]): string {
  if (hit) return 'is-hit'
  return matrix.uncoveredCriteria.includes(criterion) ? 'is-gap' : ''
}

function AssumptionsSection({ forge }: ForgeProp) {
  const assumptions = liveAssumptions(forge.order)
  if (assumptions.length === 0) return null
  return (
    <section className={`fdry-field ${redrawn(forge, 'assumptions')}`}>
      <h3 className="fdry-field-h">Assumptions</h3>
      <p className="fdry-note">Strike any that are wrong. What depended on it is redrawn.</p>
      <div className="fdry-assume">
        {assumptions.map((assumption) => (
          <ReasonButton
            key={assumption.id}
            plain
            reason={forge.askReason}
            onClick={() => void forge.turn({ strike: assumption.id })}
          >
            <Markdown inline fetchesNothing className="fdry-md-inline" onOpenLink={openInBrowser}>
              {assumption.text}
            </Markdown>{' '}
            <X aria-hidden="true" />
          </ReasonButton>
        ))}
      </div>
    </section>
  )
}

function BudgetsSection({ forge }: ForgeProp) {
  return (
    <section className="fdry-field" aria-labelledby="fdry-budgets">
      <h3 className="fdry-field-h" id="fdry-budgets" tabIndex={-1}>
        Budgets
      </h3>
      <p className="fdry-note">
        Where the run pauses and asks you. New orders start with the limits in Settings; these are
        this order&rsquo;s.
      </p>
      {forge.isDraft ? (
        <DraftBudgets forge={forge} />
      ) : (
        <p>{budgetsInWords(forge.order.budgets)}</p>
      )}
    </section>
  )
}

function DraftBudgets({ forge }: ForgeProp) {
  const { budgets } = forge.order
  return (
    <BudgetForm
      key={JSON.stringify(budgets)}
      rows={[
        { key: 'agents', label: 'Agents at once', value: budgets.agents },
        {
          key: 'wallClockMinutes',
          label: 'Minutes',
          value: budgets.wallClockMinutes,
        },
      ]}
      submitLabel="Save budgets"
      disabled={forge.locked}
      onSubmit={(next) => void forge.setBudgets(next)}
    />
  )
}

function RedTeamStep({ forge }: ForgeProp) {
  const groups = forge.findingsByGroup
  const blocking = forge.order.redTeam.filter((f) => f.status === 'open' && isBlocking(f))
  return (
    <>
      <FindingGroupBox
        group="fixing"
        findings={groups.fixing}
        icon={<LoaderCircle aria-hidden="true" className="fdry-spin" />}
      />
      <NeedsYouGroup forge={forge} />
      <FindingGroupBox group="notes" findings={groups.notes} icon={<List aria-hidden="true" />} />
      <ResolvedGroup findings={groups.resolved} />
      {blocking.length === 0 && groups.notes.length === 0 && groups.resolved.length === 0 ? (
        <p className="fdry-step-intro">
          Nothing here blocks hand-off. An adversarial pass read the plan and left nothing that
          would make the change wrong.
        </p>
      ) : null}
    </>
  )
}

interface FindingGroupBoxProps {
  readonly group: FindingGroup
  readonly findings: readonly FindingView[]
  readonly icon: React.ReactNode
}

function FindingGroupBox({ group, findings, icon }: FindingGroupBoxProps) {
  if (findings.length === 0) return null
  return (
    <div className="fdry-group">
      <div className={`fdry-group-h fdry-group-h--${GROUP_META[group].cls}`}>
        {icon}
        {GROUP_META[group].heading} <span className="fdry-cnt">{findings.length}</span>
      </div>
      <FindingRows findings={findings} />
    </div>
  )
}

function ResolvedGroup({ findings }: { readonly findings: readonly FindingView[] }) {
  if (findings.length === 0) return null
  return (
    <details className="fdry-group fdry-group--resolved">
      <summary className={`fdry-group-h fdry-group-h--${GROUP_META.resolved.cls}`}>
        <Check aria-hidden="true" />
        {GROUP_META.resolved.heading} <span className="fdry-cnt">{findings.length}</span>
      </summary>
      <FindingRows findings={findings} />
    </details>
  )
}

function NeedsYouGroup({ forge }: ForgeProp) {
  const findings = forge.findingsByGroup['needs-you']
  if (findings.length === 0) return null
  return (
    <div className="fdry-group">
      <div className={`fdry-group-h fdry-group-h--${GROUP_META['needs-you'].cls}`}>
        <AlertCircle aria-hidden="true" />
        {GROUP_META['needs-you'].heading}{' '}
        <span className="fdry-cnt">
          {decidedFindings(findings, forge.findingChoice)} of {findings.length} decided
        </span>
      </div>
      {findings.map((finding) => (
        <NeedsYouFinding key={finding.id} forge={forge} finding={finding} />
      ))}
    </div>
  )
}

/** The three answers to a blocking finding, as the radios offer them. */
const FINDING_MOVES: readonly {
  readonly mode: FindingChoice['mode']
  readonly label: string
}[] = [
  { mode: 'ask', label: 'Ask the architect to change the order so this no longer holds' },
  { mode: 'fix', label: 'Fix it my way' },
  { mode: 'accept', label: 'Accept it, and say why' },
]

interface FindingProps {
  readonly finding: FindingView
  readonly choice: FindingChoice | undefined
  readonly choose: (next: FindingChoice) => void
}

function NeedsYouFinding({ forge, finding }: ForgeProp & { readonly finding: FindingView }) {
  const choice = forge.findingChoice[finding.id]
  const choose = (next: FindingChoice): void =>
    forge.setFindingChoice((current) => ({ ...current, [finding.id]: next }))
  return (
    <div className="fdry-fnd">
      <span className="fdry-fnd-text">
        <Markdown inline fetchesNothing className="fdry-md-inline" onOpenLink={openInBrowser}>
          {finding.text}
        </Markdown>
      </span>
      <span className="fdry-fnd-meta">{finding.meta}</span>
      <fieldset className="fdry-opts">
        <legend className="fdry-opts-legend">Choose one</legend>
        {FINDING_MOVES.map((move) => (
          <label key={move.mode} className="fdry-opt">
            <input
              type="radio"
              name={`finding-${finding.id}`}
              checked={choice?.mode === move.mode}
              onChange={() => choose({ mode: move.mode, text: keptText(choice, move.mode) })}
            />
            <span className="fdry-opt-text">{move.label}</span>
          </label>
        ))}
      </fieldset>
      <FindingText finding={finding} choice={choice} choose={choose} />
    </div>
  )
}

/** What was typed for a fix or an accept, kept when the same one is chosen again; an ask has none. */
function keptText(choice: FindingChoice | undefined, mode: FindingChoice['mode']): string {
  return mode !== 'ask' && choice?.mode === mode ? choice.text : ''
}

function FindingText({ finding, choice, choose }: FindingProps) {
  if (choice?.mode === 'fix') {
    return (
      <textarea
        aria-label={`How should "${finding.text}" be fixed?`}
        placeholder="How should it be fixed?"
        rows={3}
        value={choice.text}
        onChange={(event) => choose({ mode: 'fix', text: event.target.value })}
      />
    )
  }
  if (choice?.mode !== 'accept') return null
  return (
    <input
      aria-label={`Why "${finding.text}" is accepted`}
      placeholder="Why it stands…"
      value={choice.text}
      onChange={(event) => choose({ mode: 'accept', text: event.target.value })}
    />
  )
}

function shapeIntro(recipes: RecipesView | null): string {
  return recipes?.proposed !== undefined
    ? `${capitalise(recipes.proposed)} is proposed: ${recipes.proposedWhy ?? ''}. Pick any shape. Your choice is saved and used at hand-off.`
    : 'Pick any shape. Your choice is saved and used at hand-off.'
}

function ShapeStep({ forge }: ForgeProp) {
  const { recipes } = forge
  return (
    <>
      <p className="fdry-step-intro">{shapeIntro(recipes)}</p>
      <SavedShape forge={forge} />
      <div className="fdry-shapes">
        {recipes?.recipes?.map((option) => (
          <ShapeOption key={option.name} forge={forge} recipes={recipes} option={option} />
        ))}
      </div>
    </>
  )
}

function SavedShape({ forge }: ForgeProp) {
  const own = ownChoice(forge.recipes)
  if (own === null) return null
  const chosenAt = forge.recipes?.chosenAt
  return (
    <div className="fdry-saved">
      <Check aria-hidden="true" />
      Saved {chosenAt !== null && chosenAt !== undefined ? clockOf(chosenAt) : ''}:{' '}
      {capitalise(own)}.
      <Button variant="ghost" size="sm" onClick={() => void forge.pickRecipe(null)}>
        Use the proposal
      </Button>
    </div>
  )
}

interface ShapeOptionProps extends ForgeProp {
  readonly recipes: RecipesView
  readonly option: RecipeOption
}

function ShapeOption({ forge, recipes, option }: ShapeOptionProps) {
  const isSelected = (recipes.chosen ?? recipes.proposed) === option.name
  if (!option.available || (!forge.isDraft && forge.r.locks.handOff !== null)) {
    const reason = !option.available
      ? shapeUnavailable(option.name, option.unmet)
      : forge.r.locks.handOff
    return (
      <ReasonButton
        plain
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
  return <OpenShape forge={forge} recipes={recipes} option={option} />
}

function OpenShape({ forge, recipes, option }: ShapeOptionProps) {
  const isSelected = (recipes.chosen ?? recipes.proposed) === option.name
  return (
    <button
      type="button"
      className={`fdry-shape${isSelected ? ' is-on' : ''}`}
      aria-pressed={isSelected}
      onClick={() => void forge.pickRecipe(option.name)}
    >
      <span className="fdry-shape-nm">
        <b>{capitalise(option.name)}</b>
        {option.name === recipes.proposed ? <span className="fdry-mark">Proposed</span> : null}
        {option.name === recipes.chosen && option.name !== recipes.proposed ? (
          <span className="fdry-mark fdry-mark--you">Your choice</span>
        ) : null}
      </span>
      <small>{option.description ?? ''}</small>
    </button>
  )
}

function TrackerStep({ forge }: ForgeProp) {
  const { source } = forge.order
  return (
    <>
      <p className="fdry-step-intro">
        What this order tells {source.tracker} {source.key} as it moves.
      </p>
      {forge.states?.capability?.transitions === 'unsupported' ? (
        <p className="fdry-note">
          {source.tracker} cannot be asked to move an issue, so {source.key} will not change state.
          The summary comment and the pull request links still go across.
        </p>
      ) : (
        <WorkflowStates forge={forge} />
      )}
      <WriteBacks forge={forge} />
    </>
  )
}

function WorkflowStates({ forge }: ForgeProp) {
  return (
    <section className="fdry-field">
      <h3 className="fdry-field-h">Workflow states</h3>
      <p className="fdry-note">
        Which of {forge.order.source.tracker}&rsquo;s own states each moment means. Left alone, the
        tracker resolves it.
      </p>
      {INTENTS.map((intent) => (
        <IntentMapping key={intent} forge={forge} intent={intent} />
      ))}
    </section>
  )
}

function IntentMapping({ forge, intent }: ForgeProp & { readonly intent: TransitionIntent }) {
  const { states } = forge
  return (
    <label className="fdry-map">
      <span>{INTENT_LABELS[intent]}</span>
      <select
        value={states?.mapping?.[intent] ?? ''}
        disabled={forge.locked}
        onChange={(event) =>
          void forge.mapIntent(intent, event.target.value === '' ? null : event.target.value)
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
  )
}

function WriteBacks({ forge }: ForgeProp) {
  const { writeBack } = forge.order
  return (
    <section className="fdry-field">
      <h3 className="fdry-field-h">What goes back to the issue</h3>
      <div className="fdry-writebacks">
        {WRITE_BACKS.map((kind) => (
          <label key={kind.id} className="fdry-writeback">
            <input
              type="checkbox"
              checked={writeBack.includes(kind.id)}
              disabled={forge.locked}
              onChange={(event) =>
                void forge.setWriteBack(
                  event.target.checked
                    ? [...writeBack, kind.id]
                    : writeBack.filter((w) => w !== kind.id)
                )
              }
            />
            {kind.label}
          </label>
        ))}
      </div>
    </section>
  )
}

function HandOffStep({ forge }: ForgeProp) {
  const { isDraft, view } = forge
  return (
    <>
      {isDraft ? (
        <p className="fdry-step-intro">
          {view.intake?.kind === 'refused'
            ? 'These rows describe the order as it stood before the refused turn.'
            : 'Hand-off agrees the order and starts the work. Every row must pass.'}
        </p>
      ) : null}
      {isDraft ? (
        <div className="fdry-checks">
          {forge.r.rows.map((row) => (
            <CheckRow key={row.id} forge={forge} row={row} />
          ))}
        </div>
      ) : (
        <AgreedRows forge={forge} />
      )}
      <Unmeasured unavailable={view.unavailableChecks} />
    </>
  )
}

function AgreedRows({ forge }: ForgeProp) {
  return (
    <>
      <p className="fdry-step-intro">
        All seven rows passed at agreement. The order is now read-only. Changes go through the run.
      </p>
      <div className="fdry-checks">
        <div className="fdry-chk">
          <span className="fdry-chk-icon" aria-hidden="true">
            <Check aria-hidden="true" />
          </span>
          <div>
            <b>Seven of seven rows passed</b>
            <small>
              Questions, proof, coverage, risk, red team, base branch, nobody changing the plan.
            </small>
          </div>
          <span className="fdry-pill fdry-pill--pass">Agreed</span>
        </div>
        <RunStartedRow forge={forge} />
      </div>
    </>
  )
}

function RunStartedRow({ forge }: ForgeProp) {
  const { shapeName } = forge
  return (
    <div className="fdry-chk">
      <span className="fdry-chk-icon" aria-hidden="true">
        <Play aria-hidden="true" />
      </span>
      <div>
        <b>Run started with {capitalise(shapeName ?? 'the proposed')}</b>
        <small>
          {forge.recipes?.recipes?.find((r2) => r2.name === shapeName)?.description ?? ''}
        </small>
      </div>
      <span className="fdry-pill fdry-pill--work">{forge.r.runState}</span>
    </div>
  )
}

function Unmeasured({ unavailable }: { readonly unavailable: string[] | undefined }) {
  if (unavailable === undefined || unavailable.length === 0) return null
  return (
    <section className="fdry-field">
      <h3 className="fdry-field-h">Not measurable here</h3>
      <p className="fdry-note">
        This repository has no command for {unavailable.join(', ')}. Those checks will report
        &ldquo;not measured&rdquo; rather than passing.
      </p>
    </section>
  )
}

function MessageForm({ forge }: ForgeProp) {
  const { draft, setDraft } = forge
  return (
    <form
      className="fdry-input"
      onSubmit={(event) => {
        event.preventDefault()
        if (draft.trim() === '') return
        void forge.converge(draft)
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
        variant="primary"
        reason={forge.r.locks.message ?? (draft.trim() === '' ? LOCAL_REASONS.emptyMessage : null)}
      >
        Send
      </ReasonButton>
    </form>
  )
}

function ForgeFooter({ forge }: ForgeProp) {
  const { isDraft, problem, view, previous, stepView } = forge
  if (!isDraft && problem === null && view.advisory == null) return null
  return (
    <footer className="fdry-foot">
      {problem !== null ? <p className="fdry-problem">{problem}</p> : null}
      {previous !== undefined ? (
        <Button onClick={() => openStep(forge, previous.id)}>Back</Button>
      ) : null}
      <FooterWhy forge={forge} />
      <FooterMove forge={forge} />
      {stepView.id === 'handOff' && view.advisory != null ? (
        <p className="fdry-note fdry-advisory">{view.advisory}</p>
      ) : null}
    </footer>
  )
}

function FooterWhy({ forge }: ForgeProp) {
  const { r, stepView, stepNeedsYou } = forge
  if (r.handOffWhy !== null && stepView.id === 'handOff') {
    return (
      <span className="fdry-why">
        <Info aria-hidden="true" />
        {r.handOffWhy}
      </span>
    )
  }
  if (stepNeedsYou.decided === 0 || stepNeedsYou.total === stepNeedsYou.decided) {
    return <span className="fdry-why" />
  }
  return (
    <span className="fdry-why">
      <Info aria-hidden="true" />
      Send now or decide the {stepNeedsYou.total === 2 ? 'second' : 'next'} finding first. Undecided
      findings stay open.
    </span>
  )
}

function FooterMove({ forge }: ForgeProp) {
  const { stepView, stepNeedsYou, next } = forge
  if (stepView.id === 'handOff') {
    return forge.view.agreed !== undefined && !forge.isDraft ? null : (
      <HandOffButton forge={forge} />
    )
  }
  if (stepNeedsYou.total > 0) {
    return (
      <ReasonButton
        variant="primary"
        reason={sendReasonOf(forge)}
        onClick={() => sendDecisionsOnThisStep(forge)}
      >
        {stepNeedsYou.decided === 0
          ? 'Send decisions'
          : `Send ${stepNeedsYou.decided} decision${stepNeedsYou.decided === 1 ? '' : 's'}`}
      </ReasonButton>
    )
  }
  if (next === undefined) return null
  return (
    <Button variant="primary" onClick={() => openStep(forge, next.id)}>
      Next: {STEP_LABELS[next.id]}
    </Button>
  )
}

function HandOffButton({ forge }: ForgeProp) {
  const { r, shapeName } = forge
  return (
    <ReasonButton
      variant="primary"
      icon={r.canHandOff ? Play : Lock}
      reason={r.locks.handOff}
      onClick={() => void forge.handOff()}
    >
      {r.canHandOff ? `Hand off with ${capitalise(shapeName ?? 'the proposed')}` : 'Hand off'}
    </ReasonButton>
  )
}
