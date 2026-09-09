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
    standing: standing(),
    ...over,
  }
}

function standing(over: Record<string, unknown> = {}) {
  return {
    kind: 'shaping',
    turn: 'foundry',
    label: 'being shaped',
    detail: 'Foundry is still shaping this.',
    done: 0,
    total: 0,
    gateId: null,
    ...over,
  }
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

describe('the orders list', () => {
  it('says where each order stands, in the standing own words', async () => {
    mount([row({ standing: standing({ label: '2 to answer', turn: 'you' }) })])
    await waitFor(() => expect(screen.getByText('2 to answer')).toBeTruthy())
  })

  it('marks the rows whose move is yours, and only those', async () => {
    const { container } = mount([
      row({ id: 'WO-1', standing: standing({ turn: 'you', label: 'halted' }) }),
      row({ id: 'WO-2', title: 'Second', standing: standing({ turn: 'foundry' }) }),
    ])
    await waitFor(() => expect(screen.getByText('halted')).toBeTruthy())
    expect(container.querySelectorAll('.fdry-order-state.is-waiting')).toHaveLength(1)
  })

  // The defect the standing exists to remove. The badge read
  // `failures === 0 ? 'ready to hand off' : ...`, and `failures` is a
  // draft-time compile result that is zero for every running order for ever —
  // so a run halted at a gate two hours earlier said it was ready to hand off.
  it('does not call a running order ready to hand off just because it compiled', async () => {
    mount([
      row({
        status: 'running',
        failures: 0,
        standing: standing({ kind: 'halted', turn: 'you', label: 'halted' }),
      }),
    ])
    await waitFor(() => expect(screen.getByText('halted')).toBeTruthy())
    expect(screen.queryByText('ready to hand off')).toBeNull()
  })

  // The row is polled, and a host mid-upgrade can answer without one.
  it('survives a row from an older shape that carries no standing', async () => {
    const { standing: _omitted, ...older } = row({ failures: 0 })
    mount([older])
    await waitFor(() => expect(screen.getByText('Refuse an expired refresh token')).toBeTruthy())
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
