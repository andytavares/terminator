import { HOME_MEASURES } from '@terminator/extension-sdk'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { makeTempDir } from '../../../../tests/support/temp-dir'
import { fakeHost } from '../helpers/foundry-host.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { activateFoundry, deactivate } from '../helpers/foundry-activation.js'
import { startFoundryHomePublisher } from '../../src/home/publish.js'
import { createDeciding, createStandingSources } from '../../src/ipc/standing.js'
import { gateStoreAt, orderStoreAt } from '../../src/state/live-index.js'
import { raiseGate } from '../../src/gates/rules.js'
import { runningOrder } from '../helpers/order-parts.js'
import { eventually } from '../../../../tests/support/eventually'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))
vi.mock('../../src/runtime/control-server.js', () => import('../helpers/supervision-mocks.js'))

let dataDir = ''
let host: FoundryHost

async function startingStatePublished(): Promise<void> {
  await eventually(() => expect(host.homePublish).toHaveBeenCalledTimes(1))
}

beforeEach(async () => {
  dataDir = makeTempDir('fdry-home-')
  host = fakeHost(() => dataDir)
  host.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
  await activateFoundry(host)
  // Activation publishes the starting state once; wait it out so no spec counts it.
  await startingStatePublished()
  host.homePublish.mockClear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

afterEach(async () => {
  await deactivate()
  vi.useRealTimers()
})

async function seedHaltedOrder(): Promise<string> {
  const order = runningOrder('WO-1', ['src/a.ts'], {
    title: 'Interval presets',
    source: { kind: 'typed', tracker: null, key: null, url: null, branch: 'wo-1-presets' },
  })
  await orderStoreAt(dataDir).save(order)
  const gate = raiseGate({
    id: 'G-1',
    rule: 'risk.p0',
    orderId: order.id,
    summary: 'A riskier change than planned',
    why: 'touches payments',
    at: '2026-10-18T11:10:00.000Z',
  })
  await gateStoreAt(dataDir).save(gate)
  return gate.id
}

function lastFeed() {
  return host.homePublish.mock.calls.at(-1)?.[0] as {
    asks: { id: string; title: string }[]
    facets: { stage: string; whoseMove: string }[]
    measures: { id: string }[]
  }
}

describe('publishing to Home when a record changes', () => {
  it('publishes the ask, the facet and the measures after a write, once the debounce has passed', async () => {
    const gateId = await seedHaltedOrder()
    await vi.advanceTimersByTimeAsync(499)
    expect(host.homePublish).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await eventually(() => expect(host.homePublish).toHaveBeenCalledTimes(1))
    const feed = lastFeed()
    expect(feed.asks).toMatchObject([{ id: `gate:${gateId}`, title: 'Foundry needs a decision' }])
    expect(feed.facets).toMatchObject([{ stage: 'building', whoseMove: 'you' }])
    expect(feed.measures.map((m) => m.id)).toContain(HOME_MEASURES.ordersShipped)
  })

  it('publishes once for a burst of changes', async () => {
    await seedHaltedOrder()
    await orderStoreAt(dataDir).record({
      at: '2026-10-18T11:11:00.000Z',
      orderId: 'WO-1',
      actor: 'operator',
      action: 'order.note',
      subject: 'WO-1',
      reason: 'one more write',
      evidence: [],
    })
    await vi.advanceTimersByTimeAsync(500)
    await eventually(() => expect(host.homePublish).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(2000)
    await deactivate()
    expect(host.homePublish).toHaveBeenCalledTimes(1)
  })
})

describe('a document order on Home', () => {
  it('keeps an order that just shipped on its document on Home, with its link', async () => {
    const url = 'https://claude.ai/artifact/abc'
    const order = runningOrder('WO-2', ['src/a.ts'], {
      status: 'shipped',
      document: { path: '/tmp/findings.html', url, location: 'published' },
      source: { kind: 'typed', tracker: null, key: null, url: null, branch: 'wo-2-findings' },
    })
    await orderStoreAt(dataDir).save(order)
    await orderStoreAt(dataDir).record({
      at: new Date().toISOString(),
      orderId: 'WO-2',
      actor: 'rule:run',
      action: 'run.document_ready',
      subject: 'WO-2',
      reason: `published: /tmp/findings.html (${url})`,
      evidence: [],
    })
    await vi.advanceTimersByTimeAsync(500)
    await eventually(() => expect(host.homePublish).toHaveBeenCalledTimes(1))
    expect(lastFeed().facets).toMatchObject([
      { stage: 'shipped', links: [{ label: 'Open artifact', url }] },
    ])
  })
})

function publisherWithDecide(decide: ReturnType<typeof vi.fn>) {
  const direct = fakeHost(() => dataDir)
  const dataRoot = (): string => dataDir
  const standingSources = createStandingSources(dataRoot, createDeciding())
  startFoundryHomePublisher(
    { api: direct.api, dataRoot },
    { standingSources, decide: decide as never }
  )
  return { direct, answer: direct.homeActionHandlers[0] }
}

describe('answering from Home', () => {
  it('decides the gate with the option the button names', async () => {
    const decide = vi.fn(async () => ({ ok: true }))
    const { answer } = publisherWithDecide(decide)
    await answer('gate:G-1', 'approve')
    expect(decide).toHaveBeenCalledWith({ gateId: 'G-1', option: 'approve' })
  })

  it('says so when the decision is refused', async () => {
    const { answer } = publisherWithDecide(
      vi.fn(async () => ({ error: 'Gate G-1 was already decided.' }))
    )
    await expect(answer('gate:G-1', 'approve')).rejects.toThrow('already decided')
  })

  it('brings Foundry forward for Open without deciding anything', async () => {
    const decide = vi.fn()
    const { direct, answer } = publisherWithDecide(decide)
    await answer('order:WO-1', 'open')
    expect(direct.api.window.showSelf).toHaveBeenCalledWith('main')
    expect(decide).not.toHaveBeenCalled()
  })

  it('refuses a move on an item that has no gate', async () => {
    const { answer } = publisherWithDecide(vi.fn())
    await expect(answer('order:WO-1', 'approve')).rejects.toThrow('no longer waiting')
  })
})

describe('the open-order command Home runs', () => {
  it('brings Foundry forward and tells its view which order to open', () => {
    const open = host.commands.get('open-order') as unknown as (ctx: object, args: object) => void
    open({}, { orderId: 'WO-1' })
    expect(host.api.window.showSelf).toHaveBeenCalledWith('main')
    expect(host.broadcast).toHaveBeenCalledWith('foundry:ui.open-order', { orderId: 'WO-1' })
  })
})
