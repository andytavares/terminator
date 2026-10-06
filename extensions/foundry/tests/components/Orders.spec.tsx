import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  const openExternal = vi.fn()
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    shell: { openExternal },
  }
  return { ...render(<Orders repoRoot="/repos/app" {...props} />), invoke, openExternal }
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

// A shipped order still has a gate to answer (mark the draft ready), and the
// Floor is where gates are answered. It used to open in the Forge, which only
// describes the agreement.
describe('opening an order that has a run', () => {
  // Neither surface has its order yet, so each shows its own loading line,
  // which is what tells them apart.
  async function opened(status: string) {
    const invoke = vi.fn(async (channel: string) =>
      channel === 'foundry:order.list' ? { orders: [row({ status })] } : new Promise(() => {})
    )
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Orders repoRoot="/repos/app" openOrderId="WO-1" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'All orders' })).toBeTruthy())
  }

  it.each(['running', 'shipped'])('opens a %s order on the Floor', async (status) => {
    await opened(status)
    await waitFor(() => expect(screen.getByText('Loading the run…')).toBeTruthy())
  })

  it('opens a draft in the Forge, not the Floor', async () => {
    await opened('draft')
    expect(screen.getByText('Loading the order…')).toBeTruthy()
    expect(screen.queryByText('Loading the run…')).toBeNull()
  })
})

// What a row has to say without being opened: where the order's pull request and
// ticket are, how CI is going, and the one answer the operator owes.
describe('what a row carries without being opened', () => {
  const pull = { number: 233, url: 'https://github.com/andytavares/terminator/pull/233' }
  const ticket = {
    kind: 'tracker',
    tracker: 'linear',
    key: 'TAV-15',
    url: 'https://linear.app/team/issue/TAV-15',
  }
  const watching = {
    status: 'watching',
    round: 0,
    max: 2,
    reason: '',
    checks: { done: 1, total: 3 },
  }
  const readyGate = {
    id: 'G-1',
    options: [
      { id: 'mark_ready', label: 'Mark ready', consequence: 'The draft becomes a review request.' },
      { id: 'hold', label: 'Hold', consequence: 'Nothing proceeds until you come back to it.' },
    ],
    breach: null,
  }

  it('links the pull request and the ticket, and opens them outside the application', async () => {
    const { openExternal } = mount([row({ status: 'running', pulls: [pull], source: ticket })])
    const pullLink = await screen.findByRole('link', { name: '#233' })
    const ticketLink = screen.getByRole('link', { name: 'TAV-15' })
    fireEvent.click(pullLink)
    fireEvent.click(ticketLink)
    expect(openExternal).toHaveBeenCalledWith(pull.url)
    expect(openExternal).toHaveBeenCalledWith(ticket.url)
    // A link is not the door: it must not open the order behind it.
    expect(screen.queryByRole('heading', { name: 'What is being asked' })).toBeNull()
  })

  it('shows a spinner and the CI wording while CI is watching', async () => {
    const { container } = mount([
      row({
        status: 'running',
        standing: standing({ label: 'building', kind: 'running' }),
        ci: watching,
      }),
    ])
    const pill = await screen.findByRole('status')
    expect(within(pill).getByText(/First run · up to 2 fixes/)).toBeTruthy()
    expect(within(pill).getByText(/1 of 3 checks done/)).toBeTruthy()
    expect(pill.querySelector('.fdry-spin')).not.toBeNull()
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
  })

  it('shows the standing, not a spinner, once CI has passed', async () => {
    mount([
      row({
        status: 'shipped',
        standing: standing({ label: 'shipped', kind: 'done' }),
        ci: { ...watching, status: 'green' },
      }),
    ])
    await screen.findByText('shipped')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('answers a shipped order open ready-for-review gate on the row', async () => {
    const { invoke } = mount([
      row({
        status: 'shipped',
        standing: standing({
          kind: 'halted',
          turn: 'you',
          label: 'Mark the pull request ready',
          gateId: 'G-1',
        }),
        gate: readyGate,
      }),
    ])
    fireEvent.click(await screen.findByRole('button', { name: 'Mark ready' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:inbox.decide', {
        gateId: 'G-1',
        option: 'mark_ready',
      })
    )
    expect(screen.getByRole('button', { name: 'Hold' })).toBeTruthy()
  })

  it('offers no inline answers for a gate that needs a new limit typed in', async () => {
    mount([
      row({
        status: 'running',
        standing: standing({ turn: 'you', label: 'over budget', gateId: 'G-2' }),
        gate: {
          id: 'G-2',
          options: [
            { id: 'raise', label: 'Raise it', consequence: 'More.' },
            { id: 'stop', label: 'Stop', consequence: 'Ends.' },
          ],
          breach: { kind: 'turns', used: 10, limit: 10 },
        },
      }),
    ])
    await screen.findByText('over budget')
    expect(screen.queryByRole('button', { name: 'Raise it' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
  })
})

// Tickets and orders are two different lists stacked on one screen; without a
// name each they read as one list in two styles.
describe('the ticket picker beside the orders', () => {
  function mountWithTickets(orders: unknown[]) {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:order.list') return { orders }
      if (channel === 'foundry:issues.mine')
        return {
          connected: [{ tracker: 'linear', account: 'me' }],
          issues: [
            { tracker: 'linear', key: 'TAV-14', title: 'Make all text red', status: 'Todo' },
            { tracker: 'linear', key: 'TAV-16', title: 'Group the Ledger', status: 'Backlog' },
          ],
        }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
      shell: { openExternal: vi.fn() },
    }
    return render(<Orders repoRoot="/repos/app" />)
  }

  it('names each list and counts it', async () => {
    mountWithTickets([row()])
    screen.getByRole('button', { name: 'Ticket' }).click()
    const tickets = await screen.findByRole('heading', { name: /Tickets/ })
    expect(tickets.textContent).toBe('Tickets2')
    expect(screen.getByRole('heading', { name: /Orders/ }).textContent).toBe('Orders1')
  })

  it('says where an order stands once, not in the meta line as well', async () => {
    mountWithTickets([
      row({
        id: 'WO-1006-6b5',
        status: 'shipped',
        risk: 'P3',
        standing: standing({ label: 'shipped', kind: 'done' }),
      }),
    ])
    await screen.findByText('WO-1006-6b5 · low risk')
    expect(screen.getAllByText('shipped')).toHaveLength(1)
  })
})
