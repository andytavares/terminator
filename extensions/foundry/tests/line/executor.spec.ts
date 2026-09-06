import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execute, readOnlyDecision } from '../../src/line/executor.js'
import type { ExecutorEvent, StartedRun } from '../../src/line/executor.js'
import { buildRunGraph } from '../../src/line/run-graph.js'
import { retry } from '../../src/line/scheduler.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import type { Recipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { ResumeForbiddenError, createRoleRegistry } from '../../src/line/roles.js'

// The executor is where the scheduler, the roles and a session finally meet.
// Each of those was testable alone and none of them did anything on its own,
// so this is the first place a run actually happens — and the first place the
// enforcement is real rather than described.

const builtInDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

let dataRoot: string
let repo: string

const RECIPE = `
schemaVersion: 1
id: direct
steps:
  - id: build
    kind: fanout
    over: plan.units
    step: { kind: agent, role: builder }
  - id: ship
    kind: gate
    rule: ready-for-review
    defaultIfIgnored: hold
    after: [build]
`

function recipe(text = RECIPE): Recipe {
  const parsed = parseRecipe(text, 'direct.yaml')
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value
}

function unit(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: id,
    role: 'builder',
    lane: 1,
    dependsOn: [],
    satisfies: ['AC-1'],
    touches: [`src/${id}.ts`],
    verify: [],
    ...over,
  }
}

function order(units = [unit('U-1'), unit('U-2')], over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [repo],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    status: 'agreed',
    acceptance: [
      {
        id: 'AC-1',
        statement: 'a',
        priority: 'P1',
        verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
        unverifiable: null,
      },
    ],
    plan: { ...base.plan, units },
    ...over,
  }
}

function deps(
  run: (input: Parameters<Parameters<typeof execute>[3]['run']>[0]) => Promise<StartedRun>,
  events: ExecutorEvent[] = []
) {
  return {
    run,
    now: () => '2026-09-06T11:00:00.000Z',
    sources: { dataRoot, repoPaths: [repo], builtInDir },
    onEvent: (e: ExecutorEvent) => events.push(e),
  }
}

const ok = async (input: { node: { id: string } }): Promise<StartedRun> => ({
  sessionId: `sess-${input.node.id}`,
  exitCode: 0,
})

beforeEach(() => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-exec-'))
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-exec-repo-'))
})

afterEach(() => {
  for (const d of [dataRoot, repo]) {
    fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

describe('execute', () => {
  it('runs every unit that can run', async () => {
    const run = vi.fn(ok)
    const o = order()
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), deps(run))
    // Two units. The third passed node is the recipe's own checkpoint, which
    // is raised rather than run — nothing was launched for it.
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls.every((c) => c[0].node.kind !== 'gate')).toBe(true)
    expect(outcome.graph.nodes.filter((n) => n.state === 'passed')).toHaveLength(3)
  })

  it('honours the agent budget rather than starting everything at once', async () => {
    let peak = 0
    let live = 0
    const run = vi.fn(async (input: { node: { id: string } }) => {
      live += 1
      peak = Math.max(peak, live)
      await new Promise((r) => setTimeout(r, 5))
      live -= 1
      return { sessionId: `s-${input.node.id}`, exitCode: 0 }
    })
    const o = order([unit('U-1'), unit('U-2'), unit('U-3'), unit('U-4')], {
      budgets: { agents: 2, wallClockMinutes: 45, filesTouched: 25, tokens: null },
    })
    await execute(o, recipe(), buildRunGraph(o, recipe()), deps(run))
    expect(peak).toBeLessThanOrEqual(2)
    expect(run).toHaveBeenCalledTimes(4)
  })

  it('never hands a role a session to resume', async () => {
    const run = vi.fn(ok)
    const o = order()
    await execute(o, recipe(), buildRunGraph(o, recipe()), deps(run))
    for (const call of run.mock.calls) {
      expect(call[0].resumeSessionId).toBeUndefined()
    }
  })

  it('marks a read-only role read-only, so the hook can refuse its writes', async () => {
    const run = vi.fn(ok)
    const verifying = RECIPE.replace('role: builder', 'role: verifier')
    const o = order()
    await execute(o, recipe(verifying), buildRunGraph(o, recipe(verifying)), deps(run))
    expect(run.mock.calls.every((c) => c[0].readOnly)).toBe(true)
  })

  it('does not mark a builder read-only — it is the one role that writes', async () => {
    const run = vi.fn(ok)
    const o = order()
    await execute(o, recipe(), buildRunGraph(o, recipe()), deps(run))
    expect(run.mock.calls.every((c) => c[0].readOnly)).toBe(false)
  })

  it('gives each run the role prompt rather than an empty instruction', async () => {
    const run = vi.fn(ok)
    const o = order()
    await execute(o, recipe(), buildRunGraph(o, recipe()), deps(run))
    expect(run.mock.calls[0][0].prompt).toContain('Build one unit')
  })

  it('takes the verdict from the exit status', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(
      o,
      recipe(),
      buildRunGraph(o, recipe()),
      deps(async (i) => ({ sessionId: `s-${i.node.id}`, exitCode: 1 }))
    )
    expect(outcome.verdicts[0].result).toBe('fail')
  })

  it('never lets the working session produce its own verdict', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), deps(ok))
    for (const verdict of outcome.verdicts) {
      expect(verdict.producedBy.sessionId).not.toBe('sess-build:U-1')
    }
  })

  it('reports a run with no exit status as not measured, not as a failure', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(
      o,
      recipe(),
      buildRunGraph(o, recipe()),
      deps(async (i) => ({ sessionId: `s-${i.node.id}`, exitCode: null }))
    )
    expect(outcome.verdicts[0].result).toBe('not_measured')
  })

  it('blocks what a failure stopped rather than leaving it waiting', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(
      o,
      recipe(),
      buildRunGraph(o, recipe()),
      deps(async (i) => ({ sessionId: `s-${i.node.id}`, exitCode: 1 }))
    )
    expect(outcome.graph.nodes.find((n) => n.id === 'ship')?.state).toBe('blocked')
    expect(outcome.complete).toBe(false)
  })

  it('raises a gate rather than answering it, and stops', async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), deps(run))

    // Never launched as work, and never silently stepped over: the run halts
    // and the operator is asked.
    expect(run.mock.calls.every((c) => c[0].node.kind !== 'gate')).toBe(true)
    expect(outcome.gates.map((g) => g.rule)).toContain('unit.boundary')
    expect(outcome.shippable).toBe(false)
  })

  it('does not stop at a checkpoint the autonomy setting silences', async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(run),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.gates.map((g) => g.rule)).not.toContain('unit.boundary')
    expect(outcome.complete).toBe(true)
  })

  it('reports the nodes whose next attempt must be a decision', async () => {
    const o = order([unit('U-1')])
    const failing = deps(async (i) => ({ sessionId: `s-${i.node.id}`, exitCode: 1 }))
    let graph = buildRunGraph(o, recipe())
    graph = (await execute(o, recipe(), graph, failing)).graph
    // Put it back in the queue as a decision would, then fail it again.
    graph = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === 'build:U-1' ? { ...n, state: 'waiting' as const } : n
      ),
    }
    const second = await execute(o, recipe(), graph, failing)
    expect(second.awaitingDecision).toContain('build:U-1')
  })

  it('reports every event a surface needs to follow along', async () => {
    const events: ExecutorEvent[] = []
    const o = order([unit('U-1')])
    await execute(o, recipe(), buildRunGraph(o, recipe()), deps(ok, events))
    const kinds = events.map((e) => e.type)
    expect(kinds).toContain('started')
    expect(kinds).toContain('verdict')
    expect(kinds).toContain('passed')
    expect(kinds).toContain('inspection')
  })

  it('inspects the accumulated change, not one unit, and says when it did not', async () => {
    const events: ExecutorEvent[] = []
    const o = order([unit('U-1')])
    await execute(o, recipe(), buildRunGraph(o, recipe()), deps(ok, events))
    const inspection = events.find((e) => e.type === 'inspection')
    expect(inspection).toMatchObject({ required: false })
  })

  it('requires an inspection once the change touches something that warrants one', async () => {
    const events: ExecutorEvent[] = []
    const o = order([unit('U-1', { touches: ['src/auth/session.ts'] })])
    await execute(o, recipe(), buildRunGraph(o, recipe()), deps(ok, events))
    const inspection = events.find((e) => e.type === 'inspection')
    expect(inspection).toMatchObject({ required: true })
  })

  it('does nothing at all with a graph that has nothing runnable', async () => {
    const run = vi.fn(ok)
    const o = order([])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), deps(run))
    expect(run).not.toHaveBeenCalled()
    expect(outcome.verdicts).toEqual([])
  })
})

describe('readOnlyDecision', () => {
  it('lets a read-only role read', () => {
    expect(readOnlyDecision('Read', {}).allow).toBe(true)
  })

  it('refuses a write', () => {
    const decision = readOnlyDecision('Write', { file_path: '/x' })
    expect(decision.allow).toBe(false)
    expect(decision.reason).toMatch(/may only read/)
  })

  it('refuses a tool it has never been taught about, rather than vouching for it', () => {
    expect(readOnlyDecision('SomeNewTool', {}).allow).toBe(false)
  })
})

describe('the resume rule', () => {
  it('is enforced by refusing, not by asking', () => {
    const roles = createRoleRegistry({ dataRoot, repoPaths: [repo], builtInDir })
    expect(() => roles.assertResumable('verifier', 'sess-1')).toThrow(ResumeForbiddenError)
  })
})

describe('executor edge cases', () => {
  it('runs a plain shell step with its command as the prompt', async () => {
    const run = vi.fn(ok)
    const shell = `
schemaVersion: 1
id: direct
steps:
  - id: check
    kind: run
    command: npm test
`
    const o = order([])
    await execute(o, recipe(shell), buildRunGraph(o, recipe(shell)), deps(run))
    // The command, and an instruction not to reinterpret it. A bare command
    // handed to an agent is an invitation to fix what it reports.
    expect(run.mock.calls[0][0].prompt).toContain('npm test')
    expect(run.mock.calls[0][0].prompt).toContain('Do not fix what it reports')
  })

  it('never launches an agent for a join, which is coordination and not work', async () => {
    const run = vi.fn(ok)
    const nameless = `
schemaVersion: 1
id: direct
steps:
  - id: join
    kind: join
    order: lane.ord
`
    const o = order([])
    const outcome = await execute(o, recipe(nameless), buildRunGraph(o, recipe(nameless)), {
      ...deps(run),
      runStep: async () => 0,
    })
    expect(run).not.toHaveBeenCalled()
    expect(outcome.graph.nodes.find((n) => n.id === 'join')?.state).toBe('passed')
  })

  it('produces no verdict for a step that is not about a unit', async () => {
    const shell = `
schemaVersion: 1
id: direct
steps:
  - id: check
    kind: run
    command: npm test
`
    const o = order([])
    const outcome = await execute(o, recipe(shell), buildRunGraph(o, recipe(shell)), deps(ok))
    expect(outcome.verdicts).toEqual([])
  })

  it('reports the run complete when every node passed', async () => {
    const shell = `
schemaVersion: 1
id: direct
steps:
  - id: check
    kind: run
    command: npm test
`
    const o = order([])
    const outcome = await execute(o, recipe(shell), buildRunGraph(o, recipe(shell)), deps(ok))
    expect(outcome.complete).toBe(true)
  })

  it('works with no event listener at all', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      run: ok,
      now: () => 'now',
      sources: { dataRoot, repoPaths: [repo], builtInDir },
    })
    expect(outcome.graph.nodes.some((n) => n.state === 'passed')).toBe(true)
  })

  it('writes a verdict per criterion the unit claims', async () => {
    const o = order([unit('U-1', { satisfies: ['AC-1', 'AC-2'] })], {
      acceptance: [
        {
          id: 'AC-1',
          statement: 'a',
          priority: 'P1',
          verify: { kind: 'test', command: 'x', assert: 'exit_code == 0' },
          unverifiable: null,
        },
        {
          id: 'AC-2',
          statement: 'b',
          priority: 'P1',
          verify: { kind: 'test', command: 'x', assert: 'exit_code == 0' },
          unverifiable: null,
        },
      ],
    })
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), deps(ok))
    expect(outcome.verdicts.map((v) => v.criterionId).sort()).toEqual(['AC-1', 'AC-2'])
  })
})

describe('what the agent is actually told', () => {
  it('carries the order, not just the role prompt', async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1')], {
      title: 'Refuse an expired refresh token',
      intent: { problem: 'expired tokens are accepted', outcome: 'they are refused', nonGoals: [] },
    })
    await execute(o, recipe(), buildRunGraph(o, recipe()), deps(run))

    const prompt = run.mock.calls[0][0].prompt
    expect(prompt).toContain('Build one unit') // the role's own words
    expect(prompt).toContain('Refuse an expired refresh token')
    expect(prompt).toContain('expired tokens are accepted')
  })

  it('names the unit, what it may touch, and what makes it done', async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1')])
    await execute(o, recipe(), buildRunGraph(o, recipe()), deps(run))

    const prompt = run.mock.calls[0][0].prompt
    expect(prompt).toContain('U-1')
    expect(prompt).toContain('src/U-1.ts')
    expect(prompt).toContain('AC-1')
  })

  it('carries the house rules it was given', async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1')])
    await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(run),
      rules: [
        {
          schemaVersion: 1,
          id: 'no-stubs',
          scope: 'universal',
          rung: 'L3',
          asserts: 'No TODO and no function that throws instead of doing the thing.',
          appliesWhen: 'always',
          origin: 'built-in',
        },
      ],
    })
    expect(run.mock.calls[0][0].prompt).toContain('no-stubs')
  })
})

describe('the budget is part of the agreement', () => {
  it('stops and asks rather than running past a wall-clock breach', async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1'), unit('U-2')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(run),
      observe: () => ({ elapsedMinutes: 10_000, filesTouched: 0 }),
    })

    expect(run).not.toHaveBeenCalled()
    expect(outcome.gates.map((g) => g.rule)).toContain('budget.exceeded')
    expect(outcome.gates[0].why).toContain('10000')
    expect(outcome.shippable).toBe(false)
  })

  it('says which budget, in the operator own terms', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      observe: () => ({ elapsedMinutes: 0, filesTouched: 10_000 }),
    })
    expect(outcome.gates[0].summary).toContain('files touched')
  })

  it('runs normally when it is inside them', async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1')])
    await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(run),
      observe: () => ({ elapsedMinutes: 1, filesTouched: 1 }),
    })
    expect(run).toHaveBeenCalled()
  })
})

describe('a repeated failure becomes a decision', () => {
  it('raises a gate on the second failure rather than trying a third time', async () => {
    const o = order([unit('U-1')])
    const failing = deps(async (i) => ({ sessionId: `s-${i.node.id}`, exitCode: 1 }))

    let graph = buildRunGraph(o, recipe())
    graph = (await execute(o, recipe(), graph, failing)).graph
    // Retried deliberately, as the operator's "send back" does: the scheduler
    // does not re-offer a failed node on its own.
    graph = retry(graph, 'build:U-1')
    const second = await execute(o, recipe(), graph, failing)

    expect(second.gates.map((g) => g.rule)).toContain('verify.repeat-fail')
    expect(second.gates.find((g) => g.rule === 'verify.repeat-fail')?.why).toMatch(/not a retry/)
  })

  it('does not ask on the first failure — once is bad luck', async () => {
    const o = order([unit('U-1')])
    const first = await execute(
      o,
      recipe(),
      buildRunGraph(o, recipe()),
      deps(async (i) => ({ sessionId: `s-${i.node.id}`, exitCode: 1 }))
    )
    expect(first.gates.map((g) => g.rule)).not.toContain('verify.repeat-fail')
  })
})

describe('the ladder', () => {
  it('is climbed once the units are done', async () => {
    const steps: string[] = []
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async (step) => {
        steps.push(step.name)
        return 0
      },
    })
    expect(outcome.ladder).not.toBeNull()
    expect(steps.length).toBeGreaterThan(0)
  })

  it('is not climbed when the run halted at a gate — there is nothing to judge yet', async () => {
    const runStep = vi.fn(async () => 0)
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      runStep,
    })
    expect(outcome.ladder).toBeNull()
    expect(runStep).not.toHaveBeenCalled()
  })

  it('carries what it could not measure, rather than reporting a pass', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      // No runStep at all, which is a repository with no tooling.
      runStep: async () => null,
    })

    // Not a failure — a bare repository is allowed to ship a draft. But the
    // rungs that never ran travel all the way out, so the pull request body
    // and the mark-ready decision both say so.
    expect(outcome.ladder?.unmeasured.length).toBeGreaterThan(0)
    expect(outcome.ladder?.steps.some((s) => s.result === 'pass')).toBe(false)
  })

  it('is not shippable when a rung actually failed', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 1,
    })
    expect(outcome.ladder?.ok).toBe(false)
    expect(outcome.shippable).toBe(false)
  })

  it('asks about a failed climb where the setting is asking at all', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      autonomy: 'standard',
      runStep: async () => 1,
    })
    expect(outcome.gates.map((g) => g.rule)).toContain('verify.repeat-fail')
  })

  it('does not interrupt a lights-out run over it, and still refuses to ship', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 1,
    })
    // Lights-out does not stop you mid-run; it never marks anything ready
    // without you either, which is the rule that stays live at every setting.
    expect(outcome.gates.map((g) => g.rule)).not.toContain('verify.repeat-fail')
    expect(outcome.shippable).toBe(false)
  })
})

describe('shippable', () => {
  it('is true only when everything passed and nothing is waiting on a person', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.complete).toBe(true)
    expect(outcome.gates).toEqual([])
    expect(outcome.shippable).toBe(true)
  })

  it('is false for a complete graph with an open gate', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      runStep: async () => 0,
    })
    expect(outcome.gates.length).toBeGreaterThan(0)
    expect(outcome.shippable).toBe(false)
  })

  it('is false when a unit failed', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(async (i) => ({ sessionId: `s-${i.node.id}`, exitCode: 1 })),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.shippable).toBe(false)
  })
})

describe('raising a gate where nobody can see it', () => {
  it('still stops, rather than continuing past a decision nobody took', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), deps(vi.fn(ok)))
    // No `raise` seam at all — the gate is still on the outcome, and the run
    // is still not shippable.
    expect(outcome.gates.length).toBeGreaterThan(0)
    expect(outcome.shippable).toBe(false)
  })

  it('hands each gate to the seam when there is one', async () => {
    const raise = vi.fn(async () => undefined)
    const o = order([unit('U-1')])
    await execute(o, recipe(), buildRunGraph(o, recipe()), { ...deps(vi.fn(ok)), raise })
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ rule: 'unit.boundary' }))
  })
})
