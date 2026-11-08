import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { Orders } from '../../src/components/Orders.js'
import { Forge } from '../../src/components/Forge.js'
import { draftOrder } from '../../src/order/draft.js'
import { compileOrder } from '../../src/order/compile.js'

// The shape the stylesheet frames.
//
// An open order is a frame — a way back at the top, the order in the middle
// scrolling inside it, the controls that end it at the foot — and the Forge's
// steps are one box inside that frame: the step list, the step scrolling
// itself, and the way forward pinned under it. These tests assert that order
// through roles and landmarks; the stylesheet's measurements are not checked here.

const ORDER = draftOrder({
  id: 'WO-1',
  title: 'Refuse an expired refresh token',
  source: { kind: 'typed', tracker: null, key: null, url: null },
  repoPaths: ['/repos/app'],
  now: '2026-09-06T10:00:00.000Z',
})

function bridge(handlers: Record<string, unknown>): void {
  Object.assign(window, {
    electronAPI: {
      usage: { record: vi.fn() },
      extensionBridge: {
        invoke: vi.fn(async (channel: string) => handlers[channel] ?? {}),
        on: vi.fn(() => vi.fn()),
      },
    },
  })
}

beforeEach(() => vi.clearAllMocks())

describe('the Forge is one box of steps', () => {
  it('puts the step list first and the way forward at its foot', async () => {
    bridge({
      'foundry:order.compile': { order: ORDER, compile: compileOrder(ORDER) },
      'foundry:run.recipes': { recipes: [], proposed: null },
    })
    render(<Forge orderId="WO-1" />)
    const steps = await screen.findByRole('navigation', { name: 'Steps' })
    const foot = await screen.findByRole('contentinfo')
    expect(steps.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(foot).getAllByRole('button').length).toBeGreaterThan(0)
  })
})

const SHAPING = {
  kind: 'shaping',
  turn: 'foundry',
  label: 'being shaped',
  detail: 'Foundry is still shaping this.',
  done: 0,
  total: 0,
  gateId: null,
}

describe('an open order is a frame', () => {
  it('puts the way back first and the controls that end the order last', async () => {
    const user = userEvent.setup()
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
            standing: SHAPING,
          },
        ],
      },
      'foundry:order.compile': { order: ORDER, compile: compileOrder(ORDER) },
      'foundry:run.recipes': { recipes: [], proposed: null },
    })
    render(<Orders repoRoot="/repos/app" />)
    await user.click(await screen.findByRole('button', { name: new RegExp(ORDER.title) }))
    const back = await screen.findByRole('button', { name: 'All orders' })
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toBe(back)
    expect(buttons.at(-2)).toBe(screen.getByRole('button', { name: 'Discard this order' }))
  })
})
