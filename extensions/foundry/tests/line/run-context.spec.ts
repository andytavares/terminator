import { describe, it, expect, vi } from 'vitest'
import { noteOn } from '../../src/line/run-context.js'
import type { OrderStore } from '../../src/order/store.js'
import { partialFake } from '../../../../tests/support/fakes'

describe('a checkout that had to fall back', () => {
  it('says so in the order ledger', () => {
    const record = vi.fn(async () => undefined)
    const store = partialFake<OrderStore>({ record })
    noteOn(store, 'WO-1')('could not fetch origin/main; cut from the local main')
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'WO-1',
        actor: 'rule:line',
        action: 'checkout.note',
        reason: 'could not fetch origin/main; cut from the local main',
      })
    )
  })
})
