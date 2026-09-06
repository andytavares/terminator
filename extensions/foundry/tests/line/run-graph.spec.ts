import { describe, it, expect } from 'vitest'
import { buildRunGraph, nodeById, withNode, stepFor } from '../../src/line/run-graph.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import type { Recipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

// The graph is derived, never authored. It is recomputable from the order and
// the recipe plus each node's state, which is what lets the order stay
// immutable while its work runs.

const BUGFIX = `
schemaVersion: 1
id: bugfix
steps:
  - id: reproduce
    kind: agent
    role: builder
  - id: build
    kind: fanout
    over: plan.units[role=builder]
    after: [reproduce]
    step: { kind: agent, role: builder }
  - id: inspect
    kind: agent
    role: inspector
    when: risk.triggers is not empty
    after: [build]
  - id: ship
    kind: gate
    rule: ready-for-review
    defaultIfIgnored: hold
    after: [inspect]
`

function recipe(text = BUGFIX): Recipe {
  const parsed = parseRecipe(text, 'bugfix.yaml')
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value
}

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    status: 'agreed',
    plan: {
      ...base.plan,
      units: [
        {
          id: 'U-1',
          title: 'a',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: [],
          verify: [],
        },
        {
          id: 'U-2',
          title: 'b',
          role: 'builder',
          lane: 1,
          dependsOn: ['U-1'],
          satisfies: ['AC-1'],
          touches: [],
          verify: [],
        },
        {
          id: 'U-3',
          title: 'c',
          role: 'scribe',
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

describe('buildRunGraph', () => {
  it('makes one node per plain step', () => {
    const graph = buildRunGraph(order(), recipe())
    expect(nodeById(graph, 'reproduce')?.kind).toBe('agent')
    expect(nodeById(graph, 'ship')?.kind).toBe('gate')
  })

  it('expands a fan-out into one node per selected unit', () => {
    const graph = buildRunGraph(order(), recipe())
    const built = graph.nodes.filter((n) => n.stepId === 'build').map((n) => n.id)
    expect(built).toEqual(['build:U-1', 'build:U-2'])
  })

  it('leaves out units the fan-out filter does not select', () => {
    const graph = buildRunGraph(order(), recipe())
    expect(nodeById(graph, 'build:U-3')).toBeUndefined()
  })

  it('carries the unit and its lane onto the node', () => {
    const graph = buildRunGraph(order(), recipe())
    const node = nodeById(graph, 'build:U-1')
    expect(node?.unitId).toBe('U-1')
    expect(node?.lane).toBe(1)
  })

  it("gives a fan-out child its parent's dependencies", () => {
    const graph = buildRunGraph(order(), recipe())
    expect(nodeById(graph, 'build:U-1')?.dependsOn).toContain('reproduce')
  })

  it("also gives it the unit's own dependencies, so depends_on means something", () => {
    const graph = buildRunGraph(order(), recipe())
    expect(nodeById(graph, 'build:U-2')?.dependsOn).toContain('build:U-1')
  })

  it('makes a later step wait on every node the fan-out produced', () => {
    const graph = buildRunGraph(order(), recipe())
    expect(nodeById(graph, 'inspect')?.dependsOn).toEqual(['build:U-1', 'build:U-2'])
  })

  it('starts every node waiting', () => {
    const graph = buildRunGraph(order(), recipe())
    expect(graph.nodes.filter((n) => n.state === 'waiting').length).toBeGreaterThan(0)
  })

  it('skips a step whose condition is false rather than dropping it', () => {
    const graph = buildRunGraph(order(), recipe())
    // No risk triggers on this order, so the inspector does not run — and the
    // record has to show that it did not, and why.
    expect(nodeById(graph, 'inspect')?.state).toBe('skipped')
  })

  it('runs the same step once the condition holds', () => {
    const o = order()
    o.risk.triggers = ['secrets']
    expect(nodeById(buildRunGraph(o, recipe()), 'inspect')?.state).toBe('waiting')
  })

  it('records which order and recipe it came from', () => {
    const graph = buildRunGraph(order(), recipe())
    expect(graph.orderId).toBe('WO-1')
    expect(graph.recipe).toBe('bugfix')
  })

  it('produces no fan-out nodes when nothing is selected', () => {
    const o = order({ plan: { ...order().plan, units: [] } })
    const graph = buildRunGraph(o, recipe())
    expect(graph.nodes.filter((n) => n.stepId === 'build')).toEqual([])
  })
})

describe('nodeById and withNode', () => {
  it('finds a node', () => {
    expect(nodeById(buildRunGraph(order(), recipe()), 'reproduce')?.stepId).toBe('reproduce')
  })

  it('is undefined for a node that is not there', () => {
    expect(nodeById(buildRunGraph(order(), recipe()), 'nope')).toBeUndefined()
  })

  it('replaces one node without touching the others', () => {
    const graph = buildRunGraph(order(), recipe())
    const next = withNode(graph, 'reproduce', { state: 'running' })
    expect(nodeById(next, 'reproduce')?.state).toBe('running')
    expect(nodeById(next, 'build:U-1')?.state).toBe('waiting')
  })

  it('does not mutate the graph it was given', () => {
    const graph = buildRunGraph(order(), recipe())
    withNode(graph, 'reproduce', { state: 'running' })
    expect(nodeById(graph, 'reproduce')?.state).toBe('waiting')
  })
})

describe('stepFor', () => {
  it('finds the recipe step a node came from, including a fan-out child', () => {
    const r = recipe()
    const graph = buildRunGraph(order(), r)
    const child = nodeById(graph, 'build:U-1')
    expect(child).toBeDefined()
    if (child !== undefined) expect(stepFor(r, child)?.id).toBe('build')
  })
})

describe('run-graph edge cases', () => {
  const MINIMAL = `
schemaVersion: 1
id: minimal
steps:
  - id: only
    kind: run
    command: make
`

  it('falls back to the unit own role when a fan-out names none', () => {
    const r = parseRecipe(
      `schemaVersion: 1\nid: f\nsteps:\n  - id: build\n    kind: fanout\n    over: plan.units\n    step: { kind: agent }\n`,
      'f.yaml'
    )
    if (!r.ok) throw new Error(r.reason)
    const graph = buildRunGraph(order(), r.value)
    expect(nodeById(graph, 'build:U-3')?.role).toBe('scribe')
  })

  it('selects nothing for a fan-out with no `over` at all', () => {
    const r = parseRecipe(
      `schemaVersion: 1\nid: f\nsteps:\n  - id: build\n    kind: fanout\n    over: nonsense\n    step: { kind: agent, role: builder }\n`,
      'f.yaml'
    )
    if (!r.ok) throw new Error(r.reason)
    expect(buildRunGraph(order(), r.value).nodes).toEqual([])
  })

  it('leaves a step with no role as having none, rather than inventing one', () => {
    const r = parseRecipe(MINIMAL, 'minimal.yaml')
    if (!r.ok) throw new Error(r.reason)
    expect(nodeById(buildRunGraph(order(), r.value), 'only')?.role).toBeNull()
  })

  it('gives a step with nothing to wait for an empty dependency list', () => {
    const r = parseRecipe(MINIMAL, 'minimal.yaml')
    if (!r.ok) throw new Error(r.reason)
    expect(nodeById(buildRunGraph(order(), r.value), 'only')?.dependsOn).toEqual([])
  })

  it('skips a fan-out entirely when its condition is false', () => {
    const r = parseRecipe(
      `schemaVersion: 1\nid: f\nsteps:\n  - id: build\n    kind: fanout\n    over: plan.units\n    when: risk.triggers is not empty\n    step: { kind: agent, role: builder }\n`,
      'f.yaml'
    )
    if (!r.ok) throw new Error(r.reason)
    const graph = buildRunGraph(order(), r.value)
    expect(graph.nodes.every((n) => n.state === 'skipped')).toBe(true)
  })

  it('starts every node with no session, no worktree and no attempts', () => {
    const r = parseRecipe(MINIMAL, 'minimal.yaml')
    if (!r.ok) throw new Error(r.reason)
    const node = nodeById(buildRunGraph(order(), r.value), 'only')
    expect(node?.sessionId).toBeNull()
    expect(node?.worktreePath).toBeNull()
    expect(node?.attempts).toBe(0)
    expect(node?.endedAt).toBeNull()
  })

  it('has no step for a node that is not from this recipe', () => {
    const r = parseRecipe(MINIMAL, 'minimal.yaml')
    if (!r.ok) throw new Error(r.reason)
    const graph = buildRunGraph(order(), r.value)
    const alien = { ...graph.nodes[0], stepId: 'elsewhere' }
    expect(stepFor(r.value, alien)).toBeUndefined()
  })
})
