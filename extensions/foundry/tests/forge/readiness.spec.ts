import { describe, it, expect } from 'vitest'
import { PROVEN_ENVIRONMENT, baseStep, provenBaseline } from '../helpers/environment.js'
import { builderUnit, testCriterion } from '../helpers/order-parts.js'
import { REWRITING_UNREADABLE } from '../../src/forge/autonomy.js'
import { environmentPasses, readiness } from '../../src/forge/readiness.js'
import type { EnvironmentFacts, LoopFacts, ReadinessInput } from '../../src/forge/readiness.js'
import { draftOrder } from '../../src/order/draft.js'
import { compileOrder } from '../../src/order/compile.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { currentIntake } from '../../src/forge/intake-outcome.js'
import { intakeAt } from '../../src/forge/intake-state.js'
import type { IntakeOutcome } from '../../src/forge/intake-outcome.js'

type RedTeamFinding = WorkOrder['redTeam'][number]

// readiness() is the one answer every Forge surface reads (ADR 074). The
// fixture below mirrors WO-0928-9c6, the order whose screen disagreed with
// itself: a Linear ticket filter, two test-backed criteria, one unit, P3 risk.

const T0 = '2026-09-28T13:00:00.000Z'
const T1 = '2026-09-28T13:05:49.000Z'
const T2 = '2026-09-28T13:06:19.000Z'

const SPEC_PATH = 'tests/unit/integrations/providers/linear.provider.spec.ts'
const UNIT_PATH = 'src/main/integrations/providers/linear.provider.ts'

const clock = (iso: string): string => iso

/** WO-0928's two criteria: the spec as a whole, and the one case that names Done. */
const WO0928_ACCEPTANCE: WorkOrder['acceptance'] = [
  testCriterion('AC-1', {
    statement: 'Listing issues excludes those in the Done state',
    verify: { kind: 'test', command: `npx vitest run ${SPEC_PATH}`, assert: 'exit_code == 0' },
  }),
  testCriterion('AC-2', {
    statement: 'A ticket moved to Done drops out of the next list call',
    verify: {
      kind: 'test',
      command: `npx vitest run ${SPEC_PATH} -t "excludes done"`,
      assert: 'exit_code == 0',
    },
  }),
]

const WO0928_INTENT: WorkOrder['intent'] = {
  problem: 'The Forge lists DONE tickets.',
  outcome: 'DONE tickets are excluded.',
  nonGoals: [],
}

function wo0928Order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-0928-9c6',
    title: 'Foundry - Forge should only list tickets that are not marked DONE',
    source: { kind: 'tracker', tracker: 'linear', key: 'TAV-15', url: null },
    repoPaths: ['/repos/terminator'],
    now: T0,
  })
  return {
    ...base,
    intent: WO0928_INTENT,
    acceptance: WO0928_ACCEPTANCE,
    risk: { grade: 'P3', triggers: [], blastRadius: [UNIT_PATH, SPEC_PATH], criticalPaths: [] },
    plan: {
      ...base.plan,
      units: [
        builderUnit('U-1', {
          title: 'Filter DONE issues out of the Linear provider',
          satisfies: ['AC-1', 'AC-2'],
          touches: [UNIT_PATH, SPEC_PATH],
        }),
      ],
    },
    writeBack: ['summary_comment', 'status', 'pr_link'],
    ...over,
  }
}

function baseIntake(): IntakeOutcome {
  return { kind: 'none' }
}

function baseLoop(over: Partial<LoopFacts> = {}): LoopFacts {
  return { rounds: [], heldAt: null, exhausted: false, ...over }
}

type RunningIntake = Extract<IntakeOutcome, { kind: 'running' }>

/** An architect turn the Forge started at T0, with whatever `over` says differs. */
function runningTurn(over: Partial<Omit<RunningIntake, 'kind'>> = {}): RunningIntake {
  return {
    kind: 'running',
    at: T0,
    sessionId: 's',
    asked: 'x',
    actor: 'architect',
    trigger: 'automatic',
    round: null,
    autoTurn: null,
    ...over,
  }
}

function baseInput(
  over: Partial<ReadinessInput> = {},
  orderOver: Partial<WorkOrder> = {}
): ReadinessInput {
  const order = over.order ?? wo0928Order(orderOver)
  return {
    intake: baseIntake(),
    loop: baseLoop(),
    agreed: null,
    environment: PROVEN_ENVIRONMENT,
    turnEndedAt: null,
    shape: { name: 'Direct', yours: false },
    offers: { shape: true, tracker: true },
    ...over,
    order,
    compile: over.compile ?? compileOrder(order),
    clock,
  }
}

function blockingFinding(over: Partial<RedTeamFinding> = {}): RedTeamFinding {
  return {
    id: 'RT-1',
    severity: 'high',
    text: 'Wrong outcome.\n\nEvidence: ...',
    status: 'open',
    reason: '',
    category: 'wrong-outcome',
    round: 1,
    ...over,
  }
}

describe('readiness — holder and strip', () => {
  describe('an earlier hand-off', anEarlierHandOffTests)
  describe('shipped and cancelled', shippedAndCancelledTests)
  describe('handed off by you', handedOffByYouTests)
  describe('intake refused', intakeRefusedTests)
  describe('a malformed plan', aMalformedPlanTests)
  describe('an unreadable plan', anUnreadablePlanTests)
  describe('the scout', theScoutTests)
  describe('red team with a previous round', redTeamWithAPreviousRoundTests)
  describe('red team held', redTeamHeldTests)
  describe('fixing findings', fixingFindingsTests)
  describe('fixing one finding', fixingOneFindingTests)
  describe('revising', revisingTests)
  describe('your request', yourRequestTests)
  describe('held and exhausted', heldAndExhaustedTests)
  describe('one blocking finding', oneBlockingFindingTests)
  describe('three blocking findings', threeBlockingFindingsTests)
  describe('open questions', readinessOpenQuestionsTests)
  describe('no criteria', noCriteriaTests)
  describe('compile failures and ok', compileFailuresAndOkTests)
})

function anEarlierHandOffTests() {
  it('1. an order an earlier build handed off on its own still says so, with nothing to turn off', () => {
    const order = wo0928Order({ status: 'agreed', agreedAt: T1 })
    const result = readiness(
      baseInput({
        order,
        agreed: { at: T1, by: 'automatic' },
        loop: baseLoop({ rounds: [{ round: 1, startedAt: T0, finishedAt: T1 }] }),
        shape: { name: 'direct', yours: false },
      })
    )
    expect(result.holder).toBe('nobody')
    expect(result.strip.tone).toBe('ready')
    expect(result.strip.icon).toBe('play')
    expect(result.strip.headline).toBe(`Handed off automatically at ${T1}`)
    expect(result.strip.detail).toBe('Running with the Direct shape, 1 unit.')
    expect(result.strip.actions).toEqual(['open-run'])
  })
}

function shippedAndCancelledTests() {
  it('1. a shipped order is not described as running', () => {
    const order = wo0928Order({ status: 'shipped', agreedAt: T1 })
    const result = readiness(baseInput({ order, agreed: { at: T1, by: 'you' } }))
    expect(result.strip.detail).toBe('Shipped with the Direct shape, 1 unit.')
    expect(result.strip.detail).not.toContain('Running')
    expect(result.runState).toBe('Shipped')
  })

  it('1. a cancelled order says cancelled, a running one says running', () => {
    const cancelled = readiness(baseInput({ order: wo0928Order({ status: 'cancelled' }) }))
    expect(cancelled.strip.detail).toBe('Cancelled with the Direct shape, 1 unit.')
    expect(cancelled.runState).toBe('Cancelled')
    const running = readiness(baseInput({ order: wo0928Order({ status: 'running' }) }))
    expect(running.strip.detail).toBe('Running with the Direct shape, 1 unit.')
    expect(running.runState).toBe('Running')
  })

  it('1. a shipped order that is waiting on you says so in the pill', () => {
    const order = wo0928Order({ status: 'shipped', agreedAt: T1 })
    const waiting = readiness(baseInput({ order, agreed: { at: T1, by: 'you' }, turn: 'you' }))
    expect(waiting.runState).toBe('Shipped · waiting on you')
    // The strip's sentence reads "Shipped with the ... shape" and keeps doing so.
    expect(waiting.strip.detail).toBe('Shipped with the Direct shape, 1 unit.')
    const foundry = readiness(baseInput({ order, agreed: { at: T1, by: 'you' }, turn: 'foundry' }))
    expect(foundry.runState).toBe('Shipped')
  })

  it('1. a cancelled order is never described as waiting on you', () => {
    const order = wo0928Order({ status: 'cancelled' })
    expect(readiness(baseInput({ order, turn: 'you' })).runState).toBe('Cancelled')
  })
}

function handedOffByYouTests() {
  it('1. handed off by you, uses agreed.at', () => {
    const order = wo0928Order({ status: 'agreed', agreedAt: T1 })
    const result = readiness(baseInput({ order, agreed: { at: T2, by: 'you' } }))
    expect(result.holder).toBe('nobody')
    expect(result.strip.headline).toBe(`Handed off at ${T2}`)
    expect(result.strip.detail).toBe('Running with the Direct shape, 1 unit.')
    expect(result.strip.actions).toEqual(['open-run'])
  })

  it('1. handed off, agreed null falls back to order.agreedAt', () => {
    const order = wo0928Order({ status: 'agreed', agreedAt: T1 })
    const result = readiness(baseInput({ order, agreed: null }))
    expect(result.strip.headline).toBe(`Handed off at ${T1}`)
  })
}

function intakeRefusedTests() {
  it('2. intake refused', () => {
    const result = readiness(
      baseInput({ intake: { kind: 'refused', at: T1, reason: 'Invalid enum value.' } })
    )
    expect(result.holder).toBe('you')
    expect(result.strip.tone).toBe('bad')
    expect(result.strip.icon).toBe('alert')
    expect(result.strip.headline).toBe(
      "The architect's plan was refused. Nothing on this order changed."
    )
    expect(result.strip.detail).toBe('Why: Invalid enum value.')
    expect(result.strip.actions).toEqual(['tell-architect', 'start-over'])
  })
}

function aMalformedPlanTests() {
  it('2b. intake refused for a malformed plan says where and what to do, not the schema error', () => {
    const result = readiness(
      baseInput({
        intake: {
          kind: 'refused',
          at: T1,
          reason:
            'The proposal was refused: plan.units.0.verify.0: Expected object, received string; plan.units.0.verify.1: Expected object, received string',
        },
      })
    )
    expect(result.strip.headline).toBe(
      "The architect's plan couldn't be read. Nothing on this order changed."
    )
    expect(result.strip.detail).toBe(
      'It wrote unit 1, check 1 and unit 1, check 2 in the wrong format, and retrying on its own did not fix it. ' +
        'Start the turn over to have it write the plan again, or tell it what to change.'
    )
    expect(result.strip.detail).not.toContain('Expected object')
  })
}

function anUnreadablePlanTests() {
  it('3b. running: rewriting a plan it could not read says so, not which checks it closes', () => {
    const result = readiness(
      baseInput({
        intake: runningTurn({ sessionId: 's1', asked: REWRITING_UNREADABLE, autoTurn: 1 }),
      })
    )
    expect(result.strip.detail).toBe(
      `Started ${T0}. Its last plan was in the wrong format, so it is writing it again. You don't need to do anything.`
    )
  })
}

function theScoutTests() {
  it('3. running: scout', () => {
    const result = readiness(
      baseInput({
        intake: runningTurn({ sessionId: 's1', asked: 'scout', actor: 'scout' }),
      })
    )
    expect(result.holder).toBe('scout')
    expect(result.strip.tone).toBe('working')
    expect(result.strip.icon).toBe('load')
    expect(result.strip.headline).toBe('The scout is reading the repository')
    expect(result.strip.detail).toBe(`Started ${T0}. The architect drafts the plan next.`)
    expect(result.strip.actions).toEqual(['watch'])
  })
}

function redTeamWithAPreviousRoundTests() {
  it('3. running: red team, with a previous finished round, says the hand-off is yours', () => {
    const result = readiness(
      baseInput({
        intake: runningTurn({
          at: T2,
          sessionId: 's2',
          asked: 'red team, round 2',
          actor: 'red team',
          round: 2,
        }),
        loop: baseLoop({
          rounds: [
            { round: 1, startedAt: T0, finishedAt: T1 },
            { round: 2, startedAt: T2, finishedAt: null },
          ],
        }),
        shape: { name: 'direct', yours: true },
      })
    )
    expect(result.holder).toBe('red team')
    expect(result.strip.headline).toBe('The red team is reviewing the plan · round 2 of 3')
    expect(result.strip.detail).toBe(
      `Started ${T2}. When it finishes clean, you can hand off. The last round took 5 min 49 s.`
    )
    expect(result.strip.actions).toEqual(['hold'])
  })
}

function redTeamHeldTests() {
  it('3. running: red team, no previous round, held shows release', () => {
    const result = readiness(
      baseInput({
        intake: runningTurn({
          sessionId: 's2',
          asked: 'red team, round 1',
          actor: 'red team',
          round: 1,
        }),
        loop: baseLoop({ rounds: [{ round: 1, startedAt: T0, finishedAt: null }], heldAt: T1 }),
      })
    )
    expect(result.strip.detail).toBe(`Started ${T0}. When it finishes clean, you can hand off.`)
    expect(result.strip.actions).toEqual(['release'])
  })
}

function fixingFindingsTests() {
  it('3. running: architect fixing findings automatically', () => {
    const findings = [blockingFinding({ id: 'RT-1' }), blockingFinding({ id: 'RT-2' })]
    const result = readiness(
      baseInput({
        order: wo0928Order({ redTeam: findings }),
        intake: runningTurn({ at: T2, sessionId: 's3', asked: 'red team round 2 fix', round: 2 }),
      })
    )
    expect(result.holder).toBe('architect')
    expect(result.strip.headline).toBe('The architect is fixing 2 red-team findings · round 2 of 3')
    expect(result.strip.detail).toBe(
      `Started ${T2} on its own. The red team reviews the fix next. You don't need to do anything.`
    )
    expect(result.strip.actions).toEqual(['hold'])
  })
}

function fixingOneFindingTests() {
  it('3. running: architect fixing a single finding, singular wording', () => {
    const result = readiness(
      baseInput({
        order: wo0928Order({ redTeam: [blockingFinding()] }),
        intake: runningTurn({ at: T2, sessionId: 's3', asked: 'red team round 1 fix', round: 1 }),
      })
    )
    expect(result.strip.headline).toBe('The architect is fixing 1 red-team finding · round 1 of 3')
  })
}

function revisingTests() {
  it('3. running: architect revising automatically (autoTurn)', () => {
    const order = wo0928Order({ acceptance: [] })
    const compile = compileOrder(order)
    const result = readiness(
      baseInput({
        order,
        compile,
        intake: runningTurn({ sessionId: 's4', asked: 'follow-up', autoTurn: 1 }),
      })
    )
    expect(result.strip.headline).toBe(
      'The architect is revising the plan on its own · turn 1 of 2'
    )
    expect(result.strip.detail).toBe(
      `Started ${T0}. It is closing: coverage. You don't need to do anything.`
    )
    expect(result.strip.actions).toEqual(['hold'])
  })
}

function yourRequestTests() {
  it('3. running: architect working on your request', () => {
    const result = readiness(
      baseInput({
        intake: runningTurn({ sessionId: 's5', asked: 'make it faster', trigger: 'you' }),
      })
    )
    expect(result.holder).toBe('architect')
    expect(result.strip.headline).toBe('The architect is working on your request')
    expect(result.strip.detail).toBe(`Started ${T0}. Hand-off opens when it finishes.`)
    expect(result.strip.actions).toEqual(['watch'])
  })
}

function heldAndExhaustedTests() {
  it('4. held (nothing running)', () => {
    const result = readiness(baseInput({ loop: baseLoop({ heldAt: T1 }) }))
    expect(result.holder).toBe('you')
    expect(result.strip.tone).toBe('you')
    expect(result.strip.icon).toBe('pause')
    expect(result.strip.headline).toBe(`Held by you since ${T1}`)
    expect(result.strip.detail).toBe('Nothing moves on its own until you let it continue.')
    expect(result.strip.actions).toEqual(['release'])
  })

  it('5. blocking findings need your decision, loop exhausted', () => {
    const order = wo0928Order({
      redTeam: [blockingFinding({ id: 'RT-1' }), blockingFinding({ id: 'RT-2' })],
    })
    const result = readiness(
      baseInput({
        order,
        loop: baseLoop({ exhausted: true, rounds: [{ round: 3, startedAt: T0, finishedAt: T1 }] }),
      })
    )
    expect(result.holder).toBe('you')
    expect(result.strip.tone).toBe('you')
    expect(result.strip.icon).toBe('user')
    expect(result.strip.headline).toBe('2 findings need your decision')
    expect(result.strip.detail).toBe(
      'The red team and the architect did not agree after 3 rounds. Nothing moves until you decide. Hand-off opens when both are decided and the architect has applied them.'
    )
  })
}

function oneBlockingFindingTests() {
  it('5. one blocking finding, singular wording, not exhausted', () => {
    const order = wo0928Order({ redTeam: [blockingFinding({ id: 'RT-1' })] })
    const result = readiness(baseInput({ order }))
    expect(result.strip.headline).toBe('1 finding needs your decision')
    expect(result.strip.detail).toBe(
      'Nothing moves until you decide. Hand-off opens when it is decided and the architect has applied them.'
    )
  })
}

function threeBlockingFindingsTests() {
  it('5. three blocking findings, plural wording', () => {
    const order = wo0928Order({
      redTeam: ['RT-1', 'RT-2', 'RT-3'].map((id) => blockingFinding({ id, text: `Wrong ${id}.` })),
    })
    const result = readiness(baseInput({ order }))
    expect(result.strip.headline).toBe('3 findings need your decision')
    expect(result.strip.detail).toBe(
      'Nothing moves until you decide. Hand-off opens when all are decided and the architect has applied them.'
    )
  })
}

function readinessOpenQuestionsTests() {
  it('6. unanswered open questions', () => {
    const order = wo0928Order({
      openQuestions: [
        {
          id: 'Q-1',
          text: 'Which flag?',
          why: '',
          options: [],
          recommended: null,
          answer: null,
          rank: 0,
          confidence: null,
          multiple: false,
          chosen: [],
        },
      ],
    })
    const result = readiness(baseInput({ order }))
    expect(result.holder).toBe('you')
    expect(result.strip.icon).toBe('user')
    expect(result.strip.headline).toBe('1 question needs your answer')
    expect(result.strip.detail).toBe(
      'The architect was less than 90% sure. Nothing moves until you answer.'
    )
  })
}

function noCriteriaTests() {
  it('7. no acceptance criteria yet', () => {
    const order = wo0928Order({ acceptance: [], plan: { ...wo0928Order().plan, units: [] } })
    const result = readiness(baseInput({ order }))
    expect(result.holder).toBe('you')
    expect(result.strip.tone).toBe('neutral')
    expect(result.strip.icon).toBe('alert')
    expect(result.strip.headline).toBe('No plan yet')
    expect(result.strip.detail).toBe('Press Draft the plan and the architect writes it.')
    expect(result.strip.actions).toEqual(['draft'])
  })

  it('7. criteria copied from the ticket but no units drafted is still no plan', () => {
    const order = wo0928Order({ plan: { ...wo0928Order().plan, units: [] } })
    const result = readiness(baseInput({ order }))
    expect(result.strip.headline).toBe('No plan yet')
    expect(result.strip.actions).toEqual(['draft'])
    expect(result.steps.find((s) => s.id === 'plan')?.word).toBe('Not drafted yet')
  })
}

function compileFailuresAndOkTests() {
  it('8. other compile failures, nothing running', () => {
    const order = wo0928Order({
      risk: { grade: 'P3', triggers: [], blastRadius: [], criticalPaths: [] },
    })
    const result = readiness(baseInput({ order }))
    expect(result.holder).toBe('you')
    expect(result.strip.tone).toBe('bad')
    expect(result.strip.headline).toBe('1 check needs a fix')
    expect(result.strip.detail).toBe(
      'The automatic turns could not close them. Each failing row says what to do.'
    )
  })

  it('9. compile ok waits for you to press Hand off', () => {
    const result = readiness(baseInput())
    expect(result.holder).toBe('you')
    expect(result.strip.tone).toBe('ready')
    expect(result.strip.icon).toBe('check')
    expect(result.strip.headline).toBe('Ready to hand off')
    expect(result.strip.detail).toBe(
      'All six rows pass and nobody is changing the plan. Press Hand off to start the work.'
    )
  })
}

describe('readiness — rows', () => {
  describe('all rows pass', allRowsPassTests)
  describe('questions answered', questionsAnsweredTests)
  describe('questions failing', questionsFailingTests)
  describe('verifiable phrasing and kinds', verifiablePhrasingAndKindsTests)
  describe('verifiable failing', verifiableFailingTests)
  describe('in-progress checks', inProgressChecksTests)
  describe('redTeam row', redteamRowTests)
  describe('turn row per actor', turnRowPerActorTests)
  describe('turn row refused and passed', turnRowRefusedAndPassedTests)
})

function allRowsPassTests() {
  it('all seven rows pass on the clean WO-0928-9c6-like fixture', () => {
    const result = readiness(baseInput())
    expect(result.rows.map((r) => r.id)).toEqual([
      'questions',
      'verifiable',
      'coverage',
      'risk',
      'redTeam',
      'environment',
      'turn',
    ])
    expect(result.rows.map((r) => r.label)).toEqual([
      'No open questions',
      'Every criterion can be proven',
      'Plan and criteria cover each other',
      'Risk graded against this plan',
      'No blocking red-team findings',
      'The base branch builds and passes its checks',
      'Nobody is changing the plan',
    ])
    expect(result.rows.every((r) => r.state === 'passed')).toBe(true)
    const [questions, verifiable, coverage, risk, redTeam, , turn] = result.rows
    expect(questions.detail).toBe('None were asked.')
    expect(verifiable.detail).toBe(`Both criteria are proven by a named test in ${SPEC_PATH}.`)
    expect(coverage.detail).toBe('1 unit builds both criteria.')
    expect(risk.detail).toBe(`Low risk, graded over the 2 files the plan touches.`)
    expect([redTeam.detail, turn.detail]).toEqual(['No findings.', 'No turn has run yet.'])
  })
}

function questionsAnsweredTests() {
  it('questions row: all answered', () => {
    const order = wo0928Order({
      openQuestions: [
        {
          id: 'Q-1',
          text: 'a',
          why: '',
          options: [],
          recommended: null,
          answer: 'yes',
          rank: 0,
          confidence: null,
          multiple: false,
          chosen: [],
        },
      ],
    })
    const result = readiness(baseInput({ order }))
    expect(result.rows[0].detail).toBe('All 1 answered.')
  })
}

function questionsFailingTests() {
  it('questions row: failing is needs-you', () => {
    const order = wo0928Order({
      openQuestions: [
        {
          id: 'Q-1',
          text: 'a',
          why: '',
          options: [],
          recommended: null,
          answer: null,
          rank: 0,
          confidence: null,
          multiple: false,
          chosen: [],
        },
      ],
    })
    const result = readiness(baseInput({ order }))
    expect(result.rows[0].state).toBe('needs-you')
    expect(result.rows[0].detail).toBe(
      compileOrder(order).failures.find((f) => f.check === 'questions')?.detail
    )
  })
}

function verifiablePhrasingAndKindsTests() {
  it('verifiable row: 1 criterion phrasing', () => {
    const order = wo0928Order({
      acceptance: [wo0928Order().acceptance[0]],
      plan: {
        ...wo0928Order().plan,
        units: [{ ...wo0928Order().plan.units[0], satisfies: ['AC-1'] }],
      },
    })
    const result = readiness(baseInput({ order }))
    expect(result.rows[1].detail).toBe(`The criterion is proven by a named test in ${SPEC_PATH}.`)
  })

  it('verifiable row: mixed kinds', () => {
    const order = wo0928Order({
      acceptance: [
        wo0928Order().acceptance[0],
        {
          id: 'AC-2',
          statement: 'screenshot proof',
          priority: 'P1',
          verify: { kind: 'screenshot', target: 'Forge status strip' },
          unverifiable: null,
        },
      ],
    })
    const result = readiness(baseInput({ order }))
    expect(result.rows[1].detail).toBe('2 criteria, each with a way to prove it.')
  })
}

function verifiableFailingTests() {
  it('verifiable row: failing (not in-progress) is a plain failure, not needs-you', () => {
    const order = wo0928Order({
      acceptance: [
        { ...wo0928Order().acceptance[0], verify: { kind: 'command', command: '', assert: 'ok' } },
      ],
    })
    const result = readiness(baseInput({ order }))
    expect(result.rows[1].state).toBe('failing')
  })
}

function inProgressChecksTests() {
  it('a failing check is in-progress while a machine turn runs and is not held', () => {
    const order = wo0928Order({
      acceptance: [
        { ...wo0928Order().acceptance[0], verify: { kind: 'command', command: '', assert: 'ok' } },
      ],
    })
    const result = readiness(
      baseInput({
        order,
        intake: runningTurn({ sessionId: 's1', trigger: 'you' }),
      })
    )
    expect(result.rows[1].state).toBe('in-progress')
  })
}

function redteamRowTests() {
  it('redTeam row: needs-you when open blocking findings are the operators to decide', () => {
    const order = wo0928Order({ redTeam: [blockingFinding()] })
    const result = readiness(baseInput({ order }))
    expect(result.rows[4].state).toBe('needs-you')
  })

  it('redTeam row: resolved and notes counted, zero part omitted', () => {
    const order = wo0928Order({
      redTeam: [
        { ...blockingFinding({ id: 'RT-1' }), status: 'resolved' },
        { ...blockingFinding({ id: 'RT-2' }), status: 'resolved' },
        { ...blockingFinding({ id: 'RT-3', category: 'process' }), status: 'open' },
      ],
    })
    const result = readiness(baseInput({ order }))
    expect(result.rows[4].detail).toBe("2 resolved. 1 note that don't block.")
  })
}

function turnRowPerActorTests() {
  it('turn row: in-progress per actor', () => {
    const redTeam = readiness(
      baseInput({
        intake: runningTurn({ actor: 'red team', round: 2 }),
      })
    ).rows[6]
    expect(redTeam.detail).toBe(
      'The red team is reviewing round 2. The checks above can change when it finishes.'
    )

    const architect = readiness(
      baseInput({
        intake: runningTurn({ trigger: 'you' }),
      })
    ).rows[6]
    expect(architect.detail).toBe(
      'The architect is changing the plan. The checks above can change when it finishes.'
    )

    const scout = readiness(
      baseInput({
        intake: runningTurn({ asked: 'scout', actor: 'scout' }),
      })
    ).rows[6]
    expect(scout.detail).toBe('The scout is reading the repository.')
  })
}

function turnRowRefusedAndPassedTests() {
  it('turn row: refused is failing', () => {
    const result = readiness(baseInput({ intake: { kind: 'refused', at: T1, reason: 'bad' } }))
    expect(result.rows[6].state).toBe('failing')
    expect(result.rows[6].detail).toBe(
      'The last turn ended in a refusal, so the plan is not the one the architect meant to write.'
    )
  })

  it('turn row: passed shows when the last turn ended', () => {
    const result = readiness(baseInput({ turnEndedAt: T1 }))
    expect(result.rows[6].detail).toBe(`The last turn ended at ${T1}.`)
  })
}

describe('readiness — steps and the not-yet rule', () => {
  describe('a plan gone bad', aPlanGoneBadTests)
  describe('an empty plan', anEmptyPlanTests)
  describe('a plan being revised', aPlanBeingRevisedTests)
  describe('a clean order', aCleanOrderTests)
  describe('not draft', notDraftTests)
  describe('not draft, review skipped', notDraftReviewSkippedTests)
})

function notDraftReviewSkippedTests() {
  it('says the review was skipped, and why, on an order handed off without one', () => {
    const order = wo0928Order({ status: 'agreed', agreedAt: T1 })
    const result = readiness(
      baseInput({
        order,
        agreed: { at: T1, by: 'you' },
        loop: baseLoop({ skipped: 'P3, one lane' }),
      })
    )
    const redTeam = result.steps.find((s) => s.id === 'redTeam')
    expect(redTeam?.word).toBe('Skipped: P3, one lane')
  })

  it('says not reviewed when nothing reviewed it and nothing skipped it', () => {
    const order = wo0928Order({ status: 'agreed', agreedAt: T1 })
    const result = readiness(baseInput({ order, agreed: { at: T1, by: 'you' } }))
    expect(result.steps.find((s) => s.id === 'redTeam')?.word).toBe('Not reviewed')
  })
}

function aPlanGoneBadTests() {
  it('a plan gone bad cascades: redTeam, shape and tracker become not-yet, handOff is exempt', () => {
    const order = wo0928Order({
      risk: { grade: 'P3', triggers: [], blastRadius: [], criticalPaths: [] },
    })
    const result = readiness(baseInput({ order }))
    const byId = Object.fromEntries(result.steps.map((s) => [s.id, s]))

    expect(byId.plan.state).toBe('bad')
    expect(byId.plan.mark).toBe('x')
    expect(byId.plan.word).toBe('Needs a fix')

    expect(byId.redTeam.state).toBe('not-yet')
    expect(byId.redTeam.mark).toBe('number')
    expect(byId.redTeam.word).toBe('Waits for a plan')

    expect(byId.shape.state).toBe('not-yet')
    expect(byId.shape.mark).toBe('number')
    expect(byId.shape.word).toBe('Direct, proposed')

    expect(byId.tracker.state).toBe('not-yet')
    expect(byId.tracker.mark).toBe('number')
    expect(byId.tracker.word).toBe('Comment, state, links')

    // handOff is exempt: it keeps its own branch, never forced to not-yet generically.
    expect(byId.handOff.mark).toBe('number')
    expect(byId.handOff.word).toBe('Waiting on you')
  })
}

function anEmptyPlanTests() {
  it('names an empty plan before its failing checks, and says when it is being drafted', () => {
    const empty = wo0928Order({ plan: { ...wo0928Order().plan, units: [] } })
    const idle = readiness(baseInput({ order: empty }))
    expect(idle.steps.find((s) => s.id === 'plan')?.word).toBe('Not drafted yet')

    const running: IntakeOutcome = runningTurn({
      sessionId: 'S-1',
      asked: 'drafting the plan',
      trigger: 'you',
    })
    const drafting = readiness(baseInput({ order: empty, intake: running }))
    expect(drafting.steps.find((s) => s.id === 'plan')).toMatchObject({
      state: 'work',
      mark: 'spin',
      word: 'Being drafted',
    })
  })
}

function aPlanBeingRevisedTests() {
  it('shows a failing plan check as being revised while the architect works on your request', () => {
    const order = wo0928Order({
      risk: { grade: 'P3', triggers: [], blastRadius: [], criticalPaths: [] },
    })
    const running: IntakeOutcome = runningTurn({
      sessionId: 'S-1',
      asked: 'fix it',
      trigger: 'you',
    })
    const plan = readiness(baseInput({ order, intake: running })).steps.find((s) => s.id === 'plan')
    expect(plan).toMatchObject({ state: 'work', mark: 'spin', word: 'Being revised' })
  })
}

function aCleanOrderTests() {
  it('a clean order: every step done, handOff ready', () => {
    const result = readiness(baseInput())
    const byId = Object.fromEntries(result.steps.map((s) => [s.id, s]))
    expect(byId.intent.state).toBe('done')
    expect(byId.intent.word).toBe('Done')
    expect(byId.plan.state).toBe('done')
    expect(byId.plan.word).toBe('2 criteria, 1 unit')
    expect(byId.redTeam.state).toBe('not-yet')
    expect(byId.redTeam.word).toBe('Not reviewed yet')
    expect(byId.handOff.state).toBe('done')
    expect(byId.handOff.word).toBe('Ready')
  })

  it('a finished clean round marks redTeam done', () => {
    const result = readiness(
      baseInput({ loop: baseLoop({ rounds: [{ round: 1, startedAt: T0, finishedAt: T1 }] }) })
    )
    const byId = Object.fromEntries(result.steps.map((s) => [s.id, s]))
    expect(byId.redTeam.state).toBe('done')
    expect(byId.redTeam.word).toBe('Clean after round 1')
  })
}

function notDraftTests() {
  it('not draft: every step done and check, with hand-off-specific words', () => {
    const order = wo0928Order({ status: 'agreed', agreedAt: T1 })
    const result = readiness(
      baseInput({
        order,
        agreed: { at: T1, by: 'you' },
        loop: baseLoop({ rounds: [{ round: 1, startedAt: T0, finishedAt: T1 }] }),
      })
    )
    expect(result.steps.every((s) => s.state === 'done' && s.mark === 'check')).toBe(true)
    const byId = Object.fromEntries(result.steps.map((s) => [s.id, s]))
    expect(byId.redTeam.word).toBe('Clean after round 1')
    expect(byId.shape.word).toBe('Direct, proposed')
    expect(byId.handOff.word).toBe(`Handed off ${T1}`)
  })
}

describe('readiness — findings', () => {
  describe('fixing', fixingTests)
  describe('needs you', needsYouTests)
  describe('notes', readinessNotesTests)
  describe('resolved and text', resolvedAndTextTests)
})

function fixingTests() {
  it('groups a blocking finding as fixing while the architect fix turn or a red-team round runs', () => {
    const order = wo0928Order({
      redTeam: [blockingFinding({ id: 'RT-1', round: 2 })],
    })
    const result = readiness(
      baseInput({
        order,
        intake: runningTurn({ at: T2, round: 2 }),
        loop: baseLoop({
          rounds: [
            { round: 1, startedAt: T0, finishedAt: T1 },
            { round: 2, startedAt: T2, finishedAt: null },
          ],
        }),
      })
    )
    expect(result.findings[0].group).toBe('fixing')
  })
}

function needsYouTests() {
  it('groups an unattended blocking finding as needs-you, with the round it was raised in', () => {
    const order = wo0928Order({ redTeam: [blockingFinding({ id: 'RT-1', round: 1 })] })
    const result = readiness(
      baseInput({
        order,
        loop: baseLoop({ rounds: [{ round: 1, startedAt: T0, finishedAt: T1 }] }),
      })
    )
    expect(result.findings[0].group).toBe('needs-you')
    expect(result.findings[0].meta).toBe(`Would make the change wrong · Raised ${T1}`)
  })

  it('a blocking finding whose round never finished has no raised time', () => {
    const order = wo0928Order({ redTeam: [blockingFinding({ id: 'RT-1', round: 9 })] })
    const result = readiness(baseInput({ order }))
    expect(result.findings[0].meta).toBe('Would make the change wrong')
  })
}

function readinessNotesTests() {
  it('groups non-blocking open findings as notes, by category', () => {
    const order = wo0928Order({
      redTeam: [
        blockingFinding({ id: 'RT-1', category: 'scope' }),
        blockingFinding({ id: 'RT-2', category: 'process' }),
        blockingFinding({ id: 'RT-3', category: 'pre-existing' }),
        blockingFinding({ id: 'RT-4', category: 'infra' }),
      ],
    })
    const result = readiness(baseInput({ order }))
    const metaById = Object.fromEntries(result.findings.map((f) => [f.id, f.meta]))
    expect(result.findings.every((f) => f.group === 'notes')).toBe(true)
    expect(metaById['RT-1']).toBe('Scope')
    expect(metaById['RT-2']).toBe('Process')
    expect(metaById['RT-3']).toBe('Already true before this change')
    expect(metaById['RT-4']).toBe('Setup')
  })
}

function resolvedAndTextTests() {
  it('groups settled findings as resolved, with the reason', () => {
    const order = wo0928Order({
      redTeam: [
        {
          ...blockingFinding({ id: 'RT-1' }),
          status: 'accepted',
          reason: 'architect, 95% confident: does not apply',
        },
      ],
    })
    const result = readiness(baseInput({ order }))
    expect(result.findings[0].group).toBe('resolved')
    expect(result.findings[0].meta).toBe('architect, 95% confident: does not apply')
  })

  it('finding text is the first paragraph, trimmed', () => {
    const order = wo0928Order({
      redTeam: [
        blockingFinding({ id: 'RT-1', text: '  Wrong outcome claim.  \n\nEvidence: line 12.' }),
      ],
    })
    const result = readiness(baseInput({ order }))
    expect(result.findings[0].text).toBe('Wrong outcome claim.')
  })
}

describe('readiness — locks and canHandOff', () => {
  describe('a clean draft', aCleanDraftTests)
  describe('handOff lock across states', handoffLockAcrossStatesTests)
  describe('held orders', heldOrdersTests)
  describe('who handed off', whoHandedOffTests)
  describe('the redraft lock', theRedraftLockTests)
  describe('handOffWhy', handoffwhyTests)
})

function aCleanDraftTests() {
  it('canHandOff is true and every lock is null on a clean draft', () => {
    const result = readiness(baseInput())
    expect(result.canHandOff).toBe(true)
    expect(result.locks.handOff).toBeNull()
    expect(result.locks.redraft).toBeNull()
    expect(result.locks.message).toBeNull()
    expect(result.handOffWhy).toBeNull()
  })
}

/** A question nobody has answered yet. */
const UNANSWERED: WorkOrder['openQuestions'][number] = {
  id: 'Q-1',
  text: 'a',
  why: '',
  options: [],
  recommended: null,
  answer: null,
  rank: 0,
  confidence: null,
  multiple: false,
  chosen: [],
}

function handoffLockAcrossStatesTests() {
  it('locks.handOff is null exactly when canHandOff, across several draft states', () => {
    // "Held, with nothing running and compile ok" is a deliberate exception to
    // this property (see the dedicated test below) and is excluded here.
    const fixtures: ReadinessInput[] = [
      baseInput(),
      baseInput({ intake: { kind: 'refused', at: T1, reason: 'x' } }),
      baseInput({
        intake: runningTurn({ actor: 'red team', round: 1 }),
      }),
      baseInput({ order: wo0928Order({ redTeam: [blockingFinding()] }) }),
      baseInput({ order: wo0928Order({ openQuestions: [UNANSWERED] }) }),
      baseInput({
        order: wo0928Order({ acceptance: [], plan: { ...wo0928Order().plan, units: [] } }),
      }),
      baseInput({
        order: wo0928Order({
          risk: { grade: 'P3', triggers: [], blastRadius: [], criticalPaths: [] },
        }),
      }),
    ]
    for (const input of fixtures) {
      const result = readiness(input)
      expect(input.order.status).toBe('draft')
      expect(result.locks.handOff === null).toBe(result.canHandOff)
    }
  })
}

function heldOrdersTests() {
  it('held with compile ok and nothing running is not locked, even though canHandOff is false', () => {
    const result = readiness(baseInput({ loop: baseLoop({ heldAt: T1 }) }))
    expect(result.canHandOff).toBe(false)
    expect(result.locks.handOff).toBeNull()
  })

  it('held with a real failure still locks', () => {
    const order = wo0928Order({
      risk: { grade: 'P3', triggers: [], blastRadius: [], criticalPaths: [] },
    })
    const result = readiness(baseInput({ order, loop: baseLoop({ heldAt: T1 }) }))
    expect(result.locks.handOff).toBe(
      `Held by you since ${T1}. Let it continue, or hand off yourself once nothing is running.`
    )
  })
}

function whoHandedOffTests() {
  it('handOff lock, not draft, records who handed off', () => {
    const order = wo0928Order({ status: 'agreed', agreedAt: T1 })
    const byYou = readiness(baseInput({ order, agreed: { at: T1, by: 'you' } }))
    expect(byYou.locks.handOff).toBe(`Handed off at ${T1} by you. The order is read-only.`)
    const auto = readiness(baseInput({ order, agreed: { at: T1, by: 'automatic' } }))
    expect(auto.locks.handOff).toBe(`Handed off at ${T1} automatically. The order is read-only.`)
  })
}

function theRedraftLockTests() {
  it('redraft lock: red team running warns of loss, architect/scout say to wait', () => {
    const redTeam = readiness(
      baseInput({
        intake: runningTurn({ actor: 'red team', round: 1 }),
      })
    )
    expect(redTeam.locks.redraft).toBe(
      'The red team is reviewing the plan. A redraft now would be lost when its round finishes. Use "Hold for me" to stop the loop first.'
    )
    expect(redTeam.locks.message).toBe(redTeam.locks.redraft)

    const architect = readiness(
      baseInput({
        intake: runningTurn({ trigger: 'you' }),
      })
    )
    expect(architect.locks.redraft).toBe(
      `The architect is already working (started ${T0}). Wait for it to finish, or watch it.`
    )
  })
}

function handoffwhyTests() {
  it('handOffWhy names what finishing opens hand-off, and is null when ready', () => {
    const redTeam = readiness(
      baseInput({
        intake: runningTurn({ actor: 'red team', round: 2 }),
      })
    )
    expect(redTeam.handOffWhy).toBe('Hand-off opens when the red team finishes round 2.')

    const architect = readiness(
      baseInput({
        intake: runningTurn({ trigger: 'you' }),
      })
    )
    expect(architect.handOffWhy).toBe('Hand-off opens when the architect finishes.')

    const scout = readiness(
      baseInput({
        intake: runningTurn({ asked: 'scout', actor: 'scout' }),
      })
    )
    expect(scout.handOffWhy).toBe('Hand-off opens when the scout finishes.')

    expect(readiness(baseInput()).handOffWhy).toBeNull()
  })
}

describe('readiness — summary', () => {
  it('renders grade, unit count, shape and status', () => {
    const result = readiness(baseInput({ shape: { name: 'direct', yours: true } }))
    expect(result.summary).toBe('Low risk · 1 unit · Shape: Direct (your choice) · Draft')
  })

  it('shape not chosen', () => {
    const result = readiness(baseInput({ shape: { name: null, yours: false } }))
    expect(result.summary).toBe('Low risk · 1 unit · Shape: not chosen · Draft')
  })
})

describe('readiness — finding text in plain words', () => {
  // The red team writes criterion and unit ids; the operator reads what they are.
  it('names criteria and units by position instead of by id', () => {
    const order = wo0928Order({
      redTeam: [
        blockingFinding({
          id: 'RT-a',
          text: 'AC-1 passes on a filter applied after the page is fetched.',
        }),
        blockingFinding({ id: 'RT-b', text: 'Only U-1 builds AC-2, and AC-9 does not exist.' }),
      ],
    })
    const texts = readiness(baseInput({ order })).findings.map((f) => f.text)
    expect(texts).toEqual([
      'The first criterion passes on a filter applied after the page is fetched.',
      'Only the unit builds the second criterion, and AC-9 does not exist.',
    ])
  })

  it('leaves a finding that names no id exactly as written', () => {
    const order = wo0928Order({
      redTeam: [blockingFinding({ id: 'RT-a', text: 'the change would leave the outcome false' })],
    })
    expect(readiness(baseInput({ order })).findings[0].text).toBe(
      'the change would leave the outcome false'
    )
  })
})

// The base branch row: whether the branch the work starts from builds and passes,
// and the one place hand-off waits for it.
const environmentOf = (environment: ReadinessInput['environment'], over = {}) =>
  readiness(baseInput({ environment, ...over }))
const rowOf = (result: ReturnType<typeof readiness>) =>
  result.rows.find((row) => row.id === 'environment')

const testsFailOnBase = provenBaseline({
  state: 'failing',
  steps: [baseStep('Build'), baseStep('Tests', { result: 'fail', exitCode: 1 })],
})

describe('readiness — the base branch row', () => {
  describe('before and during the check', beforeAndDuringTests)
  describe('after the check', afterTheCheckTests)
  describe('failing', failingTests)
  describe('failingEdgesTests', failingEdgesTests)
  describe('a check that stopped', stoppedCheckTests)
  describe('tests failing on the base', testsFailingOnBaseTests)
  describe('handing off anyway', handingOffAnywayTests)
  describe('questionsStillShowTests', questionsStillShowTests)
})

function beforeAndDuringTests() {
  it('is not checked yet when there is no baseline, and hand-off waits', () => {
    const result = environmentOf({ baseline: null, waivedAt: null })
    expect(rowOf(result)).toMatchObject({
      state: 'needs-you',
      detail: 'Not checked for this order yet.',
    })
    expect(result.canHandOff).toBe(false)
    expect(result.locks.handOff).toBe(
      'Not checked for this order yet. Check it again, or skip this check.'
    )
  })

  it('says what is being checked while it runs, and hand-off waits', () => {
    const result = environmentOf({
      baseline: provenBaseline({ state: 'checking' }),
      waivedAt: null,
    })
    expect(rowOf(result)).toMatchObject({
      state: 'in-progress',
      detail: 'Checking main: format, lint, tests and build, in their own terminal tabs.',
    })
    expect(result.canHandOff).toBe(false)
    expect(result.locks.handOff).toBe(
      'Hand-off opens when the base branch check finishes, or skip this check.'
    )
  })
}

function afterTheCheckTests() {
  it('names the commit and the steps that passed, and opens hand-off', () => {
    const result = environmentOf({ baseline: provenBaseline(), waivedAt: null })
    expect(rowOf(result)).toMatchObject({
      state: 'passed',
      detail: 'main at b289028 passed format, lint, tests and build.',
    })
    expect(result.canHandOff).toBe(true)
    expect(result.locks.handOff).toBeNull()
  })

  it('says so when a reinstall was needed, and names what was not measured', () => {
    const baseline = provenBaseline({
      mended: true,
      steps: [baseStep('Lint'), baseStep('Build', { result: 'not_measured', exitCode: null })],
    })
    expect(rowOf(environmentOf({ baseline, waivedAt: null }))?.detail).toBe(
      'main at b289028 passed lint after a reinstall. Not measured: Build.'
    )
  })
}

function failingTests() {
  it('names each failed step with its exit code and command, and blocks hand-off', () => {
    const baseline = provenBaseline({
      state: 'failing',
      steps: [
        baseStep('Lint', { result: 'fail', exitCode: 2, command: 'npm run lint' }),
        baseStep('Tests', { result: 'fail', exitCode: 1, command: 'npm test' }),
      ],
    })
    const result = environmentOf({ baseline, waivedAt: null })
    expect(rowOf(result)).toMatchObject({
      state: 'failing',
      detail:
        'Lint failed on main with exit code 2: `npm run lint`. Tests failed on main with exit code 1: `npm test`.',
    })
    expect(result.canHandOff).toBe(false)
    expect(result.locks.handOff).toContain('Check it again, or skip this check.')
  })

  it('says the branch could not be checked when no step failed', () => {
    const baseline = provenBaseline({ state: 'failing', steps: [] })
    expect(rowOf(environmentOf({ baseline, waivedAt: null }))).toMatchObject({
      state: 'failing',
      detail: 'Nothing could be measured on main.',
    })
  })
}

function failingEdgesTests() {
  it('says nothing could be measured when every step was not measured', () => {
    const baseline = provenBaseline({
      state: 'failing',
      steps: [baseStep('Lint', { result: 'not_measured', exitCode: null })],
    })
    expect(rowOf(environmentOf({ baseline, waivedAt: null }))?.detail).toBe(
      'Nothing could be measured on main.'
    )
  })

  it('never reads "passed ." when a proven check has no passed step', () => {
    const baseline = provenBaseline({ steps: [] })
    const detail = rowOf(environmentOf({ baseline, waivedAt: null }))?.detail ?? ''
    expect(detail).not.toMatch(/passed \./)
    expect(detail).toBe('main at b289028 had nothing that could be measured.')
  })
}

function stoppedCheckTests() {
  it('reads a check left "checking" by a quit app as stopped, and offers it again', () => {
    const baseline = provenBaseline({ state: 'checking' })
    const result = environmentOf({ baseline, waivedAt: null, proving: false })
    expect(rowOf(result)).toMatchObject({
      state: 'failing',
      detail: 'The check of main stopped before it finished.',
    })
    expect(result.locks.handOff).toBe(
      'The check of main stopped before it finished. Check it again, or skip this check.'
    )
  })

  it('keeps reading a check that is really running as in progress', () => {
    const baseline = provenBaseline({ state: 'checking' })
    expect(rowOf(environmentOf({ baseline, waivedAt: null, proving: true }))?.state).toBe(
      'in-progress'
    )
  })
}

function testsFailingOnBaseTests() {
  it('is a failing row, because no shape starts from a failing test', () => {
    expect(rowOf(environmentOf({ baseline: testsFailOnBase, waivedAt: null }))?.state).toBe(
      'failing'
    )
  })
}

function handingOffAnywayTests() {
  it('passes once the operator hands off anyway, and says when', () => {
    const baseline = provenBaseline({
      state: 'failing',
      steps: [baseStep('Build', { result: 'fail' })],
    })
    const result = environmentOf({ baseline, waivedAt: T2 })
    expect(rowOf(result)).toMatchObject({
      state: 'passed',
      detail: `You handed off without it at ${T2}. Checks that fail on main will read “failing on base”.`,
    })
    expect(result.canHandOff).toBe(true)
  })

  it('passes a waiver even when the base branch was never checked', () => {
    const result = environmentOf({ baseline: null, waivedAt: T2 })
    expect(rowOf(result)?.state).toBe('passed')
    expect(result.canHandOff).toBe(true)
  })
}

function questionsStillShowTests() {
  it('does not hide an open question behind the base branch', () => {
    const order = wo0928Order({
      openQuestions: [
        {
          id: 'Q-1',
          text: 'which?',
          why: '',
          options: ['a', 'b'],
          recommended: 0,
          answer: null,
          rank: 1,
          confidence: 0.5,
          multiple: false,
          chosen: [],
        },
      ],
    })
    const result = environmentOf({ baseline: null, waivedAt: null }, { order })
    expect(result.locks.handOff).toContain('questions need your answer')
  })
}

const failing = provenBaseline({
  state: 'failing',
  steps: [baseStep('Lint', { result: 'fail', exitCode: 1 })],
})

const nothingMeasurable = provenBaseline({ state: 'failing', steps: [] })

const passesCases: [string, EnvironmentFacts, string | null, boolean][] = [
  ['never checked', { baseline: null, waivedAt: null }, null, false],
  ['checking', { baseline: provenBaseline({ state: 'checking' }), waivedAt: null }, null, false],
  [
    'a check that stopped',
    { baseline: provenBaseline({ state: 'checking' }), waivedAt: null, proving: false },
    null,
    false,
  ],
  ['failing', { baseline: failing, waivedAt: null }, null, false],
  ['proven', { baseline: provenBaseline(), waivedAt: null }, null, true],
  ['failing but waived', { baseline: failing, waivedAt: T2 }, null, true],
  ['never checked but waived', { baseline: null, waivedAt: T2 }, null, true],
  [
    'nothing measurable on a research order, which runs no code',
    { baseline: nothingMeasurable, waivedAt: null },
    'research',
    true,
  ],
  [
    'nothing measurable on a shape that runs code',
    { baseline: nothingMeasurable, waivedAt: null },
    'direct',
    false,
  ],
  [
    'a lint failure on a research order is still the base branch failing',
    { baseline: failing, waivedAt: null },
    'research',
    false,
  ],
  [
    'only tests failing on another shape',
    { baseline: testsFailOnBase, waivedAt: null },
    'feature',
    false,
  ],
]

const passesRows = passesCases.map(([name, environment, shapeName, expected]) => ({
  name,
  environment,
  shapeName,
  expected,
}))

describe('environmentPasses', () => {
  it.each(passesRows)('$name', ({ environment, shapeName, expected }) => {
    expect(environmentPasses(environment, shapeName)).toBe(expected)
    const row = rowOf(environmentOf(environment, { shape: { name: shapeName, yours: false } }))
    expect(row?.state === 'passed').toBe(expected)
  })
})

describe('readiness — the Checks step', () => {
  const checksStep = (waiting: number | undefined) =>
    readiness(baseInput(waiting === undefined ? {} : { checks: { waiting } })).steps.find(
      (s) => s.id === 'checks'
    )

  it('counts the rows waiting on the operator in the rail', () => {
    expect(checksStep(1)).toMatchObject({ state: 'you', mark: 'alert', word: '1 waiting on you' })
    expect(checksStep(3)?.word).toBe('3 waiting on you')
  })

  it('has nothing waiting when every row is settled', () => {
    expect(checksStep(0)).toMatchObject({ state: 'done', word: 'Nothing waiting on you' })
  })

  it('does not hold the later steps back while checks wait', () => {
    const steps = readiness(baseInput({ checks: { waiting: 2 } })).steps
    expect(steps.find((s) => s.id === 'shape')?.state).not.toBe('not-yet')
  })
})

describe('an intake turn that ran out its deadline', () => {
  it('reads as failed and offers to draft again', () => {
    const started = {
      at: T1,
      orderId: 'WO-1',
      actor: 'role:architect',
      action: 'converge.started',
      subject: 'sess-1',
      reason: 'draft',
      evidence: [],
    }
    const intake = currentIntake(
      [started],
      intakeAt('drafting', new Date('2026-09-09T19:00:00Z')),
      Date.parse('2026-09-09T20:00:00Z')
    )
    const result = readiness(baseInput({ intake }))
    expect(result.strip.tone).toBe('bad')
    expect(result.strip.actions).toContain('start-over')
  })
})
