import { describe, it, expect } from 'vitest'
import { orphanedNodes, reclaim, IN_FLIGHT } from '../../src/line/reclaim.js'
import { buildRunGraph, withNode, nodeById } from '../../src/line/run-graph.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { RunGraph } from '../../src/line/run-graph.js'

// An agent's terminal is a child of the application, so quitting kills every
// one of them — and the graph on disk goes on saying `running`. These are the
// cases that made a reopened run look like a working one for ever.

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

function unit(id: string) {
  return {
    id,
    title: id,
    role: 'builder',
    lane: 1,
    dependsOn: [] as string[],
    satisfies: ['AC-1'],
    touches: [],
    verify: [],
  }
}

function graph(units = [unit('U-1'), unit('U-2')]): RunGraph {
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

/** Nothing this process is running — every session from a previous one. */
const nothingLive = (): boolean => false
const everythingLive = (): boolean => true

describe('orphanedNodes', () => {
  it('names an in-flight node whose agent is gone', () => {
    const g = withNode(graph(), 'build:U-1', { state: 'running', sessionId: 's1' })
    expect(orphanedNodes(g, nothingLive).map((n) => n.id)).toEqual(['build:U-1'])
  })

  it('covers verifying as well as running, because both occupy an agent', () => {
    const g = withNode(graph(), 'build:U-1', { state: 'verifying', sessionId: 's1' })
    expect(orphanedNodes(g, nothingLive).map((n) => n.id)).toEqual(['build:U-1'])
    expect(IN_FLIGHT).toContain('verifying')
  })

  it('leaves an in-flight node whose agent is still in its terminal alone', () => {
    const g = withNode(graph(), 'build:U-1', { state: 'running', sessionId: 's1' })
    expect(orphanedNodes(g, everythingLive)).toEqual([])
  })

  it('treats a node that never got a session as orphaned — nothing can be running it', () => {
    const g = withNode(graph(), 'build:U-1', { state: 'running', sessionId: null })
    expect(orphanedNodes(g, everythingLive).map((n) => n.id)).toEqual(['build:U-1'])
  })

  it('never names a node that is not in flight', () => {
    let g = withNode(graph(), 'build:U-1', { state: 'passed', sessionId: 's1' })
    g = withNode(g, 'build:U-2', { state: 'failed', sessionId: 's2' })
    expect(orphanedNodes(g, nothingLive)).toEqual([])
  })
})

describe('reclaim', () => {
  it('puts an orphaned node back where the scheduler can offer it again', () => {
    const g = withNode(graph(), 'build:U-1', { state: 'running', sessionId: 's1', attempts: 1 })
    const out = reclaim(g, nothingLive)
    expect(out.reclaimed).toEqual(['build:U-1'])
    expect(nodeById(out.graph, 'build:U-1')?.state).toBe('waiting')
  })

  it('gives the attempt back, because an interrupted attempt is not a failed one', () => {
    const g = withNode(graph(), 'build:U-1', { state: 'running', sessionId: 's1', attempts: 1 })
    expect(nodeById(reclaim(g, nothingLive).graph, 'build:U-1')?.attempts).toBe(0)
  })

  it('never takes the attempt count below zero', () => {
    const g = withNode(graph(), 'build:U-1', { state: 'running', sessionId: 's1', attempts: 0 })
    expect(nodeById(reclaim(g, nothingLive).graph, 'build:U-1')?.attempts).toBe(0)
  })

  it('keeps the session id, so the resumed node continues its own conversation', () => {
    const g = withNode(graph(), 'build:U-1', { state: 'running', sessionId: 's1' })
    expect(nodeById(reclaim(g, nothingLive).graph, 'build:U-1')?.sessionId).toBe('s1')
  })

  it('clears the end mark, which a waiting node has not reached', () => {
    const g = withNode(graph(), 'build:U-1', {
      state: 'running',
      sessionId: 's1',
      endedAt: '2026-09-06T11:00:00.000Z',
    })
    expect(nodeById(reclaim(g, nothingLive).graph, 'build:U-1')?.endedAt).toBeNull()
  })

  it('unblocks what the orphaned node was holding up', () => {
    let g = withNode(graph([unit('U-1')]), 'build:U-1', { state: 'running', sessionId: 's1' })
    g = withNode(g, 'integrate', { state: 'blocked' })
    expect(nodeById(reclaim(g, nothingLive).graph, 'integrate')?.state).toBe('waiting')
  })

  it('changes nothing when every agent is still in its terminal', () => {
    const g = withNode(graph(), 'build:U-1', { state: 'running', sessionId: 's1' })
    const out = reclaim(g, everythingLive)
    expect(out.reclaimed).toEqual([])
    expect(out.graph).toBe(g)
  })

  it('changes nothing on a graph with nothing in flight', () => {
    const g = graph()
    const out = reclaim(g, nothingLive)
    expect(out.reclaimed).toEqual([])
    expect(out.graph).toBe(g)
  })

  it('reclaims every orphan at once, not one per pass', () => {
    let g = withNode(graph(), 'build:U-1', { state: 'running', sessionId: 's1' })
    g = withNode(g, 'build:U-2', { state: 'verifying', sessionId: 's2' })
    expect(reclaim(g, nothingLive).reclaimed).toEqual(['build:U-1', 'build:U-2'])
  })
})
