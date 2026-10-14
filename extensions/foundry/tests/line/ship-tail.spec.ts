import { describe, it, expect, vi } from 'vitest'
import {
  afterFinalCheck,
  ciRounds,
  ciReworkTarget,
  settledOnce,
  shipNodeId,
  settleShip,
} from '../../src/line/ship-tail.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import type { CiVerdict, Check } from '../../src/line/ci.js'
import type { Feedback, NodeState, RunGraph, RunNode } from '../../src/line/run-graph.js'
import type { CiState } from '../../src/line/ci-state.js'
import type { Recipe } from '../../src/recipe/parse.js'
import { partialFake } from '../../../../tests/support/fakes'

function check(over: Partial<Check> = {}): Check {
  return { name: 'build', bucket: 'pass', link: 'https://x/1', workflow: 'ci', ...over }
}

const PULL = { url: 'https://github.com/o/r/pull/1', cwd: '/repo' }

type CiRoundsInput = Parameters<typeof ciRounds>[0]

function harness(verdicts: CiVerdict[], opts: { sendBack?: boolean } = {}) {
  let call = 0
  const watch = vi.fn<CiRoundsInput['watch']>(async () => {
    const v = verdicts[Math.min(call, verdicts.length - 1)]
    call += 1
    return v
  })
  const failedLogs = vi.fn<CiRoundsInput['failedLogs']>(
    async (checks) => `log for ${checks.map((c) => c.name).join(',')}`
  )
  const sendBack = vi.fn<CiRoundsInput['sendBack']>(async () => opts.sendBack ?? true)
  const record = vi.fn<CiRoundsInput['record']>(async () => {})
  const states: CiState[] = []
  const state = vi.fn<CiRoundsInput['state']>(async (s) => {
    states.push({ ...s, at: 'x' })
  })
  return { watch, failedLogs, sendBack, record, state, states }
}

describe('ciRounds', () => {
  describe('the next round', theNextRoundTests)
  describe('writing the checks', writingTheChecksTests)
  describe('no ci', noCiTests)
  describe('green', greenTests)
  describe('not measured', shipTailNotMeasuredTests)
  describe('red then green', redThenGreenTests)
  describe('exhausted rounds', exhaustedRoundsTests)
  describe('halting', haltingTests)
  describe('two pulls', twoPullsTests)
  describe('a write that fails mid-watch', aWriteThatFailsMidWatchTests)
})

function aWriteThatFailsMidWatchTests() {
  it('keeps watching when writing the checks so far fails, and names cancelled checks', async () => {
    const h = harness([])
    h.state.mockImplementation(async (s: Omit<CiState, 'at'>) => {
      if (s.status === 'watching' && s.pulls[0].checks.length > 0) throw new Error('disk full')
      h.states.push({ ...s, at: 'x' })
    })
    h.watch.mockImplementation(async (_pull, onPoll) => {
      onPoll([check({ bucket: 'pending' })])
      return { kind: 'red', checks: [check({ name: 'e2e', bucket: 'cancel' })] }
    })
    const outcome = await ciRounds({ pulls: [PULL], rounds: 0, ...h })
    expect(outcome).toMatchObject({ kind: 'red', rounds: 0 })
    expect(h.record).toHaveBeenCalledWith('ci.exhausted', PULL.url, 'CI red on e2e after 0 rounds')
  })
}

function theNextRoundTests() {
  it('watches the next round past the runs the last one judged', async () => {
    const red = check({ bucket: 'fail', link: 'https://github.com/o/r/actions/runs/111/job/1' })
    const h = harness([
      { kind: 'red', checks: [red] },
      { kind: 'green', checks: [check()] },
    ])
    await ciRounds({ pulls: [PULL], rounds: 2, ...h })
    expect(h.watch).toHaveBeenCalledTimes(2)
    const firstIgnored = h.watch.mock.calls[0][2] as ReadonlySet<string>
    const secondIgnored = h.watch.mock.calls[1][2] as ReadonlySet<string>
    expect([...firstIgnored]).toEqual([])
    expect([...secondIgnored]).toEqual(['111'])
  })
}

function writingTheChecksTests() {
  it('writes the checks while they are watched, once per change in what is passing', async () => {
    const h = harness([])
    h.watch.mockImplementation(async (_pull, onPoll) => {
      const pending = check({ bucket: 'pending' })
      onPoll([pending])
      onPoll([pending])
      onPoll([check({ bucket: 'pass' })])
      return { kind: 'green', checks: [check()] }
    })
    await ciRounds({ pulls: [PULL], rounds: 2, ...h })
    const watching = h.states.filter((s) => s.status === 'watching')
    expect(watching.map((s) => s.pulls[0].checks.map((c) => c.bucket))).toEqual([
      [],
      ['pending'],
      ['pass'],
    ])
  })

  it('records once that it started watching, naming the pull request', async () => {
    const h = harness([{ kind: 'green', checks: [check()] }])
    await ciRounds({ pulls: [PULL], rounds: 2, ...h })
    const watching = h.record.mock.calls.filter((c) => c[0] === 'ci.watching')
    expect(watching).toHaveLength(1)
    expect(watching[0][1]).toBe(PULL.url)
  })
}

function noCiTests() {
  it('declares none when the recipe has no ci', async () => {
    const h = harness([])
    const outcome = await ciRounds({
      pulls: [PULL],
      rounds: null,
      watch: h.watch,
      failedLogs: h.failedLogs,
      sendBack: h.sendBack,
      record: h.record,
      state: h.state,
    })
    expect(outcome).toEqual({ kind: 'none' })
    expect(h.watch).not.toHaveBeenCalled()
    expect(h.state).not.toHaveBeenCalled()
  })
}

function greenTests() {
  it('is green the first time, never calling sendBack', async () => {
    const h = harness([{ kind: 'green', checks: [check()] }])
    const outcome = await ciRounds({
      pulls: [PULL],
      rounds: 2,
      watch: h.watch,
      failedLogs: h.failedLogs,
      sendBack: h.sendBack,
      record: h.record,
      state: h.state,
    })
    expect(outcome.kind).toBe('green')
    expect(h.sendBack).not.toHaveBeenCalled()
    expect(h.record).toHaveBeenCalledWith('ci.green', expect.any(String), expect.any(String))
  })
}

function shipTailNotMeasuredTests() {
  it('is not_measured the first time and never turns green', async () => {
    const h = harness([{ kind: 'not_measured', checks: [], reason: 'no checks were reported' }])
    const outcome = await ciRounds({
      pulls: [PULL],
      rounds: 2,
      watch: h.watch,
      failedLogs: h.failedLogs,
      sendBack: h.sendBack,
      record: h.record,
      state: h.state,
    })
    expect(outcome).toEqual({ kind: 'not_measured', reason: 'no checks were reported' })
    expect(h.sendBack).not.toHaveBeenCalled()
    expect(h.record).toHaveBeenCalledWith(
      'ci.not_measured',
      expect.any(String),
      'no checks were reported'
    )
  })
}

function redThenGreenTests() {
  it('goes red then green: one round, one ci.round record, feedback carries the log', async () => {
    const red = { kind: 'red' as const, checks: [check({ name: 'lint', bucket: 'fail' })] }
    const green = { kind: 'green' as const, checks: [check({ name: 'lint' })] }
    const h = harness([red, green])
    const outcome = await ciRounds({
      pulls: [PULL],
      rounds: 2,
      watch: h.watch,
      failedLogs: h.failedLogs,
      sendBack: h.sendBack,
      record: h.record,
      state: h.state,
    })
    expect(outcome.kind).toBe('green')
    expect(h.record.mock.calls.map((c) => c[0])).toEqual([
      'ci.watching',
      'ci.round',
      'ci.watching',
      'ci.green',
    ])
    expect(h.sendBack).toHaveBeenCalledTimes(1)
    const feedback = h.sendBack.mock.calls[0][0] as Feedback
    expect(feedback.source).toBe('ci')
    expect(feedback.excerpt).toContain('log for lint')
    expect(h.states.map((s) => s.status)).toEqual(['watching', 'reworking', 'watching', 'green'])
  })
}

function exhaustedRoundsTests() {
  it('exhausts rounds: red three times with max 2 rounds sendBack, then a red outcome', async () => {
    const red = { kind: 'red' as const, checks: [check({ name: 'lint', bucket: 'fail' })] }
    const h = harness([red, red, red])
    const outcome = await ciRounds({
      pulls: [PULL],
      rounds: 2,
      watch: h.watch,
      failedLogs: h.failedLogs,
      sendBack: h.sendBack,
      record: h.record,
      state: h.state,
    })
    expect(h.sendBack).toHaveBeenCalledTimes(2)
    expect(outcome.kind).toBe('red')
    if (outcome.kind === 'red') expect(outcome.rounds).toBe(2)
    expect(h.record.mock.calls.at(-1)?.[0]).toBe('ci.exhausted')
  })
}

function haltingTests() {
  it('halts when sendBack reports it could not finish', async () => {
    const red = { kind: 'red' as const, checks: [check({ name: 'lint', bucket: 'fail' })] }
    const h = harness([red], { sendBack: false })
    const outcome = await ciRounds({
      pulls: [PULL],
      rounds: 2,
      watch: h.watch,
      failedLogs: h.failedLogs,
      sendBack: h.sendBack,
      record: h.record,
      state: h.state,
    })
    expect(outcome).toEqual({ kind: 'halted', reason: expect.any(String) })
    expect(h.sendBack).toHaveBeenCalledTimes(1)
  })
}

function twoPullsTests() {
  it('is red when one of two pulls is red', async () => {
    const green: CiVerdict = { kind: 'green', checks: [check()] }
    const red: CiVerdict = { kind: 'red', checks: [check({ name: 'lint', bucket: 'fail' })] }
    let n = 0
    const watch = vi.fn(async (pull: { url: string; cwd: string }): Promise<CiVerdict> => {
      n += 1
      return pull.url.endsWith('/2') ? red : green
    })
    const failedLogs = vi.fn(async () => 'log')
    const sendBack = vi.fn(async () => true)
    const record = vi.fn(async () => {})
    const state = vi.fn(async () => {})
    const outcome = await ciRounds({
      pulls: [PULL, { url: 'https://github.com/o/r/pull/2', cwd: '/repo2' }],
      rounds: 0,
      watch,
      failedLogs,
      sendBack,
      record,
      state,
    })
    expect(outcome.kind).toBe('red')
    void n
  })
}

function recipe(yaml: string): Recipe {
  const parsed = parseRecipe(yaml, 't.yaml')
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value
}

describe('ciReworkTarget', () => {
  describe('onFail', onfailTests)
  describe('fan-out builders', fanOutBuildersTests)
  describe('builder steps', builderStepsTests)
  describe('no target', noTargetTests)
})

function onfailTests() {
  it('names the onFail rework target when a step declares one', () => {
    const r = recipe(`
schemaVersion: 1
id: t
ci: { rounds: 1 }
steps:
  - id: build
    kind: fanout
    over: plan.units
    step: { kind: agent, role: builder }
  - id: check
    kind: run
    after: [build]
    command: make check
    onFail: { rework: build, max: 2 }
  - id: ship
    kind: gate
    after: [check]
    rule: ready-for-review
    defaultIfIgnored: hold
`)
    expect(ciReworkTarget(r)).toBe('build')
  })
}

function fanOutBuildersTests() {
  it('falls back to the first fanout step whose inner step is a builder', () => {
    const r = recipe(`
schemaVersion: 1
id: t
steps:
  - id: build
    kind: fanout
    over: plan.units
    step: { kind: agent, role: builder }
  - id: ship
    kind: gate
    after: [build]
    rule: ready-for-review
    defaultIfIgnored: hold
`)
    expect(ciReworkTarget(r)).toBe('build')
  })
}

function builderStepsTests() {
  it('falls back to the first agent step whose role is builder', () => {
    const r = recipe(`
schemaVersion: 1
id: t
steps:
  - id: build
    kind: agent
    role: builder
  - id: ship
    kind: gate
    after: [build]
    rule: ready-for-review
    defaultIfIgnored: hold
`)
    expect(ciReworkTarget(r)).toBe('build')
  })
}

function noTargetTests() {
  it('is null when the recipe has no onFail and no builder', () => {
    const r = recipe(`
schemaVersion: 1
id: t
steps:
  - id: review
    kind: agent
    role: reviewer
  - id: ship
    kind: gate
    after: [review]
    rule: ready-for-review
    defaultIfIgnored: hold
`)
    expect(ciReworkTarget(r)).toBeNull()
  })
}

describe('shipNodeId', () => {
  it('names the ready-for-review gate step', () => {
    const r = recipe(`
schemaVersion: 1
id: t
steps:
  - id: build
    kind: agent
    role: builder
  - id: ship
    kind: gate
    after: [build]
    rule: ready-for-review
    defaultIfIgnored: hold
`)
    expect(shipNodeId(r)).toBe('ship')
  })

  it('is null when the recipe opens no ready-for-review gate', () => {
    const r = recipe(`
schemaVersion: 1
id: t
steps:
  - id: build
    kind: agent
    role: builder
`)
    expect(shipNodeId(r)).toBeNull()
  })
})

/** A one-node graph whose ship node is in `state`. */
const shipGraph = (state: NodeState): RunGraph =>
  partialFake<RunGraph>({
    orderId: 'WO-1',
    recipe: 'direct',
    nodes: [
      partialFake<RunNode>({ id: 'ship', stepId: 'ship', kind: 'gate', state, dependsOn: [] }),
    ],
  })

describe('settleShip', () => {
  const graph = shipGraph
  const stateOf = (g: RunGraph) => g.nodes[0].state

  it('passes a running ship node once the ready question is raised', () => {
    const settled = settleShip(graph('running'), 'ship', {
      asked: true,
      at: '2026-10-05T10:00:00.000Z',
    })
    expect(stateOf(settled)).toBe('passed')
    expect(settled.nodes[0].endedAt).toBe('2026-10-05T10:00:00.000Z')
  })

  it('sends it back to waiting when shipping stopped before the question', () => {
    expect(stateOf(settleShip(graph('running'), 'ship', { asked: false, at: 'x' }))).toBe('waiting')
  })

  it('passes a waiting one when the question was raised after a send-back reset it', () => {
    expect(stateOf(settleShip(graph('waiting'), 'ship', { asked: true, at: 'x' }))).toBe('passed')
  })

  it('leaves a node that is not owed alone', () => {
    const passed = graph('passed')
    expect(settleShip(passed, 'ship', { asked: false, at: 'x' })).toBe(passed)
    const waiting = graph('waiting')
    expect(settleShip(waiting, 'ship', { asked: false, at: 'x' })).toBe(waiting)
    expect(settleShip(waiting, 'nonesuch', { asked: true, at: 'x' })).toBe(waiting)
  })
})

const feedback: Feedback = {
  from: 'ci',
  attempt: 1,
  source: 'ci',
  command: null,
  exitCode: 1,
  excerpt: 'red',
  logPath: null,
}

describe('a CI send-back during the final check', () => {
  describe('waiting for the final check', waitingForTheFinalCheckTests)
})

function waitingForTheFinalCheckTests() {
  it('waits for the final check, then sends back when it passed', async () => {
    const check = settledOnce<boolean>()
    const sendBack = vi.fn(async () => true)
    const guarded = afterFinalCheck(check.settled, sendBack)

    const pending = guarded(feedback)
    await Promise.resolve()
    expect(sendBack).not.toHaveBeenCalled()

    check.settle(true)
    await expect(pending).resolves.toBe(true)
    expect(sendBack).toHaveBeenCalledWith(feedback)
  })

  it('sends nothing back when the final check failed', async () => {
    const check = settledOnce<boolean>()
    const sendBack = vi.fn(async () => true)
    check.settle(false)
    await expect(afterFinalCheck(check.settled, sendBack)(feedback)).resolves.toBe(false)
    expect(sendBack).not.toHaveBeenCalled()
  })

  it('keeps the first settlement', async () => {
    const check = settledOnce<boolean>()
    check.settle(true)
    check.settle(false)
    await expect(check.settled).resolves.toBe(true)
  })
}
