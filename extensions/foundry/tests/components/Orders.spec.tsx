import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { Orders } from '../../src/components/Orders.js'

// The list is a door, not a board. What it has to carry is which order is
// waiting on an answer: the tab badge says "Forge 2", and this is where that 2
// is spent. Without it the number sends you to a list of identical rows and
// you open them one at a time to find out which two it meant.

function mount(orders: unknown[]) {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:order.list') return { orders }
    return {}
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
  }
  return { ...render(<Orders repoRoot="/repos/app" />), invoke }
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'WO-1',
    title: 'Refuse an expired refresh token',
    status: 'draft',
    risk: 'P2',
    failures: 1,
    source: { kind: 'typed', tracker: null, key: null },
    openQuestions: 0,
    ...over,
  }
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

describe('the orders list', () => {
  it('says which order is waiting on an answer, and how many', async () => {
    const { container } = mount([row({ openQuestions: 2 })])
    await waitFor(() => expect(screen.getByText('2 waiting on you')).toBeTruthy())
    expect(container.querySelector('.fdry-order-state.is-waiting')).not.toBeNull()
  })

  it('says what is blocking one that is not asking anything', async () => {
    const { container } = mount([row({ failures: 3 })])
    await waitFor(() => expect(screen.getByText('blocked by 3')).toBeTruthy())
    expect(container.querySelector('.fdry-order-state.is-waiting')).toBeNull()
  })

  it('still says an order is ready when it compiles clean', async () => {
    mount([row({ failures: 0 })])
    await waitFor(() => expect(screen.getByText('ready to hand off')).toBeTruthy())
  })

  it('prefers the question over the compile failure it is causing', async () => {
    // An unanswered question fails the "no open questions" check, so a waiting
    // order always has a failure too. Reporting the failure sends the operator
    // to look for something to fix; reporting the question is the fix.
    mount([row({ openQuestions: 1, failures: 1 })])
    await waitFor(() => expect(screen.getByText('1 waiting on you')).toBeTruthy())
    expect(screen.queryByText('blocked by 1')).toBeNull()
  })

  it('survives a row from an older shape that does not carry the count', async () => {
    const { openQuestions: _omitted, ...older } = row({ failures: 0 })
    mount([older])
    await waitFor(() => expect(screen.getByText('ready to hand off')).toBeTruthy())
  })

  it('refetches while it is on screen, so an answer given elsewhere lands here', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { invoke } = mount([row({ openQuestions: 2 })])
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('foundry:order.list', {}))
    const first = invoke.mock.calls.length
    await vi.advanceTimersByTimeAsync(4100)
    expect(invoke.mock.calls.length).toBeGreaterThan(first)
  })
})
