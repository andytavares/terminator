import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { PlanReader } from '../../src/components/PlanReader.js'
import { draftOrder } from '../../src/order/draft.js'
import { renderOrder } from '../../src/order/render.js'
import type { WorkOrder } from '../../src/order/schema.js'

const order: WorkOrder = {
  ...draftOrder({
    id: 'WO-1',
    title: 'Refuse an expired refresh token',
    source: {
      kind: 'tracker',
      tracker: 'linear',
      key: 'TAV-42',
      url: 'https://linear.app/tav/issue/TAV-42',
    },
    repoPaths: ['/repos/app'],
    now: '2026-09-06T10:00:00.000Z',
  }),
  acceptance: [
    {
      id: 'AC-1',
      statement: 'an expired token is refused with 401',
      priority: 'P1',
      verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
      unverifiable: null,
    },
  ],
}

const writeText = vi.fn(async (_text: string) => undefined)
beforeEach(() => {
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

describe('the plan reader', () => {
  it('reads the whole plan as formatted Markdown', () => {
    render(<PlanReader order={order} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Plan · WO-1' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Refuse an expired refresh token/ })).toBeTruthy()
    expect(screen.getAllByText(/an expired token is refused with 401/).length).toBeGreaterThan(0)
    expect(screen.getByText('.foundry/orders/WO-1/order.md')).toBeTruthy()
  })

  it('copies the same text order.md holds', async () => {
    render(<PlanReader order={order} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(renderOrder(order)))
  })

  it('shows nothing broken when the clipboard refuses', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    render(<PlanReader order={order} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('closes from the close button and from Escape', () => {
    const onClose = vi.fn()
    render(<PlanReader order={order} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
