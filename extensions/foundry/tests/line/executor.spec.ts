import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { testCriterion } from '../helpers/order-parts.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { executePlan as execute, opensPullRequest, skillsFor } from '../../src/line/executor.js'
import type { ExecutorDeps, ExecutorEvent, RunPlan, StartedRun } from '../../src/line/executor.js'
import { buildRunGraph, withNode } from '../../src/line/run-graph.js'
import { Execution } from '../../src/line/execution.js'
import { idleExecutorSeams } from './idle-executor-seams.js'
import { retry } from '../../src/line/scheduler.js'
import type { CommitOutcome } from '../../src/line/commit.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import type { Recipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { ResumeForbiddenError, createRoleRegistry } from '../../src/line/roles.js'
import { makeVerdict, SelfVerificationError } from '../../src/verify/verdict.js'
import { decide, raiseGate } from '../../src/gates/rules.js'
import type { Gate } from '../../src/gates/rules.js'
import { makeTempDir } from '../../../../tests/support/temp-dir'
import { eventually } from '../../../../tests/support/eventually'

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

/** The run of `o` along `shape`, over the graph built from both. */
function planOf(o: WorkOrder, shape: Recipe = recipe()): RunPlan {
  return { order: o, recipe: shape, graph: buildRunGraph(o, shape) }
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
        test: { command: 'npm test', source: 'hint' },
        lint: { command: 'npm run lint', source: 'hint' },
        format: { command: 'npm run format', source: 'hint' },
      },
      environment: {
        ...base.context.environment,
        paths: { ...base.context.environment.paths, manifests: ['package.json'] },
      },
    },
    acceptance: [testCriterion('AC-1', { statement: 'a' })],
    plan: { ...base.plan, units },
    ...over,
  }
}

type RunInput = Parameters<ExecutorDeps['run']>[0]

function deps(run: (input: RunInput) => Promise<StartedRun>, events: ExecutorEvent[] = []) {
  return {
    ...idleExecutorSeams(),
    run,
    // Commands pass and no rung files anything unless a test says otherwise.
    runCommand: async () => 0,
    collect: async () => null,
    now: () => '2026-09-06T11:00:00.000Z',
    sources: { dataRoot, repoPaths: [repo], builtInDir },
    onEvent: (e: ExecutorEvent) => events.push(e),
  }
}

const ok = async (input: RunInput): Promise<StartedRun> => ({
  sessionId: `sess-${input.node.id}`,
  exitCode: 0,
})

beforeEach(() => {
  dataRoot = makeTempDir('fdry-exec-')
  repo = makeTempDir('fdry-exec-repo-')
})

afterEach(() => {
  for (const d of [dataRoot, repo]) {
    fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

describe('execute', () => {
  describe('running units', runningUnitsTests)
  describe('sessions and read-only roles', sessionsAndReadOnlyRolesTests)
  describe('a change of role', aChangeOfRoleTests)
  describe('the prompt and the verdict', thePromptAndTheVerdictTests)
  describe('who checks the work', whoChecksTheWorkTests)
  describe('failures', executorFailuresTests)
  describe('gates', executorGatesTests)
  describe('silenced checkpoints and decisions', silencedCheckpointsAndDecisionsTests)
  describe('events and inspection', eventsAndInspectionTests)
  describe('an empty graph', anEmptyGraphTests)
})

function runningUnitsTests() {
  it('runs every unit that can run', async () => {
    const run = vi.fn(ok)
    const o = order()
    const outcome = await execute(planOf(o), deps(run))
    // Two units. The third node is the recipe's own ship gate, which is
    // reached rather than run — nothing was launched for it, and it is left
    // running because the tail has not shipped anything yet.
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls.every((c) => c[0].node.kind !== 'gate')).toBe(true)
    expect(outcome.graph.nodes.filter((n) => n.state === 'passed')).toHaveLength(2)
    expect(outcome.graph.nodes.find((n) => n.id === 'ship')?.state).toBe('running')
    expect(outcome.complete).toBe(true)
  })

  it('honours the agent budget rather than starting everything at once', agentBudgetTest)
}

/** Agents finish only when released, so more than the budget are live only if the executor lets them. */
async function agentBudgetTest(): Promise<void> {
  let peak = 0
  let live = 0
  const held: Array<() => void> = []
  const run = vi.fn(async (input: { node: { id: string } }) => {
    live += 1
    peak = Math.max(peak, live)
    await new Promise<void>((resolve) => held.push(resolve))
    live -= 1
    return { sessionId: `s-${input.node.id}`, exitCode: 0 }
  })
  const o = order([unit('U-1'), unit('U-2'), unit('U-3'), unit('U-4')], {
    budgets: { agents: 2, wallClockMinutes: 45, tokens: null },
  })
  const executing = execute(planOf(o), deps(run))
  for (const _wave of [1, 2]) {
    await eventually(() => expect(held).toHaveLength(2))
    held.splice(0).forEach((release) => release())
  }
  await executing
  expect(peak).toBeLessThanOrEqual(2)
  expect(run).toHaveBeenCalledTimes(4)
}

function sessionsAndReadOnlyRolesTests() {
  it('never hands a role a session to resume', async () => {
    const run = vi.fn(ok)
    const o = order()
    await execute(planOf(o), deps(run))
    expect(run.mock.calls.length).toBeGreaterThan(0)
    for (const call of run.mock.calls) {
      expect(call[0].resumeSessionId).toBeUndefined()
    }
  })

  it('marks a read-only role read-only, so the hook can refuse its writes', async () => {
    const run = vi.fn(ok)
    const verifying = RECIPE.replace('role: builder', 'role: verifier')
    const o = order()
    await execute(planOf(o, recipe(verifying)), deps(run))
    expect(run.mock.calls.every((c) => c[0].readOnly)).toBe(true)
  })

  it('does not mark a builder read-only — it is the one role that writes', async () => {
    const run = vi.fn(ok)
    const o = order()
    await execute(planOf(o), deps(run))
    expect(run.mock.calls.every((c) => c[0].readOnly)).toBe(false)
  })
}

function aChangeOfRoleTests() {
  it("starts a fresh conversation rather than inheriting the last role's", async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1')])
    // The architect has a conversation open in this lane. Nothing else does,
    // which is exactly what the real map looks like at this point.
    const open = new Map([['1:architect', 'sess-architect']])
    await execute(planOf(o, recipe(CHECKED)), {
      ...deps(run),
      sessionFor: (lane, role) => open.get(`${lane}:${role ?? 'command'}`),
    })
    expect(run.mock.calls.length).toBeGreaterThan(0)
    for (const call of run.mock.calls) {
      expect(call[0].resumeSessionId).toBeUndefined()
    }
  })

  it('resumes where the role is carrying on its own work, which is where the saving was', async () => {
    const run = vi.fn(ok)
    // Two units for one builder: the second keeps everything the first
    // learned about this repository.
    const o = order([unit('U-1'), unit('U-2', { dependsOn: ['U-1'] })])
    await execute(planOf(o), {
      ...deps(run),
      sessionFor: (_lane, role) => (role === 'builder' ? 'sess-builder' : undefined),
    })
    const second = run.mock.calls.find((c) => c[0].node.id.includes('U-2'))
    expect(second?.[0].resumeSessionId).toBe('sess-builder')
  })
}

function thePromptAndTheVerdictTests() {
  it('gives each run the role prompt rather than an empty instruction', async () => {
    const run = vi.fn(ok)
    const o = order()
    await execute(planOf(o), deps(run))
    expect(run.mock.calls[0][0].prompt).toContain('Build one unit')
  })

  it('takes the verdict from the exit status', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(
      planOf(o, recipe(CHECKED)),
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
    const outcome = await execute(planOf(o), deps(ok))
    // RECIPE builds and stops. An unchecked criterion is "not measured" by
    // absence — which is what both the ladder and the pull request body read.
    expect(outcome.verdicts).toEqual([])
  })
}

function whoChecksTheWorkTests() {
  it('never lets the working session produce its own verdict', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o, recipe(CHECKED)), deps(ok))
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
    const outcome = await execute(planOf(o, recipe(CHECKED)), deps(ok))
    expect(outcome.verdicts).toHaveLength(1)
    expect(() =>
      makeVerdict({
        ...outcome.verdicts[0],
        nodeSessionId: 'sess-verify:U-1',
        producedBy: { role: 'verifier', sessionId: 'sess-verify:U-1' },
      })
    ).toThrow(SelfVerificationError)
  })
}

function executorFailuresTests() {
  it('reports a run with no exit status as not measured, not as a failure', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(
      planOf(o, recipe(CHECKED)),
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
      planOf(o),
      deps(async (i) => ({ sessionId: `s-${i.node.id}`, exitCode: 1 }))
    )
    expect(outcome.graph.nodes.find((n) => n.id === 'ship')?.state).toBe('blocked')
    expect(outcome.complete).toBe(false)
  })
}

function executorGatesTests() {
  it('says on the stall gate which step failed, why, and what it holds up', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(
      planOf(o),
      deps(async (i) => ({ sessionId: `s-${i.node.id}`, exitCode: 1 }))
    )
    const gate = outcome.gates.find((g) => g.summary.endsWith('cannot go any further on its own'))
    const failed = outcome.graph.nodes.find((n) => n.id === 'build:U-1')
    expect(failed?.failReason).toBe('exited 1')
    expect(gate?.why).toMatch(/^\*\*builder · U-1 .+\*\* failed: exited 1\.\n\nHeld up behind it: /)
    expect(gate?.why).not.toMatch(/or the plan has a cycle/)
  })

  it('raises a gate rather than answering it, and stops', async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o, recipe(PAUSING)), deps(run))

    // Never launched as work, and never silently stepped over: the run halts
    // and the operator is asked.
    expect(run.mock.calls.every((c) => c[0].node.kind !== 'gate')).toBe(true)
    expect(outcome.gates.map((g) => g.rule)).toContain('unit.boundary')
    expect(outcome.shippable).toBe(false)
  })
}

function silencedCheckpointsAndDecisionsTests() {
  it('does not stop at a checkpoint the autonomy setting silences', async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o, recipe(PAUSING)), {
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
    graph = (await execute({ order: o, recipe: recipe(), graph }, failing)).graph
    // Put it back in the queue as a decision would, then fail it again.
    graph = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === 'build:U-1' ? { ...n, state: 'waiting' as const } : n
      ),
    }
    const second = await execute({ order: o, recipe: recipe(), graph }, failing)
    expect(second.awaitingDecision).toContain('build:U-1')
  })
}

function eventsAndInspectionTests() {
  it('reports every event a surface needs to follow along', async () => {
    const events: ExecutorEvent[] = []
    const o = order([unit('U-1')])
    await execute(planOf(o, recipe(CHECKED)), deps(ok, events))
    const kinds = events.map((e) => e.type)
    expect(kinds).toContain('started')
    expect(kinds).toContain('verdict')
    expect(kinds).toContain('passed')
    expect(kinds).toContain('inspection')
  })

  it('inspects the accumulated change, not one unit, and says when it did not', async () => {
    const events: ExecutorEvent[] = []
    const o = order([unit('U-1')])
    await execute(planOf(o), deps(ok, events))
    const inspection = events.find((e) => e.type === 'inspection')
    expect(inspection).toMatchObject({ required: false })
  })

  it('requires an inspection once the change touches something that warrants one', async () => {
    const events: ExecutorEvent[] = []
    const o = order([unit('U-1', { touches: ['src/auth/session.ts'] })])
    await execute(planOf(o), deps(ok, events))
    const inspection = events.find((e) => e.type === 'inspection')
    expect(inspection).toMatchObject({ required: true })
  })
}

function anEmptyGraphTests() {
  it('does nothing at all with a graph that has nothing runnable', async () => {
    const run = vi.fn(ok)
    const o = order([])
    const outcome = await execute(planOf(o), deps(run))
    expect(run).not.toHaveBeenCalled()
    expect(outcome.verdicts).toEqual([])
  })
}

describe('the resume rule', () => {
  it('is enforced by refusing, not by asking', () => {
    const roles = createRoleRegistry({ dataRoot, repoPaths: [repo], builtInDir })
    expect(() => roles.assertResumable('verifier', 'sess-1')).toThrow(ResumeForbiddenError)
  })
})

// The regrade and the inspection answer for "the change the work turned out to
// be" — and they were handed `plan.units.flatMap(touches)`, the files the plan
// *predicted*, with `linesChanged` hardcoded to zero. So a builder that went
// outside what its unit declared was invisible to precisely the check that
// exists to notice it, and nothing could ever grade worse than it was planned
// as. The comment above the regrade already said it must not read the plan.
describe('what the change turned out to be', () => {
  describe('unplanned files', unplannedFilesTests)
  describe('the blast radius trigger', theBlastRadiusTriggerTests)
  describe('declarations', declarationsTests)
})

function unplannedFilesTests() {
  it('grades a file the plan never mentioned', async () => {
    const events: ExecutorEvent[] = []
    const o = order([unit('U-1', { touches: ['src/harmless.ts'] })])
    await execute(planOf(o), {
      ...deps(ok, events),
      observedChange: async () => ({
        // The unit said it would touch one innocuous file and the agent went
        // and edited authentication.
        changedFiles: ['src/auth/session.ts'],
        linesChanged: 40,
      }),
    })
    const inspection = events.find((e) => e.type === 'inspection')
    expect(inspection).toMatchObject({ required: true })
  })
}

function theBlastRadiusTriggerTests() {
  it('fires the outside-the-blast-radius trigger, which could not fire before', async () => {
    // The trigger compares what changed against what the order declared. While
    // both sides were the plan, it could only fire on an order inconsistent
    // with itself — never on an agent that quietly grew past what was assessed,
    // which is the case the comment above it names.
    const events: ExecutorEvent[] = []
    const o = order([unit('U-1', { touches: ['src/session.ts'] })], {
      risk: {
        grade: 'P2',
        triggers: [],
        blastRadius: ['src/session.ts'],
        criticalPaths: [],
      },
    })
    await execute(planOf(o), {
      ...deps(ok, events),
      observedChange: async () => ({
        changedFiles: ['src/session.ts', 'src/billing/invoice.ts'],
        linesChanged: 12,
      }),
    })
    expect(events.find((e) => e.type === 'inspection')).toMatchObject({
      required: true,
      triggers: expect.arrayContaining(['outside_blast_radius']),
    })
  })
}

function declarationsTests() {
  it('keeps what the plan declared as well, rather than swapping one for the other', async () => {
    const events: ExecutorEvent[] = []
    const o = order([unit('U-1', { touches: ['src/auth/session.ts'] })])
    await execute(planOf(o), {
      ...deps(ok, events),
      // Git could not be read. An empty answer means "unknown", and reading it
      // as "nothing touched authentication" is how a P0 quietly grades P3.
      observedChange: async () => ({ changedFiles: [], linesChanged: 0 }),
    })
    expect(events.find((e) => e.type === 'inspection')).toMatchObject({ required: true })
  })

  it('falls back to the declaration when nothing can tell it what changed', async () => {
    const events: ExecutorEvent[] = []
    const o = order([unit('U-1', { touches: ['src/auth/session.ts'] })])
    await execute(planOf(o), deps(ok, events))
    expect(events.find((e) => e.type === 'inspection')).toMatchObject({ required: true })
  })
}

describe('executor edge cases', () => {
  describe('slash commands', slashCommandsTests)
  describe('joins', executorJoinsTests)
  describe('steps not about a unit and completion', stepsNotAboutAUnitAndCompletionTests)
  describe('verdicts per criterion', verdictsPerCriterionTests)
})

function slashCommandsTests() {
  it('hands a slash-command step to an agent with the command as the prompt', async () => {
    const run = vi.fn(ok)
    const shell = `
schemaVersion: 1
id: direct
steps:
  - id: check
    kind: run
    command: /speckit-plan
`
    const o = order([])
    await execute(planOf(o, recipe(shell)), deps(run))
    // The command, and an instruction not to reinterpret it. A command handed
    // to an agent is an invitation to fix what it reports.
    expect(run.mock.calls[0][0].prompt).toContain('/speckit-plan')
    expect(run.mock.calls[0][0].prompt).toContain('Do not fix what it reports')
  })
}

function executorJoinsTests() {
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
    const outcome = await execute(planOf(o, recipe(nameless)), {
      ...deps(run),
      runStep: async () => 0,
    })
    expect(run).not.toHaveBeenCalled()
    expect(outcome.graph.nodes.find((n) => n.id === 'join')?.state).toBe('passed')
  })
}

function stepsNotAboutAUnitAndCompletionTests() {
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
    const outcome = await execute(planOf(o, recipe(shell)), deps(ok))
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
    const outcome = await execute(planOf(o, recipe(shell)), deps(ok))
    expect(outcome.complete).toBe(true)
  })
}

function verdictsPerCriterionTests() {
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
    const outcome = await execute(planOf(o, recipe(CHECKED)), deps(ok))
    expect(outcome.verdicts.map((v) => v.criterionId).sort()).toEqual(['AC-1', 'AC-2'])
  })
}

describe('what the agent is actually told', () => {
  describe('the order and the unit', theOrderAndTheUnitTests)
  describe('house rules', houseRulesTests)
})

function theOrderAndTheUnitTests() {
  it('carries the order, not just the role prompt', async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1')], {
      title: 'Refuse an expired refresh token',
      intent: { problem: 'expired tokens are accepted', outcome: 'they are refused', nonGoals: [] },
    })
    await execute(planOf(o), deps(run))

    const prompt = run.mock.calls[0][0].prompt
    expect(prompt).toContain('Build one unit') // the role's own words
    expect(prompt).toContain('Refuse an expired refresh token')
    expect(prompt).toContain('expired tokens are accepted')
  })

  it('names the unit, what it may touch, and what makes it done', async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1')])
    await execute(planOf(o), deps(run))

    const prompt = run.mock.calls[0][0].prompt
    expect(prompt).toContain('U-1')
    expect(prompt).toContain('src/U-1.ts')
    expect(prompt).toContain('AC-1')
  })
}

function houseRulesTests() {
  it('carries the house rules it was given', async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1')])
    await execute(planOf(o), {
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
}

describe('the budget is part of the agreement', () => {
  describe('a breach', aBreachTests)
  describe('the record and normal runs', theRecordAndNormalRunsTests)
})

function aBreachTests() {
  it('stops and asks rather than running past a wall-clock breach', async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1'), unit('U-2')])
    const outcome = await execute(planOf(o), {
      ...deps(run),
      observe: () => ({ elapsedMinutes: 10_000 }),
    })

    expect(run).not.toHaveBeenCalled()
    expect(outcome.gates.map((g) => g.rule)).toContain('budget.exceeded')
    expect(outcome.gates[0].why).toContain('10000')
    expect(outcome.shippable).toBe(false)
  })

  it('says which budget, in the operator own terms', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      observe: () => ({ elapsedMinutes: 10_000 }),
    })
    expect(outcome.gates[0].summary).toContain('wall clock')
  })
}

function theRecordAndNormalRunsTests() {
  it('records which budget it stopped at, with the limit and the count', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      observe: () => ({ elapsedMinutes: 10_000 }),
    })
    expect(outcome.gates[0].breach).toEqual({
      kind: 'wall_clock',
      limit: o.budgets.wallClockMinutes,
      actual: 10_000,
    })
  })

  it('runs normally when it is inside them', async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1')])
    await execute(planOf(o), {
      ...deps(run),
      observe: () => ({ elapsedMinutes: 1 }),
    })
    expect(run).toHaveBeenCalled()
  })
}

describe('a repeated failure becomes a decision', () => {
  it('raises a gate on the second failure rather than trying a third time', async () => {
    const o = order([unit('U-1')])
    const failing = deps(async (i) => ({ sessionId: `s-${i.node.id}`, exitCode: 1 }))

    let graph = buildRunGraph(o, recipe())
    graph = (await execute({ order: o, recipe: recipe(), graph }, failing)).graph
    // Retried deliberately, as the operator's "send back" does: the scheduler
    // does not re-offer a failed node on its own.
    graph = retry(graph, 'build:U-1')
    const second = await execute({ order: o, recipe: recipe(), graph }, failing)

    expect(second.gates.map((g) => g.rule)).toContain('verify.repeat-fail')
    expect(second.gates.find((g) => g.rule === 'verify.repeat-fail')?.why).toMatch(/not a retry/)
  })

  it('does not ask about the node on its first failure — once is bad luck', async () => {
    const o = order([unit('U-1')])
    const first = await execute(
      planOf(o),
      deps(async (i) => ({ sessionId: `s-${i.node.id}`, exitCode: 1 }))
    )
    // A second attempt is owed first, so nothing here is "attempt three is a
    // decision" — but the graph still cannot move on its own, and that gate
    // names the node the Inbox's "Send back" would have to retry.
    const stalled = first.gates.find((g) => g.summary.endsWith('cannot go any further on its own'))
    expect(stalled?.nodeId).toBe('build:U-1')
  })
})

describe('the ladder', () => {
  describe('when it is climbed', whenItIsClimbedTests)
  describe('what it reports', whatItReportsTests)
  describe('the pictures step', picturesStepTests)
  describe("the profile's added checks", profileChecksTests)
  describe('step output', stepOutputTests)
  describe('the question it asks', theQuestionItAsksTests)
  describe('lights-out runs', lightsOutRunsTests)
})

/** Fails Lint (and writes a log for it) until `passAfter` runs of it have happened. */
function lintRunner(exit: (n: number) => number) {
  let n = 0
  return async (step: { name: string }, logPath: string) => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    const code = step.name === 'Lint' ? exit((n += 1)) : 0
    fs.writeFileSync(logPath, `${step.name} exited ${code} at ${path.basename(logPath)}\n`)
    return code
  }
}
const base = (over: Record<string, unknown> = {}) => ({
  ...deps(vi.fn(ok)),
  autonomy: 'standard' as const,
  ...over,
})
function sentBack(o: WorkOrder, n: number, option = 'send_back') {
  return Array.from({ length: n }, (_, i) => ({
    ...raiseGate({
      id: `WO-1-verify.repeat-fail-${i + 1}`,
      rule: 'verify.repeat-fail',
      orderId: o.id,
      summary: 's',
      why: 'w',
      at: '2026-09-06T10:00:00.000Z',
    }),
    decision: {
      option,
      by: 'operator' as const,
      note: '',
      at: '2026-09-06T10:05:00.000Z',
    },
  }))
}
function logRunner(log: (n: number) => { code: number; text: string }) {
  let n = 0
  return async (step: { name: string }, logPath: string) => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    const { code, text } = step.name === 'Lint' ? log((n += 1)) : { code: 0, text: '' }
    fs.writeFileSync(logPath, `${text}\n`)
    return code
  }
}

function whenItIsClimbedTests() {
  it('is climbed once the units are done', async () => {
    const steps: string[] = []
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), {
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
    const outcome = await execute(planOf(o, recipe(PAUSING)), {
      ...deps(vi.fn(ok)),
      runStep,
    })
    expect(outcome.ladder).toBeNull()
    expect(runStep).not.toHaveBeenCalled()
  })
}

function profileChecksTests() {
  it("runs the checks the repository's profile adds, at their rung", async () => {
    const ran: string[] = []
    const o = order([unit('U-1')])
    const additional = [{ name: 'Type check', command: 'make types', rung: 'L1' as const }]
    const environment = { ...o.context.environment, additional }
    const outcome = await execute(planOf({ ...o, context: { ...o.context, environment } }), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async (step) => {
        ran.push(step.command ?? '')
        return 0
      },
    })
    expect(ran).toContain('make types')
    expect(outcome.ladder?.steps.find((s) => s.name === 'Type check')).toMatchObject({
      result: 'pass',
    })
  })
}

const interfaceOrder = (pictures: string | null) => {
  const o = order([unit('U-1', { touchesInterface: true })])
  const environment = { ...o.context.environment, pictures }
  return { ...o, context: { ...o.context, environment } }
}
const climbWith = (pictures: string | null, taken: { folder: string; images: string[] } | null) =>
  execute(planOf(interfaceOrder(pictures)), {
    ...deps(vi.fn(ok)),
    autonomy: 'lights-out',
    runStep: async (step) => (step.name === 'Pictures' && taken?.images.length === 0 ? null : 0),
    picturesTaken: () => taken,
  })
const picturesOf = (outcome: Awaited<ReturnType<typeof climbWith>>) =>
  outcome.ladder?.steps.find((s) => s.name === 'Pictures')

function picturesStepTests() {
  it('carries the images the step left onto its outcome', async () => {
    const taken = { folder: '/runs/pictures-1', images: ['/runs/pictures-1/a.png'] }
    expect(picturesOf(await climbWith('npm run shots', taken))).toMatchObject({
      result: 'pass',
      pictures: taken,
    })
  })

  it('reports exit 0 with no images as not measured, naming why', async () => {
    const none = { folder: '/runs/pictures-1', images: [] }
    expect(picturesOf(await climbWith('npm run shots', none))).toMatchObject({
      result: 'not_measured',
      reason: 'the pictures command left no images',
    })
  })

  it('is not measured, never a pass, when there is no pictures command', async () => {
    const outcome = await climbWith(null, null)
    expect(picturesOf(outcome)).toMatchObject({
      result: 'not_measured',
      reason: 'this repository has no pictures command',
    })
  })
}

function whatItReportsTests() {
  it('carries what it could not measure, rather than reporting a pass', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), {
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
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 1,
    })
    expect(outcome.ladder?.ok).toBe(false)
    expect(outcome.shippable).toBe(false)
  })
}

function stepOutputTests() {
  it("keeps each step's output and shows the failed step's last lines on the gate", async () => {
    const o = order([unit('U-1')])
    const logs: string[] = []
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'standard',
      runStep: async (step, logPath) => {
        logs.push(logPath)
        fs.mkdirSync(path.dirname(logPath), { recursive: true })
        fs.writeFileSync(logPath, `running ${step.command}\nError: Process failed to launch!\n`)
        return step.name === 'Lint' ? 1 : 0
      },
    })
    const gate = outcome.gates.find((g) => g.rule === 'verify.repeat-fail')
    expect(new Set(logs).size).toBe(logs.length)
    expect(logs.every((p) => p.startsWith(dataRoot))).toBe(true)
    expect(gate?.why).toContain('Lint failed with exit code 1')
    expect(gate?.evidence).toEqual([
      expect.objectContaining({
        kind: 'stdout',
        exitCode: 1,
        excerpt: expect.stringContaining('Process failed to launch!'),
      }),
    ])
  })
}

function theQuestionItAsksTests() {
  it('asks about a failed climb where the setting is asking at all', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'standard',
      runStep: async () => 1,
    })
    expect(outcome.gates.map((g) => g.rule)).toContain('verify.repeat-fail')
  })

  it('names the step and its command in plain words, never a rung code', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'standard',
      runStep: async () => 1,
    })
    const gate = outcome.gates.find((g) => g.rule === 'verify.repeat-fail')
    expect(gate?.why).toMatch(/exit code/)
    expect(gate?.why).not.toMatch(/\bL\d\b/)
    const firstStep = outcome.ladder?.steps.find((s) => s.result === 'fail')
    expect(firstStep).toBeDefined()
    expect(gate?.why).toContain(firstStep?.name)
  })
}

function lightsOutRunsTests() {
  it('does not interrupt a lights-out run over it, and still refuses to ship', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 1,
    })
    // Lights-out does not stop you mid-run; it never marks anything ready
    // without you either, which is the rule that stays live at every setting.
    expect(outcome.gates.map((g) => g.rule)).not.toContain('verify.repeat-fail')
    expect(outcome.shippable).toBe(false)
  })
}

describe('a failed final climb', () => {
  describe('a check that fails once', failedOnceTests)
  describe('sending back', sendingBackTests)
  describe('the send-back limit', theSendBackLimitTests)
  describe('accepted debt', acceptedDebtTests)
  describe('a document outside the checkout', documentOutsideTheCheckoutTests)
  describe('preparing the checkout again', preparingAgainTests)
  describe('the question after it', afterPreparingTests)
  describe('without a prepare command', withoutPrepareTests)
  describe('a log is never read', noLogReadingTests)
})

const TESTS = "The unit's own tests"

/** Runs the unit tests with `exit(n)` for the n-th run, and every other step green. */
function testsRunner(exit: (n: number) => number, seen: { options: unknown[] } = { options: [] }) {
  let n = 0
  return async (
    step: { name: string },
    logPath: string,
    options?: { fresh?: boolean }
  ): Promise<number> => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    const code = step.name === TESTS ? exit((n += 1)) : 0
    if (step.name === TESTS) seen.options.push(options)
    fs.writeFileSync(logPath, `${step.name} exited ${code} at ${path.basename(logPath)}\n`)
    return code
  }
}

function failedOnceTests() {
  it('a check that fails once fails the final check, with no second run of it on the same commit', async () => {
    const o = order([unit('U-1')])
    const seen = { options: [] as unknown[] }
    const outcome = await execute(
      planOf(o),
      base({ runStep: testsRunner((n) => (n === 1 ? 1 : 0), seen) })
    )
    const gate = outcome.gates.find((g) => g.rule === 'verify.repeat-fail')
    expect(seen.options).toEqual([undefined])
    expect(gate?.why).toContain(`${TESTS} failed with exit code 1`)
    expect(gate?.evidence).toEqual([
      expect.objectContaining({ exitCode: 1, excerpt: expect.stringContaining('exited 1') }),
    ])
    expect(outcome.ladder?.ok).toBe(false)
    expect(outcome.shippable).toBe(false)
  })

  it('runs a passing test step once', async () => {
    const o = order([unit('U-1')])
    const seen = { options: [] as unknown[] }
    const outcome = await execute(planOf(o), base({ runStep: testsRunner(() => 0, seen) }))
    expect(seen.options).toEqual([undefined])
    expect(outcome.gates).toEqual([])
    expect(outcome.ladder?.ok).toBe(true)
  })
}

function sendingBackTests() {
  it('sends the change back when the base passes the same check', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), base({ runStep: lintRunner(() => 1) }))
    const gate = outcome.gates.find((g) => g.rule === 'verify.repeat-fail')
    expect(gate?.why).not.toContain('main')
    expect(gate?.options.map((o) => o.id)).toContain('send_back')
  })
}

function theSendBackLimitTests() {
  it('stops offering send back after two of them', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(
      planOf(o),
      base({
        runStep: lintRunner(() => 1),
        priorGates: sentBack(o, 2),
      })
    )
    const gate = outcome.gates.find((g) => g.rule === 'verify.repeat-fail')
    expect(gate?.options.map((o) => o.id)).toEqual(['take_over', 'accept_debt', 'hold'])
    expect(gate?.why).toContain('It has been sent back twice; take over, accept the debt, or hold.')
  })

  it('still offers send back after one', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(
      planOf(o),
      base({ runStep: lintRunner(() => 1), priorGates: sentBack(o, 1) })
    )
    const gate = outcome.gates.find((g) => g.rule === 'verify.repeat-fail')
    expect(gate?.options.map((o) => o.id)).toContain('send_back')
  })
}

function acceptedDebtTests() {
  it('raises the gate when nobody has decided', async () => {
    const outcome = await execute(
      planOf(order([unit('U-1')])),
      base({ runStep: lintRunner(() => 1) })
    )
    expect(outcome.gates.map((g) => g.rule)).toEqual(['verify.repeat-fail'])
    expect(outcome.shippable).toBe(false)
  })

  it('raises no gate, records the debt and ships once the operator accepted it', async () => {
    const o = order([unit('U-1')])
    const record = vi.fn(async () => undefined)
    const outcome = await execute(
      planOf(o),
      base({
        runStep: lintRunner(() => 1),
        priorGates: sentBack(o, 1, 'accept_debt'),
        record,
      })
    )
    expect(outcome.gates).toEqual([])
    expect(outcome.ladder?.ok).toBe(false)
    expect(outcome.shippable).toBe(true)
    expect(record).toHaveBeenCalledWith(
      'verify.debt_accepted',
      'Lint',
      expect.stringMatching(/^Lint .* failed with exit code 1; you accepted this debt/)
    )
  })
}

function documentOutsideTheCheckoutTests() {
  it('climbs nothing, raises nothing and ships when the change is not the end', async () => {
    const runStep = vi.fn(async () => 1)
    const outcome = await execute(
      planOf(order([unit('U-1')])),
      base({ runStep, shipsChange: async () => false })
    )
    expect(runStep).not.toHaveBeenCalled()
    expect(outcome.gates).toEqual([])
    expect(outcome.ladder).toBeNull()
    expect(outcome.shippable).toBe(true)
  })
}

/** A log the old rule read as a broken install; nothing reads it now. */
const MISSING = "Error: Cannot find package '@axe-core/playwright' imported from /w/a.spec.ts"

const withPrepare = (o: WorkOrder, prepare: string | null): WorkOrder => ({
  ...o,
  context: { ...o.context, environment: { ...o.context.environment, prepare } },
})

function preparingAgainTests() {
  it('records verify.reprepared and ships when the check passes after the checkout is prepared again', async () => {
    const o = withPrepare(order([unit('U-1')]), 'make deps')
    let prepared = false
    const reinstall = vi.fn(async () => {
      prepared = true
      return 0
    })
    const record = vi.fn(async () => undefined)
    const outcome = await execute(
      planOf(o),
      base({ runStep: lintRunner(() => (prepared ? 0 : 1)), reinstall, record })
    )
    expect(reinstall).toHaveBeenCalledTimes(1)
    expect(reinstall).toHaveBeenCalledWith('change', expect.stringMatching(/\.log$/))
    expect(outcome.gates).toEqual([])
    expect(outcome.ladder?.ok).toBe(true)
    expect(record).toHaveBeenCalledWith(
      'verify.reprepared',
      'Lint',
      expect.stringMatching(/the checkout was broken, not the code\. Earlier log: .*\.log\./)
    )
  })
}

function afterPreparingTests() {
  it('raises the gate when the check still fails after the checkout is prepared again', async () => {
    const o = withPrepare(order([unit('U-1')]), 'make deps')
    const reinstall = vi.fn(async () => 0)
    const record = vi.fn(async () => undefined)
    const outcome = await execute(
      planOf(o),
      base({ runStep: lintRunner(() => 1), reinstall, record })
    )
    expect(reinstall).toHaveBeenCalledTimes(1)
    expect(record).not.toHaveBeenCalledWith(
      'verify.reprepared',
      expect.anything(),
      expect.anything()
    )
    expect(outcome.gates.map((g) => g.rule)).toContain('verify.repeat-fail')
  })
}

function withoutPrepareTests() {
  it('skips the question when the order has no prepare command', async () => {
    const o = withPrepare(order([unit('U-1')]), null)
    const reinstall = vi.fn(async () => 0)
    const outcome = await execute(planOf(o), base({ runStep: lintRunner(() => 1), reinstall }))
    expect(reinstall).not.toHaveBeenCalled()
    expect(outcome.gates.map((g) => g.rule)).toContain('verify.repeat-fail')
  })
}

function noLogReadingTests() {
  const missingPackage = (n: number) => ({ code: n > 0 ? 1 : 0, text: MISSING })

  it('treats a missing-package log like any other failure when there is no prepare command', async () => {
    const o = withPrepare(order([unit('U-1')]), null)
    const reinstall = vi.fn(async () => 0)
    const outcome = await execute(
      planOf(o),
      base({ runStep: logRunner(missingPackage), reinstall })
    )
    expect(reinstall).not.toHaveBeenCalled()
    expect(outcome.gates.map((g) => g.rule)).toContain('verify.repeat-fail')
  })

  it('never says the dependencies are broken, whatever the log says', async () => {
    const o = withPrepare(order([unit('U-1')]), 'make deps')
    const outcome = await execute(
      planOf(o),
      base({
        runStep: logRunner(missingPackage),
        reinstall: vi.fn(async () => 1),
      })
    )
    const gate = outcome.gates.find((g) => g.rule === 'verify.repeat-fail')
    expect(gate?.why).not.toMatch(/install|dependencies/)
  })
}

describe('shippable', () => {
  describe('everything passed', everythingPassedTests)
  describe('open gates and failures', openGatesAndFailuresTests)
})

function everythingPassedTests() {
  it('is true only when everything passed and nothing is waiting on a person', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.complete).toBe(true)
    expect(outcome.gates).toEqual([])
    expect(outcome.shippable).toBe(true)
  })
}

function openGatesAndFailuresTests() {
  it('is false for a complete graph with an open gate', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o, recipe(PAUSING)), {
      ...deps(vi.fn(ok)),
      runStep: async () => 0,
    })
    expect(outcome.gates.length).toBeGreaterThan(0)
    expect(outcome.shippable).toBe(false)
  })

  it('is false when a unit failed', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), {
      ...deps(async (i) => ({ sessionId: `s-${i.node.id}`, exitCode: 1 })),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.shippable).toBe(false)
  })
}

describe('raising a gate where nobody can see it', () => {
  it('still stops, rather than continuing past a decision nobody took', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o, recipe(PAUSING)), deps(vi.fn(ok)))
    // No `raise` seam at all — the gate is still on the outcome, and the run
    // is still not shippable.
    expect(outcome.gates.length).toBeGreaterThan(0)
    expect(outcome.shippable).toBe(false)
  })

  it('hands each gate to the seam when there is one', async () => {
    const raise = vi.fn(async () => undefined)
    const o = order([unit('U-1')])
    await execute(planOf(o, recipe(PAUSING)), {
      ...deps(vi.fn(ok)),
      raise,
    })
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ rule: 'unit.boundary' }))
  })
})

describe('one conversation per lane', () => {
  describe('resumable roles', resumableRolesTests)
  describe('roles that may not resume and new lanes', rolesThatMayNotResumeAndNewLanesTests)
})

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
    rule: verify.repeat-fail
    defaultIfIgnored: hold
    after: [build]
`

function resumableRolesTests() {
  it('carries a resumable role on in the session the lane already has', async () => {
    const run = vi.fn(ok)
    // Two units for the one role. The builder declares `allowResume: true`, so
    // its second unit continues where its first left off rather than being a
    // fresh agent that has read nothing.
    const o = order([unit('U-1'), unit('U-2', { dependsOn: ['U-1'] })])
    await execute(planOf(o), {
      ...deps(run),
      sessionFor: (_lane, role) => (role === 'builder' ? 'sess-lane-1' : undefined),
    })
    const second = run.mock.calls.find((c) => c[0].node.id.includes('U-2'))
    expect(second?.[0].resumeSessionId).toBe('sess-lane-1')
  })

  it("asks for its own role's conversation, not the lane's last one", async () => {
    // The role is half the key, so a node cannot be handed a conversation that
    // belonged to somebody else — there is nothing under its own name to give.
    const run = vi.fn(ok)
    const asked: (string | null)[] = []
    const o = order([unit('U-1')])
    await execute(planOf(o), {
      ...deps(run),
      sessionFor: (_lane, role) => {
        asked.push(role)
        return role === 'architect' ? 'sess-architect' : undefined
      },
    })
    expect(asked).toContain('builder')
    expect(run.mock.calls[0][0].resumeSessionId).toBeUndefined()
  })
}

function rolesThatMayNotResumeAndNewLanesTests() {
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
    await execute(planOf(o, recipe(verifying)), {
      ...deps(run),
      sessionFor: (_lane, role) => (role === 'builder' ? 'sess-lane-1' : undefined),
      runStep: async () => 0,
    })
    // The verifier's fresh context is the whole point of it; being offered the
    // builder's conversation would hand it the builder's justification.
    expect(run.mock.calls[0][0].resumeSessionId).toBeUndefined()
  })

  it('starts fresh when the lane has no conversation yet', async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1')])
    await execute(planOf(o), deps(run))
    expect(run.mock.calls[0][0].resumeSessionId).toBeUndefined()
  })
}

describe("a recipe's own gate rule", () => {
  describe('the rule raised', theRuleRaisedTests)
  describe('ship markers', shipMarkersTests)
  describe('unknown rules', unknownRulesTests)
})

const bugfix = `
schemaVersion: 1
id: direct
steps:
  - id: reproduce
    kind: run
    command: npm test
    expect: { exit_code: '!= 0' }
`

function theRuleRaisedTests() {
  it('is the one raised, not a hardcoded default', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o, recipe(risky)), {
      ...deps(vi.fn(ok)),
      runStep: async () => 0,
    })
    expect(outcome.gates.map((g) => g.rule)).toContain('verify.repeat-fail')
    expect(outcome.gates.map((g) => g.rule)).not.toContain('unit.boundary')
  })

  it('brings the options that rule offers with it', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o, recipe(risky)), {
      ...deps(vi.fn(ok)),
      runStep: async () => 0,
    })
    const gate = outcome.gates.find((g) => g.rule === 'verify.repeat-fail')
    expect(gate?.options.map((o) => o.id)).toContain('send_back')
    expect(gate?.defaultIfIgnored).toBe('hold')
  })
}

function shipMarkersTests() {
  it("passes a recipe's terminal ship marker rather than asking about it", async () => {
    // "Mark it ready?" before a draft exists is a question with no answer. The
    // real one is raised once shipping has opened something.
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      runStep: async () => 0,
    })
    expect(outcome.gates).toEqual([])
    expect(outcome.complete).toBe(true)
    expect(outcome.shippable).toBe(true)
  })
}

function unknownRulesTests() {
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
    const outcome = await execute(planOf(o, recipe(odd)), deps(vi.fn(ok)))
    expect(outcome.gates.map((g) => g.rule)).toContain('unit.boundary')
  })
}

describe('a step that promised something about its own result', () => {
  describe('kept and broken promises', keptAndBrokenPromisesTests)
  describe('no promise', noPromiseTests)
})

function keptAndBrokenPromisesTests() {
  it('fails when the promise was not kept, however the command exited', async () => {
    // The reproduction has to *fail* before the fix exists — the one place a
    // passing command is the wrong answer.
    const o = order([])
    const record = vi.fn(async () => undefined)
    const outcome = await execute(planOf(o, recipe(bugfix)), {
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
    const outcome = await execute(planOf(o, recipe(bugfix)), {
      ...deps(vi.fn(ok)),
      runCommand: async () => 1,
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.graph.nodes.find((n) => n.id === 'reproduce')?.state).toBe('passed')
  })
}

function noPromiseTests() {
  it('leaves a step that promised nothing judged on its exit status alone', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.complete).toBe(true)
  })
}

describe('the grade the change turned out to deserve', () => {
  describe('regrading', regradingTests)
  describe('declared triggers', declaredTriggersTests)
  describe('the planned grade', thePlannedGradeTests)
  describe('an approved regrade', anApprovedRegradeTests)
  describe('a held regrade', aHeldRegradeTests)
  describe('an ordinary change', anOrdinaryChangeTests)
})

function regradingTests() {
  it('regrades from what was touched, not from what the plan predicted', async () => {
    const o = order([unit('U-1', { touches: ['src/main/auth/session.ts'] })], {
      risk: { grade: 'P3', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    })
    const outcome = await execute(planOf(o), {
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
}

function declaredTriggersTests() {
  it('does not stop for a trigger the agreed plan already declared', async () => {
    const o = order([unit('U-1', { touches: ['src/package.json'] })], {
      risk: { grade: 'P3', triggers: ['new_dependency'], blastRadius: ['src/'], criticalPaths: [] },
    })
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      runStep: async () => 0,
    })
    expect(outcome.gates.filter((g) => g.rule === 'risk.p0')).toEqual([])
  })

  it('still stops for a trigger the plan did not declare', async () => {
    const o = order([unit('U-1', { touches: ['src/package.json'] })], {
      risk: { grade: 'P3', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    })
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      runStep: async () => 0,
    })
    expect(outcome.gates.find((g) => g.rule === 'risk.p0')?.why).toContain('new_dependency')
  })
}

function thePlannedGradeTests() {
  it('says it was planned as something else, when it was', async () => {
    const o = order([unit('U-1', { touches: ['src/main/auth/session.ts'] })], {
      risk: { grade: 'P3', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    })
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      runStep: async () => 0,
    })
    expect(outcome.gates.find((g) => g.rule === 'risk.p0')?.summary).toContain(
      'planned as low risk'
    )
  })
}

function anApprovedRegradeTests() {
  it('does not ask again about a regrade the operator already approved', async () => {
    const o = order([unit('U-1', { touches: ['src/main/auth/session.ts'] })], {
      risk: { grade: 'P3', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    })
    const first = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      runStep: async () => 0,
    })
    const asked = first.gates.find((g) => g.rule === 'risk.p0')
    if (asked === undefined) throw new Error('expected the regrade to be asked about')
    const approved = decide(asked, { option: 'approve', note: '', at: '2026-09-28T19:12:26.193Z' })

    const resumed = await execute(
      { order: o, recipe: recipe(), graph: first.graph },
      {
        ...deps(vi.fn(ok)),
        runStep: async () => 0,
        priorGates: [approved],
      }
    )
    expect(resumed.gates.filter((g) => g.rule === 'risk.p0')).toEqual([])
    expect(resumed.shippable).toBe(true)
  })
}

function aHeldRegradeTests() {
  it('asks again about a regrade the operator held', async () => {
    const o = order([unit('U-1', { touches: ['src/main/auth/session.ts'] })], {
      risk: { grade: 'P3', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    })
    const first = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      runStep: async () => 0,
    })
    const asked = first.gates.find((g) => g.rule === 'risk.p0')
    if (asked === undefined) throw new Error('expected the regrade to be asked about')
    const held = decide(asked, { option: 'hold', note: '', at: '2026-09-28T19:12:26.193Z' })

    const resumed = await execute(
      { order: o, recipe: recipe(), graph: first.graph },
      {
        ...deps(vi.fn(ok)),
        runStep: async () => 0,
        priorGates: [held],
      }
    )
    const again = resumed.gates.find((g) => g.rule === 'risk.p0')
    expect(again).toBeDefined()
    // A fresh id, or saving it overwrites the decision already on file.
    expect(again?.id).not.toBe(asked.id)
  })
}

function anOrdinaryChangeTests() {
  it('leaves an ordinary change where the plan put it', async () => {
    const o = order([unit('U-1', { touches: ['src/readme.ts'] })], {
      risk: { grade: 'P3', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    })
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.inspection.required).toBe(false)
  })
}

describe('a graph that cannot move on its own', () => {
  it('says so, rather than reporting a run waiting on a gate that does not exist', async () => {
    // U-2 depends on U-1; U-1 fails twice, so nothing is runnable and nothing
    // is finished.
    const o = order([unit('U-1'), unit('U-2', { dependsOn: ['U-1'] })])
    const failing = deps(async (i) => ({ sessionId: `s-${i.node.id}`, exitCode: 1 }))
    let graph = buildRunGraph(o, recipe())
    graph = (await execute({ order: o, recipe: recipe(), graph }, failing)).graph
    const stalled = await execute({ order: o, recipe: recipe(), graph }, failing)

    expect(stalled.shippable).toBe(false)
    const gate = stalled.gates.find((g) => g.summary.endsWith('cannot go any further on its own'))
    expect(gate).toBeDefined()
    // Names the failed node, so the Inbox's "Send back" retries something
    // rather than nothing.
    expect(gate?.nodeId).toBe('build:U-1')
  })

  it('does not call a finished run stalled', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.gates).toEqual([])
    expect(outcome.shippable).toBe(true)
  })
})

const question = `
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

describe('a shape that opens nothing (FR-019)', () => {
  describe('never shippable', neverShippableTests)
  describe('a shape that ships', aShapeThatShipsTests)
})

const refactorish = `
schemaVersion: 1
id: direct
steps:
  - id: cover
    kind: run
    command: npm test
    expect: { tests_added: '>= 1' }
`

function neverShippableTests() {
  it('is never shippable, however well it went', async () => {
    const o = order([])
    const outcome = await execute(planOf(o, recipe(question)), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    // A question is not a change. Shipping one would turn every
    // investigation into a branch.
    expect(outcome.complete).toBe(true)
    expect(outcome.ladder?.ok).toBe(true)
    expect(outcome.shippable).toBe(false)
  })

  it('is decided by the recipe having a ship step, not by a flag', () => {
    expect(opensPullRequest(recipe(question))).toBe(false)
    expect(opensPullRequest(recipe())).toBe(true)
  })
}

function aShapeThatShipsTests() {
  it('leaves a shape that does ship shipping', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.shippable).toBe(true)
  })
}

describe('an expectation nothing here can measure', () => {
  describe('recorded and judged on exit status', recordedAndJudgedOnExitStatusTests)
  describe('measurable keys', measurableKeysTests)
  describe('the bug shape', theBugShapeTests)
})

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
  const run = vi.fn(async (input: RunInput) => {
    seen.push({ role: input.role, modelTier: input.modelTier })
    return ok(input)
  })
  const o = order([unit('U-1')])
  const r = recipe(TIERED)
  await execute(planOf(o, r), deps(run as never))
  return seen
}

function recordedAndJudgedOnExitStatusTests() {
  it('is recorded, and the step is judged on its exit status instead', async () => {
    const record = vi.fn(async () => undefined)
    const o = order([])
    const outcome = await execute(planOf(o, recipe(refactorish)), {
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
}

function measurableKeysTests() {
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
    const outcome = await execute(planOf(o, recipe(both)), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.complete).toBe(false)
  })
}

function theBugShapeTests() {
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
    const outcome = await execute(planOf(o, recipe(repro)), {
      ...deps(vi.fn(ok)),
      runCommand: async () => 1,
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.graph.nodes.find((n) => n.id === 'reproduce')?.state).toBe('passed')
  })
}

// The settings panel has always said the operator's model applies "unless a
// role asks for something else". Nothing read `modelTier`, so it applied to
// everything — the scribe, which four recipes use and which every role file
// marks `fast`, ran on the deep model like the architect.
describe('the tier a role asked for', () => {
  describe('scribe and builder', scribeAndBuilderTests)
  describe('a node with no role', aNodeWithNoRoleTests)
})

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

function scribeAndBuilderTests() {
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
}

function aNodeWithNoRoleTests() {
  it('asks for the deep tier for a node with no role, so the operator choice stands', async () => {
    const seen: string[] = []
    const run = vi.fn(async (input: RunInput) => {
      if (input.role === null) seen.push(input.modelTier)
      return ok(input)
    })
    const roleless = `
schemaVersion: 1
id: direct
steps:
  - id: check
    kind: run
    command: /review the change
`
    const o = order([unit('U-1')])
    await execute(planOf(o, recipe(roleless)), deps(run as never))
    // Said out loud: with no role-less node reached, the check below asserts nothing.
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((tier) => tier === 'deep')).toBe(true)
  })
}

// Two step fields that parsed and reached nothing. `deadlineMinutes` is what
// makes "what happens when nobody answers" a promise a gate can keep, and
// `context: fresh` is how a shape demands a clean conversation from a role
// that is otherwise allowed to resume.
describe('what a step declares about its gate and its conversation', () => {
  describe('deadlines', executorDeadlinesTests)
  describe('fresh conversations', freshConversationsTests)
})

function executorDeadlinesTests() {
  it('gives the gate the deadline its step declared', async () => {
    const raised: Gate[] = []
    const o = order([unit('U-1')])
    const r = recipe(DEADLINE)
    await execute(planOf(o, r), {
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
    await execute(planOf(o, r), {
      ...deps(ok),
      autonomy: 'escorted' as const,
      raise: async (gate: Gate) => {
        raised.push(gate)
      },
    })
    expect(raised.find((g) => g.rule === 'unit.boundary')?.deadline).toBeNull()
  })
}

function freshConversationsTests() {
  it('offers no session to resume where the step asked for a fresh one', async () => {
    const seen: { node: string; resumeSessionId: string | undefined }[] = []
    const run = vi.fn(async (input: RunInput) => {
      seen.push({ node: input.node.id, resumeSessionId: input.resumeSessionId })
      return ok(input)
    })
    // Two units, so the builder has a second node of its own role to resume
    // into — which is the case the step's `context: fresh` has to override.
    const o = order([unit('U-1'), unit('U-2', { dependsOn: ['U-1'] })])
    const r = recipe(FRESH)
    await execute(planOf(o, r), {
      ...deps(run as never),
      // The builder may resume, and one is on offer for its lane. The step is
      // the only thing that should stop it being taken.
      sessionFor: (_lane, role) => (role === 'builder' ? 'sess-lane-1' : undefined),
    })
    const fresh = seen.filter((s) => s.node.includes('recheck'))
    expect(fresh.length).toBeGreaterThan(0)
    for (const step of fresh) expect(step.resumeSessionId).toBeUndefined()
    const resumed = seen.filter((s) => s.node.includes('build'))
    expect(resumed.length).toBeGreaterThan(0)
    expect(resumed.some((s) => s.resumeSessionId === 'sess-lane-1')).toBe(true)
  })
}

// The graph on disk is what `run.observe` reads, and it used to be written
// once when the run started and once when it ended. For the whole of a run the
// Floor therefore showed every node `waiting` while agents were working in
// their worktrees — the one surface whose purpose is watching a run, showing
// the snapshot it began with. A live run is what made it obvious.
describe('writing the graph down as it changes', () => {
  describe('every state', everyStateTests)
  describe('running before passed', runningBeforePassedTests)
  describe('an unwritable graph', anUnwritableGraphTests)
  describe('a slow write', aSlowWriteTests)
})

function everyStateTests() {
  it('persists every state the run passes through, not only the last', async () => {
    const seen: string[][] = []
    const o = order([unit('U-1')])
    await execute(planOf(o), {
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
}

function runningBeforePassedTests() {
  it('records a node as running before it records it as passed', async () => {
    const order_ = order([unit('U-1')])
    const states: string[] = []
    await execute(planOf(order_), {
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
}

function aSlowWriteTests() {
  it('writes the graph in the order it changed, so a slow write never lands last', async () => {
    const plan = planOf(order([unit('U-1')]))
    const started = withNode(plan.graph, 'build:U-1', { state: 'running', sessionId: 'sess-1' })
    const passed = withNode(started, 'build:U-1', { state: 'passed' })
    let disk: unknown = null
    let releaseFirst = (): void => undefined
    const firstLanded = new Promise<void>((resolve) => (releaseFirst = resolve))
    const run = new Execution(plan, {
      ...deps(vi.fn(ok)),
      // The first write is slow, as a busy disk is: it lands only when the test says so.
      persist: async (graph) => {
        if (graph === started) await firstLanded
        disk = graph
      },
    })

    const first = run.advance(started)
    const second = run.advance(passed)
    releaseFirst()
    await Promise.all([first, second])

    expect(disk).toBe(passed)
  })
}

function anUnwritableGraphTests() {
  it('carries on when the graph cannot be written — a run is not a report', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
      persist: async () => {
        throw new Error('the disk is full')
      },
    })
    expect(outcome.complete).toBe(true)
  })
}

/** A wave that never finishes, which is what a hung agent looks like. */
const hangs = () => new Promise<StartedRun>(() => {})

function clock() {
  let minutes = 0
  return {
    observe: () => ({ elapsedMinutes: minutes }),
    wait: async (_ms: number) => {
      minutes += 10
    },
    budgetPollMs: 1,
  }
}

// The budget was read between waves, and the loop then parked on the wave. So
// the one case a wall-clock budget exists for — an agent that never comes
// back — is the one case it could not catch. A live run sat forty minutes past
// a twenty-minute budget with nothing to show for it.
describe('a budget exceeded while agents are still running', () => {
  describe('stopping', executorStoppingTests)
  describe('a silenced rule', aSilencedRuleTests)
  describe('inside the budget', insideTheBudgetTests)
})

/** A clock that starts where the test says and moves on every poll. A fixed clock plus a wave that
 * never settles is an infinite loop with no delay in it — which is a busy spin, not a test. */
function from(minutes: number) {
  let now = minutes
  return {
    observe: () => ({ elapsedMinutes: now }),
    wait: async (_ms: number) => {
      now += 0.5
    },
    budgetPollMs: 1,
  }
}
async function runFrom(minutes: number) {
  const o = order([unit('U-1')], {
    budgets: { agents: 2, wallClockMinutes: 20, tokens: null },
  })
  return execute(planOf(o), {
    ...deps(hangs as never),
    autonomy: 'escorted',
    ...from(minutes),
  })
}

function executorStoppingTests() {
  it('stops the run rather than waiting for the wave that will not end', async () => {
    const o = order([unit('U-1')], {
      budgets: { agents: 2, wallClockMinutes: 20, tokens: null },
    })
    const outcome = await execute(planOf(o), {
      ...deps(hangs as never),
      autonomy: 'escorted',
      ...clock(),
    })
    expect(outcome.gates.map((g) => g.rule)).toContain('budget.exceeded')
  })

  it('says the agents were not thrown away, because they were not', async () => {
    const o = order([unit('U-1')], {
      budgets: { agents: 2, wallClockMinutes: 20, tokens: null },
    })
    const outcome = await execute(planOf(o), {
      ...deps(hangs as never),
      autonomy: 'escorted',
      ...clock(),
    })
    const gate = outcome.gates.find((g) => g.rule === 'budget.exceeded')
    expect(gate?.why).toContain('still in their terminals')
  })
}

function aSilencedRuleTests() {
  it('stops even where the setting silences the rule — a budget is not a preference', async () => {
    const o = order([unit('U-1')], {
      budgets: { agents: 2, wallClockMinutes: 20, tokens: null },
    })
    const outcome = await execute(planOf(o), {
      ...deps(hangs as never),
      autonomy: 'lights-out',
      ...clock(),
    })
    // `budget.exceeded` is unconditional, so it is raised at every setting —
    // and the run is over either way.
    expect(outcome.shippable).toBe(false)
    expect(outcome.complete).toBe(false)
  })
}

function insideTheBudgetTests() {
  it('leaves a wave that finishes inside its budget completely alone', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
      observe: () => ({ elapsedMinutes: 1 }),
      wait: async () => undefined,
      budgetPollMs: 1,
    })
    expect(outcome.complete).toBe(true)
    expect(outcome.gates.map((g) => g.rule)).not.toContain('budget.exceeded')
  })

  it('still works with no clock injected at all, which is every existing caller', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.complete).toBe(true)
  })
}

// The budget is compared exactly, not against a rounded number of minutes. It
// was `Math.round`ed, so a run at 19:31 reported "20" and a twenty-minute
// budget could only be exceeded at 20:30 — a live run whose own deadline was
// the budget therefore never saw the gate at all.
describe('when exactly the budget is exceeded', () => {
  describe('a second before', aSecondBeforeTests)
  describe('a run well inside its budget', aRunWellInsideItsBudgetTests)
})

function aSecondBeforeTests() {
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
}

function aRunWellInsideItsBudgetTests() {
  it('never fires for a run comfortably inside its budget', async () => {
    const o = order([unit('U-1')], {
      budgets: { agents: 2, wallClockMinutes: 20, tokens: null },
    })
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
      observe: () => ({ elapsedMinutes: 19.98 }),
      wait: async () => undefined,
      budgetPollMs: 1,
    })
    expect(outcome.gates.map((g) => g.rule)).not.toContain('budget.exceeded')
    expect(outcome.complete).toBe(true)
  })
}

// A running node had no session on it. `sessionId` was written after `deps.run`
// resolved — which is when the turn is over — so for the whole life of a rung
// the graph said `running` and named nobody, and the Floor's Watch and Attach
// buttons, which render on `node.sessionId !== null`, appeared only once the
// agent was gone. The one moment you need to get into a terminal is the one
// moment there was no way in. Watched live: two builders held on permission
// questions with no control on either card.
describe('reaching a rung while it is still running', () => {
  describe('the moment the agent exists', theMomentTheAgentExistsTests)
  describe('announcing once', announcingOnceTests)
  describe('callers that never report a start', callersThatNeverReportAStartTests)
})

const READS = `
schemaVersion: 1
id: direct
steps:
  - id: challenge
    kind: agent
    role: red-team
  - id: build
    kind: fanout
    over: plan.units
    after: [challenge]
    step: { kind: agent, role: builder }
`

interface HeldAgent {
  run: (input: {
    node: { id: string }
    onStarted?: (sessionId: string) => void
  }) => Promise<StartedRun>
  releaseAgent: () => void
}

/** An agent that reports its session at once and ends its turn only when released. */
function heldAgent(): HeldAgent {
  let release: () => void = () => {}
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const run: HeldAgent['run'] = async (input) => {
    input.onStarted?.(`sess-${input.node.id}`)
    await blocked
    return { sessionId: `sess-${input.node.id}`, exitCode: 0 }
  }
  return { run, releaseAgent: () => release() }
}

function theMomentTheAgentExistsTests() {
  it('puts the session on the node the moment the agent exists', async () => {
    const o = order([unit('U-1')])
    const seen: (string | null)[] = []
    const { run, releaseAgent: released } = heldAgent()

    const running = execute(planOf(o), {
      ...deps(run as never),
      autonomy: 'lights-out',
      runStep: async () => 0,
      persist: async (graph) => {
        const node = graph.nodes.find((n) => n.id === 'build:U-1')
        if (node?.state === 'running') seen.push(node.sessionId)
      },
    })

    // The persist of the started callback lands while the agent is still held.
    await eventually(() => expect(seen).toContain('sess-build:U-1'))
    released()
    await running

    expect(seen).toContain('sess-build:U-1')
  })
}

function announcingOnceTests() {
  it('announces a start once, however the session is learned', async () => {
    const o = order([unit('U-1')])
    const events: ExecutorEvent[] = []
    const run = async (input: {
      node: { id: string }
      onStarted?: (sessionId: string) => void
    }): Promise<StartedRun> => {
      input.onStarted?.(`sess-${input.node.id}`)
      return { sessionId: `sess-${input.node.id}`, exitCode: 0 }
    }

    await execute(planOf(o), {
      ...deps(run as never, events),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })

    const starts = events.filter((e) => e.type === 'started' && e.nodeId === 'build:U-1')
    expect(starts).toHaveLength(1)
  })
}

function callersThatNeverReportAStartTests() {
  it('still names the session for a caller that never reports a start', async () => {
    // Every ladder rung and every test stub resolves without one.
    const o = order([unit('U-1')])
    const events: ExecutorEvent[] = []
    await execute(planOf(o), {
      ...deps(vi.fn(ok), events),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(events).toContainEqual({
      type: 'started',
      nodeId: 'build:U-1',
      sessionId: 'sess-build:U-1',
    })
  })
}

// Four of the standard shape's nine steps are read-only roles whose whole
// product is a document, and the Line kept none of them: the brief named no
// destination and nothing read a rung's result past its exit status. A live
// run's scout produced a complete report of where the application picks its
// colours, its node passed, and not a word survived.
describe('what a read-only rung hands back', () => {
  describe('where to write', whereToWriteTests)
  describe('collecting', collectingTests)
  describe('collecting with the session', collectingSessionTests)
  describe('a contradicting rung', aContradictingRungTests)
  describe('silenced defects and failures to collect', silencedDefectsAndFailuresToCollectTests)
})

const READS_THEN_BUILDS = `
schemaVersion: 1
id: direct
steps:
  - id: challenge
    kind: agent
    role: red-team
  - id: build
    kind: fanout
    over: plan.units
    after: [challenge]
    step: { kind: agent, role: builder }
`

function whereToWriteTests() {
  it('tells the rung where to write, under the order', async () => {
    const o = order([unit('U-1')])
    const run = vi.fn(ok)
    await execute(planOf(o, recipe(READS)), {
      ...deps(run),
      autonomy: 'lights-out',
      runStep: async () => 0,
      collect: async () => null,
    })

    const challenge = run.mock.calls.find((c) => c[0].node.id === 'challenge')?.[0]
    expect(challenge?.outputPath).toBe(
      path.join(dataRoot, 'orders', 'WO-1', 'rungs', 'challenge.json')
    )
    expect(challenge?.prompt).toContain('What to write, and where')
  })

  it('offers no destination to a role whose product is the diff', async () => {
    const o = order([unit('U-1')])
    const run = vi.fn(ok)
    await execute(planOf(o, recipe(READS)), {
      ...deps(run),
      autonomy: 'lights-out',
      runStep: async () => 0,
      collect: async () => null,
    })

    const build = run.mock.calls.find((c) => c[0].node.id === 'build:U-1')?.[0]
    expect(build?.outputPath).toBeNull()
  })
}

function collectingSessionTests() {
  it('collects with the session the rung just ran in, so its transcript can be read', async () => {
    const o = order([unit('U-1')])
    const sessions: (string | null)[] = []
    await execute(planOf(o, recipe(READS)), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
      collect: async ({ sessionId }) => {
        sessions.push(sessionId)
        return null
      },
    })

    expect(sessions).toContain('sess-challenge')
  })
}

function collectingTests() {
  it('collects what the rung wrote and records it', async () => {
    const o = order([unit('U-1')])
    const recorded: string[][] = []
    await execute(planOf(o, recipe(READS)), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
      record: async (action, subject, reason) => {
        recorded.push([action, subject, reason])
      },
      collect: async () => ({ order: o, note: 'AC-2 cannot be falsified', defect: null }),
    })

    expect(recorded).toContainEqual(['rung.collected', 'challenge', 'AC-2 cannot be falsified'])
  })

  it('says so when a rung wrote nothing at all', async () => {
    // Silence here is the defect this whole channel exists to end, so it goes
    // in the record rather than passing as an ordinary turn.
    const o = order([unit('U-1')])
    const recorded: string[][] = []
    await execute(planOf(o, recipe(READS)), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
      record: async (action, subject, reason) => {
        recorded.push([action, subject, reason])
      },
      collect: async () => null,
    })

    expect(recorded.some(([action]) => action === 'rung.wrote_nothing')).toBe(true)
  })
}

function aContradictingRungTests() {
  it('raises forge-defect when a rung contradicts the order being built', async () => {
    const o = order([unit('U-1')])
    const gates: string[] = []
    const outcome = await execute(planOf(o, recipe(READS)), {
      ...deps(vi.fn(ok)),
      autonomy: 'standard',
      runStep: async () => 0,
      raise: async (gate) => {
        gates.push(gate.rule)
      },
      collect: async () => ({
        order: o,
        note: 'three things are wrong',
        defect: 'The architect would rewrite the plan: three things are wrong',
      }),
    })

    expect(gates).toContain('forge-defect')
    expect(outcome.gates.find((g) => g.rule === 'forge-defect')?.why).toContain(
      'three things are wrong'
    )
    // It stops. The builders would otherwise carry on from an order a reader
    // has just said is wrong, which is what happened on the live run.
    expect(outcome.complete).toBe(false)
  })
}

function silencedDefectsAndFailuresToCollectTests() {
  it('does not stop for a defect the autonomy setting silences', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o, recipe(READS)), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
      collect: async () => ({ order: o, note: 'x', defect: 'the plan is wrong' }),
    })
    expect(outcome.complete).toBe(true)
  })

  it('carries on when collecting throws — a run is not a filing cabinet', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o, recipe(READS)), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
      collect: async () => {
        throw new Error('the disk is full')
      },
    })
    expect(outcome.complete).toBe(true)
  })
}

// The scout exists to inform the plan and the build that follow it. Its
// findings had nowhere to go, so `applyProposal` says in as many words that
// "Scout runs after agreement, which is too late to inform one" — the design
// had already worked around a channel that was simply missing.
describe('what one rung filed reaching the next', () => {
  describe('rebuilding the brief', rebuildingTheBriefTests)
  describe('the agreement stays put', theAgreementStaysPutTests)
})

const SHAPED = `
schemaVersion: 1
id: direct
effort: xhigh
steps:
  - id: build
    kind: fanout
    over: plan.units by lane
    step: { kind: agent, role: builder }
  - id: verify
    kind: agent
    role: verifier
    context: fresh
    effort: high
    after: [build]
  - id: document
    kind: agent
    role: scribe
    after: [verify]
`
async function efforts(text = SHAPED): Promise<{ role: string | null; effort: unknown }[]> {
  const seen: { role: string | null; effort: unknown }[] = []
  const run = vi.fn(async (input: RunInput) => {
    seen.push({ role: input.role, effort: input.effort })
    return ok(input)
  })
  const o = order([unit('U-1')])
  const r = recipe(text)
  await execute(planOf(o, r), deps(run as never))
  return seen
}

function rebuildingTheBriefTests() {
  it('rebuilds the brief from what the rung before it wrote', async () => {
    const o = order([unit('U-1')])
    const run = vi.fn(ok)
    await execute(planOf(o, recipe(READS_THEN_BUILDS)), {
      ...deps(run),
      autonomy: 'lights-out',
      runStep: async () => 0,
      collect: async () => ({
        order: {
          ...o,
          context: { ...o.context, conventions: ['colour lives in tokens'] },
        },
        note: 'read it',
        defect: null,
      }),
    })

    const build = run.mock.calls.find((c) => c[0].node.id === 'build:U-1')?.[0]
    expect(build?.prompt).toContain('colour lives in tokens')
  })
}

function theAgreementStaysPutTests() {
  it('never lets a rung move the agreement it is judged against', async () => {
    // Budgets and risk are the agreement. A rung that could raise its own
    // budget mid-run is a run with no budget.
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o, recipe(READS_THEN_BUILDS)), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
      collect: async () => ({
        order: { ...o, risk: { ...o.risk, grade: 'P0' as const } },
        note: '',
        defect: null,
      }),
    })
    expect(outcome.risk.grade).not.toBe('P0')
  })
}

// Effort travels with the node the way the tier does, and for the same reason:
// nothing read it, so every builder on every shape thought exactly as hard as
// the runtime's default. The shape decides, a step may override, and a
// fast-tier role gets none — the fast model does not take one.
describe('the effort a node is launched with', () => {
  describe('recipe and step effort', recipeAndStepEffortTests)
  describe('fast roles and no declaration', fastRolesAndNoDeclarationTests)
})

const REWORK = `
schemaVersion: 1
id: direct
steps:
  - id: build
    kind: agent
    role: builder
  - id: lint
    kind: run
    command: \${toolchain.lint}
    after: [build]
    onFail: { rework: build, max: 1 }
`

function recipeAndStepEffortTests() {
  it("launches a fan-out's builders at the recipe's effort", async () => {
    const builders = (await efforts()).filter((s) => s.role === 'builder')
    expect(builders.length).toBeGreaterThan(0)
    expect(builders.every((s) => s.effort === 'xhigh')).toBe(true)
  })

  it("lets a step's own effort override the recipe's", async () => {
    const verifiers = (await efforts()).filter((s) => s.role === 'verifier')
    expect(verifiers.length).toBeGreaterThan(0)
    expect(verifiers.every((s) => s.effort === 'high')).toBe(true)
  })
}

function fastRolesAndNoDeclarationTests() {
  it('gives a fast-tier role no effort, because the fast model takes none', async () => {
    const scribes = (await efforts()).filter((s) => s.role === 'scribe')
    expect(scribes.length).toBeGreaterThan(0)
    expect(scribes.every((s) => s.effort === null)).toBe(true)
  })

  it('passes null where the recipe declared nothing, so the operator config wins', async () => {
    const seen = await efforts(
      SHAPED.replace('effort: xhigh\n', '').replace('    effort: high\n', '')
    )
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((s) => s.effort === null)).toBe(true)
  })
}

// A failed check used to be a dead end: it either passed, off an exit code the
// agent could not have failed, or it stopped the whole line for a decision.
// `onFail` is a third way — a check that names where its failure belongs, and
// sends the work back there instead of stopping.
describe('a failed check pushes back on the builder', () => {
  describe('command steps', commandStepsTests)
  describe('reworking', executorReworkingTests)
  describe('used-up reworks', usedUpReworksTests)
  describe('an agent that could not start', agentThatCouldNotStartTests)
  describe('unknown commands', unknownCommandsTests)
  describe('slash commands stay with agents', slashCommandsStayWithAgentsTests)
})

function commandStepsTests() {
  it('runs a command step as a command, not as an agent', async () => {
    const o = order([])
    const buildRuns = vi.fn(ok)
    const runCommand = vi.fn<ExecutorDeps['runCommand']>(async () => 0)
    await execute(planOf(o, recipe(REWORK)), {
      ...deps(buildRuns),
      runCommand,
    })
    expect(runCommand).toHaveBeenCalledTimes(1)
    expect(runCommand.mock.calls[0][0].command).toBe('npm run lint')
    // Only the build step ever goes to an agent.
    expect(buildRuns.mock.calls.every((c) => c[0].node.id === 'build')).toBe(true)
  })
}

/** A check command that fails its first run, logging why, and passes every run after. */
function failsOnceThenPasses(): (input: { logPath: string }) => Promise<number> {
  let call = 0
  return async (input) => {
    call += 1
    if (call > 1) return 0
    fs.mkdirSync(path.dirname(input.logPath), { recursive: true })
    fs.writeFileSync(input.logPath, 'lint: unexpected token at line 4\n')
    return 1
  }
}

function executorReworkingTests() {
  it('reworks the target instead of failing, and carries the excerpt forward', async () => {
    const o = order([])
    const buildRuns = vi.fn(ok)
    const record = vi.fn(async () => undefined)
    const runCommand = vi.fn(failsOnceThenPasses())
    const outcome = await execute(planOf(o, recipe(REWORK)), {
      ...deps(buildRuns),
      runCommand,
      record,
    })

    expect(outcome.gates).toEqual([])
    expect(record).toHaveBeenCalledWith(
      'rework.started',
      'lint',
      expect.stringContaining('round 1 of 1')
    )
    const buildCalls = buildRuns.mock.calls.filter((c) => c[0].node.id === 'build')
    expect(buildCalls).toHaveLength(2)
    expect(buildCalls[1][0].prompt).toContain('unexpected token at line 4')
  })
}

function agentThatCouldNotStartTests() {
  it('fails the node with the agent’s reason instead of "without a status"', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(
      planOf(o),
      deps(async (i) => ({
        sessionId: `s-${i.node.id}`,
        exitCode: null,
        notStarted: 'Mode dontAsk is not available',
      }))
    )
    const failed = outcome.graph.nodes.find((n) => n.id === 'build:U-1')
    expect(failed?.failReason).toBe(
      'Claude could not start the builder: Mode dontAsk is not available'
    )
  })
}

function usedUpReworksTests() {
  it('stops asking once reworks and attempts are both used up, naming the check', async () => {
    const o = order([])
    const runCommand = vi.fn(async () => 1)
    const outcome = await execute(planOf(o, recipe(REWORK)), {
      ...deps(vi.fn(ok)),
      runCommand,
    })
    const repeatFails = outcome.gates.filter((g) => g.rule === 'verify.repeat-fail')
    expect(repeatFails).toHaveLength(1)
    expect(repeatFails[0].nodeId).toBe('lint')
  })
}

function unknownCommandsTests() {
  it('skips a command the toolchain has no entry for, rather than passing or failing it', async () => {
    const withoutLint = order([])
    const o = {
      ...withoutLint,
      context: {
        ...withoutLint.context,
        toolchain: { ...withoutLint.context.toolchain, lint: null },
      },
    }
    const record = vi.fn(async () => undefined)
    const runCommand = vi.fn(async () => 0)
    const outcome = await execute(planOf(o, recipe(REWORK)), {
      ...deps(vi.fn(ok)),
      runCommand,
      record,
    })
    expect(runCommand).not.toHaveBeenCalled()
    expect(outcome.graph.nodes.find((n) => n.id === 'lint')?.state).toBe('skipped')
    expect(outcome.graph.nodes.find((n) => n.id === 'lint')?.skipReason).toBe(
      'no lint command in this repository'
    )
    expect(record).toHaveBeenCalledWith(
      'step.not_measured',
      'lint',
      expect.stringContaining('toolchain.lint')
    )
  })
}

function slashCommandsStayWithAgentsTests() {
  it('still hands a slash command to an agent, never to runCommand', async () => {
    const slash = REWORK.replace('command: ${toolchain.lint}', 'command: /speckit-plan').replace(
      '\n    onFail: { rework: build, max: 1 }',
      ''
    )
    const o = order([])
    const runCommand = vi.fn(async () => 0)
    const run = vi.fn(ok)
    await execute(planOf(o, recipe(slash)), {
      ...deps(run),
      runCommand,
    })
    expect(runCommand).not.toHaveBeenCalled()
    expect(run.mock.calls.some((c) => c[0].node.id === 'lint')).toBe(true)
  })
}

describe('the stalled gate names what it would retry', () => {
  it("names the failed node with a dependant, so the Inbox's Send back retries something", async () => {
    const o = order([unit('U-1'), unit('U-2', { dependsOn: ['U-1'] })])
    const outcome = await execute(
      planOf(o),
      deps(async (i) => ({ sessionId: `s-${i.node.id}`, exitCode: 1 }))
    )
    const stalled = outcome.gates.find((g) =>
      g.summary.endsWith('cannot go any further on its own')
    )
    expect(stalled?.nodeId).toBe('build:U-1')
  })
})

describe('a resumed session is ended before it is resumed', () => {
  it('ends the live session before handing it back to the agent', async () => {
    const order2 = order([unit('U-1'), unit('U-2', { dependsOn: ['U-1'] })])
    const ended: string[] = []
    const seenAtRunTime = new Set<string>()
    const run = vi.fn(async (input: RunInput) => {
      if (input.resumeSessionId !== undefined) seenAtRunTime.add(input.resumeSessionId)
      return ok(input)
    })
    await execute(planOf(order2), {
      ...deps(run),
      sessionFor: (_lane, role) => (role === 'builder' ? 'sess-builder' : undefined),
      endSession: async (sessionId) => {
        ended.push(sessionId)
      },
    })
    expect(ended).toContain('sess-builder')
    // It was ended before the node that resumed it actually ran with it.
    expect(seenAtRunTime.has('sess-builder')).toBe(true)
  })
})

const roles = createRoleRegistry({ dataRoot: '', repoPaths: [], builtInDir })

describe('skillsFor', () => {
  describe('union of skills', unionOfSkillsTests)
  describe('inner steps and none', innerStepsAndNoneTests)
})

function unionOfSkillsTests() {
  it("is the union of the role's and the step's skills, de-duplicated", () => {
    const withStep = parseRecipe(
      `
schemaVersion: 1
id: direct
steps:
  - id: build
    kind: agent
    role: builder
    skills: [ci-fix, extra]
`,
      'direct.yaml'
    )
    if (!withStep.ok) throw new Error(withStep.reason)
    const graph = buildRunGraph(order([unit('U-1')]), withStep.value)
    const node = graph.nodes.find((n) => n.id === 'build')!
    // The builder role already declares `ci-fix`; the step adds `extra`.
    expect(skillsFor(withStep.value, node, roles).sort()).toEqual(['ci-fix', 'extra'])
  })
}

function innerStepsAndNoneTests() {
  it('reads a skill declared on a fan-out’s inner step', () => {
    const fanned = parseRecipe(
      `
schemaVersion: 1
id: direct
steps:
  - id: build
    kind: fanout
    over: plan.units
    step: { kind: agent, role: builder, skills: [extra] }
`,
      'direct.yaml'
    )
    if (!fanned.ok) throw new Error(fanned.reason)
    const graph = buildRunGraph(order([unit('U-1')]), fanned.value)
    const node = graph.nodes.find((n) => n.id === 'build:U-1')!
    expect(skillsFor(fanned.value, node, roles).sort()).toEqual(['ci-fix', 'extra'])
  })

  it('is empty for a role and a step that declare none', () => {
    const verifying = RECIPE.replace('role: builder', 'role: verifier')
    const r = recipe(verifying)
    const graph = buildRunGraph(order([unit('U-1')]), r)
    const node = graph.nodes.find((n) => n.id === 'build:U-1')!
    expect(skillsFor(r, node, roles)).toEqual([])
  })
}

describe('a node with skills gets them mounted', () => {
  describe('mounting', mountingTests)
  describe('command steps mount nothing', commandStepsMountNothingTests)
})

function log() {
  const calls: string[] = []
  return {
    calls,
    record: vi.fn(async (action: string, subject: string) => {
      calls.push(`record:${action}:${subject}`)
    }),
    runStep: async (step: { name: string }, logPath: string) => {
      calls.push(`step:${step.name}`)
      fs.mkdirSync(path.dirname(logPath), { recursive: true })
      fs.writeFileSync(logPath, 'ok\n')
      return step.name === 'Lint' ? 1 : 0
    },
  }
}

function mountingTests() {
  it('hands the run its mounted skills, and null when it has none', async () => {
    const run = vi.fn(ok)
    const o = order([unit('U-1')])
    await execute(planOf(o, recipe(CHECKED)), deps(run))

    // The builder role declares `ci-fix`.
    const build = run.mock.calls.find((c) => c[0].node.id === 'build:U-1')?.[0]
    expect(build?.skillsMount).toBe(
      path.join(dataRoot, 'orders', o.id, 'skills-mount', 'build_U-1')
    )
    expect(
      fs.existsSync(path.join(build?.skillsMount ?? '', '.claude', 'skills', 'ci-fix', 'SKILL.md'))
    ).toBe(true)

    // The verifier declares no skills at all.
    const verify = run.mock.calls.find((c) => c[0].node.id === 'verify:U-1')?.[0]
    expect(verify?.skillsMount).toBeNull()
  })

  it('records skills.mounted, naming each skill and the rung it came from', async () => {
    const recorded: string[][] = []
    const o = order([unit('U-1')])
    await execute(planOf(o, recipe(CHECKED)), {
      ...deps(vi.fn(ok)),
      record: async (action, subject, reason) => {
        recorded.push([action, subject, reason])
      },
    })
    expect(recorded).toContainEqual(['skills.mounted', 'build:U-1', 'ci-fix (built-in)'])
    expect(recorded.some(([, subject]) => subject === 'verify:U-1')).toBe(false)
  })
}

function commandStepsMountNothingTests() {
  it('never mounts anything for a `run` step that runs as a command', async () => {
    const o = order([unit('U-1')])
    const RUN_AS_COMMAND = `
schemaVersion: 1
id: direct
steps:
  - id: check
    kind: run
    command: make
`
    const recorded: string[][] = []
    await execute(planOf(o, recipe(RUN_AS_COMMAND)), {
      ...deps(vi.fn(ok)),
      runCommand: async () => 0,
      record: async (action, subject, reason) => {
        recorded.push([action, subject, reason])
      },
    })
    expect(recorded.some(([action]) => action === 'skills.mounted')).toBe(false)
  })
}

describe('shipping order (ADR 085)', () => {
  describe('opening first', openingFirstTests)
  describe('not opening first', notOpeningFirstTests)
  describe('a failed final check', aFailedFinalCheckTests)
  describe('the tail owed', theTailOwedTests)
})

const WRITING = `
schemaVersion: 1
id: direct
steps:
  - id: build
    kind: fanout
    over: plan.units by lane
    step: { kind: agent, role: builder }
  - id: lint
    kind: run
    command: '\${toolchain.lint}'
    after: [build]
  - id: document
    kind: agent
    role: scribe
    after: [build]
  - id: verify
    kind: agent
    role: verifier
    after: [build]
`
const o = () =>
  order([unit('U-1', { title: 'refuse an expired token' }), unit('U-2', { title: 'log it' })])
function committing(committed: (nodeId: string) => boolean | CommitOutcome) {
  const commitNode = vi.fn(async (input: { node: { id: string }; message: string }) => {
    const answer = committed(input.node.id)
    if (typeof answer !== 'boolean') return answer
    return answer ? ({ kind: 'committed' } as const) : ({ kind: 'clean' } as const)
  })
  return { commitNode }
}
const HOOK_FAILED: CommitOutcome = {
  kind: 'refused',
  command: 'git commit',
  exitCode: 1,
  output: '✖ vitest related --run:\n  FAIL  Markdown renders exactly as before > gfm table',
}

function openingFirstTests() {
  it('opens the drafts before the final check climbs, for a change nobody has to inspect', async () => {
    const seen = log()
    const o = order([unit('U-1')])
    await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async (step, logPath) => (seen.runStep(step, logPath), 0),
      beforeFinalCheck: async () => {
        seen.calls.push('drafts')
        return true
      },
    })
    expect(seen.calls[0]).toBe('drafts')
    expect(seen.calls.filter((c) => c.startsWith('step:')).length).toBeGreaterThan(0)
  })
}

function notOpeningFirstTests() {
  it('does not open anything first when an inspection is owed', async () => {
    const beforeFinalCheck = vi.fn(async () => true)
    const o = order([unit('U-1', { touches: ['src/auth/session.ts'] })])
    await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
      beforeFinalCheck,
    })
    expect(beforeFinalCheck).not.toHaveBeenCalled()
  })

  it('does not open anything first when the run halted at a gate', async () => {
    const beforeFinalCheck = vi.fn(async () => true)
    const o = order([unit('U-1')])
    await execute(planOf(o, recipe(PAUSING)), {
      ...deps(vi.fn(ok)),
      beforeFinalCheck,
    })
    expect(beforeFinalCheck).not.toHaveBeenCalled()
  })
}

function aFailedFinalCheckTests() {
  it('records ship.final_check_failed and raises the executor gate when the draft is already open', async () => {
    const seen = log()
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'standard',
      record: seen.record,
      runStep: seen.runStep,
      beforeFinalCheck: async () => true,
    })
    expect(outcome.gates.map((g) => g.rule)).toContain('verify.repeat-fail')
    expect(outcome.shippable).toBe(false)
    expect(seen.calls.some((c) => c === 'record:ship.final_check_failed:Lint')).toBe(true)
  })

  it('records no ship.final_check_failed when nothing was opened first', async () => {
    const seen = log()
    const o = order([unit('U-1')])
    await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'standard',
      record: seen.record,
      runStep: seen.runStep,
    })
    expect(seen.calls.some((c) => c.includes('ship.final_check_failed'))).toBe(false)
  })
}

function theTailOwedTests() {
  it('leaves the ship node running while the tail is owed, and still counts the work as done', async () => {
    const o = order([unit('U-1')])
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      runStep: async () => 0,
    })
    expect(outcome.graph.nodes.find((n) => n.id === 'ship')?.state).toBe('running')
    expect(outcome.complete).toBe(true)
    expect(outcome.shippable).toBe(true)
  })

  it('treats a ship node already running (a resume) as the tail owed, not as a stall', async () => {
    const o = order([unit('U-1')])
    const first = await execute(planOf(o), deps(vi.fn(ok)))
    const run = vi.fn(ok)
    const again = await execute(
      { order: o, recipe: recipe(), graph: first.graph },
      {
        ...deps(run),
        autonomy: 'lights-out',
        runStep: async () => 0,
      }
    )
    expect(run).not.toHaveBeenCalled()
    expect(again.gates).toHaveLength(0)
    expect(again.shippable).toBe(true)
  })
}

// What an agent that writes leaves in its checkout is committed by the line,
// because nothing else ever runs `git commit` and a pull request needs commits.
describe('committing what an agent wrote', () => {
  describe('what is committed', whatIsCommittedTests)
  describe('what is not', whatIsNotTests)
  describe('no change', noChangeTests)
  describe('a refused commit', aRefusedCommitTests)
  describe('the next attempt', theNextAttemptTests)
  describe('a second refusal', aSecondRefusalTests)
  describe('nothing to commit', nothingToCommitTests)
})

const AUTHORING = `
schemaVersion: 1
id: direct
steps:
  - id: write
    kind: agent
    role: author
`
const collecting = (document: unknown) =>
  vi.fn(async () => ({
    order: order([]),
    note: 'wrote it',
    defect: null,
    document: document as never,
  }))

function whatIsCommittedTests() {
  it('commits the builder once it passes, naming the step and its units', async () => {
    const { commitNode } = committing(() => true)
    const order1 = o()
    const outcome = await execute(planOf(order1, recipe(WRITING)), {
      ...deps(vi.fn(ok)),
      runCommand: async () => 0,
      commitNode,
    })
    const built = commitNode.mock.calls.find((call) => call[0].node.id === 'build:lane-1')
    expect(built?.[0].message).toBe('build: refuse an expired token, log it')
    expect(outcome.graph.nodes.find((n) => n.id === 'build:lane-1')?.state).toBe('passed')
  })

  it('commits a scribe by its step id, which has no units', async () => {
    const { commitNode } = committing(() => true)
    const order1 = o()
    await execute(planOf(order1, recipe(WRITING)), {
      ...deps(vi.fn(ok)),
      runCommand: async () => 0,
      commitNode,
    })
    const documented = commitNode.mock.calls.find((call) => call[0].node.id === 'document')
    expect(documented?.[0].message).toBe('document: document')
  })
}

function whatIsNotTests() {
  it('never commits a role that may not write, nor a command', async () => {
    const { commitNode } = committing(() => true)
    const order1 = o()
    await execute(planOf(order1, recipe(WRITING)), {
      ...deps(vi.fn(ok)),
      runCommand: async () => 0,
      commitNode,
    })
    const ids = commitNode.mock.calls.map((call) => call[0].node.id)
    expect(ids).not.toContain('verify')
    expect(ids).not.toContain('lint')
  })

  it('does not commit a builder that failed', async () => {
    const { commitNode } = committing(() => true)
    const order1 = o()
    await execute(planOf(order1, recipe(WRITING)), {
      ...deps(async (input) => ({ sessionId: `s-${input.node.id}`, exitCode: 1 })),
      runCommand: async () => 0,
      commitNode,
    })
    expect(commitNode).not.toHaveBeenCalled()
  })
}

function noChangeTests() {
  it('fails a builder that passed and changed nothing, and says why', async () => {
    const { commitNode } = committing((id) => id !== 'build:lane-1')
    const record = vi.fn(async () => undefined)
    const order1 = o()
    const outcome = await execute(planOf(order1, recipe(WRITING)), {
      ...deps(vi.fn(ok)),
      runCommand: async () => 0,
      commitNode,
      record,
    })
    expect(outcome.graph.nodes.find((n) => n.id === 'build:lane-1')?.state).toBe('failed')
    expect(record).toHaveBeenCalledWith(
      'step.no_change',
      'build:lane-1',
      'made no change to the checkout'
    )
    // The work after it never started, so nothing downstream ran on nothing.
    expect(outcome.graph.nodes.find((n) => n.id === 'document')?.state).not.toBe('passed')
  })
}

function aRefusedCommitTests() {
  // TAV-19: the pre-commit hook rejected the line's commit and the gate said
  // "made no change", so nobody could tell why it kept failing.
  it('fails a builder whose commit was refused, naming the refusal rather than no change', async () => {
    const { commitNode } = committing((id) => (id === 'build:lane-1' ? HOOK_FAILED : true))
    const record = vi.fn(async () => undefined)
    const order1 = o()
    const outcome = await execute(planOf(order1, recipe(WRITING)), {
      ...deps(vi.fn(ok)),
      runCommand: async () => 0,
      commitNode,
      record,
    })
    const built = outcome.graph.nodes.find((n) => n.id === 'build:lane-1')
    expect(built?.state).toBe('failed')
    expect(built?.failReason).toBe('changed the checkout, but `git commit` exited 1')
    expect(record).toHaveBeenCalledWith(
      'step.commit_refused',
      'build:lane-1',
      'changed the checkout, but `git commit` exited 1'
    )
    expect(record).not.toHaveBeenCalledWith('step.no_change', expect.anything(), expect.anything())
  })
}

function theNextAttemptTests() {
  it('hands the refused commit\u2019s output to the builder\u2019s next attempt', async () => {
    const { commitNode } = committing((id) => (id === 'build:lane-1' ? HOOK_FAILED : true))
    const order1 = o()
    const outcome = await execute(planOf(order1, recipe(WRITING)), {
      ...deps(vi.fn(ok)),
      runCommand: async () => 0,
      commitNode,
    })
    expect(outcome.graph.nodes.find((n) => n.id === 'build:lane-1')?.feedback).toEqual([
      expect.objectContaining({
        command: 'git commit',
        exitCode: 1,
        excerpt: expect.stringContaining('gfm table'),
      }),
    ])
  })
}

function aSecondRefusalTests() {
  it('puts the refusal and its output on the gate a second refusal raises', async () => {
    const { commitNode } = committing((id) => (id === 'build:lane-1' ? HOOK_FAILED : true))
    const order1 = o()
    const run = () => ({
      ...deps(vi.fn(ok)),
      autonomy: 'standard' as const,
      runCommand: async () => 0,
      commitNode,
    })
    let graph = buildRunGraph(order1, recipe(WRITING))
    graph = (await execute({ order: order1, recipe: recipe(WRITING), graph }, run())).graph
    graph = retry(graph, 'build:lane-1')
    const second = await execute({ order: order1, recipe: recipe(WRITING), graph }, run())

    const gate = second.gates.find((g) => g.rule === 'verify.repeat-fail')
    expect(gate?.why).toContain('changed the checkout, but `git commit` exited 1')
    expect(gate?.why).not.toContain('made no change')
    expect(gate?.evidence).toEqual([
      expect.objectContaining({
        kind: 'stdout',
        command: 'git commit',
        exitCode: 1,
        excerpt: expect.stringContaining('gfm table'),
      }),
    ])
  })
}

function nothingToCommitTests() {
  it('lets a scribe with nothing to document pass', async () => {
    const { commitNode } = committing((id) => id !== 'document')
    const order1 = o()
    const outcome = await execute(planOf(order1, recipe(WRITING)), {
      ...deps(vi.fn(ok)),
      runCommand: async () => 0,
      commitNode,
    })
    expect(outcome.graph.nodes.find((n) => n.id === 'document')?.state).toBe('passed')
  })

  it('changes nothing for a caller that commits nothing', async () => {
    const order1 = o()
    const outcome = await execute(planOf(order1, recipe(WRITING)), {
      ...deps(vi.fn(ok)),
      runCommand: async () => 0,
    })
    expect(outcome.graph.nodes.find((n) => n.id === 'build:lane-1')?.state).toBe('passed')
  })
}

describe('an author handing back a document', () => {
  describe('the outputs directory', theOutputsDirectoryTests)
  describe('recording the document', recordingTheDocumentTests)
  describe('a document outside the checkout', aDocumentOutsideTheCheckoutTests)
  describe('a document said to be in the checkout', aDocumentSaidToBeInTheCheckoutTests)
  describe('nothing handed back', nothingHandedBackTests)
})

const docsUnit = (id: string) => unit(id, { touches: [`docs/${id}.md`] })

function theOutputsDirectoryTests() {
  it('is given the order\u2019s outputs directory, and a builder is not', async () => {
    const run = vi.fn(ok)
    const order1 = order([])
    await execute(planOf(order1, recipe(AUTHORING)), {
      ...deps(run),
      collect: collecting(null),
    })
    expect(run.mock.calls[0][0].outputsDir).toBe(path.join(dataRoot, 'orders', 'WO-1', 'outputs'))

    const run2 = vi.fn(ok)
    const order2 = order()
    await execute(planOf(order2), {
      ...deps(run2),
      collect: collecting(null),
    })
    expect(run2.mock.calls[0][0].outputsDir).toBeNull()
  })
}

function recordingTheDocumentTests() {
  it('is recorded when it is handed back', async () => {
    const record = vi.fn(async () => undefined)
    const order1 = order([])
    await execute(planOf(order1, recipe(AUTHORING)), {
      ...deps(vi.fn(ok)),
      collect: collecting({
        path: '/data/orders/WO-1/outputs/answer.md',
        url: 'https://example.com/d/1',
        location: 'published',
      }),
      commitNode: async () => ({ kind: 'clean' }) as const,
      record,
    })
    expect(record).toHaveBeenCalledWith(
      'document.handed_back',
      'write',
      'published: /data/orders/WO-1/outputs/answer.md (https://example.com/d/1)'
    )
  })
}

function aDocumentOutsideTheCheckoutTests() {
  it('passes with nothing to commit when the document is outside the checkout', async () => {
    const order1 = order([])
    const outcome = await execute(planOf(order1, recipe(AUTHORING)), {
      ...deps(vi.fn(ok)),
      collect: collecting({ path: '/o/answer.md', location: 'outputs' }),
      commitNode: async () => ({ kind: 'clean' }) as const,
    })
    expect(outcome.graph.nodes.find((n) => n.id === 'write')?.state).toBe('passed')
  })
}

function aDocumentSaidToBeInTheCheckoutTests() {
  it('fails when the document is said to be in the checkout and nothing changed there', async () => {
    const order1 = order([])
    const outcome = await execute(planOf(order1, recipe(AUTHORING)), {
      ...deps(vi.fn(ok)),
      collect: collecting({ path: 'docs/answer.md', location: 'checkout' }),
      commitNode: async () => ({ kind: 'clean' }) as const,
    })
    expect(outcome.graph.nodes.find((n) => n.id === 'write')?.state).toBe('failed')
  })
}

function nothingHandedBackTests() {
  it('fails when it handed back nothing and changed nothing', async () => {
    const order1 = order([])
    const outcome = await execute(planOf(order1, recipe(AUTHORING)), {
      ...deps(vi.fn(ok)),
      collect: collecting(null),
      commitNode: async () => ({ kind: 'clean' }) as const,
    })
    expect(outcome.graph.nodes.find((n) => n.id === 'write')?.state).toBe('failed')
  })

  it('passes when it handed back nothing but did commit a change', async () => {
    const order1 = order([])
    const outcome = await execute(planOf(order1, recipe(AUTHORING)), {
      ...deps(vi.fn(ok)),
      collect: collecting(null),
      commitNode: async () => ({ kind: 'committed' }) as const,
    })
    expect(outcome.graph.nodes.find((n) => n.id === 'write')?.state).toBe('passed')
  })
}

describe('the final check for a change that only touches documentation', () => {
  describe('documentation only', documentationOnlyTests)
  describe('code too', codeTooTests)
})

function documentationOnlyTests() {
  it('runs format and lint, and marks the rest not run as documentation only', async () => {
    const o = order([docsUnit('U-1')])
    const ran: string[] = []
    const outcome = await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      observedChange: async () => ({ changedFiles: ['docs/U-1.md'], linesChanged: 3 }),
      runStep: async (step) => {
        ran.push(step.name)
        return 0
      },
    })
    expect(ran).toEqual(['Format', 'Lint'])
    expect(outcome.ladder?.ok).toBe(true)
    expect(outcome.ladder?.steps.find((s) => s.name === "The unit's own tests")).toMatchObject({
      result: 'not_triggered',
      reason: 'documentation only',
    })
    expect(outcome.shippable).toBe(true)
  })
}

function codeTooTests() {
  it('runs the tests as well once the work touched code', async () => {
    const o = order([docsUnit('U-1')])
    const ran: string[] = []
    await execute(planOf(o), {
      ...deps(vi.fn(ok)),
      autonomy: 'lights-out',
      observedChange: async () => ({
        changedFiles: ['docs/U-1.md', 'src/a.ts'],
        linesChanged: 3,
      }),
      runStep: async (step) => {
        ran.push(step.name)
        return 0
      },
    })
    expect(ran).toContain("The unit's own tests")
  })
}
