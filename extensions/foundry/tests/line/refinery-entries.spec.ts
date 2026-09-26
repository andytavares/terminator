import { describe, it, expect } from 'vitest'
import { queueEntries } from '../../src/line/refinery-entries.js'
import type { QueueEntriesDeps } from '../../src/line/refinery-entries.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Refuse an expired refresh token',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/app'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    status: 'running',
    agreedAt: '2026-09-06T09:00:00.000Z',
    context: {
      ...base.context,
      repos: [
        {
          name: 'app',
          path: '/repos/app',
          lane: 1,
          baseBranch: 'main',
          headBranch: 'foundry/wo-1',
        },
      ],
    },
    plan: {
      ...base.plan,
      units: [
        {
          id: 'U1',
          title: 'Refuse the token',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: [],
          touches: ['src/auth.ts'],
          verify: [],
        },
      ],
      lanes: [{ ord: 1, repo: 'app', branch: '', role: null, blocks: [], blockedBy: [] }],
    },
    ...over,
  }
}

function deps(over: Partial<QueueEntriesDeps> = {}): QueueEntriesDeps {
  return {
    readPulls: async () => [],
    changedFiles: async () => [],
    merged: () => false,
    agreedAt: (o) => o.agreedAt ?? '',
    ...over,
  }
}

describe('queueEntries', () => {
  it('skips drafts and cancelled orders', async () => {
    const entries = await queueEntries(
      [order({ status: 'draft' }), order({ status: 'cancelled' })],
      deps()
    )
    expect(entries).toEqual([])
  })

  it('produces one entry per lane repo for a running order', async () => {
    const entries = await queueEntries([order()], deps())
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      orderId: 'WO-1',
      title: 'Refuse an expired refresh token',
      repo: 'app',
      base: 'main',
      agreedAt: '2026-09-06T09:00:00.000Z',
      merged: false,
    })
  })

  it('uses the checkout observed files when there is one', async () => {
    const entries = await queueEntries(
      [order()],
      deps({ changedFiles: async () => ['src/observed.ts'] })
    )
    expect(entries[0]?.files).toEqual(['src/observed.ts'])
  })

  it('falls back to the lane units touches when there is no checkout yet', async () => {
    const entries = await queueEntries([order()], deps())
    expect(entries[0]?.files).toEqual(['src/auth.ts'])
  })

  it('treats an order with an open pull as having a checkout, even with nothing observed yet', async () => {
    const entries = await queueEntries(
      [order()],
      deps({ readPulls: async () => [{ repo: 'app' }], changedFiles: async () => [] })
    )
    expect(entries[0]?.files).toEqual([])
  })

  it('carries the merged flag from its dep', async () => {
    const entries = await queueEntries([order()], deps({ merged: () => true }))
    expect(entries[0]?.merged).toBe(true)
  })

  it('shipped orders also produce entries', async () => {
    const entries = await queueEntries([order({ status: 'shipped' })], deps())
    expect(entries).toHaveLength(1)
  })
})
