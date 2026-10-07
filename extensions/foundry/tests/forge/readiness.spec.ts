import { describe, it, expect } from 'vitest'
import { REWRITING_UNREADABLE } from '../../src/forge/autonomy.js'
import { readiness } from '../../src/forge/readiness.js'
import type { LoopFacts, ReadinessInput } from '../../src/forge/readiness.js'
import { draftOrder } from '../../src/order/draft.js'
import { compileOrder } from '../../src/order/compile.js'
import type { WorkOrder, RedTeamFinding } from '../../src/order/schema.js'
import type { IntakeOutcome } from '../../src/forge/intake-outcome.js'

// readiness() is the one answer every Forge surface reads (ADR 074). The
// fixture below mirrors WO-0928-9c6, the order whose screen disagreed with
// itself: a Linear ticket filter, two test-backed criteria, one unit, P3 risk.

const T0 = '2026-09-28T13:00:00.000Z'
const T1 = '2026-09-28T13:05:49.000Z'
const T2 = '2026-09-28T13:06:19.000Z'

const SPEC_PATH = 'tests/unit/integrations/providers/linear.provider.spec.ts'
const UNIT_PATH = 'src/main/integrations/providers/linear.provider.ts'

const clock = (iso: string): string => iso

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
    intent: {
      problem: 'The Forge lists DONE tickets.',
      outcome: 'DONE tickets are excluded.',
      nonGoals: [],
    },
    acceptance: [
      {
        id: 'AC-1',
        statement: 'Listing issues excludes those in the Done state',
        priority: 'P1',
        verify: { kind: 'test', command: `npx vitest run ${SPEC_PATH}`, assert: 'exit_code == 0' },
        unverifiable: null,
      },
      {
        id: 'AC-2',
        statement: 'A ticket moved to Done drops out of the next list call',
        priority: 'P1',
        verify: {
          kind: 'test',
          command: `npx vitest run ${SPEC_PATH} -t "excludes done"`,
          assert: 'exit_code == 0',
        },
        unverifiable: null,
      },
    ],
    risk: { grade: 'P3', triggers: [], blastRadius: [UNIT_PATH, SPEC_PATH], criticalPaths: [] },
    plan: {
      ...base.plan,
      units: [
        {
          id: 'U-1',
          title: 'Filter DONE issues out of the Linear provider',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1', 'AC-2'],
          touches: [UNIT_PATH, SPEC_PATH],
          verify: [],
        },
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

function baseInput(
  over: Partial<ReadinessInput> = {},
  orderOver: Partial<WorkOrder> = {}
): ReadinessInput {
  const order = over.order ?? wo0928Order(orderOver)
  return {
    order,
    compile: over.compile ?? compileOrder(order),
    intake: over.intake ?? baseIntake(),
    loop: over.loop ?? baseLoop(),
    agreed: over.agreed ?? null,
    turnEndedAt: over.turnEndedAt ?? null,
    shape: over.shape ?? { name: 'Direct', yours: false },
    offers: over.offers ?? { shape: true, tracker: true },
    turn: over.turn,
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

  it('3b. running: rewriting a plan it could not read says so, not which checks it closes', () => {
    const result = readiness(
      baseInput({
        intake: {
          kind: 'running',
          at: T0,
          sessionId: 's1',
          asked: REWRITING_UNREADABLE,
          actor: 'architect',
          trigger: 'automatic',
          round: null,
          autoTurn: 1,
        },
      })
    )
    expect(result.strip.detail).toBe(
      `Started ${T0}. Its last plan was in the wrong format, so it is writing it again. You don't need to do anything.`
    )
  })

  it('3. running: scout', () => {
    const result = readiness(
      baseInput({
        intake: {
          kind: 'running',
          at: T0,
          sessionId: 's1',
          asked: 'scout',
          actor: 'scout',
          trigger: 'automatic',
          round: null,
          autoTurn: null,
        },
      })
    )
    expect(result.holder).toBe('scout')
    expect(result.strip.tone).toBe('working')
    expect(result.strip.icon).toBe('load')
    expect(result.strip.headline).toBe('The scout is reading the repository')
    expect(result.strip.detail).toBe(`Started ${T0}. The architect drafts the plan next.`)
    expect(result.strip.actions).toEqual(['watch'])
  })

  it('3. running: red team, with a previous finished round, says the hand-off is yours', () => {
    const result = readiness(
      baseInput({
        intake: {
          kind: 'running',
          at: T2,
          sessionId: 's2',
          asked: 'red team, round 2',
          actor: 'red team',
          trigger: 'automatic',
          round: 2,
          autoTurn: null,
        },
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

  it('3. running: red team, no previous round, held shows release', () => {
    const result = readiness(
      baseInput({
        intake: {
          kind: 'running',
          at: T0,
          sessionId: 's2',
          asked: 'red team, round 1',
          actor: 'red team',
          trigger: 'automatic',
          round: 1,
          autoTurn: null,
        },
        loop: baseLoop({ rounds: [{ round: 1, startedAt: T0, finishedAt: null }], heldAt: T1 }),
      })
    )
    expect(result.strip.detail).toBe(`Started ${T0}. When it finishes clean, you can hand off.`)
    expect(result.strip.actions).toEqual(['release'])
  })

  it('3. running: architect fixing findings automatically', () => {
    const findings = [blockingFinding({ id: 'RT-1' }), blockingFinding({ id: 'RT-2' })]
    const result = readiness(
      baseInput({
        order: wo0928Order({ redTeam: findings }),
        intake: {
          kind: 'running',
          at: T2,
          sessionId: 's3',
          asked: 'red team round 2 fix',
          actor: 'architect',
          trigger: 'automatic',
          round: 2,
          autoTurn: null,
        },
      })
    )
    expect(result.holder).toBe('architect')
    expect(result.strip.headline).toBe('The architect is fixing 2 red-team findings · round 2 of 3')
    expect(result.strip.detail).toBe(
      `Started ${T2} on its own. The red team reviews the fix next. You don't need to do anything.`
    )
    expect(result.strip.actions).toEqual(['hold'])
  })

  it('3. running: architect fixing a single finding, singular wording', () => {
    const result = readiness(
      baseInput({
        order: wo0928Order({ redTeam: [blockingFinding()] }),
        intake: {
          kind: 'running',
          at: T2,
          sessionId: 's3',
          asked: 'red team round 1 fix',
          actor: 'architect',
          trigger: 'automatic',
          round: 1,
          autoTurn: null,
        },
      })
    )
    expect(result.strip.headline).toBe('The architect is fixing 1 red-team finding · round 1 of 3')
  })

  it('3. running: architect revising automatically (autoTurn)', () => {
    const order = wo0928Order({ acceptance: [] })
    const compile = compileOrder(order)
    const result = readiness(
      baseInput({
        order,
        compile,
        intake: {
          kind: 'running',
          at: T0,
          sessionId: 's4',
          asked: 'follow-up',
          actor: 'architect',
          trigger: 'automatic',
          round: null,
          autoTurn: 1,
        },
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

  it('3. running: architect working on your request', () => {
    const result = readiness(
      baseInput({
        intake: {
          kind: 'running',
          at: T0,
          sessionId: 's5',
          asked: 'make it faster',
          actor: 'architect',
          trigger: 'you',
          round: null,
          autoTurn: null,
        },
      })
    )
    expect(result.holder).toBe('architect')
    expect(result.strip.headline).toBe('The architect is working on your request')
    expect(result.strip.detail).toBe(`Started ${T0}. Hand-off opens when it finishes.`)
    expect(result.strip.actions).toEqual(['watch'])
  })

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

  it('5. one blocking finding, singular wording, not exhausted', () => {
    const order = wo0928Order({ redTeam: [blockingFinding({ id: 'RT-1' })] })
    const result = readiness(baseInput({ order }))
    expect(result.strip.headline).toBe('1 finding needs your decision')
    expect(result.strip.detail).toBe(
      'Nothing moves until you decide. Hand-off opens when it is decided and the architect has applied them.'
    )
  })

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
})

describe('readiness — rows', () => {
  it('all six rows pass on the clean WO-0928-9c6-like fixture', () => {
    const result = readiness(baseInput())
    expect(result.rows.map((r) => r.id)).toEqual([
      'questions',
      'verifiable',
      'coverage',
      'risk',
      'redTeam',
      'turn',
    ])
    expect(result.rows.map((r) => r.label)).toEqual([
      'No open questions',
      'Every criterion can be proven',
      'Plan and criteria cover each other',
      'Risk graded against this plan',
      'No blocking red-team findings',
      'Nobody is changing the plan',
    ])
    expect(result.rows.every((r) => r.state === 'passed')).toBe(true)

    const [questions, verifiable, coverage, risk, redTeam, turn] = result.rows
    expect(questions.detail).toBe('None were asked.')
    expect(verifiable.detail).toBe(`Both criteria are proven by a named test in ${SPEC_PATH}.`)
    expect(coverage.detail).toBe('1 unit builds both criteria.')
    expect(risk.detail).toBe(`Low risk, graded over the 2 files the plan touches.`)
    expect(redTeam.detail).toBe('No findings.')
    expect(turn.detail).toBe('No turn has run yet.')
  })

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
        },
      ],
    })
    const result = readiness(baseInput({ order }))
    expect(result.rows[0].detail).toBe('All 1 answered.')
  })

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
        },
      ],
    })
    const result = readiness(baseInput({ order }))
    expect(result.rows[0].state).toBe('needs-you')
    expect(result.rows[0].detail).toBe(
      compileOrder(order).failures.find((f) => f.check === 'questions')?.detail
    )
  })

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

  it('verifiable row: failing (not in-progress) is a plain failure, not needs-you', () => {
    const order = wo0928Order({
      acceptance: [
        { ...wo0928Order().acceptance[0], verify: { kind: 'command', command: '', assert: 'ok' } },
      ],
    })
    const result = readiness(baseInput({ order }))
    expect(result.rows[1].state).toBe('failing')
  })

  it('a failing check is in-progress while a machine turn runs and is not held', () => {
    const order = wo0928Order({
      acceptance: [
        { ...wo0928Order().acceptance[0], verify: { kind: 'command', command: '', assert: 'ok' } },
      ],
    })
    const result = readiness(
      baseInput({
        order,
        intake: {
          kind: 'running',
          at: T0,
          sessionId: 's1',
          asked: 'x',
          actor: 'architect',
          trigger: 'you',
          round: null,
          autoTurn: null,
        },
      })
    )
    expect(result.rows[1].state).toBe('in-progress')
  })

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

  it('turn row: in-progress per actor', () => {
    const redTeam = readiness(
      baseInput({
        intake: {
          kind: 'running',
          at: T0,
          sessionId: 's',
          asked: 'x',
          actor: 'red team',
          trigger: 'automatic',
          round: 2,
          autoTurn: null,
        },
      })
    ).rows[5]
    expect(redTeam.detail).toBe(
      'The red team is reviewing round 2. The checks above can change when it finishes.'
    )

    const architect = readiness(
      baseInput({
        intake: {
          kind: 'running',
          at: T0,
          sessionId: 's',
          asked: 'x',
          actor: 'architect',
          trigger: 'you',
          round: null,
          autoTurn: null,
        },
      })
    ).rows[5]
    expect(architect.detail).toBe(
      'The architect is changing the plan. The checks above can change when it finishes.'
    )

    const scout = readiness(
      baseInput({
        intake: {
          kind: 'running',
          at: T0,
          sessionId: 's',
          asked: 'scout',
          actor: 'scout',
          trigger: 'automatic',
          round: null,
          autoTurn: null,
        },
      })
    ).rows[5]
    expect(scout.detail).toBe('The scout is reading the repository.')
  })

  it('turn row: refused is failing', () => {
    const result = readiness(baseInput({ intake: { kind: 'refused', at: T1, reason: 'bad' } }))
    expect(result.rows[5].state).toBe('failing')
    expect(result.rows[5].detail).toBe(
      'The last turn ended in a refusal, so the plan is not the one the architect meant to write.'
    )
  })

  it('turn row: passed shows when the last turn ended', () => {
    const result = readiness(baseInput({ turnEndedAt: T1 }))
    expect(result.rows[5].detail).toBe(`The last turn ended at ${T1}.`)
  })
})

describe('readiness — steps and the not-yet rule', () => {
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

  it('names an empty plan before its failing checks, and says when it is being drafted', () => {
    const empty = wo0928Order({ plan: { ...wo0928Order().plan, units: [] } })
    const idle = readiness(baseInput({ order: empty }))
    expect(idle.steps.find((s) => s.id === 'plan')?.word).toBe('Not drafted yet')

    const running: IntakeOutcome = {
      kind: 'running',
      at: T0,
      sessionId: 'S-1',
      asked: 'drafting the plan',
      actor: 'architect',
      trigger: 'you',
      round: null,
      autoTurn: null,
    }
    const drafting = readiness(baseInput({ order: empty, intake: running }))
    expect(drafting.steps.find((s) => s.id === 'plan')).toMatchObject({
      state: 'work',
      mark: 'spin',
      word: 'Being drafted',
    })
  })

  it('shows a failing plan check as being revised while the architect works on your request', () => {
    const order = wo0928Order({
      risk: { grade: 'P3', triggers: [], blastRadius: [], criticalPaths: [] },
    })
    const running: IntakeOutcome = {
      kind: 'running',
      at: T0,
      sessionId: 'S-1',
      asked: 'fix it',
      actor: 'architect',
      trigger: 'you',
      round: null,
      autoTurn: null,
    }
    const plan = readiness(baseInput({ order, intake: running })).steps.find((s) => s.id === 'plan')
    expect(plan).toMatchObject({ state: 'work', mark: 'spin', word: 'Being revised' })
  })

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
})

describe('readiness — findings', () => {
  it('groups a blocking finding as fixing while the architect fix turn or a red-team round runs', () => {
    const order = wo0928Order({
      redTeam: [blockingFinding({ id: 'RT-1', round: 2 })],
    })
    const result = readiness(
      baseInput({
        order,
        intake: {
          kind: 'running',
          at: T2,
          sessionId: 's',
          asked: 'x',
          actor: 'architect',
          trigger: 'automatic',
          round: 2,
          autoTurn: null,
        },
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
})

describe('readiness — locks and canHandOff', () => {
  it('canHandOff is true and every lock is null on a clean draft', () => {
    const result = readiness(baseInput())
    expect(result.canHandOff).toBe(true)
    expect(result.locks.handOff).toBeNull()
    expect(result.locks.redraft).toBeNull()
    expect(result.locks.message).toBeNull()
    expect(result.handOffWhy).toBeNull()
  })

  it('locks.handOff is null exactly when canHandOff, across several draft states', () => {
    // "Held, with nothing running and compile ok" is a deliberate exception to
    // this property (see the dedicated test below) and is excluded here.
    const fixtures: ReadinessInput[] = [
      baseInput(),
      baseInput({ intake: { kind: 'refused', at: T1, reason: 'x' } }),
      baseInput({
        intake: {
          kind: 'running',
          at: T0,
          sessionId: 's',
          asked: 'x',
          actor: 'red team',
          trigger: 'automatic',
          round: 1,
          autoTurn: null,
        },
      }),
      baseInput({ order: wo0928Order({ redTeam: [blockingFinding()] }) }),
      baseInput({
        order: wo0928Order({
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
            },
          ],
        }),
      }),
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

  it('handOff lock, not draft, records who handed off', () => {
    const order = wo0928Order({ status: 'agreed', agreedAt: T1 })
    const byYou = readiness(baseInput({ order, agreed: { at: T1, by: 'you' } }))
    expect(byYou.locks.handOff).toBe(`Handed off at ${T1} by you. The order is read-only.`)
    const auto = readiness(baseInput({ order, agreed: { at: T1, by: 'automatic' } }))
    expect(auto.locks.handOff).toBe(`Handed off at ${T1} automatically. The order is read-only.`)
  })

  it('redraft lock: red team running warns of loss, architect/scout say to wait', () => {
    const redTeam = readiness(
      baseInput({
        intake: {
          kind: 'running',
          at: T0,
          sessionId: 's',
          asked: 'x',
          actor: 'red team',
          trigger: 'automatic',
          round: 1,
          autoTurn: null,
        },
      })
    )
    expect(redTeam.locks.redraft).toBe(
      'The red team is reviewing the plan. A redraft now would be lost when its round finishes. Use "Hold for me" to stop the loop first.'
    )
    expect(redTeam.locks.message).toBe(redTeam.locks.redraft)

    const architect = readiness(
      baseInput({
        intake: {
          kind: 'running',
          at: T0,
          sessionId: 's',
          asked: 'x',
          actor: 'architect',
          trigger: 'you',
          round: null,
          autoTurn: null,
        },
      })
    )
    expect(architect.locks.redraft).toBe(
      `The architect is already working (started ${T0}). Wait for it to finish, or watch it.`
    )
  })

  it('handOffWhy names what finishing opens hand-off, and is null when ready', () => {
    const redTeam = readiness(
      baseInput({
        intake: {
          kind: 'running',
          at: T0,
          sessionId: 's',
          asked: 'x',
          actor: 'red team',
          trigger: 'automatic',
          round: 2,
          autoTurn: null,
        },
      })
    )
    expect(redTeam.handOffWhy).toBe('Hand-off opens when the red team finishes round 2.')

    const architect = readiness(
      baseInput({
        intake: {
          kind: 'running',
          at: T0,
          sessionId: 's',
          asked: 'x',
          actor: 'architect',
          trigger: 'you',
          round: null,
          autoTurn: null,
        },
      })
    )
    expect(architect.handOffWhy).toBe('Hand-off opens when the architect finishes.')

    const scout = readiness(
      baseInput({
        intake: {
          kind: 'running',
          at: T0,
          sessionId: 's',
          asked: 'scout',
          actor: 'scout',
          trigger: 'automatic',
          round: null,
          autoTurn: null,
        },
      })
    )
    expect(scout.handOffWhy).toBe('Hand-off opens when the scout finishes.')

    expect(readiness(baseInput()).handOffWhy).toBeNull()
  })
})

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
