import { describe, it, expect, beforeEach } from 'vitest'
import * as path from 'node:path'

import { saveRoundOutput } from '../../src/forge/intake-turn.js'
import { draftOrder } from '../../src/order/draft.js'
import { createOrderStore, type OrderStore } from '../../src/order/store.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { temporaryDirectory } from '../helpers/foundry-host.js'

// A read-only round (the scout, the red team) puts what it found on the order while the
// architect may be saving its draft: neither may replace the other's write.

let store: OrderStore

beforeEach(async () => {
  store = createOrderStore(path.join(temporaryDirectory('round-output'), 'records'))
  await store.save(
    draftOrder({
      id: 'WO-1',
      title: 'Make it red',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/app'],
      now: '2026-10-30T10:00:00.000Z',
    })
  )
})

/** The store, with the architect's draft landing after a read and before the next write. */
function draftLandsMidway(): OrderStore {
  let landed = false
  const land = async (id: string): Promise<void> => {
    if (landed) return
    landed = true
    await store.update(id, (o) => ({ ...o, title: 'drafted by the architect' }))
  }
  return {
    ...store,
    load: async (id) => {
      const loaded = await store.load(id)
      await land(id)
      return loaded
    },
    update: async (id, change) => {
      await land(id)
      return store.update(id, change)
    },
  }
}

const withEntryPoint = (order: WorkOrder) => ({
  ok: true as const,
  order: { ...order, context: { ...order.context, entryPoints: ['src/colours.ts'] } },
  note: '',
  defect: null,
  document: null,
  anotherPass: false,
  commands: [],
})

describe('saveRoundOutput', () => {
  it('keeps a draft that landed while the round was reading the order', async () => {
    const result = await saveRoundOutput(draftLandsMidway(), 'WO-1', withEntryPoint)
    const saved = await store.load('WO-1')
    expect(result?.ok).toBe(true)
    expect(saved?.title).toBe('drafted by the architect')
    expect(saved?.context.entryPoints).toEqual(['src/colours.ts'])
  })

  it('leaves the order as it is when the round wrote nothing usable', async () => {
    const refused = await saveRoundOutput(store, 'WO-1', () => ({ ok: false, reason: 'bad' }))
    expect(refused).toEqual({ ok: false, reason: 'bad' })
    expect((await store.load('WO-1'))?.context.entryPoints).toEqual([])
  })
})
