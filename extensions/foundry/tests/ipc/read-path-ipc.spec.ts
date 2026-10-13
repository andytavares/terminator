/**
 * Reading Foundry's state, end to end through `activate`.
 *
 * Two things the read path owes the rest of the application: it never starts a
 * process to answer (the refinery's queue used to ask git what every in-flight
 * checkout had changed, on every list and every observe), and a write names
 * what it changed so a window can read just that instead of polling.
 */
import * as fs from 'node:fs'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

import { makeTempDir } from '../../../../tests/support/temp-dir'
import { fakeHost, type FoundryHost } from '../helpers/foundry-host.js'
import { activateFoundry } from '../helpers/foundry-activation.js'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/draft.js'
import { checkoutPath } from '../../src/line/worktree.js'
import { writeRunGraph } from '../../src/ipc/run-channels.js'
import type { RunGraph } from '../../src/line/run-graph.js'
import { writeObservedFiles } from '../../src/line/observed-files.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { partialFake } from '../../../../tests/support/fakes'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}))

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

let dataDir = ''
let host: FoundryHost
const call = (channel: string, payload: unknown = {}) => host.call(channel, payload)

function runningOrder(id: string, touches: string[], agreedAt: string): WorkOrder {
  const base = draftOrder({
    id,
    title: `Order ${id}`,
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    status: 'running',
    recipe: 'direct',
    agreedAt,
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
          touches,
          verify: [],
        },
      ],
    },
  }
}

beforeAll(async () => {
  host = fakeHost(() => dataDir)
  host.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
  await activateFoundry(host)
})

/** A records location with two in-flight orders, each with a checkout on disk. */
async function seedTwoRunningOrders(): Promise<void> {
  dataDir = makeTempDir('fdry-read-path-')
  const store = createOrderStore(dataDir)
  for (const [id, agreedAt] of [
    ['WO-1', '2026-09-06T10:01:00.000Z'],
    ['WO-2', '2026-09-06T10:02:00.000Z'],
  ] as const) {
    const order = runningOrder(id, ['src/a.ts'], agreedAt)
    await store.save(order)
    await writeRunGraph(
      dataDir,
      partialFake<RunGraph>({
        orderId: id,
        recipe: 'direct',
        nodes: [],
      })
    )
    fs.mkdirSync(checkoutPath(dataDir, order, order.context.repos[0].name), { recursive: true })
  }
}

beforeEach(() => {
  host.exec.mockClear()
  host.broadcast.mockClear()
})

describe('the remote browser client', () => {
  // A logged-in remote browser reaches only what is opted in (ADR 094); a
  // channel added here is a decision, so the list is spelled out.
  it('may call exactly these read-only channels, and nothing that writes or runs', () => {
    expect([...host.remoteChannels].sort()).toEqual([
      'foundry:ask-model',
      'foundry:factory.metrics',
      'foundry:feed-list',
      'foundry:models-list',
      'foundry:order.list',
      'foundry:order.states',
      'foundry:permissions-list',
      'foundry:rules.inForce',
      'foundry:run.activity',
      'foundry:run.recipes',
      'foundry:run.timeline',
      'foundry:sensors.list',
      'foundry:signals.list',
      'foundry:stalls-list',
      'foundry:ui.view',
    ])
  })
})

describe('reading the order list and a run', () => {
  it('starts no process even though every in-flight order has a checkout on disk', async () => {
    await seedTwoRunningOrders()
    host.exec.mockClear()
    await call('foundry:order.list')
    await call('foundry:run.observe', { id: 'WO-1' })
    await call('foundry:inbox.list')
    await call('foundry:attention')
    expect(host.exec).not.toHaveBeenCalled()
  })

  it('queues an order behind another by the files recorded for it', async () => {
    await seedTwoRunningOrders()
    await writeObservedFiles(dataDir, 'WO-1', ['src/shared.ts'])
    await writeObservedFiles(dataDir, 'WO-2', ['src/shared.ts'])
    const view = (await call('foundry:run.observe', { id: 'WO-2' })) as {
      queue: { behind: { orderId: string; files: string[] }[] } | null
    }
    expect(view.queue?.behind.map((b) => [b.orderId, b.files])).toEqual([
      ['WO-1', ['src/shared.ts']],
    ])
  })
})

describe('telling the windows what changed', () => {
  it('names the order and the kind of record after a write through a channel', async () => {
    await seedTwoRunningOrders()
    await call('foundry:order.hold', { id: 'WO-1', held: true })
    expect(host.broadcast).toHaveBeenCalledWith('foundry:changed', {
      kind: 'ledger',
      orderId: 'WO-1',
    })
  })

  it('says nothing about an order for a read', async () => {
    await seedTwoRunningOrders()
    host.broadcast.mockClear()
    await call('foundry:order.list')
    await call('foundry:run.observe', { id: 'WO-1' })
    expect(host.broadcast.mock.calls.filter(([channel]) => channel === 'foundry:changed')).toEqual(
      []
    )
  })
})
