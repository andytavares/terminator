import { describe, it, expect } from 'vitest'
import { builderUnit, testCriterion } from '../helpers/order-parts.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRunGraph } from '../../src/line/run-graph.js'
import { proposeRecipe } from '../../src/ipc/run-channels.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import type { Recipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'

// What one ask costs.
//
// WO-0907-3c1 was "Make all text in the application red", typed as one
// sentence. Intake produced twelve acceptance criteria and seven plan units,
// all seven in a single lane, and the `standard` shape turned that into a
// twenty-one node graph of which eighteen were separate `claude` sessions. At
// 113 minutes against a 105 minute budget it had started two builders and
// finished none.
//
// The numbers below are the ones out of that order's own `order.json` and
// `run-graph.json`: seven units, one lane, that dependency chain, P2 with
// `public_interface` and `critical_path`. Nothing here is invented, which is
// the point — this is the shape that has to stop costing what it cost.

const recipesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../recipes')

function recipe(name: string): Recipe {
  const file = `${name}.yaml`
  const parsed = parseRecipe(fs.readFileSync(path.join(recipesDir, file), 'utf8'), file)
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value
}

/** WO-0907-3c1's plan, as the architect wrote it. */
const UNITS: { id: string; dependsOn: string[] }[] = [
  { id: 'U-1', dependsOn: [] },
  { id: 'U-2', dependsOn: ['U-1'] },
  { id: 'U-3', dependsOn: ['U-1'] },
  { id: 'U-4', dependsOn: ['U-1'] },
  { id: 'U-5', dependsOn: [] },
  { id: 'U-6', dependsOn: ['U-1', 'U-2', 'U-3', 'U-5'] },
  { id: 'U-7', dependsOn: ['U-1', 'U-2'] },
]

function allTextRed(): WorkOrder {
  const base = draftOrder({
    id: 'WO-0907-3c1',
    title: 'Make all text in the application red',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/terminator'],
    now: '2026-09-07T13:59:23.330Z',
  })
  return {
    ...base,
    status: 'agreed',
    risk: {
      grade: 'P2',
      triggers: ['public_interface', 'critical_path'],
      blastRadius: ['src/'],
      criticalPaths: [],
    },
    plan: {
      ...base.plan,
      units: UNITS.map(({ id, dependsOn }) =>
        builderUnit(id, { dependsOn, satisfies: ['AC-1'], touches: ['src/renderer/styles.css'] })
      ),
      lanes: [{ ord: 1, repo: 'terminator', branch: 'red', role: null, blocks: [], blockedBy: [] }],
    },
  }
}

function agents(order: WorkOrder, name: string): string[] {
  return buildRunGraph(order, recipe(name))
    .nodes.filter((node) => node.kind === 'agent' || node.kind === 'fanout')
    .filter((node) => node.state !== 'skipped')
    .map((node) => node.id)
}

describe('the shape WO-0907-3c1 would get now', () => {
  describe('the proposed shape and its cost', theProposedShapeAndItsCostTests)
  describe('what it keeps', orderShapeWhatItKeepsTests)
  describe('nodes', orderShapeNodesTests)
  describe('the standard shape and the architect', theStandardShapeAndTheArchitectTests)
})

function theProposedShapeAndItsCostTests() {
  it('is proposed the direct shape, because one lane graded P2 is not the heaviest work there is', () => {
    const proposal = proposeRecipe(allTextRed())
    expect(proposal.name).toBe('direct')
    expect(proposal.why).toContain('public_interface')
  })

  it('costs four agent sessions, where it cost eighteen', () => {
    expect(agents(allTextRed(), 'direct')).toEqual([
      'build:lane-1',
      'verify',
      'inspect',
      'document',
    ])
  })

  it('builds it in one session rather than one per unit', () => {
    const build = buildRunGraph(allTextRed(), recipe('direct')).nodes.filter(
      (node) => node.stepId === 'build'
    )
    expect(build).toHaveLength(1)
    expect(build[0].unitIds).toHaveLength(UNITS.length)
  })
}

function orderShapeWhatItKeepsTests() {
  it('keeps every unit, because the plan is still what the builder is told to do', () => {
    const build = buildRunGraph(allTextRed(), recipe('direct')).nodes.find(
      (node) => node.stepId === 'build'
    )
    expect([...(build?.unitIds ?? [])].sort()).toEqual(UNITS.map((unit) => unit.id).sort())
  })

  it('still runs the inspector, because the triggers that fired are why it exists', () => {
    const inspect = buildRunGraph(allTextRed(), recipe('direct')).nodes.find(
      (node) => node.id === 'inspect'
    )
    expect(inspect?.state).toBe('waiting')
  })
}

function orderShapeNodesTests() {
  it('is eight nodes end to end, where it was twenty-one', () => {
    const graph = buildRunGraph(allTextRed(), recipe('direct'))
    expect(graph.nodes.length).toBeLessThanOrEqual(8)
  })

  // The lint step added after `build` is a `run` node, not a session — it
  // counts toward the graph above but not toward the agent-session totals in
  // this file, and with no lint command measured on this order it settles as
  // skipped rather than blocking `verify`.
  it('adds a lint node after build that is skipped, not a session, when no lint command is measured', () => {
    const graph = buildRunGraph(allTextRed(), recipe('direct'))
    const lint = graph.nodes.find((node) => node.id === 'lint')
    expect(lint?.kind).toBe('run')
    expect(lint?.state).toBe('skipped')
  })
}

function theStandardShapeAndTheArchitectTests() {
  // The heavy shape still exists and is still heavy — what changed is that a
  // one-lane order is no longer sent to it, and that it no longer spends a
  // session per unit twice over when it is.
  it('would cost four sessions rather than eighteen even under the standard shape', () => {
    // The Forge's scout already read the repository, so the Line has none.
    expect(agents(allTextRed(), 'standard')).toEqual([
      'build:lane-1',
      'verify',
      'inspect',
      'document',
    ])
  })

  it('does not re-run the architect over an order the compile gate already agreed', () => {
    for (const name of ['direct', 'standard']) {
      expect(agents(allTextRed(), name)).not.toContain('plan')
    }
  })
}

/** An agreed order with one unit in one lane, and `over` on top. */
function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/app'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    status: 'agreed',
    acceptance: [testCriterion('AC-1', { statement: 'a' })],
    plan: {
      ...base.plan,
      units: [builderUnit('U-1', { title: 'a', satisfies: ['AC-1'], touches: ['src/a'] })],
    },
    ...over,
  }
}

function unit(over: Partial<WorkOrder['plan']['units'][number]> = {}) {
  return {
    id: 'U-2',
    title: 'b',
    role: 'builder',
    lane: 1,
    dependsOn: [],
    satisfies: ['AC-1'],
    touches: [],
    verify: [],
    ...over,
  }
}
function graded(grade: WorkOrder['risk']['grade'], triggers: WorkOrder['risk']['triggers'] = []) {
  return order({ risk: { grade, triggers, blastRadius: [], criticalPaths: [] } })
}

// Choosing the shape: lanes first (only lanes run in parallel), then risk (the order's own word on
// who looks). Unit count decides nothing: seven units in one lane cost one session, so pricing the
// shape off them charged for parallelism that never existed.
describe('proposeRecipe', () => {
  describe('direct', directTests)
  describe('standard', standardTests)
})

function directTests() {
  it('keeps a shape the order already carries', () => {
    expect(proposeRecipe(order({ recipe: 'research' }))).toEqual({
      name: 'research',
      why: 'the order already names this shape',
    })
  })

  it('proposes the direct shape for one lane at the lowest risk', () => {
    const proposal = proposeRecipe(graded('P3'))
    expect(proposal.name).toBe('direct')
    expect(proposal.why).toBe('one lane, graded low risk')
  })

  it('still proposes it when that lane holds several units', () => {
    const o = graded('P3')
    o.plan.units.push(unit(), unit({ id: 'U-3' }), unit({ id: 'U-4' }))
    expect(proposeRecipe(o).name).toBe('direct')
  })

  it('proposes direct for an order graded notable', () => {
    const proposal = proposeRecipe(graded('P2'))
    expect(proposal.name).toBe('direct')
    expect(proposal.why).toContain('ordinary risk')
  })

  it('proposes direct, naming the trigger, when one fired at the lowest grade', () => {
    const proposal = proposeRecipe(graded('P3', ['public_interface']))
    expect(proposal.name).toBe('direct')
    expect(proposal.why).toContain('public_interface')
  })
}

function standardTests() {
  it('proposes the standard shape once there is more than one lane', () => {
    const o = graded('P3')
    o.plan.units.push(unit({ lane: 2 }))
    o.plan.lanes = [
      { ord: 1, repo: 'a', branch: '', role: null, blocks: [], blockedBy: [] },
      { ord: 2, repo: 'b', branch: '', role: null, blocks: [], blockedBy: [] },
    ]
    const proposal = proposeRecipe(o)
    expect(proposal.name).toBe('standard')
    expect(proposal.why).toBe('2 lanes of work')
  })

  it('proposes the standard shape for anything above the lowest two grades', () => {
    const proposal = proposeRecipe(graded('P1'))
    expect(proposal.name).toBe('standard')
    expect(proposal.why).toContain("above the direct shape's ceiling")
  })
}
