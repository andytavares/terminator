import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import React from 'react'
import { Orders } from '../../src/components/Orders.js'
import { Forge } from '../../src/components/Forge.js'
import { draftOrder } from '../../src/order/schema.js'
import { compileOrder } from '../../src/order/compile.js'

// The shape the stylesheet frames.
//
// An open order is a frame — a way back at the top, the order in the middle
// scrolling inside it, the controls that end it at the foot — and the Forge's
// two columns are one box inside that frame so neither of them can drive how
// long the page is. Whether it actually holds is measured in the running
// application (tests/e2e/foundry.spec.ts); what is asserted here is the
// structure that rule is written against, because a wrapper quietly dropped in
// a refactor takes the whole layout with it and every other test stays green.

const ORDER = draftOrder({
  id: 'WO-1',
  title: 'Refuse an expired refresh token',
  source: { kind: 'typed', tracker: null, key: null, url: null },
  repoPaths: ['/repos/app'],
  now: '2026-09-06T10:00:00.000Z',
})

function bridge(handlers: Record<string, unknown>): void {
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: {
      invoke: vi.fn(async (channel: string) => handlers[channel] ?? {}),
      on: vi.fn(() => vi.fn()),
    },
  }
}

beforeEach(() => vi.clearAllMocks())

describe('the Forge is two columns in one box', () => {
  it('puts the rail and the document inside it, and nothing else', async () => {
    bridge({
      'foundry:order.compile': { order: ORDER, compile: compileOrder(ORDER) },
      'foundry:run.recipes': { recipes: [], proposed: null },
    })
    const { container } = render(<Forge orderId="WO-1" />)
    await waitFor(() => expect(container.querySelector('.fdry-rail')).not.toBeNull())

    const cols = container.querySelector('.fdry-cols')
    expect(cols, 'the columns box is gone; the rail drives the page height again').not.toBeNull()
    expect(Array.from(cols?.children ?? []).map((el) => el.className)).toEqual([
      'fdry-rail',
      'fdry-doc',
    ])
  })
})

describe('an open order is a frame', () => {
  it('marks the shell, and keeps the controls that end it last', async () => {
    bridge({
      'foundry:order.list': {
        orders: [
          {
            id: 'WO-1',
            title: ORDER.title,
            status: 'draft',
            risk: 'P2',
            failures: 0,
            source: { kind: 'typed', tracker: null, key: null },
          },
        ],
      },
      'foundry:order.compile': { order: ORDER, compile: compileOrder(ORDER) },
      'foundry:run.recipes': { recipes: [], proposed: null },
    })
    const { container } = render(<Orders repoRoot="/repos/app" />)
    await waitFor(() => expect(container.querySelector('.fdry-orders')).not.toBeNull())
    ;(container.querySelector('.fdry-orders button') as HTMLButtonElement).click()
    await waitFor(() => expect(container.querySelector('.fdry-forge')).not.toBeNull())

    const shell = container.querySelector('.fdry-shell')
    expect(shell?.classList.contains('is-open'), 'the shell is not framed').toBe(true)
    expect(shell?.lastElementChild?.className).toBe('fdry-order-controls')
  })
})
