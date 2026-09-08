import { describe, it, expect } from 'vitest'
import { interruptedRuns, interruptedGate } from '../../src/line/adopt.js'
import { buildRunGraph, withNode } from '../../src/line/run-graph.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { RunGraph } from '../../src/line/run-graph.js'

// What a fresh application finds when it opens on a run that never finished.
//
// Every agent's terminal was a child of the process that died, so nothing from
// a previous session is alive — and until this existed nothing looked. The run
// sat there drawing "building" chips, with no gate, no record and no way back.

const RECIPE = `
schemaVersion: 1
id: standard
steps:
  - id: build
    kind: fanout
    over: plan.units
    step: { kind: agent, role: builder }
  - id: integrate
    kind: join
    order: lane.ord
    after: [build]
`

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Make the thing work',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    status: 'running',
    plan: {
      ...base.plan,
      units: [
        {
          id: 'U-1',
          title: 'the first bit',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: [],
          verify: [],
        },
      ],
    },
    ...over,
  }
}

function graph(o: WorkOrder = order()): RunGraph {
  const parsed = parseRecipe(RECIPE, 'standard.yaml')
  if (!parsed.ok) throw new Error(parsed.reason)
  return buildRunGraph(o, parsed.value)
}

function running(o: WorkOrder = order()): RunGraph {
  return withNode(graph(o), 'build:U-1', { state: 'running', sessionId: 'gone' })
}

const nothingLive = (): boolean => false
const everythingLive = (): boolean => true

describe('interruptedRuns', () => {
  it('finds a running order whose agents are gone', () => {
    const found = interruptedRuns([{ order: order(), graph: running() }], nothingLive)
    expect(found.map((r) => r.orderId)).toEqual(['WO-1'])
  })

  it('names the steps that stopped, as a person would read them', () => {
    const found = interruptedRuns([{ order: order(), graph: running() }], nothingLive)
    expect(found[0].stopped).toEqual(['builder · U-1 the first bit'])
  })

  it('leaves a run alone whose agents are still in their terminals', () => {
    expect(interruptedRuns([{ order: order(), graph: running() }], everythingLive)).toEqual([])
  })

  it('leaves a run alone that has nothing in flight', () => {
    expect(interruptedRuns([{ order: order(), graph: graph() }], nothingLive)).toEqual([])
  })

  it('ignores an order that is not running', () => {
    const agreed = order({ status: 'agreed' })
    expect(interruptedRuns([{ order: agreed, graph: running(agreed) }], nothingLive)).toEqual([])
  })

  it('ignores a running order with no graph on disk', () => {
    expect(interruptedRuns([{ order: order(), graph: null }], nothingLive)).toEqual([])
  })

  it('counts what the interruption is holding up, so the inbox can rank it', () => {
    const found = interruptedRuns([{ order: order(), graph: running() }], nothingLive)
    expect(found[0].blockedUnits).toBe(1)
  })
})

describe('interruptedGate', () => {
  const found = (): ReturnType<typeof interruptedRuns>[number] =>
    interruptedRuns([{ order: order(), graph: running() }], nothingLive)[0]

  it('is one gate per order, so reopening twice does not stack two rows', () => {
    expect(interruptedGate(found(), '2026-09-06T12:00:00.000Z').id).toBe('WO-1-run.interrupted')
  })

  it('says which run, in the operator’s own words', () => {
    expect(interruptedGate(found(), '2026-09-06T12:00:00.000Z').summary).toContain(
      'Make the thing work'
    )
  })

  it('names what stopped, rather than a node id', () => {
    expect(interruptedGate(found(), '2026-09-06T12:00:00.000Z').why).toContain(
      'builder · U-1 the first bit'
    )
  })

  it('carries the order’s own risk grade into the ranking', () => {
    const gate = interruptedGate(found(), '2026-09-06T12:00:00.000Z')
    expect(gate.riskGrade).toBe(order().risk.grade)
    expect(gate.blockedUnits).toBe(1)
  })

  it('never sets a deadline — restarting agents on a timer is not a default', () => {
    expect(interruptedGate(found(), '2026-09-06T12:00:00.000Z').deadline).toBeNull()
  })
})
