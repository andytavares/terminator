/**
 * Picking a run back up after the application closed, end to end.
 *
 * Driven through `activate` with a stubbed runner, because the thing worth
 * asserting is not that `reclaim` reclaims — its own tests cover that — but
 * that a fresh application notices, says so where the operator is already
 * looking, and that the answer they give reaches the run. Every part of this
 * existed and none of it was joined up: `run.resume` was registered and called
 * by nothing, and every gate offering "Stop here" did nothing at all.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'

import { makeTempDir } from '../../../../tests/support/temp-dir'
import { fakeHost, type FoundryHost } from '../helpers/foundry-host.js'
import { activateFoundry, deactivate, settleFoundryWork } from '../helpers/foundry-activation.js'
import { builderUnit } from '../helpers/order-parts.js'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { RunGraph } from '../../src/line/run-graph.js'
import type { Gate } from '../../src/gates/rules.js'
import { executingOrders } from '../../src/line/run-control.js'
import { theRunner } from '../helpers/supervision-mocks.js'
import { ledgerFileText } from '../helpers/order-ledger.js'
import { eventually } from '../../../../tests/support/eventually'

/**
 * Nothing is running. That is the state a fresh application is always in —
 * every agent's terminal was a child of the process that died with it.
 */
vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))
vi.mock('../../src/runtime/control-server.js', () => import('../helpers/supervision-mocks.js'))

/** Read by the extension through `settings.get`; a fresh one per test. */
let dataDir = ''
let host: FoundryHost

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Make the thing work',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    status: 'running',
    recipe: 'direct',
    plan: {
      ...base.plan,
      units: [builderUnit('U-1', { title: 'the first bit', satisfies: ['AC-1'] })],
    },
    ...over,
  }
}

const GRAPH: RunGraph = {
  orderId: 'WO-1',
  recipe: 'direct',
  nodes: [
    {
      id: 'build:U-1',
      stepId: 'build',
      kind: 'fanout',
      state: 'running',
      unitIds: ['U-1'],
      lane: 1,
      role: 'builder',
      dependsOn: [],
      attempts: 1,
      reworks: 0,
      feedback: [],
      sessionId: 'session-from-a-dead-process',
      worktreePath: '/repos/a',
      startedAt: '2026-09-06T10:00:00.000Z',
      endedAt: null,
    },
  ],
}

/** One run the last application left in flight, plus `more`. The extension sees the location only
 * once it is complete: it never notices a hand-written record later (foundry CLAUDE.md rule 4). */
async function seedInterruptedRun(
  over: Partial<WorkOrder> = {},
  more: (records: string) => Promise<void> = async () => undefined
): Promise<void> {
  const records = makeTempDir('fdry-interrupted-')
  await createOrderStore(records).save(order(over))
  fs.writeFileSync(
    path.join(records, 'orders', 'WO-1', 'run-graph.json'),
    JSON.stringify(GRAPH, null, 2)
  )
  await more(records)
  dataDir = records
}

function gatesOnDisk(): Gate[] {
  const file = path.join(dataDir, 'orders', 'WO-1', 'gates.json')
  if (!fs.existsSync(file)) return []
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Gate[]
}

function graphOnDisk(): RunGraph {
  return JSON.parse(
    fs.readFileSync(path.join(dataDir, 'orders', 'WO-1', 'run-graph.json'), 'utf8')
  ) as RunGraph
}

beforeAll(async () => {
  host = fakeHost(() => dataDir)
  host.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
  await activateFoundry(host)
})

// Each test's proofs and runs end before the next test, or the spec's folder, goes.
afterEach(settleFoundryWork)

afterAll(async () => {
  await deactivate()
})

/**
 * Resuming hands the graph to an executor it does not wait for, which starts
 * the reclaimed node again. Read the graph after that, not while it races.
 */
async function restarted(): Promise<RunGraph> {
  await eventually(() => expect(theRunner.start).toHaveBeenCalledTimes(1))
  return graphOnDisk()
}

beforeEach(async () => {
  // A previous test's resume leaves its executor winding down; while it is marked executing,
  // no node of the order counts as orphaned.
  await eventually(() => expect(executingOrders.size).toBe(0))
  // This spec stops at the restart: a start that throws leaves the node as resuming put it
  // and ends that executor before the next test resumes the same order.
  theRunner.start.mockClear().mockImplementation(() => {
    throw new Error('no agent starts in this spec')
  })
  theRunner.terminalFor.mockReturnValue(null)
  theRunner.stop.mockReturnValue(true)
})

describe('a fresh application opening on a run the last one left in flight', () => {
  describe('noticing', noticingTests)
  describe('once only and live agents', onceOnlyAndLiveAgentsTests)
  describe('the Floor and terminals', theFloorAndTerminalsTests)
})

function noticingTests() {
  it('notices without being asked, on the poll the chrome already makes', async () => {
    await seedInterruptedRun()
    await host.call('foundry:attention')
    expect(gatesOnDisk().map((g) => g.rule)).toEqual(['run.interrupted'])
  })

  it('counts it on the inbox, so the badge says so within one poll', async () => {
    await seedInterruptedRun()
    const counts = (await host.call('foundry:attention')) as { inbox: number }
    expect(counts.inbox).toBe(1)
  })

  it('says what stopped, in the operator’s words rather than node ids', async () => {
    await seedInterruptedRun()
    await host.call('foundry:attention')
    expect(gatesOnDisk()[0].why).toContain('builder · U-1 the first bit')
  })

  it('writes it to the order’s own record, so it is answerable afterwards', async () => {
    await seedInterruptedRun()
    await host.call('foundry:attention')
    expect(ledgerFileText(dataDir)).toContain('run.interrupted')
  })
}

function onceOnlyAndLiveAgentsTests() {
  it('raises one row however many times the application is reopened', async () => {
    await seedInterruptedRun()
    await host.call('foundry:attention')
    await host.call('foundry:inbox.list')
    await host.call('foundry:attention')
    expect(gatesOnDisk()).toHaveLength(1)
  })

  it('leaves a run alone whose agents are still in their terminals', async () => {
    theRunner.terminalFor.mockReturnValue({ terminalSessionId: 't1', projectId: 'p1' })
    await seedInterruptedRun()
    await host.call('foundry:attention')
    expect(gatesOnDisk()).toEqual([])
  })

  it('leaves an order alone that is not running', async () => {
    await seedInterruptedRun({ status: 'shipped' })
    await host.call('foundry:attention')
    expect(gatesOnDisk()).toEqual([])
  })
}

function theFloorAndTerminalsTests() {
  it('tells the Floor which steps nothing is running', async () => {
    await seedInterruptedRun()
    const view = (await host.call('foundry:run.observe', { id: 'WO-1' })) as { orphaned: string[] }
    expect(view.orphaned).toEqual(['build:U-1'])
  })

  it('refuses to send the operator to a terminal that no longer exists', async () => {
    await seedInterruptedRun()
    const r = (await host.call('foundry:session.attach', {
      orderId: 'WO-1',
      nodeId: 'build:U-1',
    })) as { error: string }
    expect(r.error).toMatch(/no live agent/)
  })
}

describe('answering the gate', () => {
  describe('picking up', interruptedRunIpcPickingUpTests)
  describe('stopping and holding', stoppingAndHoldingTests)
})

function interruptedRunIpcPickingUpTests() {
  it('picks the run back up, putting the abandoned step back in the queue', async () => {
    await seedInterruptedRun()
    await host.call('foundry:attention')
    const r = (await host.call('foundry:inbox.decide', {
      gateId: 'WO-1-run.interrupted',
      option: 'resume',
    })) as { ok: boolean }

    expect(r.ok).toBe(true)
    expect((await restarted()).nodes[0].state).toBe('running')
  })

  it('gives the attempt back, because the application closing is not a failed try', async () => {
    await seedInterruptedRun()
    await host.call('foundry:attention')
    await host.call('foundry:inbox.decide', { gateId: 'WO-1-run.interrupted', option: 'resume' })
    expect((await restarted()).nodes[0].attempts).toBe(1)
  })

  it('keeps the session on the node, so the agent resumes its own conversation', async () => {
    await seedInterruptedRun()
    await host.call('foundry:attention')
    await host.call('foundry:inbox.decide', { gateId: 'WO-1-run.interrupted', option: 'resume' })
    expect(graphOnDisk().nodes[0].sessionId).toBe('session-from-a-dead-process')
  })
}

function stoppingAndHoldingTests() {
  it('stopping actually stops: the order is cancelled rather than left running', async () => {
    await seedInterruptedRun()
    await host.call('foundry:attention')
    await host.call('foundry:inbox.decide', { gateId: 'WO-1-run.interrupted', option: 'stop' })
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('cancelled')
  })

  it('holding changes nothing, which is what holding means', async () => {
    await seedInterruptedRun()
    await host.call('foundry:attention')
    await host.call('foundry:inbox.decide', { gateId: 'WO-1-run.interrupted', option: 'hold' })
    expect(graphOnDisk().nodes[0].state).toBe('running')
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('running')
  })
}

/** A budget gate whose options include stopping the order. */
const BUDGET_GATE = {
  id: 'WO-1-budget',
  rule: 'budget.exceeded',
  orderId: 'WO-1',
  nodeId: null,
  summary: 's',
  why: 'w',
  evidence: [],
  options: [
    { id: 'raise', label: 'Raise the budget', consequence: 'c' },
    { id: 'stop', label: 'Stop here', consequence: 'c' },
    { id: 'hold', label: 'Hold', consequence: 'c' },
  ],
  defaultIfIgnored: 'hold',
  deadline: null,
  blockedUnits: 0,
  riskGrade: 'P3',
  raisedAt: '2026-09-06T10:00:00.000Z',
  decision: null,
}

const RAISED = {
  at: '2026-09-06T10:00:00.000Z',
  orderId: 'WO-1',
  actor: 'rule:line',
  action: 'gate.raised',
  subject: 'x',
  reason: 'x',
  evidence: [],
}

describe('stopping a run whose agents are still alive', () => {
  it('ends each one, saying why, before the order is cancelled', async () => {
    theRunner.terminalFor.mockReturnValue({ terminalSessionId: 't1', projectId: 'p1' })
    // Raised by hand: with live agents nothing adopts it, which is the point.
    await seedInterruptedRun({}, async (records) => {
      await createOrderStore(records).record(RAISED)
      fs.writeFileSync(
        path.join(records, 'orders', 'WO-1', 'gates.json'),
        JSON.stringify([BUDGET_GATE])
      )
    })
    const store = createOrderStore(dataDir)

    await host.call('foundry:inbox.decide', { gateId: 'WO-1-budget', option: 'stop' })
    expect(theRunner.stop).toHaveBeenCalledWith(
      'session-from-a-dead-process',
      expect.stringContaining('a run going past its time or agent budget')
    )
    expect((await store.load('WO-1'))?.status).toBe('cancelled')
  })
})

describe('stopping the whole order rather than one agent', () => {
  it('is reachable as its own channel, because a gate was the only way out', async () => {
    await expect(host.call('foundry:run.stop', { id: 'WO-none' })).resolves.toBeDefined()
  })

  it('cancels the order and writes down that a person did it', async () => {
    await seedInterruptedRun()
    expect(await host.call('foundry:run.stop', { id: 'WO-1' })).toEqual({ ok: true })
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('cancelled')
    expect(ledgerFileText(dataDir)).toContain('run.stopped')
  })
})
