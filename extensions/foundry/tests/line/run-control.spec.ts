import { describe, it, expect, beforeEach } from 'vitest'
import * as path from 'node:path'

import { temporaryDirectory } from '../helpers/foundry-host.js'
import { settleFinishedDocuments } from '../../src/line/run-control.js'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/draft.js'
import type { OrderStore } from '../../src/order/store.js'
import type { WorkOrder } from '../../src/order/schema.js'

let store: OrderStore

beforeEach(() => {
  store = createOrderStore(path.join(temporaryDirectory('fdry-run-control'), 'records'))
})

async function runningOrder(id: string, actions: string[]): Promise<void> {
  const base = draftOrder({
    id,
    title: 'Why is the sky blue',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  await store.save({ ...base, status: 'running' } satisfies WorkOrder)
  for (const action of actions) {
    await store.record({
      at: '2026-09-06T11:00:00.000Z',
      orderId: id,
      actor: 'rule:line',
      action,
      subject: id,
      reason: '',
      evidence: [],
    })
  }
}

describe('settling runs that ended on a ready document', () => {
  it('ships a running order whose last run entry is the document being ready', async () => {
    await runningOrder('WO-1', ['run.started', 'run.document_ready'])
    await settleFinishedDocuments(store)
    expect((await store.load('WO-1'))?.status).toBe('shipped')
    const settled = (await store.entries('WO-1')).find((entry) => entry.action === 'order.settled')
    expect(settled?.reason).toBe('its run ended on a ready document')
  })

  it('tells the ticket about each order it settles, as a finished run would', async () => {
    await runningOrder('WO-4', ['run.started', 'run.document_ready'])
    await runningOrder('WO-5', ['run.started'])
    const told: string[] = []
    await settleFinishedDocuments(store, async (order) => {
      told.push(`${order.id}:${order.status}`)
    })
    expect(told).toEqual(['WO-4:shipped'])
  })

  it('leaves a run that went on after the document alone', async () => {
    await runningOrder('WO-2', ['run.document_ready', 'run.started'])
    await settleFinishedDocuments(store)
    expect((await store.load('WO-2'))?.status).toBe('running')
  })

  it('leaves a run that never reached a document alone', async () => {
    await runningOrder('WO-3', ['run.started', 'run.failed'])
    await settleFinishedDocuments(store)
    expect((await store.load('WO-3'))?.status).toBe('running')
  })
})
