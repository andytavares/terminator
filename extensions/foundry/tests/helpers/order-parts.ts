/**
 * The parts of a work order specs build over and over: a criterion the test
 * command proves, and a builder unit. Each takes the id and whatever differs.
 */
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
