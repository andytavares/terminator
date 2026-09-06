import { describe, it, expect } from 'vitest'
import {
  readyNodes,
  startReady,
  markPassed,
  markFailed,
  retry,
  isComplete,
  hasStalled,
  blockedNodes,
  blockedReason,
  inFlight,
  budgetBreach,
  MAX_ATTEMPTS,
} from '../../src/line/scheduler.js'
import { buildRunGraph, nodeById, withNode } from '../../src/line/run-graph.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/schema.js'
import type { Budgets, WorkOrder } from '../../src/order/schema.js'
import type { RunGraph } from '../../src/line/run-graph.js'

// Two rules carry nearly all of this: a node starts only when everything it
// waits on has passed, and the number in flight never exceeds the agent budget
// the order agreed to. Both are pure functions of the graph, so "why is
// nothing running" is always answerable without watching it happen.

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
  - id: ship
    kind: gate
    rule: ready-for-review
    defaultIfIgnored: hold
    after: [integrate]
`

const BUDGETS: Budgets = { agents: 2, wallClockMinutes: 45, filesTouched: 25, tokens: null }

function unit(id: string, dependsOn: string[] = []) {
  return {
    id,
    title: id,
    role: 'builder',
    lane: 1,
    dependsOn,
    satisfies: ['AC-1'],
    touches: [],
    verify: [],
  }
}

function graph(units = [unit('U-1'), unit('U-2'), unit('U-3')]): RunGraph {
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  const order: WorkOrder = { ...base, plan: { ...base.plan, units } }
  const parsed = parseRecipe(RECIPE, 'standard.yaml')
  if (!parsed.ok) throw new Error(parsed.reason)
  return buildRunGraph(order, parsed.value)
}

describe('readyNodes', () => {
  it('offers only what has nothing left to wait for', () => {
    expect(readyNodes(graph(), BUDGETS).map((n) => n.id)).toEqual(['build:U-1', 'build:U-2'])
  })

  it('never offers more work than the agent budget allows', () => {
    const wide = readyNodes(graph(), { ...BUDGETS, agents: 1 })
    expect(wide.filter((n) => n.kind !== 'gate')).toHaveLength(1)
  })

  it('counts what is already running against the budget', () => {
    const g = withNode(graph(), 'build:U-1', { state: 'running' })
    expect(readyNodes(g, BUDGETS).filter((n) => n.kind !== 'gate')).toHaveLength(1)
  })

  it('counts verifying against the budget too, since it occupies an agent', () => {
    const g = withNode(withNode(graph(), 'build:U-1', { state: 'verifying' }), 'build:U-2', {
      state: 'running',
    })
    expect(readyNodes(g, BUDGETS).filter((n) => n.kind !== 'gate')).toEqual([])
  })

  it('does not offer a node whose dependency has not passed', () => {
    expect(readyNodes(graph(), BUDGETS).map((n) => n.id)).not.toContain('integrate')
  })

  it('offers a node once every dependency has passed', () => {
    let g = graph([unit('U-1')])
    g = markPassed(g, 'build:U-1', 'now')
    expect(readyNodes(g, BUDGETS).map((n) => n.id)).toContain('integrate')
  })

  it('treats a skipped dependency as settled, so a skipped step cannot deadlock the graph', () => {
    let g = graph([unit('U-1')])
    g = withNode(g, 'build:U-1', { state: 'skipped' })
    expect(readyNodes(g, BUDGETS).map((n) => n.id)).toContain('integrate')
  })

  it('honours a unit dependency inside a fan-out', () => {
    const g = graph([unit('U-1'), unit('U-2', ['U-1'])])
    expect(readyNodes(g, BUDGETS).map((n) => n.id)).toEqual(['build:U-1'])
  })

  it('never counts a gate against the budget — it waits on a person, not an agent', () => {
    let g = graph([unit('U-1')])
    g = markPassed(g, 'build:U-1', 'now')
    g = markPassed(g, 'integrate', 'now')
    g = withNode(g, 'build:U-1', { state: 'running' })
    expect(readyNodes(g, { ...BUDGETS, agents: 1 }).map((n) => n.id)).toContain('ship')
  })
})

describe('startReady', () => {
  it('moves what can start into running and stamps when', () => {
    const { graph: g, started } = startReady(graph(), BUDGETS, 'at')
    expect(started).toEqual(['build:U-1', 'build:U-2'])
    expect(nodeById(g, 'build:U-1')?.state).toBe('running')
    expect(nodeById(g, 'build:U-1')?.startedAt).toBe('at')
  })

  it('counts an attempt each time a node starts', () => {
    const { graph: g } = startReady(graph(), BUDGETS, 'at')
    expect(nodeById(g, 'build:U-1')?.attempts).toBe(1)
  })

  it('keeps the original start time across a retry', () => {
    let g = startReady(graph(), BUDGETS, 'first').graph
    g = markFailed(g, 'build:U-1', 'then').graph
    g = retry(g, 'build:U-1')
    g = startReady(g, BUDGETS, 'second').graph
    expect(nodeById(g, 'build:U-1')?.startedAt).toBe('first')
    expect(nodeById(g, 'build:U-1')?.attempts).toBe(2)
  })
})

describe('markFailed', () => {
  it('blocks everything downstream rather than leaving it waiting for ever', () => {
    const g = graph([unit('U-1')])
    const { graph: after } = markFailed(g, 'build:U-1', 'at')
    expect(nodeById(after, 'integrate')?.state).toBe('blocked')
  })

  it('does not ask for a decision on the first failure', () => {
    const g = startReady(graph(), BUDGETS, 'at').graph
    expect(markFailed(g, 'build:U-1', 'at').needsDecision).toBe(false)
  })

  it('asks for a decision once the retries are used up', () => {
    let g = startReady(graph(), BUDGETS, 'at').graph
    g = markFailed(g, 'build:U-1', 'at').graph
    g = retry(g, 'build:U-1')
    g = startReady(g, BUDGETS, 'at').graph
    expect(markFailed(g, 'build:U-1', 'at').needsDecision).toBe(true)
  })

  it('allows exactly two attempts before the third becomes a decision', () => {
    expect(MAX_ATTEMPTS).toBe(2)
  })

  it('ignores a node that is not in the graph', () => {
    const g = graph()
    expect(markFailed(g, 'nope', 'at').graph).toEqual(g)
  })
})

describe('retry', () => {
  it('puts a failed node back in the queue and unblocks what it stopped', () => {
    let g = graph([unit('U-1')])
    g = markFailed(g, 'build:U-1', 'at').graph
    g = retry(g, 'build:U-1')
    expect(nodeById(g, 'build:U-1')?.state).toBe('waiting')
    expect(nodeById(g, 'integrate')?.state).toBe('waiting')
  })
})

describe('blockedNodes and blockedReason', () => {
  it('names what a node is waiting on', () => {
    expect(blockedReason(graph(), 'integrate')).toMatch(/waiting on build:U-1/)
  })

  it('names what failed, in preference to what it is waiting on', () => {
    const g = markFailed(graph([unit('U-1')]), 'build:U-1', 'at').graph
    expect(blockedReason(g, 'integrate')).toBe('build:U-1 failed')
  })

  it('has no reason for a node that is running', () => {
    const g = withNode(graph(), 'build:U-1', { state: 'running' })
    expect(blockedReason(g, 'build:U-1')).toBeNull()
  })

  it('has no reason for a node that is not there', () => {
    expect(blockedReason(graph(), 'nope')).toBeNull()
  })

  it('lists everything a failure has stopped', () => {
    const g = markFailed(graph([unit('U-1')]), 'build:U-1', 'at').graph
    expect(blockedNodes(g).map((n) => n.id)).toContain('integrate')
  })
})

describe('isComplete and hasStalled', () => {
  it('is not complete while anything is outstanding', () => {
    expect(isComplete(graph())).toBe(false)
  })

  it('is complete when every node has passed or been skipped', () => {
    let g = graph([unit('U-1')])
    for (const node of g.nodes) g = markPassed(g, node.id, 'at')
    expect(isComplete(g)).toBe(true)
  })

  it('has not stalled while something can still start', () => {
    expect(hasStalled(graph(), BUDGETS)).toBe(false)
  })

  it('has stalled when nothing is running and nothing can start', () => {
    const g = markFailed(graph([unit('U-1')]), 'build:U-1', 'at').graph
    expect(hasStalled(g, BUDGETS)).toBe(true)
  })

  it('has not stalled merely because it is finished', () => {
    let g = graph([unit('U-1')])
    for (const node of g.nodes) g = markPassed(g, node.id, 'at')
    expect(hasStalled(g, BUDGETS)).toBe(false)
  })

  it('counts what is in flight', () => {
    const g = withNode(graph(), 'build:U-1', { state: 'running' })
    expect(inFlight(g).map((n) => n.id)).toEqual(['build:U-1'])
  })
})

describe('budgetBreach', () => {
  it('sees nothing wrong inside the budget', () => {
    expect(budgetBreach(BUDGETS, { elapsedMinutes: 10, filesTouched: 3, agents: 1 })).toBeNull()
  })

  it('catches the wall clock', () => {
    const breach = budgetBreach(BUDGETS, { elapsedMinutes: 60, filesTouched: 3, agents: 1 })
    expect(breach?.kind).toBe('wall_clock')
    expect(breach?.limit).toBe(45)
    expect(breach?.actual).toBe(60)
  })

  it('catches files touched', () => {
    expect(budgetBreach(BUDGETS, { elapsedMinutes: 1, filesTouched: 99, agents: 1 })?.kind).toBe(
      'files_touched'
    )
  })

  it('catches too many agents', () => {
    expect(budgetBreach(BUDGETS, { elapsedMinutes: 1, filesTouched: 1, agents: 9 })?.kind).toBe(
      'agents'
    )
  })

  it('does not fire exactly at the limit — the budget is what is allowed', () => {
    expect(budgetBreach(BUDGETS, { elapsedMinutes: 45, filesTouched: 25, agents: 2 })).toBeNull()
  })
})
