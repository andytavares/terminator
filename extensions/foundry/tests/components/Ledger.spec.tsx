import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { Ledger } from '../../src/components/Ledger.js'

// The record, read-only apart from one button. Proposals appear when the
// operator presses it and at no other time.

const ENTRIES = [
  {
    at: '2026-09-05T10:00:00.000Z',
    orderId: 'WO-1',
    actor: 'operator',
    action: 'gate.decided',
    subject: 'G-1',
    reason: 'risk.p0 -> send_back: the token comparison is not constant time',
    evidence: [],
  },
  {
    at: '2026-09-04T10:00:00.000Z',
    orderId: 'WO-2',
    actor: 'rule:budget.exceeded',
    action: 'gate.default',
    subject: 'G-2',
    reason: 'no answer by the deadline',
    evidence: [],
  },
]

const PROPOSAL = {
  id: 'curator-hardcodes-the-timeout',
  asserts: '`U-9` hardcodes the timeout',
  rung: 'L3',
  origin: 'curator:2026-09-01T10:00:00.000Z/U-1',
  occurrences: 3,
  citations: [
    {
      ref: '2026-09-01T10:00:00.000Z/U-1',
      at: '2026-09-01T10:00:00.000Z',
      actor: 'operator',
      action: 'review.rejected',
      subject: 'U-1',
      reason: '`U-1` hardcodes the timeout',
    },
  ],
}

let invoke: ReturnType<typeof vi.fn>

function mount(over: Record<string, unknown> = {}) {
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:ledger.query') {
      return {
        entries: ENTRIES,
        total: 2,
        actors: ['operator', 'rule:budget.exceeded'],
        actions: ['gate.decided', 'gate.default'],
        orders: ['WO-1', 'WO-2'],
        ...over,
      }
    }
    if (channel === 'foundry:rules.propose') return { proposals: over.proposals ?? [] }
    if (channel === 'foundry:rules.decide') return over.decide ?? { ok: true, accepted: true }
    return {}
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
  }
  render(<Ledger />)
}

beforeEach(() => vi.clearAllMocks())

describe('reading the record', () => {
  /** The rows, not the filter options, which carry the same words. */
  function rowText(): string[] {
    return screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent ?? '')
  }

  it('shows who decided, what, about what and why', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('G-1')).toBeTruthy())
    const [first] = rowText()
    expect(first).toContain('operator')
    expect(first).toContain('gate.decided')
    expect(first).toContain('G-1')
    expect(first).toContain('not constant time')
  })

  it('distinguishes a decision a rule took from one the operator took', async () => {
    mount()
    await waitFor(() => screen.getByText('G-1'))
    expect(rowText()[1]).toContain('rule:budget.exceeded')
  })

  it('offers only the filter values that occur', async () => {
    mount()
    await waitFor(() => screen.getByText('G-1'))
    expect(screen.getByRole('option', { name: 'rule:budget.exceeded' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'WO-2' })).toBeTruthy()
  })

  it('filters by order', async () => {
    mount()
    await waitFor(() => screen.getByText('G-1'))
    fireEvent.change(screen.getByLabelText('Order'), { target: { value: 'WO-2' } })
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'foundry:ledger.query',
        expect.objectContaining({ orderId: 'WO-2' })
      )
    )
  })

  it('filters by who decided', async () => {
    mount()
    await waitFor(() => screen.getByText('G-1'))
    fireEvent.change(screen.getByLabelText('Decided by'), { target: { value: 'operator' } })
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'foundry:ledger.query',
        expect.objectContaining({ actor: 'operator' })
      )
    )
  })

  it('filters by action', async () => {
    mount()
    await waitFor(() => screen.getByText('G-1'))
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'gate.default' } })
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'foundry:ledger.query',
        expect.objectContaining({ action: 'gate.default' })
      )
    )
  })

  it('says how much of the record it is showing', async () => {
    mount()
    await waitFor(() => screen.getByText('G-1'))
    expect(screen.getByText(/showing/)).toBeTruthy()
  })

  it('says so when nothing has been recorded', async () => {
    mount({ entries: [], total: 0, actors: [], actions: [], orders: [] })
    await waitFor(() => expect(screen.getByText('Nothing recorded yet.')).toBeTruthy())
  })
})

describe('asking what it keeps rejecting (FR-076)', () => {
  it('proposes nothing until asked', async () => {
    mount({ proposals: [PROPOSAL] })
    await waitFor(() => screen.getByText('G-1'))
    expect(screen.queryByText('Proposed rules')).toBeNull()
    expect(invoke.mock.calls.filter((c) => c[0] === 'foundry:rules.propose')).toHaveLength(0)
  })

  it('asks only when the operator presses the button', async () => {
    mount({ proposals: [PROPOSAL] })
    await waitFor(() => screen.getByText('G-1'))
    fireEvent.click(screen.getByRole('button', { name: /keep rejecting/ }))
    await waitFor(() => expect(screen.getByText('Proposed rules')).toBeTruthy())
  })

  it('shows the citations the proposal derives from', async () => {
    mount({ proposals: [PROPOSAL] })
    await waitFor(() => screen.getByText('G-1'))
    fireEvent.click(screen.getByRole('button', { name: /keep rejecting/ }))
    await waitFor(() => screen.getByText('Proposed rules'))
    expect(screen.getByText(/3 rejections/)).toBeTruthy()
    // The proposal's own words, and the entry it derives from.
    expect(screen.getByText(PROPOSAL.asserts)).toBeTruthy()
    expect(screen.getByRole('listitem').textContent).toContain('U-1')
  })

  it('explains the threshold rather than showing an empty box', async () => {
    mount({ proposals: [] })
    await waitFor(() => screen.getByText('G-1'))
    fireEvent.click(screen.getByRole('button', { name: /keep rejecting/ }))
    await waitFor(() => expect(screen.getByText(/three times/)).toBeTruthy())
  })

  it('accepts one, and says what that means', async () => {
    mount({ proposals: [PROPOSAL] })
    await waitFor(() => screen.getByText('G-1'))
    fireEvent.click(screen.getByRole('button', { name: /keep rejecting/ }))
    await waitFor(() => screen.getByText('Proposed rules'))

    fireEvent.click(screen.getByRole('button', { name: /Accept/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:rules.decide', {
        proposalId: PROPOSAL.id,
        accept: true,
      })
    )
    expect(screen.getByText(/in force from the next run/)).toBeTruthy()
  })

  it('turns one down for good', async () => {
    mount({ proposals: [PROPOSAL] })
    await waitFor(() => screen.getByText('G-1'))
    fireEvent.click(screen.getByRole('button', { name: /keep rejecting/ }))
    await waitFor(() => screen.getByText('Proposed rules'))

    fireEvent.click(screen.getByRole('button', { name: /Never propose this/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:rules.decide', {
        proposalId: PROPOSAL.id,
        accept: false,
      })
    )
    expect(screen.getByText(/will not be offered again/)).toBeTruthy()
  })

  it('reports a refusal rather than claiming the rule was accepted', async () => {
    mount({ proposals: [PROPOSAL], decide: { error: 'The ledger no longer supports it.' } })
    await waitFor(() => screen.getByText('G-1'))
    fireEvent.click(screen.getByRole('button', { name: /keep rejecting/ }))
    await waitFor(() => screen.getByText('Proposed rules'))

    fireEvent.click(screen.getByRole('button', { name: /Accept/ }))
    await waitFor(() => expect(screen.getByText(/no longer supports/)).toBeTruthy())
    // Still listed, because it was not decided.
    expect(screen.getByText(PROPOSAL.asserts)).toBeTruthy()
  })
})
