import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRunGraph } from '../../src/line/run-graph.js'
import { proposeRecipe } from '../../src/ipc/run-channels.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import type { Recipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/schema.js'
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
      units: UNITS.map(({ id, dependsOn }) => ({
        id,
        title: id,
        role: 'builder',
        lane: 1,
        dependsOn,
        satisfies: ['AC-1'],
        touches: ['src/renderer/styles.css'],
        verify: [],
      })),
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

  it('is eight nodes end to end, where it was twenty-one', () => {
    const graph = buildRunGraph(allTextRed(), recipe('direct'))
    expect(graph.nodes.length).toBeLessThanOrEqual(8)
  })

  // The heavy shape still exists and is still heavy — what changed is that a
  // one-lane order is no longer sent to it, and that it no longer spends a
  // session per unit twice over when it is.
  it('would cost six sessions rather than eighteen even under the standard shape', () => {
    expect(agents(allTextRed(), 'standard')).toEqual([
      'scout',
      'challenge',
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
})
