import { isBlocking } from '../order/schema.js'
import type { AcceptanceCriterion, WorkOrder } from '../order/schema.js'
import { statusInWords } from '../order/render.js'
import { gradeInWords } from '../runtime/review/risk-grader.js'
import type { CheckId, CompileResult } from '../order/compile.js'
import type { IntakeOutcome } from './intake-outcome.js'
import type { StepId } from './steps.js'

// Who holds a draft order, what stops it being handed off, and what happens
// next — the one answer every Forge surface reads (ADR 074).
//
// The Forge used to work this out in four places from partial inputs: the
// header from the intake, the step marks from the compile, the band from the
// open findings, the button from both. On WO-0928-9c6 they disagreed — five
// green checks over a disabled button, while the red team reviewed a plan the
// header said the architect was writing. Pure and ignorant of React: it
// returns words and states, and the Forge draws them.

/** Red-team rounds and the operator's hold, read out of the ledger. */
export interface LoopFacts {
  /** Every red-team round on this order, oldest first. */
  readonly rounds: readonly {
    readonly round: number
    readonly startedAt: string
    /** Null while the round is running. */
    readonly finishedAt: string | null
  }[]
  /** When the operator pressed "Hold for me"; null when not held. */
  readonly heldAt: string | null
  /** The loop gave up after its last round and handed the findings to a person. */
  readonly exhausted: boolean
  /** Why the red team was not needed, when it was skipped for a small order (ADR 084). */
  readonly skipped?: string
}

/** How the order was agreed, once it has been. */
export interface AgreedFacts {
  readonly at: string
  readonly by: 'you' | 'automatic'
}

export interface ReadinessInput {
  readonly order: WorkOrder
  readonly compile: CompileResult
  readonly intake: IntakeOutcome
  readonly loop: LoopFacts
  readonly agreed: AgreedFacts | null
  /** When the last intake line was written, for "The last turn ended at …". */
  readonly turnEndedAt: string | null
  /** The shape hand-off will run, and whether it is the operator's pick. */
  readonly shape: { readonly name: string | null; readonly yours: boolean }
  /** Which optional steps the Forge offers on this order. */
  readonly offers: { readonly shape: boolean; readonly tracker: boolean }
  /** Formats an ISO time for display. Injected so specs do not depend on the time zone. */
  readonly clock: (iso: string) => string
}

export type RunState = 'Running' | 'Shipped' | 'Cancelled'

function runStateOf(status: WorkOrder['status']): RunState {
  return status === 'shipped' ? 'Shipped' : status === 'cancelled' ? 'Cancelled' : 'Running'
}

export type Holder = 'you' | 'architect' | 'red team' | 'scout' | 'nobody'

/** The status strip's colour: accent while the machine works, then by whose move it is. */
export type Tone = 'working' | 'you' | 'ready' | 'bad' | 'neutral'

export type StripIcon = 'load' | 'user' | 'check' | 'play' | 'alert' | 'pause'

export type StripAction =
  | 'hold'
  | 'release'
  | 'watch'
  | 'tell-architect'
  | 'start-over'
  | 'open-run'
  | 'draft'

export interface Strip {
  readonly tone: Tone
  readonly icon: StripIcon
  readonly headline: string
  readonly detail: string
  readonly actions: readonly StripAction[]
}

export type RowState = 'passed' | 'in-progress' | 'needs-you' | 'failing'

/** One row of "Ready to hand off?": the five checks and whether anyone is changing the plan. */
export interface Row {
  readonly id: CheckId | 'turn'
  readonly label: string
  readonly state: RowState
  readonly detail: string
}

export type StepState = 'done' | 'work' | 'you' | 'bad' | 'not-yet'

export type StepMark = 'number' | 'check' | 'spin' | 'alert' | 'x'

export interface StepView {
  readonly id: StepId
  readonly state: StepState
  readonly mark: StepMark
  /** The state word under the step's name. */
  readonly word: string
}

export type FindingGroup = 'fixing' | 'needs-you' | 'notes' | 'resolved'

export interface FindingView {
  readonly id: string
  readonly text: string
  readonly group: FindingGroup
  /** "Would make the change wrong · Raised 13:05:49", "Process", or a resolution. */
  readonly meta: string
}

export interface Readiness {
  readonly holder: Holder
  readonly strip: Strip
  /** "Low risk · 1 unit · Shape: Direct (proposed) · Draft" */
  readonly summary: string
  readonly rows: readonly Row[]
  readonly steps: readonly StepView[]
  readonly findings: readonly FindingView[]
  readonly canHandOff: boolean
  /** What the run is doing once the order is off the draft: the hand-off pill's word. */
  readonly runState: RunState
  /**
   * Why each control that the order's state can lock is locked, or null.
   * The text is shown verbatim as the tooltip and inline reason.
   */
  readonly locks: {
    readonly handOff: string | null
    readonly redraft: string | null
    readonly message: string | null
  }
  /** The bottom bar's line on the Hand off step; null when ready or handed off. */
  readonly handOffWhy: string | null
}

/** Reasons that depend on what the operator is doing, not on the order. */
export const LOCAL_REASONS = {
  emptyMessage: "Type what's wrong or what you want instead, then send it to the architect.",
  nothingDecided: 'Choose an answer or a decision above first.',
  acceptEmpty: 'Say why it stands. The reason travels with the order.',
  saving: 'Saving your change…',
  queued: 'Your decisions are queued and go to the architect when the current turn ends.',
} as const

/** Why a shape cannot be offered here, from its unmet requirements. */
export function shapeUnavailable(shape: string, unmet: readonly string[]): string {
  return `${capitalise(shape)} cannot run here: ${unmet.join('; ')}.`
}

export function capitalise(word: string): string {
  return word === '' ? word : word[0].toUpperCase() + word.slice(1)
}

const ROW_LABELS: Record<CheckId | 'turn', string> = {
  questions: 'No open questions',
  verifiable: 'Every criterion can be proven',
  coverage: 'Plan and criteria cover each other',
  risk: 'Risk graded against this plan',
  redTeam: 'No blocking red-team findings',
  turn: 'Nobody is changing the plan',
}

/** The words used for a failing check in a running sentence, e.g. "closing: coverage, red team." */
const CHECK_LABEL: Record<CheckId, string> = {
  questions: 'questions',
  verifiable: 'verifiable',
  coverage: 'coverage',
  risk: 'risk',
  redTeam: 'red team',
}

const SEQUENCE: readonly StepId[] = ['intent', 'plan', 'redTeam', 'shape', 'tracker', 'handOff']

const PATH_RE = /\S+\.(spec|test)\.[cm]?[jt]sx?/

function pluralS(n: number): string {
  return n === 1 ? '' : 's'
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds} seconds`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes} min ${seconds} s`
}

function msBetween(from: string, to: string): number {
  return Date.parse(to) - Date.parse(from)
}

function failingChecksList(compile: CompileResult): string {
  return compile.failures.map((f) => CHECK_LABEL[f.check]).join(', ')
}

function openBlockingFindings(order: WorkOrder): WorkOrder['redTeam'] {
  return order.redTeam.filter((f) => f.status === 'open' && isBlocking(f))
}

function lastFinishedRound(loop: LoopFacts): LoopFacts['rounds'][number] | null {
  const finished = loop.rounds.filter((r) => r.finishedAt !== null)
  return finished.length === 0 ? null : finished[finished.length - 1]
}

// ── Holder / strip ──────────────────────────────────────────────────────────

interface HolderStrip {
  readonly holder: Holder
  readonly strip: Strip
}

function deriveHolderAndStrip(input: ReadinessInput): HolderStrip {
  const { order, compile, intake, loop, agreed, shape, clock } = input
  const Shape = capitalise(shape.name ?? 'the proposed')
  const openBlocking = openBlockingFindings(order)
  const machineActing = intake.kind === 'running' && loop.heldAt === null
  const rule5Applies = openBlocking.length > 0 && (loop.exhausted || !machineActing)
  const openQuestions = order.openQuestions.filter((q) => q.answer === null)

  // 1. Not draft.
  if (order.status !== 'draft') {
    const n = order.plan.units.length
    // Only an order an earlier build handed off on its own reads this way;
    // nothing hands off automatically any more.
    if (agreed?.by === 'automatic') {
      return {
        holder: 'nobody',
        strip: {
          tone: 'ready',
          icon: 'play',
          headline: `Handed off automatically at ${clock(agreed.at)}`,
          detail: `${runStateOf(order.status)} with the ${Shape} shape, ${n} unit${pluralS(n)}.`,
          actions: ['open-run'],
        },
      }
    }
    const t = clock(agreed?.at ?? order.agreedAt ?? '')
    return {
      holder: 'nobody',
      strip: {
        tone: 'ready',
        icon: 'play',
        headline: `Handed off at ${t}`,
        detail: `${runStateOf(order.status)} with the ${Shape} shape, ${n} unit${pluralS(n)}.`,
        actions: ['open-run'],
      },
    }
  }

  // 2. Intake refused.
  if (intake.kind === 'refused') {
    return {
      holder: 'you',
      strip: {
        tone: 'bad',
        icon: 'alert',
        headline: `The architect's plan was refused. Nothing on this order changed.`,
        detail: `Why: ${intake.reason}`,
        actions: ['tell-architect', 'start-over'],
      },
    }
  }

  // 3. Intake running.
  if (intake.kind === 'running') {
    const t = clock(intake.at)
    if (intake.actor === 'scout') {
      return {
        holder: 'scout',
        strip: {
          tone: 'working',
          icon: 'load',
          headline: 'The scout is reading the repository',
          detail: `Started ${t}. The architect drafts the plan next.`,
          actions: ['watch'],
        },
      }
    }
    if (intake.actor === 'red team') {
      const base = `Started ${t}. When it finishes clean, you can hand off.`
      const previous = lastFinishedRound(loop)
      const detail =
        previous === null
          ? base
          : `${base} The last round took ${formatDuration(msBetween(previous.startedAt, previous.finishedAt as string))}.`
      return {
        holder: 'red team',
        strip: {
          tone: 'working',
          icon: 'load',
          headline: `The red team is reviewing the plan · round ${intake.round} of 3`,
          detail,
          actions: [loop.heldAt !== null ? 'release' : 'hold'],
        },
      }
    }
    // actor === 'architect'
    if (intake.trigger === 'automatic' && intake.round !== null) {
      const n = openBlocking.length
      return {
        holder: 'architect',
        strip: {
          tone: 'working',
          icon: 'load',
          headline: `The architect is fixing ${n} red-team finding${pluralS(n)} · round ${intake.round} of 3`,
          detail: `Started ${t} on its own. The red team reviews the fix next. You don't need to do anything.`,
          actions: ['hold'],
        },
      }
    }
    if (intake.trigger === 'automatic' && intake.autoTurn !== null) {
      return {
        holder: 'architect',
        strip: {
          tone: 'working',
          icon: 'load',
          headline: `The architect is revising the plan on its own · turn ${intake.autoTurn} of 2`,
          detail: `Started ${t}. It is closing: ${failingChecksList(compile)}. You don't need to do anything.`,
          actions: ['hold'],
        },
      }
    }
    return {
      holder: 'architect',
      strip: {
        tone: 'working',
        icon: 'load',
        headline: 'The architect is working on your request',
        detail: `Started ${t}. Hand-off opens when it finishes.`,
        actions: ['watch'],
      },
    }
  }

  // 4. Held.
  if (loop.heldAt !== null) {
    return {
      holder: 'you',
      strip: {
        tone: 'you',
        icon: 'pause',
        headline: `Held by you since ${clock(loop.heldAt)}`,
        detail: 'Nothing moves on its own until you let it continue.',
        actions: ['release'],
      },
    }
  }

  // 5. Open blocking findings that are the operator's to decide.
  if (rule5Applies) {
    const n = openBlocking.length
    const phrase = n === 2 ? 'both are' : n === 1 ? 'it is' : 'all are'
    const tail = `Nothing moves until you decide. Hand-off opens when ${phrase} decided and the architect has applied them.`
    const detail = loop.exhausted
      ? `The red team and the architect did not agree after 3 rounds. ${tail}`
      : tail
    return {
      holder: 'you',
      strip: {
        tone: 'you',
        icon: 'user',
        headline: `${n} finding${pluralS(n)} need${n === 1 ? 's' : ''} your decision`,
        detail,
        actions: [],
      },
    }
  }

  // 6. Unanswered open questions.
  if (openQuestions.length > 0) {
    const n = openQuestions.length
    return {
      holder: 'you',
      strip: {
        tone: 'you',
        icon: 'user',
        headline: `${n} question${pluralS(n)} need${n === 1 ? 's' : ''} your answer`,
        detail: 'The architect was less than 90% sure. Nothing moves until you answer.',
        actions: [],
      },
    }
  }

  // 7. Nothing drafted yet. Criteria alone are not a plan: an order seeded
  // from a ticket arrives with them, and no unit to satisfy them.
  if (order.plan.units.length === 0) {
    return {
      holder: 'you',
      strip: {
        tone: 'neutral',
        icon: 'alert',
        headline: 'No plan yet',
        detail: 'Press Draft the plan and the architect writes it.',
        actions: ['draft'],
      },
    }
  }

  // 8. Other compile failures.
  if (!compile.ok) {
    const n = compile.failures.length
    return {
      holder: 'you',
      strip: {
        tone: 'bad',
        icon: 'alert',
        headline: `${n} check${pluralS(n)} need${n === 1 ? 's' : ''} a fix`,
        detail: 'The automatic turns could not close them. Each failing row says what to do.',
        actions: [],
      },
    }
  }

  // 9. Compile ok.
  return {
    holder: 'you',
    strip: {
      tone: 'ready',
      icon: 'check',
      headline: 'Ready to hand off',
      detail:
        'All six rows pass and nobody is changing the plan. Press Hand off to start the work.',
      actions: [],
    },
  }
}

// ── Rows ─────────────────────────────────────────────────────────────────

function questionsPassedDetail(order: WorkOrder): string {
  const total = order.openQuestions.length
  return total === 0 ? 'None were asked.' : `All ${total} answered.`
}

const VERIFY_KIND_PHRASE: Record<string, string> = {
  test: 'a named test',
  command: 'a command',
  judge: 'a rubric with evidence',
  artifact: 'an artifact',
  screenshot: 'a screenshot',
  unverifiable: 'a written reason',
}

function verifiableKindOf(c: AcceptanceCriterion): string {
  return c.unverifiable?.accepted === true ? 'unverifiable' : c.verify.kind
}

function pathSuffix(criteria: readonly AcceptanceCriterion[]): string {
  const commands = criteria.map((c) =>
    c.verify.kind === 'test' || c.verify.kind === 'command' ? c.verify.command : null
  )
  if (commands.some((c) => c === null)) return ''
  const paths = commands.map((c) => PATH_RE.exec(c as string)?.[0] ?? null)
  if (paths.some((p) => p === null)) return ''
  const first = paths[0]
  return paths.every((p) => p === first) ? ` in ${first}` : ''
}

function verifiablePassedDetail(order: WorkOrder): string {
  const criteria = order.acceptance
  const n = criteria.length
  const kinds = criteria.map(verifiableKindOf)

  if (n === 1) {
    const kind = kinds[0]
    return `The criterion is proven by ${VERIFY_KIND_PHRASE[kind]}${pathSuffix(criteria)}.`
  }

  const allSame = kinds.every((k) => k === kinds[0])
  if (allSame) {
    const countWord = n === 2 ? 'Both' : `All ${n}`
    return `${countWord} criteria are proven by ${VERIFY_KIND_PHRASE[kinds[0]]}${pathSuffix(criteria)}.`
  }

  return `${n} criteria, each with a way to prove it.`
}

function coveragePassedDetail(order: WorkOrder): string {
  const u = order.plan.units.length
  const n = order.acceptance.length
  const uPhrase = `${u} unit${pluralS(u)}`
  const verb = u === 1 ? 'builds' : 'build'
  const criteriaPhrase = n === 1 ? 'the criterion' : n === 2 ? 'both criteria' : `all ${n} criteria`
  return `${uPhrase} ${verb} ${criteriaPhrase}.`
}

function riskPassedDetail(order: WorkOrder): string {
  const touched = new Set(order.plan.units.flatMap((u) => u.touches))
  const k = touched.size
  const filePhrase = k === 1 ? '1 file' : `${k} files`
  return `${capitalise(gradeInWords(order.risk.grade))}, graded over the ${filePhrase} the plan touches.`
}

function redTeamPassedDetail(order: WorkOrder): string {
  if (order.redTeam.length === 0) return 'No findings.'
  const resolved = order.redTeam.filter((f) => f.status !== 'open').length
  const notes = order.redTeam.filter((f) => f.status === 'open' && !isBlocking(f)).length
  const parts: string[] = []
  if (resolved > 0) parts.push(`${resolved} resolved.`)
  if (notes > 0) parts.push(`${notes} note${pluralS(notes)} that don't block.`)
  return parts.join(' ')
}

const PASSED_DETAIL: Record<CheckId, (order: WorkOrder) => string> = {
  questions: questionsPassedDetail,
  verifiable: verifiablePassedDetail,
  coverage: coveragePassedDetail,
  risk: riskPassedDetail,
  redTeam: redTeamPassedDetail,
}

function checkRow(id: CheckId, input: ReadinessInput): Row {
  const { order, compile, intake, loop } = input
  const failure = compile.failures.find((f) => f.check === id)
  if (failure === undefined) {
    const detail =
      id === 'redTeam' && loop.skipped !== undefined
        ? `Skipped: ${loop.skipped}.`
        : PASSED_DETAIL[id](order)
    return { id, label: ROW_LABELS[id], state: 'passed', detail }
  }
  const inProgress = intake.kind === 'running' && loop.heldAt === null
  if (inProgress) return { id, label: ROW_LABELS[id], state: 'in-progress', detail: failure.detail }
  if (id === 'questions')
    return { id, label: ROW_LABELS[id], state: 'needs-you', detail: failure.detail }
  if (id === 'redTeam') {
    const openBlocking = openBlockingFindings(order)
    const machineActing = intake.kind === 'running' && loop.heldAt === null
    const rule5Applies = openBlocking.length > 0 && (loop.exhausted || !machineActing)
    if (rule5Applies)
      return { id, label: ROW_LABELS[id], state: 'needs-you', detail: failure.detail }
  }
  return { id, label: ROW_LABELS[id], state: 'failing', detail: failure.detail }
}

function turnRow(input: ReadinessInput): Row {
  const { intake, turnEndedAt, clock } = input
  const label = ROW_LABELS.turn
  if (intake.kind === 'running') {
    let detail: string
    if (intake.actor === 'red team') {
      detail = `The red team is reviewing round ${intake.round}. The checks above can change when it finishes.`
    } else if (intake.actor === 'architect') {
      detail = `The architect is changing the plan. The checks above can change when it finishes.`
    } else {
      detail = 'The scout is reading the repository.'
    }
    return { id: 'turn', label, state: 'in-progress', detail }
  }
  if (intake.kind === 'refused') {
    return {
      id: 'turn',
      label,
      state: 'failing',
      detail:
        'The last turn ended in a refusal, so the plan is not the one the architect meant to write.',
    }
  }
  const detail =
    turnEndedAt !== null ? `The last turn ended at ${clock(turnEndedAt)}.` : 'No turn has run yet.'
  return { id: 'turn', label, state: 'passed', detail }
}

function buildRows(input: ReadinessInput): readonly Row[] {
  return [
    checkRow('questions', input),
    checkRow('verifiable', input),
    checkRow('coverage', input),
    checkRow('risk', input),
    checkRow('redTeam', input),
    turnRow(input),
  ]
}

// ── Steps ────────────────────────────────────────────────────────────────

function orderedStepIds(offers: ReadinessInput['offers']): readonly StepId[] {
  return SEQUENCE.filter((id) =>
    id === 'shape' ? offers.shape : id === 'tracker' ? offers.tracker : true
  )
}

function trackerWord(order: WorkOrder): string {
  const parts: string[] = []
  if (order.writeBack.includes('summary_comment')) parts.push('comment')
  if (order.writeBack.includes('status')) parts.push('state')
  if (order.writeBack.includes('pr_link')) parts.push('links')
  return parts.length === 0 ? 'Nothing goes back' : capitalise(parts.join(', '))
}

interface BaseStep {
  readonly state: StepState
  readonly mark: StepMark
  readonly word: string
}

function nonDraftWord(id: StepId, input: ReadinessInput, Shape: string): string {
  const { order, loop, agreed, shape, clock } = input
  switch (id) {
    case 'intent':
    case 'plan':
      return 'Agreed'
    case 'redTeam': {
      const last = loop.rounds.length > 0 ? loop.rounds[loop.rounds.length - 1].round : null
      if (last === null && loop.skipped !== undefined) return `Skipped: ${loop.skipped}`
      return last !== null ? `Clean after round ${last}` : 'Not reviewed'
    }
    case 'shape':
      return `${Shape}, ${shape.yours ? 'your choice' : 'proposed'}`
    case 'tracker':
      return trackerWord(order)
    case 'handOff':
      return `Handed off ${clock(agreed?.at ?? order.agreedAt ?? '')}`
  }
}

function computeBaseStep(
  id: StepId,
  input: ReadinessInput,
  canHandOff: boolean,
  holder: Holder,
  Shape: string
): BaseStep {
  const { order, compile, intake, loop } = input
  const openBlocking = openBlockingFindings(order)
  const machineActing = intake.kind === 'running' && loop.heldAt === null
  const rule5Applies = openBlocking.length > 0 && (loop.exhausted || !machineActing)

  if (id === 'intent') {
    const stated = order.intent.problem.trim() !== '' && order.intent.outcome.trim() !== ''
    return stated
      ? { state: 'done', mark: 'check', word: 'Done' }
      : { state: 'you', mark: 'number', word: 'Not stated yet' }
  }

  if (id === 'plan') {
    if (intake.kind === 'refused') {
      return { state: 'bad', mark: 'x', word: 'Last redraft refused' }
    }
    if (
      intake.kind === 'running' &&
      intake.actor === 'architect' &&
      intake.trigger === 'automatic' &&
      intake.autoTurn !== null &&
      intake.round === null
    ) {
      return { state: 'work', mark: 'spin', word: `Revising ${intake.autoTurn} of 2` }
    }
    // An empty plan fails coverage by construction, so it is named before the
    // failing checks or it would read "Needs a fix" before anything was drafted.
    if (order.plan.units.length === 0) {
      return machineActing
        ? { state: 'work', mark: 'spin', word: 'Being drafted' }
        : { state: 'you', mark: 'number', word: 'Not drafted yet' }
    }
    const failingPlanCheck = compile.failures.find(
      (f) => f.check === 'verifiable' || f.check === 'coverage' || f.check === 'risk'
    )
    if (failingPlanCheck !== undefined) {
      return machineActing
        ? { state: 'work', mark: 'spin', word: 'Being revised' }
        : { state: 'bad', mark: 'x', word: 'Needs a fix' }
    }
    if (compile.failures.some((f) => f.check === 'questions')) {
      return { state: 'you', mark: 'alert', word: 'Needs your answer' }
    }
    const c = order.acceptance.length
    const u = order.plan.units.length
    return {
      state: 'done',
      mark: 'check',
      word: `${c} criteri${c === 1 ? 'on' : 'a'}, ${u} unit${pluralS(u)}`,
    }
  }

  if (id === 'redTeam') {
    if (intake.kind === 'running' && intake.actor === 'red team') {
      return { state: 'work', mark: 'spin', word: `Reviewing, round ${intake.round} of 3` }
    }
    if (
      intake.kind === 'running' &&
      intake.actor === 'architect' &&
      intake.trigger === 'automatic' &&
      intake.round !== null
    ) {
      return { state: 'work', mark: 'spin', word: `Architect fixing ${openBlocking.length}` }
    }
    if (rule5Applies) {
      const n = openBlocking.length
      return { state: 'you', mark: 'alert', word: `Needs you: ${n} decision${pluralS(n)}` }
    }
    const last = lastFinishedRound(loop)
    if (last !== null && openBlocking.length === 0) {
      return { state: 'done', mark: 'check', word: `Clean after round ${last.round}` }
    }
    if (loop.skipped !== undefined && openBlocking.length === 0) {
      return { state: 'done', mark: 'check', word: `Skipped: ${loop.skipped}` }
    }
    return { state: 'not-yet', mark: 'number', word: 'Not reviewed yet' }
  }

  if (id === 'shape') {
    return {
      state: 'done',
      mark: 'check',
      word: `${Shape}, ${input.shape.yours ? 'your choice' : 'proposed'}`,
    }
  }

  if (id === 'tracker') {
    return { state: 'done', mark: 'check', word: trackerWord(order) }
  }

  // handOff
  if (canHandOff) return { state: 'done', mark: 'number', word: 'Ready' }
  if (intake.kind === 'running') {
    return { state: 'work', mark: 'number', word: `Waiting on the ${intake.actor}` }
  }
  if (intake.kind === 'refused') {
    return { state: 'bad', mark: 'number', word: 'Blocked by the refusal' }
  }
  if (holder === 'you') return { state: 'you', mark: 'number', word: 'Waiting on you' }
  return { state: 'not-yet', mark: 'number', word: 'Waiting' }
}

function buildSteps(
  input: ReadinessInput,
  canHandOff: boolean,
  holder: Holder
): readonly StepView[] {
  const ids = orderedStepIds(input.offers)
  const Shape = capitalise(input.shape.name ?? 'the proposed')

  if (input.order.status !== 'draft') {
    return ids.map((id) => ({
      id,
      state: 'done',
      mark: 'check',
      word: nonDraftWord(id, input, Shape),
    }))
  }

  const openBlocking = openBlockingFindings(input.order)
  const views: StepView[] = []
  let triggered = false
  let triggerId: StepId | null = null
  let triggerState: StepState | null = null

  for (const id of ids) {
    const base = computeBaseStep(id, input, canHandOff, holder, Shape)
    if (id === 'handOff') {
      views.push({ id, ...base })
      continue
    }
    if (triggered) {
      const word =
        id === 'redTeam' && triggerId === 'plan' && triggerState === 'bad'
          ? 'Waits for a plan'
          : base.word
      views.push({ id, state: 'not-yet', mark: 'number', word })
      continue
    }
    views.push({ id, ...base })
    if (
      base.state === 'bad' ||
      base.state === 'you' ||
      (base.state === 'work' && openBlocking.length > 0)
    ) {
      triggered = true
      triggerId = id
      triggerState = base.state
    }
  }

  return views
}

// ── Findings ─────────────────────────────────────────────────────────────

const NOTE_META: Record<string, string> = {
  scope: 'Scope',
  process: 'Process',
  'pre-existing': 'Already true before this change',
  infra: 'Setup',
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth']

/**
 * A finding's first paragraph, with criterion and unit ids named by what they are.
 *
 * An id that names nothing on the order is left alone rather than guessed at.
 */
function findingText(text: string, order: WorkOrder): string {
  const idx = text.search(/\n\s*\n/)
  const first = (idx === -1 ? text : text.slice(0, idx)).trim()
  const named = first.replace(/\b(AC|U)-\d+\b/g, (id, kind: string, offset: number) => {
    const list: readonly { readonly id: string }[] =
      kind === 'AC' ? order.acceptance : order.plan.units
    const at = list.findIndex((item) => item.id === id)
    if (at === -1 || at >= ORDINALS.length) return id
    const noun = kind === 'AC' ? 'criterion' : 'unit'
    const phrase = list.length === 1 ? `the ${noun}` : `the ${ORDINALS[at]} ${noun}`
    return offset === 0 ? capitalise(phrase) : phrase
  })
  return named
}

function buildFindings(input: ReadinessInput): readonly FindingView[] {
  const { order, intake, loop, clock } = input
  const fixing =
    intake.kind === 'running' &&
    ((intake.actor === 'architect' && intake.round !== null) || intake.actor === 'red team')

  return order.redTeam.map((finding) => {
    const text = findingText(finding.text, order)
    if (finding.status !== 'open') {
      return { id: finding.id, text, group: 'resolved', meta: finding.reason || 'Resolved' }
    }
    if (!isBlocking(finding)) {
      return {
        id: finding.id,
        text,
        group: 'notes',
        meta: NOTE_META[finding.category] ?? finding.category,
      }
    }
    const round = loop.rounds.find((r) => r.round === finding.round)
    const meta =
      round !== undefined && round.finishedAt !== null
        ? `Would make the change wrong · Raised ${clock(round.finishedAt)}`
        : 'Would make the change wrong'
    return { id: finding.id, text, group: fixing ? 'fixing' : 'needs-you', meta }
  })
}

// ── Locks ────────────────────────────────────────────────────────────────

function buildHandOffLock(input: ReadinessInput): string | null {
  const { order, compile, intake, loop, agreed, clock } = input
  const openBlocking = openBlockingFindings(order)
  const machineActing = intake.kind === 'running' && loop.heldAt === null
  const rule5Applies = openBlocking.length > 0 && (loop.exhausted || !machineActing)
  const openQuestions = order.openQuestions.filter((q) => q.answer === null)

  if (order.status !== 'draft') {
    const t = clock(agreed?.at ?? order.agreedAt ?? '')
    const by = agreed?.by === 'automatic' ? 'automatically' : 'by you'
    return `Handed off at ${t} ${by}. The order is read-only.`
  }

  if (intake.kind === 'running') {
    const t = clock(intake.at)
    if (intake.actor === 'red team') {
      return `The red team is reviewing the plan (round ${intake.round} of 3, started ${t}). Hand-off opens when it finishes.`
    }
    if (intake.actor === 'architect' && intake.trigger === 'automatic' && intake.round !== null) {
      return `The architect is fixing ${openBlocking.length} red-team findings (round ${intake.round} of 3, started ${t}). Hand-off opens when it finishes.`
    }
    if (
      intake.actor === 'architect' &&
      intake.trigger === 'automatic' &&
      intake.autoTurn !== null
    ) {
      return `The architect is closing ${failingChecksList(compile)} on its own, automatic turn ${intake.autoTurn} of 2. Hand-off opens when it finishes.`
    }
    if (intake.actor === 'architect') {
      return `The architect is working on your request (started ${t}). Hand-off opens when it finishes.`
    }
    return `The scout is reading the repository before the first draft (started ${t}). The architect drafts next.`
  }

  if (intake.kind === 'refused') {
    return `The architect's last plan was refused: ${intake.reason}. Nothing changed.`
  }

  if (loop.heldAt !== null) {
    if (compile.ok) return null
    return `Held by you since ${clock(loop.heldAt)}. Let it continue, or hand off yourself once nothing is running.`
  }

  if (rule5Applies) {
    return `${openBlocking.length} red-team findings need your decision.`
  }

  if (openQuestions.length > 0) {
    return `${openQuestions.length} questions need your answer. The architect was less than 90% sure.`
  }

  if (compile.failures.length > 0) {
    return compile.failures[0].detail
  }

  return null
}

function buildRedraftLock(input: ReadinessInput, handOffLockText: string | null): string | null {
  const { order, intake, clock } = input
  if (order.status !== 'draft') return handOffLockText
  if (intake.kind === 'running') {
    if (intake.actor === 'red team') {
      return 'The red team is reviewing the plan. A redraft now would be lost when its round finishes. Use "Hold for me" to stop the loop first.'
    }
    const t = clock(intake.at)
    const who = intake.actor === 'architect' ? 'architect' : 'scout'
    return `The ${who} is already working (started ${t}). Wait for it to finish, or watch it.`
  }
  return null
}

function buildHandOffWhy(
  input: ReadinessInput,
  canHandOff: boolean,
  handOffLockText: string | null
): string | null {
  const { order, intake } = input
  if (canHandOff || order.status !== 'draft') return null
  if (intake.kind === 'running') {
    if (intake.actor === 'red team')
      return `Hand-off opens when the red team finishes round ${intake.round}.`
    if (intake.actor === 'architect') return 'Hand-off opens when the architect finishes.'
    return 'Hand-off opens when the scout finishes.'
  }
  return handOffLockText
}

// ── Summary ──────────────────────────────────────────────────────────────

function buildSummary(order: WorkOrder, shape: ReadinessInput['shape']): string {
  const n = order.plan.units.length
  const shapePart =
    shape.name === null
      ? 'not chosen'
      : `${capitalise(shape.name)} (${shape.yours ? 'your choice' : 'proposed'})`
  return `${capitalise(gradeInWords(order.risk.grade))} · ${n} unit${pluralS(n)} · Shape: ${shapePart} · ${order.status === 'draft' ? 'Draft' : capitalise(statusInWords(order.status))}`
}

// ── Entry point ──────────────────────────────────────────────────────────

export function readiness(input: ReadinessInput): Readiness {
  const { order, compile, intake, loop } = input
  const { holder, strip } = deriveHolderAndStrip(input)

  const canHandOff =
    order.status === 'draft' &&
    compile.ok &&
    intake.kind !== 'running' &&
    intake.kind !== 'refused' &&
    loop.heldAt === null

  const rows = buildRows(input)
  const steps = buildSteps(input, canHandOff, holder)
  const findings = buildFindings(input)
  const handOff = buildHandOffLock(input)
  const redraft = buildRedraftLock(input, handOff)
  const handOffWhy = buildHandOffWhy(input, canHandOff, handOff)
  const summary = buildSummary(order, input.shape)

  return {
    holder,
    strip,
    summary,
    rows,
    steps,
    findings,
    canHandOff,
    runState: runStateOf(order.status),
    locks: { handOff, redraft, message: redraft },
    handOffWhy,
  }
}
