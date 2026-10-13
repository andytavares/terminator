/**
 * The parts of a work order specs build over and over: criteria, units,
 * questions and a running order. Each takes the id and whatever differs.
 */
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'

type Criterion = WorkOrder['acceptance'][number]
type Unit = WorkOrder['plan']['units'][number]

/** A P1 criterion proved by `npm test` exiting 0. */
export function testCriterion(id: string, over: Partial<Criterion> = {}): Criterion {
  return {
    id,
    statement: id,
    priority: 'P1',
    verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
    unverifiable: null,
    ...over,
  }
}

/** A running order in /repos/a whose one builder unit, U-1, touches `touches`. */
export function runningOrder(
  id: string,
  touches: string[],
  over: Partial<WorkOrder> = {}
): WorkOrder {
  const base = draftOrder({
    id,
    title: id,
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  const unit = builderUnit('U-1', { satisfies: ['AC-1'], touches })
  return { ...base, status: 'running', plan: { ...base.plan, units: [unit] }, ...over }
}

type Question = WorkOrder['openQuestions'][number]

/** An open question with no options, no recommendation and no answer until told. */
export function openQuestion(id: string, over: Partial<Question> = {}): Question {
  return {
    id,
    text: id,
    why: '',
    options: [],
    recommended: null,
    answer: null,
    rank: 1,
    confidence: null,
    ...over,
  }
}

/** The row's last glyph: a command proves it renders, a screenshot that it is not clipped. */
export function glyphCriteria(): WorkOrder['acceptance'] {
  return [
    testCriterion('AC-1', {
      statement: 'a full-width row renders its final glyph',
      priority: 'P0',
      verify: { kind: 'test', command: 'npx vitest run', assert: 'exit_code == 0' },
    }),
    // A command cannot say whether the glyph renders on a stylesheet change (FR-040).
    testCriterion('AC-2', {
      statement: 'the last column is not clipped, in the running application',
      verify: { kind: 'screenshot', target: 'a full-width terminal row' },
    }),
  ]
}

/** A builder unit in lane 1 that touches nothing and satisfies nothing until told. */
export function builderUnit(id: string, over: Partial<Unit> = {}): Unit {
  return {
    id,
    title: id,
    role: 'builder',
    lane: 1,
    dependsOn: [],
    satisfies: [],
    touches: [],
    verify: [],
    ...over,
  }
}
