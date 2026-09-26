import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { FactorySite } from '../../../src/components/factory/FactorySite.js'
import type { FactoryOrderRow } from '../../../src/components/factory/FactorySite.js'

// The Factory's front door: one card per order, opened by whoever is waiting
// on it.

const METRICS = {
  window: '30d',
  orders: [],
  shipped: 3,
  medianLeadTimeMs: 80 * 60_000,
  medianYourTimeMs: 45_000,
  firstPassYield: 0.5,
  reworksPerOrder: 1.5,
  ciRoundsPerOrder: 2,
  sessionsPerOrder: 3,
  forgeFollowUps: 4,
  forgeDecisionsStruckShare: 0.25,
}

function mount(orders: FactoryOrderRow[], metrics: Record<string, unknown> = METRICS) {
  const onOpen = vi.fn()
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:order.list') return { orders }
    if (channel === 'foundry:factory.metrics') return metrics
    return {}
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
  }
  render(<FactorySite repoRoot="/repo" onOpen={onOpen} />)
  return { onOpen, invoke }
}

beforeEach(() => vi.clearAllMocks())

describe('FactorySite', () => {
  it('says there is nothing yet', async () => {
    mount([])
    await waitFor(() => expect(screen.getByText(/no orders yet/i)).toBeTruthy())
  })

  it('lists a card per order, in a stable order', async () => {
    mount([
      { id: 'WO-2', title: 'Second', status: 'running' },
      { id: 'WO-1', title: 'First', status: 'running' },
    ])
    await waitFor(() => screen.getByText('First'))
    const cards = Array.from(document.querySelectorAll('.fdry-hall-card'))
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringContaining('First'),
      expect.stringContaining('Second'),
    ])
  })

  it('beacons a card whose standing says the operator’s move', async () => {
    mount([
      {
        id: 'WO-1',
        title: 'Halted',
        status: 'running',
        standing: {
          kind: 'halted',
          turn: 'you',
          label: 'halted',
          headline: '',
          detail: '',
          done: 0,
          total: 1,
          gateId: 'g-1',
        },
      },
    ])
    await waitFor(() => screen.getByText('Halted'))
    expect(
      screen.getByRole('button', { name: /Halted/ }).querySelector('.fdry-hall-card-beacon')
    ).not.toBeNull()
  })

  it('shows the CI round and status when the order carries one', async () => {
    mount([
      { id: 'WO-1', title: 'Shipping', status: 'running', ci: { status: 'red', round: 2, max: 3 } },
    ])
    await waitFor(() => screen.getByText('Shipping'))
    expect(screen.getByText('CI 2/3 · red')).toBeTruthy()
  })

  it('says nothing about CI for an order that has not shipped one', async () => {
    mount([{ id: 'WO-1', title: 'Fresh', status: 'running', ci: null }])
    await waitFor(() => screen.getByText('Fresh'))
    expect(screen.queryByText(/CI \d/)).toBeNull()
  })

  it('opens the order it is given', async () => {
    const { onOpen } = mount([{ id: 'WO-1', title: 'Only one', status: 'running' }])
    await waitFor(() => screen.getByText('Only one'))
    fireEvent.click(screen.getByRole('button', { name: /Only one/ }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'WO-1', title: 'Only one' }))
  })
})

describe('FactorySite status wall', () => {
  it('shows the 30-day numbers as tiles', async () => {
    mount([])
    await waitFor(() => screen.getByText('Status wall'))
    expect(screen.getByText('Shipped').previousSibling?.textContent).toBe('3')
    expect(screen.getByText('Median lead time').previousSibling?.textContent).toBe('1 h 20 min')
    expect(screen.getByText('First-pass yield').previousSibling?.textContent).toBe('50%')
  })

  it('renders a null number as —, never 0', async () => {
    mount([], { ...METRICS, medianLeadTimeMs: null, firstPassYield: null })
    await waitFor(() => screen.getByText('Status wall'))
    expect(screen.getByText('Median lead time').previousSibling?.textContent).toBe('—')
    expect(screen.getByText('First-pass yield').previousSibling?.textContent).toBe('—')
  })

  it('refetches with the chosen window when the toggle is switched', async () => {
    const { invoke } = mount([])
    await waitFor(() => screen.getByText('Status wall'))
    fireEvent.click(screen.getByRole('button', { name: 'All time' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:factory.metrics', { window: 'all' })
    )
  })
})
