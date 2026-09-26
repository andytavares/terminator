import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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

const FACTORY_METRICS = {
  window: '30d',
  orders: [
    {
      orderId: 'WO-1',
      title: 'Ship the thing',
      shipped: true,
      leadTimeMs: 80 * 60_000,
      yourTimeMs: 45_000,
      reworks: 1,
      ciRounds: 2,
      sessions: 3,
      firstPass: false,
    },
  ],
  shipped: 1,
  medianLeadTimeMs: 80 * 60_000,
  medianYourTimeMs: 45_000,
  firstPassYield: 0.5,
  reworksPerOrder: 1,
  ciRoundsPerOrder: 2,
  sessionsPerOrder: 3,
  forgeFollowUps: 4,
  forgeDecisionsStruckShare: 0.25,
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
    if (channel === 'foundry:rules.inForce') {
      return over.inForce ?? { rules: [], declined: [] }
    }
    if (channel === 'foundry:rules.remove') return over.remove ?? { ok: true, removed: true }
    if (channel === 'foundry:factory.metrics') return over.factoryMetrics ?? FACTORY_METRICS
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

describe('removing an accepted check (FR-081)', () => {
  const IN_FORCE = {
    rules: [
      {
        id: 'curator-hardcodes-the-timeout',
        asserts: 'no unit hardcodes a timeout',
        rung: 'data-root',
        origin: 'curator:2026-09-01T10:00:00.000Z/U-1',
      },
    ],
    declined: [],
  }

  it('shows the checks the operator accepted, with what each asserts', async () => {
    mount({ inForce: IN_FORCE })
    await waitFor(() => expect(screen.getByText('Checks you accepted')).toBeTruthy())
    expect(screen.getByText('no unit hardcodes a timeout')).toBeTruthy()
  })

  it('offers a way to take one back out', async () => {
    mount({ inForce: IN_FORCE })
    await waitFor(() => screen.getByText('Checks you accepted'))
    fireEvent.click(screen.getByRole('button', { name: /Remove this check/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:rules.remove', {
        ruleId: 'curator-hardcodes-the-timeout',
      })
    )
  })

  it('says it is gone and will not come back', async () => {
    mount({ inForce: IN_FORCE })
    await waitFor(() => screen.getByText('Checks you accepted'))
    fireEvent.click(screen.getByRole('button', { name: /Remove this check/ }))
    await waitFor(() => expect(screen.getByText(/no longer in force/)).toBeTruthy())
  })

  it('reports a refusal rather than claiming the check was removed', async () => {
    mount({ inForce: IN_FORCE, remove: { error: 'docs-in-pr is not yours to remove.' } })
    await waitFor(() => screen.getByText('Checks you accepted'))
    fireEvent.click(screen.getByRole('button', { name: /Remove this check/ }))
    await waitFor(() => expect(screen.getByText(/not yours to remove/)).toBeTruthy())
    expect(screen.queryByText(/no longer in force/)).toBeNull()
  })

  it('shows what was turned down, and why, so the removal is readable back', async () => {
    mount({
      inForce: {
        rules: [],
        declined: [{ id: 'curator-hardcodes-the-timeout', reason: 'it fired on everything' }],
      },
    })
    await waitFor(() => expect(screen.getByText('Checks you accepted')).toBeTruthy())
    expect(screen.getByText(/it fired on everything/)).toBeTruthy()
  })

  it('shows the panel not at all when there is nothing in force and nothing declined', async () => {
    mount()
    await waitFor(() => screen.getByText('G-1'))
    expect(screen.queryByText('Checks you accepted')).toBeNull()
  })
})

describe('the Factory view (FR: the factory’s numbers)', () => {
  it('stays on Record until asked', async () => {
    mount()
    await waitFor(() => screen.getByText('G-1'))
    expect(invoke.mock.calls.filter((c) => c[0] === 'foundry:factory.metrics')).toHaveLength(0)
  })

  function tileValue(label: string): string | null {
    const tiles = document.querySelectorAll('.fdry-metrics-tile')
    for (const tile of Array.from(tiles)) {
      if (within(tile as HTMLElement).queryByText(label) !== null) {
        return tile.querySelector('.fdry-metrics-tile__value')?.textContent ?? null
      }
    }
    return null
  }

  it('shows the 30-day tiles and a per-order row when switched to Factory', async () => {
    mount()
    await waitFor(() => screen.getByText('G-1'))
    fireEvent.click(screen.getByRole('button', { name: 'Factory' }))
    await waitFor(() => screen.getByText('Ship the thing'))

    expect(tileValue('Shipped')).toBe('1')
    expect(tileValue('Median lead time')).toBe('1 h 20 min')
    expect(tileValue('First-pass yield')).toBe('50%')

    const row = screen.getByText('Ship the thing').closest('tr')
    expect(row?.textContent).toContain('✓')
    expect(row?.textContent).toContain('1 h 20 min')
  })

  it('renders a null number as —, never 0', async () => {
    mount({
      factoryMetrics: {
        ...FACTORY_METRICS,
        medianLeadTimeMs: null,
        firstPassYield: null,
        orders: [{ ...FACTORY_METRICS.orders[0], leadTimeMs: null }],
      },
    })
    await waitFor(() => screen.getByText('G-1'))
    fireEvent.click(screen.getByRole('button', { name: 'Factory' }))
    await waitFor(() => screen.getByText('Ship the thing'))

    expect(tileValue('Median lead time')).toBe('—')
    expect(tileValue('First-pass yield')).toBe('—')
    const row = screen.getByText('Ship the thing').closest('tr')
    expect(row?.textContent).toContain('—')
  })

  it('refetches with the chosen window', async () => {
    mount()
    await waitFor(() => screen.getByText('G-1'))
    fireEvent.click(screen.getByRole('button', { name: 'Factory' }))
    await waitFor(() => screen.getByText('Ship the thing'))
    fireEvent.click(screen.getByRole('button', { name: 'All time' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:factory.metrics', { window: 'all' })
    )
  })
})

describe('the reasons in the record', () => {
  it('renders a reason as markdown — an architect note is written that way', async () => {
    mount({
      entries: [
        {
          ...ENTRIES[0],
          actor: 'role:architect',
          action: 'order.redrafted',
          reason: 'split **U-2** out of `U-1`',
        },
      ],
      total: 1,
    })
    await waitFor(() => screen.getByText('U-2'))
    expect(screen.getByText('U-2').tagName).toBe('STRONG')
  })
})
