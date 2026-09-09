import { describe, it, expect } from 'vitest'
import {
  buildRunGraph,
  nodeById,
  withNode,
  stepFor,
  nodeLabel,
  nodeLabels,
  wantsFreshContext,
} from '../../src/line/run-graph.js'
import type { RunNode } from '../../src/line/run-graph.js'
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

function recipe(text = BUGFIX, file = 'bugfix.yaml'): Recipe {
  const parsed = parseRecipe(text, file)
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
    expect(node?.unitIds).toEqual(['U-1'])
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

// Fanning out `by lane`.
//
// A fan-out exists to run work at the same time. Units in one lane share one
// worktree and one branch, so they cannot run at the same time — fanning out
// over them spends a cold session each on work that is serial anyway.
// Measured on WO-0907-3c1: seven units, one lane, seven sessions.
const BY_LANE = `
schemaVersion: 1
id: bylane
steps:
  - id: build
    kind: fanout
    over: plan.units[role=builder] by lane
    step: { kind: agent, role: builder }
  - id: verify
    kind: agent
    role: verifier
    context: fresh
    after: [build]
`

function laneOrder(units: WorkOrder['plan']['units'], lanes = [1]): WorkOrder {
  const base = order()
  return {
    ...base,
    plan: {
      ...base.plan,
      units,
      lanes: lanes.map((ord) => ({
        ord,
        repo: `repo-${ord}`,
        branch: '',
        role: null,
        blocks: [],
        blockedBy: [],
      })),
    },
  }
}

function unit(
  id: string,
  lane: number,
  dependsOn: string[] = [],
  role = 'builder'
): WorkOrder['plan']['units'][number] {
  return { id, title: id, role, lane, dependsOn, satisfies: ['AC-1'], touches: [], verify: [] }
}

describe('a fan-out by lane', () => {
  it('makes one node for seven units that share a lane', () => {
    const o = laneOrder([
      unit('U-1', 1),
      unit('U-2', 1, ['U-1']),
      unit('U-3', 1, ['U-1']),
      unit('U-4', 1, ['U-1']),
      unit('U-5', 1),
      unit('U-6', 1, ['U-1', 'U-2', 'U-3', 'U-5']),
      unit('U-7', 1, ['U-1', 'U-2']),
    ])
    const graph = buildRunGraph(o, recipe(BY_LANE, 'bylane.yaml'))
    const built = graph.nodes.filter((n) => n.stepId === 'build')
    expect(built.map((n) => n.id)).toEqual(['build:lane-1'])
  })

  it('still runs one node per lane, so separate repositories stay parallel', () => {
    const o = laneOrder([unit('U-1', 1), unit('U-2', 2), unit('U-3', 3), unit('U-4', 3)], [1, 2, 3])
    const graph = buildRunGraph(o, recipe(BY_LANE, 'bylane.yaml'))
    expect(graph.nodes.filter((n) => n.stepId === 'build').map((n) => n.id)).toEqual([
      'build:lane-1',
      'build:lane-2',
      'build:lane-3',
    ])
  })

  it('carries every unit it covers, in dependency order', () => {
    const o = laneOrder([unit('U-3', 1, ['U-1']), unit('U-1', 1), unit('U-2', 1, ['U-1'])])
    const graph = buildRunGraph(o, recipe(BY_LANE, 'bylane.yaml'))
    expect(nodeById(graph, 'build:lane-1')?.unitIds).toEqual(['U-1', 'U-3', 'U-2'])
  })

  it("honours the filter, so a scribe unit is not the builder lane node's work", () => {
    const o = laneOrder([unit('U-1', 1), unit('U-2', 1, [], 'scribe')])
    const graph = buildRunGraph(o, recipe(BY_LANE, 'bylane.yaml'))
    expect(nodeById(graph, 'build:lane-1')?.unitIds).toEqual(['U-1'])
  })

  it('waits on the lane that holds a unit it depends on', () => {
    const o = laneOrder([unit('U-1', 1), unit('U-2', 2, ['U-1'])], [1, 2])
    const graph = buildRunGraph(o, recipe(BY_LANE, 'bylane.yaml'))
    expect(nodeById(graph, 'build:lane-2')?.dependsOn).toContain('build:lane-1')
  })

  it("never waits on itself, because a lane's own order is the node's own work", () => {
    const o = laneOrder([unit('U-1', 1), unit('U-2', 1, ['U-1'])])
    const graph = buildRunGraph(o, recipe(BY_LANE, 'bylane.yaml'))
    expect(nodeById(graph, 'build:lane-1')?.dependsOn).not.toContain('build:lane-1')
  })

  it('makes a later step wait on every lane', () => {
    const o = laneOrder([unit('U-1', 1), unit('U-2', 2)], [1, 2])
    const graph = buildRunGraph(o, recipe(BY_LANE, 'bylane.yaml'))
    expect(nodeById(graph, 'verify')?.dependsOn).toEqual(['build:lane-1', 'build:lane-2'])
  })

  it('produces nothing when the filter selects nothing', () => {
    const o = laneOrder([unit('U-1', 1, [], 'scribe')])
    const graph = buildRunGraph(o, recipe(BY_LANE, 'bylane.yaml'))
    expect(graph.nodes.filter((n) => n.stepId === 'build')).toEqual([])
  })

  // A cycle is a plan the compile gate should have refused. The graph is not
  // the place to discover it: refusing to build one means a run that cannot
  // start at all, so the units that cannot be ordered keep the order the plan
  // gave them.
  it('keeps plan order for units that depend on each other, rather than refusing to build', () => {
    const o = laneOrder([unit('U-1', 1, ['U-2']), unit('U-2', 1, ['U-1'])])
    const graph = buildRunGraph(o, recipe(BY_LANE, 'bylane.yaml'))
    expect(nodeById(graph, 'build:lane-1')?.unitIds).toEqual(['U-1', 'U-2'])
  })

  it('orders what it can and keeps the rest, when only some of them cycle', () => {
    const o = laneOrder([
      unit('U-3', 1, ['U-1']),
      unit('U-1', 1),
      unit('U-4', 1, ['U-5']),
      unit('U-5', 1, ['U-4']),
    ])
    const graph = buildRunGraph(o, recipe(BY_LANE, 'bylane.yaml'))
    expect(nodeById(graph, 'build:lane-1')?.unitIds).toEqual(['U-1', 'U-3', 'U-4', 'U-5'])
  })

  it('ignores a dependency on a unit no node in this fan-out carries', () => {
    const o = laneOrder([unit('U-1', 1, ['U-99'])])
    const graph = buildRunGraph(o, recipe(BY_LANE, 'bylane.yaml'))
    expect(nodeById(graph, 'build:lane-1')?.dependsOn).toEqual([])
  })

  it('names a lane node after its lane and the work, not after one unit', () => {
    const o = laneOrder([unit('U-1', 1), unit('U-2', 1, ['U-1'])])
    const graph = buildRunGraph(o, recipe(BY_LANE, 'bylane.yaml'))
    const node = nodeById(graph, 'build:lane-1')
    expect(node).toBeDefined()
    expect(nodeLabel(o, node as RunNode)).toBe('builder · 2 units in repo-1')
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

// `n2` is the handle the graph and the ledger use. Putting it in front of an
// operator watching a run tells them which array slot the work came from and
// nothing about what is being built — which is the whole point of the surface.
describe('what to call a node', () => {
  const node = (over: Partial<RunNode> & Pick<RunNode, 'id'>): RunNode => ({
    stepId: 'build',
    kind: 'agent',
    state: 'waiting',
    unitIds: [],
    lane: null,
    role: null,
    dependsOn: [],
    attempts: 0,
    sessionId: null,
    worktreePath: null,
    startedAt: null,
    endedAt: null,
    ...over,
  })

  const withUnit = (): WorkOrder => {
    const base = order()
    return {
      ...base,
      plan: {
        ...base.plan,
        units: [
          {
            id: 'U-1',
            title: 'refresh the token on a 401',
            role: 'builder',
            lane: 1,
            dependsOn: [],
            satisfies: [],
            touches: [],
            verify: [],
          },
        ],
      },
    }
  }

  it("uses the unit's own title, which is what the operator asked for", () => {
    expect(nodeLabel(withUnit(), node({ id: 'n2', unitIds: ['U-1'], role: 'builder' }))).toBe(
      'builder · U-1 refresh the token on a 401'
    )
  })

  it('names the unit without a role when the node has none', () => {
    expect(nodeLabel(withUnit(), node({ id: 'n2', unitIds: ['U-1'] }))).toBe(
      'U-1 refresh the token on a 401'
    )
  })

  it('falls back to the role for a node that is not about one unit', () => {
    expect(nodeLabel(withUnit(), node({ id: 'n1', role: 'architect' }))).toBe('architect')
  })

  it('falls back to the step for a gate, which has neither', () => {
    expect(nodeLabel(withUnit(), node({ id: 'n4', stepId: 'ship', kind: 'gate' }))).toBe('ship')
  })

  it('falls back to the id only when there is nothing else at all', () => {
    expect(nodeLabel(null, node({ id: 'n9', stepId: '' }))).toBe('n9')
  })

  it('names a unit the order no longer has by its role rather than inventing one', () => {
    expect(nodeLabel(order(), node({ id: 'n2', unitIds: ['U-gone'], role: 'builder' }))).toBe(
      'builder'
    )
  })

  it('labels every node in the graph, keyed by the id the ledger uses', () => {
    const graph = {
      orderId: 'WO-1',
      recipe: 'direct',
      nodes: [node({ id: 'n1', role: 'architect' }), node({ id: 'n2', unitIds: ['U-1'] })],
    }
    expect(nodeLabels(withUnit(), graph)).toEqual({
      n1: 'architect',
      n2: 'U-1 refresh the token on a 401',
    })
  })
})

describe('a step that asks for a fresh conversation', () => {
  const OUTER = `
schemaVersion: 1
id: bugfix
steps:
  - id: verify
    kind: agent
    role: verifier
    context: fresh
`
  const INNER = `
schemaVersion: 1
id: bugfix
steps:
  - id: verify
    kind: fanout
    over: plan.units
    step: { kind: agent, role: verifier, context: fresh }
`
  const NEITHER = `
schemaVersion: 1
id: bugfix
steps:
  - id: build
    kind: fanout
    over: plan.units
    step: { kind: agent, role: builder }
`

  function nodeOf(text: string) {
    const r = recipe(text)
    const o = order()
    return { recipe: r, node: buildRunGraph(o, r).nodes[0] }
  }

  it('reads it from the step itself', () => {
    const { recipe: r, node } = nodeOf(OUTER)
    expect(wantsFreshContext(r, node)).toBe(true)
  })

  it("reads it from a fan-out's inner step, which is where every built-in puts it", () => {
    const { recipe: r, node } = nodeOf(INNER)
    expect(wantsFreshContext(r, node)).toBe(true)
  })

  it('is false where nothing asked for one', () => {
    const { recipe: r, node } = nodeOf(NEITHER)
    expect(wantsFreshContext(r, node)).toBe(false)
  })
})
