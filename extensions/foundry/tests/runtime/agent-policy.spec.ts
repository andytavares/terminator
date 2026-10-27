import { describe, it, expect } from 'vitest'

import { probedCommands } from '../../src/runtime/agent-policy.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'

function orderProbing(test: string | null): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/app'],
    now: '2026-10-12T10:00:00.000Z',
  })
  return {
    ...base,
    context: {
      ...base.context,
      toolchain: {
        ...base.context.toolchain,
        test: test === null ? null : { command: test, source: 'hint' },
      },
    },
  } as WorkOrder
}

describe('the commands the toolchain probe found', () => {
  it('lists each one trimmed', () => {
    expect(probedCommands(orderProbing(' npm test '))).toEqual(['npm test'])
  })

  it('lists none when nothing was probed', () => {
    expect(probedCommands(orderProbing(null))).toEqual([])
  })
})
