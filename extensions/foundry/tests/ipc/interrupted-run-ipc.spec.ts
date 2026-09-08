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
import { tmpdir } from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'

const USER_DATA = tmpdir()

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type { ExtensionAPI } from '../../../../src/main/extensions/api.js'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { RunGraph } from '../../src/line/run-graph.js'
import type { Gate } from '../../src/gates/rules.js'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  app: { getPath: vi.fn().mockReturnValue(USER_DATA) },
}))

/**
 * Nothing is running. That is the state a fresh application is always in —
 * every agent's terminal was a child of the process that died with it.
 */
const runner = {
  start: vi.fn(),
  resolve: vi.fn(),
  handBackToTerminal: vi.fn(),
  interrupt: vi.fn(),
  stop: vi.fn().mockReturnValue(true),
  send: vi.fn().mockReturnValue(true),
  terminalFor: vi.fn().mockReturnValue(null),
  watchable: vi.fn().mockReturnValue([]),
  dispose: vi.fn(),
}

vi.mock('../../src/runtime/supervised-runner.js', () => ({
  createSupervisedRunner: () => runner,
}))

vi.mock('../../src/runtime/control-server.js', () => ({
  createControlServer: vi.fn().mockResolvedValue({
    url: 'http://127.0.0.1:1/pretooluse',
    eventUrl: 'http://127.0.0.1:1/event',
    token: 'token',
    register: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
  }),
}))

let getHandler: (channel: string) => ((payload: unknown) => Promise<unknown>) | undefined
let api: ExtensionAPI
/** Read by the extension through `settings.get`; a fresh one per test. */
let dataDir = ''
const settingsGet = vi.fn((key: string) =>
  key === 'terminator.foundry.dataDir' ? dataDir : undefined
)

function call(channel: string, payload: unknown = {}): Promise<unknown> {
  const handler = getHandler(channel)
  if (handler === undefined) throw new Error(`${channel} is not registered`)
  return handler(payload)
}

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
      units: [
        {
          id: 'U-1',
          title: 'the first bit',
          role: 'builder',
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

const GRAPH: RunGraph = {
  orderId: 'WO-1',
  recipe: 'direct',
  nodes: [
    {
      id: 'build:U-1',
      stepId: 'build',
      kind: 'fanout',
      state: 'running',
      unitId: 'U-1',
      lane: 1,
      role: 'builder',
      dependsOn: [],
      attempts: 1,
      sessionId: 'session-from-a-dead-process',
      worktreePath: '/repos/a',
      startedAt: '2026-09-06T10:00:00.000Z',
      endedAt: null,
    },
  ],
}

/** A records location holding one run the last application left in flight. */
async function seedInterruptedRun(over: Partial<WorkOrder> = {}): Promise<void> {
  dataDir = fs.mkdtempSync(path.join(tmpdir(), 'fdry-interrupted-'))
  const store = createOrderStore(dataDir)
  await store.save(order(over))
  fs.writeFileSync(
    path.join(dataDir, 'orders', 'WO-1', 'run-graph.json'),
    JSON.stringify(GRAPH, null, 2)
  )
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

function ledger(): string {
  const file = path.join(dataDir, 'orders', 'WO-1', 'ledger.jsonl')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

beforeAll(async () => {
  const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
  api = {
    ipc: {
      registerHandler: vi.fn((channel: string, handler: (payload: unknown) => Promise<unknown>) => {
        handlers.set(channel, handler)
        return { dispose: vi.fn() }
      }),
      invokeChannel: vi.fn(),
      sendChannel: vi.fn(),
      onWindowEvent: vi.fn().mockReturnValue(() => {}),
      isRemoteAccessible: vi.fn().mockReturnValue(false),
    },
    window: { broadcast: vi.fn(), openAuxiliary: vi.fn(), focusSelf: vi.fn() },
    shell: { exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }) },
    notifications: { showToast: vi.fn(), createNotification: vi.fn() },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: {
      register: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      get: settingsGet,
      set: vi.fn(),
      resolveWorktreeBaseDir: vi.fn().mockReturnValue(path.join(tmpdir(), 'fdry-worktrees')),
    },
    terminal: {
      onSessionCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onSessionClose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    workspace: {
      list: vi.fn().mockReturnValue([]),
      listProjects: vi.fn().mockReturnValue([]),
      createProject: vi.fn(),
      deleteProject: vi.fn(),
      onDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onProjectDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    pty: {
      spawn: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      listSessions: vi.fn().mockReturnValue([]),
      attachOnData: vi.fn().mockReturnValue(null),
      attachOnExit: vi.fn().mockReturnValue(null),
      openTerminalTab: vi.fn(),
    },
    app: { version: '0.0.0-test' },
  } as unknown as ExtensionAPI

  const { activate, startSupervisionRuntime } = await import('../../src/index.ts')
  activate(api)
  getHandler = (channel) => handlers.get(channel)
  if ((await startSupervisionRuntime(api)) === null) {
    throw new Error('the supervision runtime did not start')
  }
})

beforeEach(() => {
  runner.terminalFor.mockReturnValue(null)
  runner.stop.mockReturnValue(true)
})

describe('a fresh application opening on a run the last one left in flight', () => {
  it('notices without being asked, on the poll the chrome already makes', async () => {
    await seedInterruptedRun()
    await call('foundry:attention')
    expect(gatesOnDisk().map((g) => g.rule)).toEqual(['run.interrupted'])
  })

  it('counts it on the inbox, so the badge says so within one poll', async () => {
    await seedInterruptedRun()
    const counts = (await call('foundry:attention')) as { inbox: number }
    expect(counts.inbox).toBe(1)
  })

  it('says what stopped, in the operator’s words rather than node ids', async () => {
    await seedInterruptedRun()
    await call('foundry:attention')
    expect(gatesOnDisk()[0].why).toContain('builder · U-1 the first bit')
  })

  it('writes it to the order’s own record, so it is answerable afterwards', async () => {
    await seedInterruptedRun()
    await call('foundry:attention')
    expect(ledger()).toContain('run.interrupted')
  })

  it('raises one row however many times the application is reopened', async () => {
    await seedInterruptedRun()
    await call('foundry:attention')
    await call('foundry:inbox.list')
    await call('foundry:attention')
    expect(gatesOnDisk()).toHaveLength(1)
  })

  it('leaves a run alone whose agents are still in their terminals', async () => {
    runner.terminalFor.mockReturnValue({ terminalSessionId: 't1', projectId: 'p1' })
    await seedInterruptedRun()
    await call('foundry:attention')
    expect(gatesOnDisk()).toEqual([])
  })

  it('leaves an order alone that is not running', async () => {
    await seedInterruptedRun({ status: 'shipped' })
    await call('foundry:attention')
    expect(gatesOnDisk()).toEqual([])
  })

  it('tells the Floor which steps nothing is running', async () => {
    await seedInterruptedRun()
    const view = (await call('foundry:run.observe', { id: 'WO-1' })) as { orphaned: string[] }
    expect(view.orphaned).toEqual(['build:U-1'])
  })

  it('refuses to send the operator to a terminal that no longer exists', async () => {
    await seedInterruptedRun()
    const r = (await call('foundry:session.attach', {
      orderId: 'WO-1',
      nodeId: 'build:U-1',
    })) as { error: string }
    expect(r.error).toMatch(/no live agent/)
  })
})

describe('answering the gate', () => {
  it('picks the run back up, putting the abandoned step back in the queue', async () => {
    await seedInterruptedRun()
    await call('foundry:attention')
    const r = (await call('foundry:inbox.decide', {
      gateId: 'WO-1-run.interrupted',
      option: 'resume',
    })) as { ok: boolean }

    expect(r.ok).toBe(true)
    expect(graphOnDisk().nodes[0].state).toBe('waiting')
  })

  it('gives the attempt back, because the application closing is not a failed try', async () => {
    await seedInterruptedRun()
    await call('foundry:attention')
    await call('foundry:inbox.decide', { gateId: 'WO-1-run.interrupted', option: 'resume' })
    expect(graphOnDisk().nodes[0].attempts).toBe(0)
  })

  it('keeps the session on the node, so the agent resumes its own conversation', async () => {
    await seedInterruptedRun()
    await call('foundry:attention')
    await call('foundry:inbox.decide', { gateId: 'WO-1-run.interrupted', option: 'resume' })
    expect(graphOnDisk().nodes[0].sessionId).toBe('session-from-a-dead-process')
  })

  it('stopping actually stops: the order is cancelled rather than left running', async () => {
    await seedInterruptedRun()
    await call('foundry:attention')
    await call('foundry:inbox.decide', { gateId: 'WO-1-run.interrupted', option: 'stop' })
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('cancelled')
  })

  it('holding changes nothing, which is what holding means', async () => {
    await seedInterruptedRun()
    await call('foundry:attention')
    await call('foundry:inbox.decide', { gateId: 'WO-1-run.interrupted', option: 'hold' })
    expect(graphOnDisk().nodes[0].state).toBe('running')
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('running')
  })
})

describe('stopping a run whose agents are still alive', () => {
  it('ends each one, saying why, before the order is cancelled', async () => {
    runner.terminalFor.mockReturnValue({ terminalSessionId: 't1', projectId: 'p1' })
    await seedInterruptedRun()
    // Raised by hand: with live agents nothing adopts it, which is the point.
    const store = createOrderStore(dataDir)
    await store.record({
      at: '2026-09-06T10:00:00.000Z',
      orderId: 'WO-1',
      actor: 'rule:line',
      action: 'gate.raised',
      subject: 'x',
      reason: 'x',
      evidence: [],
    })
    fs.writeFileSync(
      path.join(dataDir, 'orders', 'WO-1', 'gates.json'),
      JSON.stringify([
        {
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
        },
      ])
    )

    await call('foundry:inbox.decide', { gateId: 'WO-1-budget', option: 'stop' })
    expect(runner.stop).toHaveBeenCalledWith(
      'session-from-a-dead-process',
      expect.stringContaining('budget.exceeded')
    )
    expect((await store.load('WO-1'))?.status).toBe('cancelled')
  })
})

describe('stopping the whole order rather than one agent', () => {
  it('is reachable as its own channel, because a gate was the only way out', async () => {
    expect(getHandler('foundry:run.stop')).toBeDefined()
  })

  it('cancels the order and writes down that a person did it', async () => {
    await seedInterruptedRun()
    expect(await call('foundry:run.stop', { id: 'WO-1' })).toEqual({ ok: true })
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('cancelled')
    expect(ledger()).toContain('run.stopped')
  })

  it('rejects a malformed request rather than cancelling something else', async () => {
    await seedInterruptedRun()
    expect(await call('foundry:run.stop', {})).toEqual({ error: 'Malformed request.' })
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('running')
  })
})
