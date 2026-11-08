import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

describe('the plan reader', () => {
  it('reads the whole plan as formatted Markdown', () => {
    render(<PlanReader order={order} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Plan · WO-1' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Refuse an expired refresh token/ })).toBeTruthy()
    expect(screen.getAllByText(/an expired token is refused with 401/).length).toBeGreaterThan(0)
    expect(screen.getByText('.foundry/orders/WO-1/order.md')).toBeTruthy()
  })

  it('copies the same text order.md holds', async () => {
    const user = userEvent.setup()
    render(<PlanReader order={order} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Copy Markdown' }))
    expect(await navigator.clipboard.readText()).toBe(renderOrder(order))
  })

  it('shows nothing broken when the clipboard refuses', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'))
    render(<PlanReader order={order} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Copy Markdown' }))
    expect(screen.getByRole('dialog', { name: 'Plan · WO-1' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Refuse an expired refresh token/ })).toBeTruthy()
  })
})

describe('closing the plan reader', () => {
  it('closes from the close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<PlanReader order={order} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<PlanReader order={order} onClose={onClose} />)
    expect(screen.getByRole('dialog').matches(':focus-within')).toBe(true)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
