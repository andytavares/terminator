import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { executePlan as execute } from '../../src/line/executor.js'
import type { ExecutorDeps, RunPlan, StartedRun } from '../../src/line/executor.js'
import { buildRunGraph } from '../../src/line/run-graph.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/draft.js'
import { testCriterion } from '../helpers/order-parts.js'
import { idleExecutorSeams } from './idle-executor-seams.js'
import { makeTempDir } from '../../../../tests/support/temp-dir'
import { eventually } from '../../../../tests/support/eventually'

// The scheduler starts a node the moment a slot frees, not when the whole wave ends.

const builtInDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const CHECKED = `
schemaVersion: 1
id: direct
steps:
  - id: build
    kind: fanout
    over: plan.units
    step: { kind: agent, role: builder }
`

let dataRoot: string
let repo: string

beforeEach(() => {
  dataRoot = makeTempDir('fdry-waves-')
  repo = makeTempDir('fdry-waves-repo-')
})

afterEach(() => {
  for (const d of [dataRoot, repo]) fs.rmSync(d, { recursive: true, force: true })
})

function unit(id: string, lane: number, dependsOn: string[] = []) {
  return {
    id,
    title: id,
    role: 'builder',
    lane,
    dependsOn,
    satisfies: ['AC-1'],
    touches: [`src/${id}.ts`],
    verify: [],
  }
}

function planOfTwoLanes(): RunPlan {
  const parsed = parseRecipe(CHECKED, 'direct.yaml')
  if (!parsed.ok) throw new Error(parsed.reason)
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [repo],
    now: '2026-09-06T10:00:00.000Z',
  })
  const order = {
    ...base,
    status: 'agreed' as const,
    acceptance: [testCriterion('AC-1', { statement: 'a' })],
    plan: { ...base.plan, units: [unit('U-1', 1), unit('U-2', 2), unit('U-3', 3, ['U-1'])] },
    budgets: { agents: 3, wallClockMinutes: 45, tokens: null },
  }
  return { order, recipe: parsed.value, graph: buildRunGraph(order, parsed.value) }
}

describe('a node starts when its slot frees', () => {
  it('starts the unit waiting on the fast lane while the slow lane still runs', async () => {
    const releases = new Map<string, () => void>()
    const started: string[] = []
    const run = async (input: Parameters<ExecutorDeps['run']>[0]): Promise<StartedRun> => {
      const label = input.node.id
      started.push(label)
      await new Promise<void>((resolve) => releases.set(label, resolve))
      return { sessionId: `s-${label}`, exitCode: 0 }
    }
    const executing = execute(planOfTwoLanes(), {
      ...idleExecutorSeams(),
      run,
      runCommand: async () => 0,
      collect: async () => null,
      now: () => '2026-09-06T11:00:00.000Z',
      sources: { dataRoot, repoPaths: [repo], builtInDir },
      onEvent: () => undefined,
    })
    await eventually(() => expect(releases.size).toBe(2))
    releases.get('build:U-1')?.()
    await eventually(() => expect(releases.has('build:U-3')).toBe(true))
    releases.forEach((release) => release())
    await executing
  })
})
