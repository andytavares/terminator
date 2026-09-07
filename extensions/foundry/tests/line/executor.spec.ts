import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execute, opensPullRequest } from '../../src/line/executor.js'
import type { ExecutorEvent, StartedRun } from '../../src/line/executor.js'
import { buildRunGraph } from '../../src/line/run-graph.js'
import { retry } from '../../src/line/scheduler.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import type { Recipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { ResumeForbiddenError, createRoleRegistry } from '../../src/line/roles.js'
import { makeVerdict, SelfVerificationError } from '../../src/verify/verdict.js'

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

/**
 * A shape with a genuine mid-run pause.
 *
 * The terminal `ready-for-review` gate in RECIPE is a marker rather than a
 * stop — the real "mark it ready?" is raised once a draft exists — so anything
 * asserting that a gate halts a run needs one that actually does.
 */
const PAUSING = `
schemaVersion: 1
id: direct
steps:
  - id: build
    kind: fanout
    over: plan.units
    step: { kind: agent, role: builder }
  - id: checkpoint
    kind: gate
    rule: unit.boundary
    defaultIfIgnored: hold
    after: [build]
`

/**
 * A shape that checks its own work, which is what the real ones do.
 *
 * RECIPE builds and stops. Every verdict assertion below used to run against
 * it, and passed — because the executor stamped a verdict the moment the
 * *builder* finished, off the builder's own exit code. A live run caught it:
 * the verifier read the file, found the change had never been made, and found
 * a `pass` already in the ledger for the criterion it was there to judge.
 * A verdict needs a checking party, so a test about verdicts needs one too.
 */
const CHECKED = `
schemaVersion: 1
id: direct
steps:
  - id: build
    kind: fanout
    over: plan.units
    step: { kind: agent, role: builder }
  - id: verify
    kind: fanout
    over: plan.units
    after: [build]
    step: { kind: agent, role: verifier, context: fresh }
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
    // A real toolchain, so the climb has real rungs. With an empty one the
    // only steps the ladder offers are the three that are not commands at
    // all, and every "a rung failed" test below would be passing on those.
    context: {
      ...base.context,
      toolchain: {
        ...base.context.toolchain,
        test: { command: 'npm test', source: 'package.json' },
        lint: { command: 'npm run lint', source: 'package.json' },
        format: { command: 'npm run format', source: 'package.json' },
      },
    },
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
    expect(run.mock.calls.length).toBeGreaterThan(0)
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

  // A lane is one conversation, and the conversation carries who the agent has
  // been as well as what it has read. Three live runs died on that: forty turns
  // of being the architect outweighed the builder's brief, and the last one
  // ended with the builder writing its own recap — "I've handed over the work
  // order with criteria and two units, and I'm waiting on your sign-off plus
  // write access to implement." Still the architect, waiting to be approved,
  // while the graph said the unit was being built and the worktree stayed
  // clean.
  describe('a change of role', () => {
    it("starts a fresh conversation rather than inheriting the last role's", async () => {
      const run = vi.fn(ok)
      const o = order([unit('U-1')])
      await execute(o, recipe(CHECKED), buildRunGraph(o, recipe(CHECKED)), {
        ...deps(run),
        sessionFor: () => 'sess-architect',
      })
      for (const call of run.mock.calls) {
        expect(call[0].resumeSessionId, call[0].node.id).toBeUndefined()
      }
    })

    it('resumes where the role is carrying on its own work, which is where the saving was', async () => {
      const run = vi.fn(ok)
      // Two units for one builder: the second keeps everything the first
      // learned about this repository.
      const o = order([unit('U-1'), unit('U-2', { dependsOn: ['U-1'] })])
      await execute(o, recipe(), buildRunGraph(o, recipe()), {
        ...deps(run),
        sessionFor: () => 'sess-builder',
      })
      const second = run.mock.calls.find((c) => c[0].node.id.includes('U-2'))
      expect(second?.[0].resumeSessionId).toBe('sess-builder')
    })
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
      recipe(CHECKED),
      buildRunGraph(o, recipe(CHECKED)),
      deps(async (i) => ({
        sessionId: `s-${i.node.id}`,
        exitCode: i.node.id.startsWith('verify') ? 1 : 0,
      }))
    )
    expect(outcome.verdicts[0].result).toBe('fail')
  })

  // FR-032/FR-033. The builder's turn ending is the *claim* under test, and
  // for the whole of this feature's life it was also the verdict on that
  // claim: every node with a unit stamped `pass` on every criterion the unit
  // said it satisfied, from the builder's own exit code, labelled `verifier`.
  it('stamps no verdict when nothing has checked the work', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), deps(ok))
    // RECIPE builds and stops. An unchecked criterion is "not measured" by
    // absence — which is what both the ladder and the pull request body read.
    expect(outcome.verdicts).toEqual([])
  })

  it('never lets the working session produce its own verdict', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(CHECKED), buildRunGraph(o, recipe(CHECKED)), deps(ok))
    expect(outcome.verdicts.length).toBeGreaterThan(0)
    for (const verdict of outcome.verdicts) {
      expect(verdict.producedBy.role).toBe('verifier')
      expect(verdict.producedBy.sessionId).toBe('sess-verify:U-1')
      expect(verdict.producedBy.sessionId).not.toBe('sess-build:U-1')
    }
  })

  // The independence has to be a fact, not a naming convention. `makeVerdict`
  // refuses a verdict whose checking session is the working session — and the
  // executor used to satisfy that guard by handing it `<session>-verify`, a
  // string one suffix away from the session it was checking. The guard saw two
  // parties where there was one. It is held against the *builder's* recorded
  // session now, so the refusal can actually fire.
  it('holds the checker against the session that did the work', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(CHECKED), buildRunGraph(o, recipe(CHECKED)), deps(ok))
    expect(outcome.verdicts).toHaveLength(1)
    expect(() =>
      makeVerdict({
        ...outcome.verdicts[0],
        nodeSessionId: 'sess-verify:U-1',
        producedBy: { role: 'verifier', sessionId: 'sess-verify:U-1' },
      })
    ).toThrow(SelfVerificationError)
  })

  it('reports a run with no exit status as not measured, not as a failure', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(
      o,
      recipe(CHECKED),
      buildRunGraph(o, recipe(CHECKED)),
      // The build lands; it is the *check* that never reported an exit, which
      // is the case this is about. A build with no exit never passes, so the
      // verify node it gates would not run at all.
      deps(async (i) => ({
        sessionId: `s-${i.node.id}`,
        exitCode: i.node.id.startsWith('verify') ? null : 0,
      }))
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
    const outcome = await execute(o, recipe(PAUSING), buildRunGraph(o, recipe(PAUSING)), deps(run))

    // Never launched as work, and never silently stepped over: the run halts
    // and the operator is asked.
    expect(run.mock.calls.every((c) => c[0].node.kind !== 'gate')).toBe(true)
    expect(outcome.gates.map((g) => g.rule)).toContain('unit.boundary')
    expect(outcome.shippable).toBe(false)
  })

  it('does not stop at a checkpoint the autonomy setting silences', async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(PAUSING), buildRunGraph(o, recipe(PAUSING)), {
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
    await execute(o, recipe(CHECKED), buildRunGraph(o, recipe(CHECKED)), deps(ok, events))
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
    const outcome = await execute(o, recipe(CHECKED), buildRunGraph(o, recipe(CHECKED)), deps(ok))
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

  it('does not ask about the node on its first failure — once is bad luck', async () => {
    const o = order([unit('U-1')])
    const first = await execute(
      o,
      recipe(),
      buildRunGraph(o, recipe()),
      deps(async (i) => ({ sessionId: `s-${i.node.id}`, exitCode: 1 }))
    )
    // Nothing asks about *the unit*: a second attempt is owed first. The run
    // still stops and says it cannot proceed, which is a different row — that
    // one names no node.
    expect(first.gates.filter((g) => g.nodeId !== null)).toEqual([])
    expect(first.gates.some((g) => g.nodeId === null && g.why.includes('blocked'))).toBe(true)
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
    const outcome = await execute(o, recipe(PAUSING), buildRunGraph(o, recipe(PAUSING)), {
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
    const outcome = await execute(o, recipe(PAUSING), buildRunGraph(o, recipe(PAUSING)), {
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
    const outcome = await execute(
      o,
      recipe(PAUSING),
      buildRunGraph(o, recipe(PAUSING)),
      deps(vi.fn(ok))
    )
    // No `raise` seam at all — the gate is still on the outcome, and the run
    // is still not shippable.
    expect(outcome.gates.length).toBeGreaterThan(0)
    expect(outcome.shippable).toBe(false)
  })

  it('hands each gate to the seam when there is one', async () => {
    const raise = vi.fn(async () => undefined)
    const o = order([unit('U-1')])
    await execute(o, recipe(PAUSING), buildRunGraph(o, recipe(PAUSING)), {
      ...deps(vi.fn(ok)),
      raise,
    })
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ rule: 'unit.boundary' }))
  })
})

describe('one conversation per lane', () => {
  it('carries a resumable role on in the session the lane already has', async () => {
    const run = vi.fn(ok)
    // Two units for the one role. The builder declares `allowResume: true`, so
    // its second unit continues where its first left off rather than being a
    // fresh agent that has read nothing.
    const o = order([unit('U-1'), unit('U-2', { dependsOn: ['U-1'] })])
    await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(run),
      sessionFor: () => 'sess-lane-1',
    })
    const second = run.mock.calls.find((c) => c[0].node.id.includes('U-2'))
    expect(second?.[0].resumeSessionId).toBe('sess-lane-1')
  })

  it('starts the lane rather than resuming a conversation nothing here opened', () => {
    // The first node of a lane has no earlier role to continue, and a session
    // this run cannot account for belongs to a role it cannot name.
    const run = vi.fn(ok)
    const o = order([unit('U-1')])
    return execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(run),
      sessionFor: () => 'sess-from-somewhere',
    }).then(() => {
      expect(run.mock.calls[0][0].resumeSessionId).toBeUndefined()
    })
  })

  it('never offers one to a role that may not resume', async () => {
    const verifying = `
schemaVersion: 1
id: direct
steps:
  - id: check
    kind: agent
    role: verifier
`
    const run = vi.fn(ok)
    const o = order([])
    await execute(o, recipe(verifying), buildRunGraph(o, recipe(verifying)), {
      ...deps(run),
      sessionFor: () => 'sess-lane-1',
      runStep: async () => 0,
    })
    // The verifier's fresh context is the whole point of it; being offered the
    // builder's conversation would hand it the builder's justification.
    expect(run.mock.calls[0][0].resumeSessionId).toBeUndefined()
  })

  it('starts fresh when the lane has no conversation yet', async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1')])
    await execute(o, recipe(), buildRunGraph(o, recipe()), deps(run))
    expect(run.mock.calls[0][0].resumeSessionId).toBeUndefined()
  })
})

describe("a recipe's own gate rule", () => {
  const risky = `
schemaVersion: 1
id: direct
steps:
  - id: build
    kind: fanout
    over: plan.units
    step: { kind: agent, role: builder }
  - id: check
    kind: gate
    rule: critical-path
    defaultIfIgnored: hold
    after: [build]
`

  it('is the one raised, not a hardcoded default', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(risky), buildRunGraph(o, recipe(risky)), {
      ...deps(vi.fn(ok)),
      runStep: async () => 0,
    })
    expect(outcome.gates.map((g) => g.rule)).toContain('critical-path')
    expect(outcome.gates.map((g) => g.rule)).not.toContain('unit.boundary')
  })

  it('brings the options that rule offers with it', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(risky), buildRunGraph(o, recipe(risky)), {
      ...deps(vi.fn(ok)),
      runStep: async () => 0,
    })
    const gate = outcome.gates.find((g) => g.rule === 'critical-path')
    expect(gate?.options.map((o) => o.id)).toContain('send_back')
    expect(gate?.defaultIfIgnored).toBe('hold')
  })

  it("passes a recipe's terminal ship marker rather than asking about it", async () => {
    // "Mark it ready?" before a draft exists is a question with no answer. The
    // real one is raised once shipping has opened something.
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      runStep: async () => 0,
    })
    expect(outcome.gates).toEqual([])
    expect(outcome.complete).toBe(true)
    expect(outcome.shippable).toBe(true)
  })

  it('falls back to a checkpoint when a recipe names a rule this build does not know', async () => {
    const odd = `
schemaVersion: 1
id: direct
steps:
  - id: build
    kind: fanout
    over: plan.units
    step: { kind: agent, role: builder }
  - id: pause
    kind: gate
    rule: something-invented
    defaultIfIgnored: hold
    after: [build]
`
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(odd), buildRunGraph(o, recipe(odd)), deps(vi.fn(ok)))
    expect(outcome.gates.map((g) => g.rule)).toContain('unit.boundary')
  })
})

describe('a step that promised something about its own result', () => {
  const bugfix = `
schemaVersion: 1
id: direct
steps:
  - id: reproduce
    kind: run
    command: npm test
    expect: { exit_code: '!= 0' }
`

  it('fails when the promise was not kept, however the command exited', async () => {
    // The reproduction has to *fail* before the fix exists — the one place a
    // passing command is the wrong answer.
    const o = order([])
    const record = vi.fn(async () => undefined)
    const outcome = await execute(o, recipe(bugfix), buildRunGraph(o, recipe(bugfix)), {
      ...deps(vi.fn(ok)),
      record,
      runStep: async () => 0,
    })
    expect(outcome.complete).toBe(false)
    expect(record).toHaveBeenCalledWith(
      'step.expectation_unmet',
      'reproduce',
      expect.stringContaining('exit_code')
    )
  })

  it('passes when it was kept', async () => {
    const o = order([])
    const outcome = await execute(o, recipe(bugfix), buildRunGraph(o, recipe(bugfix)), {
      ...deps(async (i) => ({ sessionId: `s-${i.node.id}`, exitCode: 1 })),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.graph.nodes.find((n) => n.id === 'reproduce')?.state).toBe('passed')
  })

  it('leaves a step that promised nothing judged on its exit status alone', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.complete).toBe(true)
  })
})

describe('the grade the change turned out to deserve', () => {
  it('regrades from what was touched, not from what the plan predicted', async () => {
    const o = order([unit('U-1', { touches: ['src/main/auth/session.ts'] })], {
      risk: { grade: 'P3', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    })
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    // Planned P3, touches authentication. Shipping reads the regraded value,
    // so a change like this cannot slip past the decision its real grade calls
    // for.
    expect(o.risk.grade).toBe('P3')
    expect(outcome.risk.grade).not.toBe('P3')
    expect(outcome.risk.triggers).toContain('authentication')
  })

  it('says it was planned as something else, when it was', async () => {
    const o = order([unit('U-1', { touches: ['src/main/auth/session.ts'] })], {
      risk: { grade: 'P3', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    })
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      runStep: async () => 0,
    })
    expect(outcome.gates.find((g) => g.rule === 'risk.p0')?.summary).toContain('planned as P3')
  })

  it('leaves an ordinary change where the plan put it', async () => {
    const o = order([unit('U-1', { touches: ['src/readme.ts'] })], {
      risk: { grade: 'P3', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    })
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.inspection.required).toBe(false)
  })
})

describe('a graph that cannot move on its own', () => {
  it('says so, rather than reporting a run waiting on a gate that does not exist', async () => {
    // U-2 depends on U-1; U-1 fails twice, so nothing is runnable and nothing
    // is finished.
    const o = order([unit('U-1'), unit('U-2', { dependsOn: ['U-1'] })])
    const failing = deps(async (i) => ({ sessionId: `s-${i.node.id}`, exitCode: 1 }))
    let graph = buildRunGraph(o, recipe())
    graph = (await execute(o, recipe(), graph, failing)).graph
    const stalled = await execute(o, recipe(), graph, failing)

    expect(stalled.shippable).toBe(false)
    expect(stalled.gates.some((g) => g.why.includes('blocked'))).toBe(true)
  })

  it('does not call a finished run stalled', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.gates).toEqual([])
    expect(outcome.shippable).toBe(true)
  })
})

describe('a shape that opens nothing (FR-019)', () => {
  const spike = `
schemaVersion: 1
id: direct
steps:
  - id: investigate
    kind: agent
    role: architect
  - id: findings
    kind: agent
    role: scribe
    after: [investigate]
`

  it('is never shippable, however well it went', async () => {
    const o = order([])
    const outcome = await execute(o, recipe(spike), buildRunGraph(o, recipe(spike)), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    // A spike is a question, not a change. Shipping one would turn every
    // investigation into a branch.
    expect(outcome.complete).toBe(true)
    expect(outcome.ladder?.ok).toBe(true)
    expect(outcome.shippable).toBe(false)
  })

  it('is decided by the recipe having a ship step, not by a flag', () => {
    expect(opensPullRequest(recipe(spike))).toBe(false)
    expect(opensPullRequest(recipe())).toBe(true)
  })

  it('leaves a shape that does ship shipping', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.shippable).toBe(true)
  })
})

describe('an expectation nothing here can measure', () => {
  const refactorish = `
schemaVersion: 1
id: direct
steps:
  - id: cover
    kind: run
    command: npm test
    expect: { tests_added: '>= 1' }
`

  it('is recorded, and the step is judged on its exit status instead', async () => {
    const record = vi.fn(async () => undefined)
    const o = order([])
    const outcome = await execute(o, recipe(refactorish), buildRunGraph(o, recipe(refactorish)), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      record,
      runStep: async () => 0,
    })
    // Never a silent pass and never a silent failure: a shape whose promise
    // nothing measures must not become a shape that can never pass.
    expect(record).toHaveBeenCalledWith(
      'step.expectation_not_measured',
      'cover',
      expect.stringContaining('tests_added')
    )
    expect(outcome.complete).toBe(true)
  })

  it('still honours the keys it can measure', async () => {
    const both = `
schemaVersion: 1
id: direct
steps:
  - id: reproduce
    kind: run
    command: npm test
    expect: { suite_exit_code: '!= 0', tests_added: '>= 1' }
`
    const o = order([])
    // The suite passing is the wrong answer for a reproduction, and that half
    // is measurable.
    const outcome = await execute(o, recipe(both), buildRunGraph(o, recipe(both)), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.complete).toBe(false)
  })

  it('passes the reproduction when the suite fails, as the bug shape means', async () => {
    const repro = `
schemaVersion: 1
id: direct
steps:
  - id: reproduce
    kind: run
    command: npm test
    expect: { suite_exit_code: '!= 0' }
`
    const o = order([])
    const outcome = await execute(o, recipe(repro), buildRunGraph(o, recipe(repro)), {
      ...deps(async (i) => ({ sessionId: `s-${i.node.id}`, exitCode: 1 })),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.graph.nodes.find((n) => n.id === 'reproduce')?.state).toBe('passed')
  })
})

// The settings panel has always said the operator's model applies "unless a
// role asks for something else". Nothing read `modelTier`, so it applied to
// everything — the scribe, which four recipes use and which every role file
// marks `fast`, ran on the deep model like the architect.
describe('the tier a role asked for', () => {
  const TIERED = `
schemaVersion: 1
id: direct
steps:
  - id: build
    kind: fanout
    over: plan.units
    step: { kind: agent, role: builder }
  - id: document
    kind: agent
    role: scribe
    after: [build]
`

  async function tiers(): Promise<{ role: string | null; modelTier: string }[]> {
    const seen: { role: string | null; modelTier: string }[] = []
    const run = vi.fn(
      async (input: { node: { id: string }; role: string | null; modelTier: string }) => {
        seen.push({ role: input.role, modelTier: input.modelTier })
        return ok(input)
      }
    )
    const o = order([unit('U-1')])
    const r = recipe(TIERED)
    await execute(o, r, buildRunGraph(o, r), deps(run as never))
    return seen
  }

  it('runs the scribe on the fast model, which is what its role file asks for', async () => {
    const seen = await tiers()
    const scribe = seen.filter((s) => s.role === 'scribe')
    // Said out loud: without this the test passes on a run that never reached
    // the scribe at all.
    expect(scribe.length).toBeGreaterThan(0)
    expect(scribe.every((s) => s.modelTier === 'fast')).toBe(true)
  })

  it('leaves the builder on the deep model', async () => {
    const seen = await tiers()
    const builder = seen.filter((s) => s.role === 'builder')
    expect(builder.length).toBeGreaterThan(0)
    expect(builder.every((s) => s.modelTier === 'deep')).toBe(true)
  })

  it('asks for the deep tier for a node with no role, so the operator choice stands', async () => {
    const seen: string[] = []
    const run = vi.fn(
      async (input: { node: { id: string }; role: string | null; modelTier: string }) => {
        if (input.role === null) seen.push(input.modelTier)
        return ok(input)
      }
    )
    const o = order([unit('U-1')])
    await execute(o, recipe(), buildRunGraph(o, recipe()), deps(run as never))
    for (const tier of seen) expect(tier).toBe('deep')
  })
})

// Two step fields that parsed and reached nothing. `deadlineMinutes` is what
// makes "what happens when nobody answers" a promise a gate can keep, and
// `context: fresh` is how a shape demands a clean conversation from a role
// that is otherwise allowed to resume.
describe('what a step declares about its gate and its conversation', () => {
  const DEADLINE = `
schemaVersion: 1
id: direct
steps:
  - id: build
    kind: fanout
    over: plan.units
    step: { kind: agent, role: builder }
  - id: checkpoint
    kind: gate
    rule: unit.boundary
    options: [go_on, hold]
    defaultIfIgnored: hold
    deadlineMinutes: 30
    after: [build]
`

  const FRESH = `
schemaVersion: 1
id: direct
steps:
  - id: build
    kind: fanout
    over: plan.units
    step: { kind: agent, role: builder }
  - id: recheck
    kind: fanout
    over: plan.units
    after: [build]
    step: { kind: agent, role: builder, context: fresh }
`

  it('gives the gate the deadline its step declared', async () => {
    const raised: Gate[] = []
    const o = order([unit('U-1')])
    const r = recipe(DEADLINE)
    await execute(o, r, buildRunGraph(o, r), {
      ...deps(ok),
      autonomy: 'escorted' as const,
      raise: async (gate: Gate) => {
        raised.push(gate)
      },
    })
    const checkpoint = raised.find((g) => g.rule === 'unit.boundary')
    expect(checkpoint).toBeDefined()
    expect(checkpoint?.deadline).toBe('2026-09-06T11:30:00.000Z')
  })

  it('leaves a gate whose step named no deadline waiting for ever, on purpose', async () => {
    const raised: Gate[] = []
    const o = order([unit('U-1')])
    const r = recipe(PAUSING)
    await execute(o, r, buildRunGraph(o, r), {
      ...deps(ok),
      autonomy: 'escorted' as const,
      raise: async (gate: Gate) => {
        raised.push(gate)
      },
    })
    expect(raised.find((g) => g.rule === 'unit.boundary')?.deadline).toBeNull()
  })

  it('offers no session to resume where the step asked for a fresh one', async () => {
    const seen: { node: string; resumeSessionId: string | undefined }[] = []
    const run = vi.fn(
      async (input: { node: { id: string }; resumeSessionId: string | undefined }) => {
        seen.push({ node: input.node.id, resumeSessionId: input.resumeSessionId })
        return ok(input)
      }
    )
    // Two units, so the builder has a second node of its own role to resume
    // into — which is the case the step's `context: fresh` has to override.
    const o = order([unit('U-1'), unit('U-2', { dependsOn: ['U-1'] })])
    const r = recipe(FRESH)
    await execute(o, r, buildRunGraph(o, r), {
      ...deps(run as never),
      // The builder may resume, and one is on offer for its lane. The step is
      // the only thing that should stop it being taken.
      sessionFor: () => 'sess-lane-1',
    })
    const fresh = seen.filter((s) => s.node.includes('recheck'))
    expect(fresh.length).toBeGreaterThan(0)
    for (const step of fresh) expect(step.resumeSessionId).toBeUndefined()
    const resumed = seen.filter((s) => s.node.includes('build'))
    expect(resumed.length).toBeGreaterThan(0)
    expect(resumed.some((s) => s.resumeSessionId === 'sess-lane-1')).toBe(true)
  })
})

// The graph on disk is what `run.observe` reads, and it used to be written
// once when the run started and once when it ended. For the whole of a run the
// Floor therefore showed every node `waiting` while agents were working in
// their worktrees — the one surface whose purpose is watching a run, showing
// the snapshot it began with. A live run is what made it obvious.
describe('writing the graph down as it changes', () => {
  it('persists every state the run passes through, not only the last', async () => {
    const seen: string[][] = []
    const o = order([unit('U-1')])
    await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
      persist: async (graph) => {
        seen.push(graph.nodes.map((n) => `${n.id}=${n.state}`))
      },
    })

    expect(seen.length).toBeGreaterThan(1)
    // The first write is not already the finished graph.
    expect(seen[0].some((s) => s.endsWith('=waiting') || s.endsWith('=ready'))).toBe(true)
    // And the last one is.
    expect(seen[seen.length - 1].every((s) => !s.endsWith('=waiting'))).toBe(true)
  })

  it('records a node as running before it records it as passed', async () => {
    const order_ = order([unit('U-1')])
    const states: string[] = []
    await execute(order_, recipe(), buildRunGraph(order_, recipe()), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
      persist: async (graph) => {
        const node = graph.nodes.find((n) => n.id === 'build:U-1')
        if (node !== undefined && states[states.length - 1] !== node.state) states.push(node.state)
      },
    })
    expect(states).toContain('running')
    expect(states.indexOf('running')).toBeLessThan(states.indexOf('passed'))
  })

  it('carries on when the graph cannot be written — a run is not a report', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
      persist: async () => {
        throw new Error('the disk is full')
      },
    })
    expect(outcome.complete).toBe(true)
  })
})

// The budget was read between waves, and the loop then parked on the wave. So
// the one case a wall-clock budget exists for — an agent that never comes
// back — is the one case it could not catch. A live run sat forty minutes past
// a twenty-minute budget with nothing to show for it.
describe('a budget exceeded while agents are still running', () => {
  /** A wave that never finishes, which is what a hung agent looks like. */
  const hangs = () => new Promise<StartedRun>(() => {})

  function clock() {
    let minutes = 0
    return {
      observe: () => ({ elapsedMinutes: minutes, filesTouched: 0 }),
      wait: async (_ms: number) => {
        minutes += 10
      },
      budgetPollMs: 1,
    }
  }

  it('stops the run rather than waiting for the wave that will not end', async () => {
    const o = order([unit('U-1')], {
      budgets: { agents: 2, wallClockMinutes: 20, filesTouched: 25, tokens: null },
    })
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(hangs as never),
      autonomy: 'escorted',
      ...clock(),
    })
    expect(outcome.gates.map((g) => g.rule)).toContain('budget.exceeded')
  })

  it('says the agents were not thrown away, because they were not', async () => {
    const o = order([unit('U-1')], {
      budgets: { agents: 2, wallClockMinutes: 20, filesTouched: 25, tokens: null },
    })
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(hangs as never),
      autonomy: 'escorted',
      ...clock(),
    })
    const gate = outcome.gates.find((g) => g.rule === 'budget.exceeded')
    expect(gate?.why).toContain('still in their terminals')
  })

  it('stops even where the setting silences the rule — a budget is not a preference', async () => {
    const o = order([unit('U-1')], {
      budgets: { agents: 2, wallClockMinutes: 20, filesTouched: 25, tokens: null },
    })
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(hangs as never),
      autonomy: 'lights-out',
      ...clock(),
    })
    // `budget.exceeded` is unconditional, so it is raised at every setting —
    // and the run is over either way.
    expect(outcome.shippable).toBe(false)
    expect(outcome.complete).toBe(false)
  })

  it('leaves a wave that finishes inside its budget completely alone', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
      observe: () => ({ elapsedMinutes: 1, filesTouched: 1 }),
      wait: async () => undefined,
      budgetPollMs: 1,
    })
    expect(outcome.complete).toBe(true)
    expect(outcome.gates.map((g) => g.rule)).not.toContain('budget.exceeded')
  })

  it('still works with no clock injected at all, which is every existing caller', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.complete).toBe(true)
  })
})

// The budget is compared exactly, not against a rounded number of minutes. It
// was `Math.round`ed, so a run at 19:31 reported "20" and a twenty-minute
// budget could only be exceeded at 20:30 — a live run whose own deadline was
// the budget therefore never saw the gate at all.
describe('when exactly the budget is exceeded', () => {
  const hangs = () => new Promise<StartedRun>(() => {})

  /**
   * A clock that starts where the test says and moves on every poll.
   *
   * A fixed clock plus a wave that never settles is an infinite loop with no
   * delay in it — which is a busy spin, not a test.
   */
  function from(minutes: number) {
    let now = minutes
    return {
      observe: () => ({ elapsedMinutes: now, filesTouched: 0 }),
      wait: async (_ms: number) => {
        now += 0.5
      },
      budgetPollMs: 1,
    }
  }

  async function runFrom(minutes: number) {
    const o = order([unit('U-1')], {
      budgets: { agents: 2, wallClockMinutes: 20, filesTouched: 25, tokens: null },
    })
    return execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(hangs as never),
      autonomy: 'escorted',
      ...from(minutes),
    })
  }

  it('is not exceeded a second before the budget — it waits, and then it is', async () => {
    const outcome = await runFrom(19.98)
    const gate = outcome.gates.find((g) => g.rule === 'budget.exceeded')
    expect(gate).toBeDefined()
    // The first poll was under the budget, so the gate is not raised on it.
    expect(gate?.why).toContain('at 20')
  })

  it('says the number a person would say, not the fraction it compared', async () => {
    const outcome = await runFrom(20.4)
    const gate = outcome.gates.find((g) => g.rule === 'budget.exceeded')
    expect(gate?.why).toContain('at 20')
    expect(gate?.why).not.toMatch(/20\.\d/)
  })

  it('never fires for a run comfortably inside its budget', async () => {
    const o = order([unit('U-1')], {
      budgets: { agents: 2, wallClockMinutes: 20, filesTouched: 25, tokens: null },
    })
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
      observe: () => ({ elapsedMinutes: 19.98, filesTouched: 0 }),
      wait: async () => undefined,
      budgetPollMs: 1,
    })
    expect(outcome.gates.map((g) => g.rule)).not.toContain('budget.exceeded')
    expect(outcome.complete).toBe(true)
  })
})
