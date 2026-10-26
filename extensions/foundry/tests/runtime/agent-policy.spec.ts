import { describe, it, expect } from 'vitest'

import { isProbedCommand, readOnlyAutoDecide } from '../../src/runtime/agent-policy.js'
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

describe('a command the toolchain probe found', () => {
  const order = orderProbing('npm test')

  it('may run exactly as found, or followed by a read-only step that reports its status', () => {
    expect(isProbedCommand(order, 'Bash', { command: ' npm test ' })).toBe(true)
    expect(isProbedCommand(order, 'Bash', { command: 'npm test; echo "EXIT=$?"' })).toBe(true)
  })

  it('may not carry a write along with it, or arguments it was not found with', () => {
    expect(isProbedCommand(order, 'Bash', { command: 'npm test; rm -rf .' })).toBe(false)
    expect(isProbedCommand(order, 'Bash', { command: 'npm test -- --update' })).toBe(false)
  })

  it('is never another tool, a command that is not a string, or anything when nothing was probed', () => {
    expect(isProbedCommand(order, 'Write', { command: 'npm test' })).toBe(false)
    expect(isProbedCommand(order, 'Bash', { command: 42 })).toBe(false)
    expect(isProbedCommand(order, 'Bash', null)).toBe(false)
    expect(isProbedCommand(orderProbing(null), 'Bash', { command: 'npm test' })).toBe(false)
  })
})

describe('a read-only turn in the Forge', () => {
  const decide = readOnlyAutoDecide('/data/orders/WO-1/proposal.json')

  it('writes its one file and nothing else', () => {
    expect(decide('Write', { file_path: '/data/orders/WO-1/proposal.json' })).toEqual({
      allow: true,
    })
    expect(decide('Write', { file_path: '/repos/app/src/a.ts' }).allow).toBe(false)
  })

  it('reads what the read-only policy allows', () => {
    expect(decide('Read', { file_path: '/repos/app/src/a.ts' }).allow).toBe(true)
  })
})
