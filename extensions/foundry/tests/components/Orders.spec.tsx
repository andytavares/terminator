import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { Orders } from '../../src/components/Orders.js'

// The list is a door, not a board. What it has to carry is which order is
// waiting on an answer: the tab badge says "Forge 2", and this is where that 2
// is spent. Without it the number sends you to a list of identical rows and
// you open them one at a time to find out which two it meant.

function mount(orders: unknown[], props: Record<string, unknown> = {}) {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:order.list') return { orders }
    return {}
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
  }
  return { ...render(<Orders repoRoot="/repos/app" {...props} />), invoke }
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

describe('the New work order quick action', () => {
  it('leaves the idea box alone until asked', async () => {
    mount([], { focusIdeaSignal: 0 })
    await waitFor(() => screen.getByLabelText('Describe what you want built or fixed'))
    expect(document.activeElement).not.toBe(
      screen.getByLabelText('Describe what you want built or fixed')
    )
  })

  it('focuses the idea box when the signal changes, and switches away from ticket search', async () => {
    const { rerender } = mount([], { focusIdeaSignal: 0 })
    await waitFor(() => screen.getByLabelText('Describe what you want built or fixed'))
    // Leave the "typed" tab so the effect is proven to switch back to it.
    screen.getByRole('button', { name: 'Ticket' }).click()
    await waitFor(() => screen.getByLabelText('Search your tickets'))

    rerender(<Orders repoRoot="/repos/app" focusIdeaSignal={1} />)

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText('Describe what you want built or fixed')
      )
    )
  })
})

// Spec 061, FR-4: a typed idea is offered a Linear ticket before it becomes an
// order, so the order — and its one project — are named after the ticket.
describe('offering a ticket for a typed idea', () => {
  function mountWith(offer: unknown, created: unknown = { key: 'TAV-16' }) {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:order.list') return { orders: [] }
      if (channel === 'foundry:ticket.offer') return { offer }
      if (channel === 'foundry:ticket.create') return created
      if (channel === 'foundry:order.create') return {}
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Orders repoRoot="/repos/app" />)
    return invoke
  }

  async function submitIdea(text = 'Only list open tickets') {
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(screen.getByLabelText('Describe what you want built or fixed'), {
      target: { value: text },
    })
    fireEvent.click(screen.getByRole('button', { name: /New order/ }))
    return fireEvent
  }

  const orderCreates = (invoke: ReturnType<typeof vi.fn>) =>
    invoke.mock.calls.filter(([c]) => c === 'foundry:order.create').map(([, p]) => p)

  it('asks nothing and seeds a typed order when no ticket can be made', async () => {
    const invoke = mountWith(null)
    await submitIdea()
    await waitFor(() => expect(orderCreates(invoke)).toHaveLength(1))
    expect(orderCreates(invoke)[0]).toMatchObject({ source: { kind: 'typed' } })
    expect(screen.queryByText(/Create a Linear ticket/)).toBeNull()
  })

  it('creates the ticket and seeds the order from it', async () => {
    const invoke = mountWith({ teams: [{ id: 't1', key: 'TAV', name: 'Team' }] })
    const fire = await submitIdea()
    await waitFor(() => screen.getByText(/Create a Linear ticket for this/))
    expect(orderCreates(invoke)).toHaveLength(0)
    expect(screen.queryByRole('combobox', { name: 'Linear team' })).toBeNull()
    fire.click(screen.getByRole('button', { name: 'Create ticket' }))
    await waitFor(() => expect(orderCreates(invoke)).toHaveLength(1))
    expect(invoke).toHaveBeenCalledWith('foundry:ticket.create', {
      idea: 'Only list open tickets',
      teamId: 't1',
    })
    expect(orderCreates(invoke)[0]).toMatchObject({
      source: { kind: 'tracker', tracker: 'linear', key: 'TAV-16' },
    })
  })

  it('seeds a typed order when the operator declines', async () => {
    const invoke = mountWith({ teams: [{ id: 't1', key: 'TAV', name: 'Team' }] })
    const fire = await submitIdea()
    await waitFor(() => screen.getByText(/Create a Linear ticket for this/))
    fire.click(screen.getByRole('button', { name: 'No ticket' }))
    await waitFor(() => expect(orderCreates(invoke)).toHaveLength(1))
    expect(orderCreates(invoke)[0]).toMatchObject({ source: { kind: 'typed' } })
    expect(invoke).not.toHaveBeenCalledWith('foundry:ticket.create', expect.anything())
  })

  it('lets the operator pick the team only when there is more than one', async () => {
    const invoke = mountWith({
      teams: [
        { id: 't1', key: 'TAV', name: 'Team' },
        { id: 't2', key: 'OPS', name: 'Ops' },
      ],
    })
    const fire = await submitIdea()
    const picker = await waitFor(() => screen.getByRole('combobox', { name: 'Linear team' }))
    fire.change(picker, { target: { value: 't2' } })
    fire.click(screen.getByRole('button', { name: 'Create ticket' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:ticket.create', {
        idea: 'Only list open tickets',
        teamId: 't2',
      })
    )
  })

  it('says why and makes no order when the ticket cannot be created', async () => {
    const invoke = mountWith(
      { teams: [{ id: 't1', key: 'TAV', name: 'Team' }] },
      { error: 'Linear refused' }
    )
    const fire = await submitIdea()
    await waitFor(() => screen.getByText(/Create a Linear ticket for this/))
    fire.click(screen.getByRole('button', { name: 'Create ticket' }))
    await waitFor(() => screen.getByText('Linear refused'))
    expect(orderCreates(invoke)).toHaveLength(0)
  })
})
