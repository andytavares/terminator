import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { Inbox, SIGNAL_POLL_MS } from '../../src/components/Inbox.js'
import { raiseGate, GATE_RULES } from '../../src/gates/rules.js'
import type { Signal } from '../../src/sensors/types.js'

// The one surface the operator is required to visit. Every row names the rule
// that raised it, says what it looked at, and says what happens if it is
// ignored — because an interruption they cannot attribute is one they learn to
// click through without reading.

let invoke: ReturnType<typeof vi.fn>

function gate(over: Partial<Parameters<typeof raiseGate>[0]> = {}) {
  return raiseGate({
    id: 'G-1',
    rule: 'risk.p0',
    orderId: 'WO-1',
    summary: 'U-4 rewrites session token refresh',
    why: 'the diff touches src/main/auth/session.ts',
    blockedUnits: 3,
    riskGrade: 'P0',
    at: '2026-09-06T10:00:00.000Z',
    ...over,
  })
}

function signal(over: Partial<Signal> = {}): Signal {
  return {
    id: 'SIG-1',
    sensorId: 'ci-flake',
    key: 'flake:test-foo',
    title: 'test-foo flakes on main',
    evidence: [
      {
        kind: 'ci-run',
        title: 'Run #42 failed',
        url: 'https://ci.example/42',
        at: '2026-09-20T10:00:00.000Z',
      },
    ],
    occurrences: 4,
    severity: 'high',
    firstSeen: '2026-09-18T00:00:00.000Z',
    lastSeen: '2026-09-20T10:00:00.000Z',
    status: 'open',
    dismissedAt: null,
    orderId: null,
    ...over,
  }
}

function mount(over: Record<string, unknown> = {}) {
  // Mutable so a dismiss during the test is reflected the next time the
  // component re-polls the list, the way the real channel would behave.
  let liveSignals = [...((over.signals as Signal[] | undefined) ?? [])]
  invoke = vi.fn(async (channel: string, payload?: unknown) => {
    if (channel === 'foundry:inbox.list') {
      return {
        gates: over.gates ?? [],
        autonomy: over.autonomy ?? 'standard',
        silenced: over.silenced ?? [],
        summary: {
          waiting: 0,
          orders: 0,
          automatic: 0,
          building: 0,
          converging: 0,
          ...(over.summary as object satisfies object | undefined),
        },
      }
    }
    if (channel === 'foundry:feed-digest') {
      return over.digest ?? { entryCount: 0, sessionCount: 0, bySession: [] }
    }
    if (channel === 'foundry:inbox.decide') return over.decide ?? { ok: true }
    if (channel === 'foundry:signals.list') {
      return { signals: liveSignals, counts: { open: liveSignals.length } }
    }
    if (channel === 'foundry:sensors.list') {
      return { sensors: over.sensors ?? [] }
    }
    if (channel === 'foundry:signals.dismiss') {
      const { id } = payload as { id: string }
      liveSignals = liveSignals.filter((s) => s.id !== id)
      return over.dismiss ?? { signal: null }
    }
    if (channel === 'foundry:signals.promote') return over.promote ?? { order: { id: 'WO-9' } }
    return { ok: true }
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
  }
  render(<Inbox />)
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe('a row the operator can act on', () => {
  it('names the rule, the reason and what happens if it is ignored', async () => {
    mount({ gates: [gate()] })
    await waitFor(() => expect(screen.getByText('risk.p0')).toBeTruthy())
    expect(screen.getByText(/session\.ts/)).toBeTruthy()
    expect(screen.getByText(/if ignored: hold/)).toBeTruthy()
  })

  it('says how much work the decision unblocks', async () => {
    mount({ gates: [gate()] })
    await waitFor(() => screen.getByText('risk.p0'))
    expect(screen.getByText('3 units waiting')).toBeTruthy()
  })

  it('offers each option with its consequence on the control itself', async () => {
    mount({ gates: [gate()] })
    await waitFor(() => screen.getByText('risk.p0'))
    const approve = screen.getByRole('button', { name: 'Approve' })
    expect(approve.getAttribute('title')).toContain('proceeds')
  })

  it('sends the decision, and asks again afterwards', async () => {
    mount({ gates: [gate()] })
    await waitFor(() => screen.getByText('risk.p0'))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:inbox.decide', {
        gateId: 'G-1',
        option: 'approve',
      })
    )
    expect(invoke.mock.calls.filter((c) => c[0] === 'foundry:inbox.list').length).toBeGreaterThan(1)
  })

  it('says a gate with no deadline waits, rather than implying a timer', async () => {
    mount({ gates: [gate()] })
    await waitFor(() => screen.getByText('risk.p0'))
    expect(screen.getByText(/\(waits\)/)).toBeTruthy()
  })
})

describe('raising a budget from the inbox', () => {
  const budgetGate = () =>
    gate({
      rule: 'budget.exceeded',
      summary: 'x has gone past its wall clock budget',
      why: 'The order budgets 45 and this run is at 46.',
      breach: { kind: 'wall_clock', limit: 45, actual: 45.6 },
    })

  it('asks for the new limit, then sends it with the decision', async () => {
    mount({ gates: [budgetGate()] })
    await waitFor(() => screen.getByText('budget.exceeded'))
    fireEvent.click(screen.getByRole('button', { name: 'Raise the budget' }))
    expect(invoke).not.toHaveBeenCalledWith('foundry:inbox.decide', expect.anything())
    expect(screen.getByText('At least 46.')).toBeTruthy()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Minutes' }), {
      target: { value: '90' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Raise and resume' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:inbox.decide', {
        gateId: 'G-1',
        option: 'raise',
        limit: 90,
      })
    )
  })

  it('decides straight away for a gate that never recorded its budget', async () => {
    mount({ gates: [gate({ rule: 'budget.exceeded' })] })
    await waitFor(() => screen.getByText('budget.exceeded'))
    fireEvent.click(screen.getByRole('button', { name: 'Raise the budget' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:inbox.decide', {
        gateId: 'G-1',
        option: 'raise',
      })
    )
  })
})

describe('nothing needs you', () => {
  it('says so', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('Nothing needs you.')).toBeTruthy())
  })

  it('says what happened while you were not looking', async () => {
    mount({
      digest: {
        entryCount: 7,
        sessionCount: 2,
        bySession: [{ sessionId: 's-1', entries: [{ summary: 'ran the tests' }] }],
      },
    })
    await waitFor(() => expect(screen.getByText(/7 things happened across 2 runs/)).toBeTruthy())
    expect(screen.getByText(/ran the tests/)).toBeTruthy()
  })

  it('renders the most recent line as markdown', async () => {
    mount({
      digest: {
        entryCount: 1,
        sessionCount: 1,
        bySession: [{ sessionId: 's-1', entries: [{ summary: 'edited `a.ts`' }] }],
      },
    })
    await waitFor(() => screen.getByText('a.ts'))
    expect(screen.getByText('a.ts').tagName).toBe('CODE')
  })

  it('stays quiet when nothing happened', async () => {
    mount()
    await waitFor(() => screen.getByText('Nothing needs you.'))
    expect(screen.queryByText(/things happened/)).toBeNull()
  })

  it('asks from when it last looked, and remembers that it looked', async () => {
    window.localStorage.setItem('foundry.inbox.lastRead', '1700000000000')
    mount()
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:feed-digest', { from: 1700000000000 })
    )
    await waitFor(() =>
      expect(Number(window.localStorage.getItem('foundry.inbox.lastRead'))).toBeGreaterThan(
        1700000000000
      )
    )
  })

  it('falls back to a day when nothing was remembered', async () => {
    mount()
    await waitFor(() => screen.getByText('Nothing needs you.'))
    const from = (
      invoke.mock.calls.find((c) => c[0] === 'foundry:feed-digest')?.[1] as {
        from: number
      }
    ).from
    expect(Date.now() - from).toBeGreaterThan(23 * 60 * 60 * 1000)
  })

  it('still renders when storage refuses to answer', async () => {
    const original = window.localStorage.getItem
    // A private window, or site data turned off. Neither is a reason to show
    // nothing.
    window.localStorage.getItem = () => {
      throw new Error('denied')
    }
    mount()
    await waitFor(() => expect(screen.getByText('Nothing needs you.')).toBeTruthy())
    window.localStorage.getItem = original
  })

  it('counts what is building and what was decided without anybody', async () => {
    mount({ summary: { building: 2, converging: 1, automatic: 4 } })
    await waitFor(() => screen.getByText('Nothing needs you.'))
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('4')).toBeTruthy()
  })
})

describe('quiet has to be explicable', () => {
  // In words, not ids. This read "not asking about: unit.boundary" — a
  // sentence about this extension's internals, shown to the person using it,
  // on the screen whose whole job is to be reassuring when there is nothing
  // to do. The test asserted the ids, so it held the jargon in place.
  it('says what this setting decides for you, in words', async () => {
    mount({ autonomy: 'lights-out', silenced: ['unit.boundary', 'new-dependency'] })
    await waitFor(() => expect(screen.getByText(/decides these for you/)).toBeTruthy())
    expect(screen.getByText(/each unit of work as it finishes/)).toBeTruthy()
    expect(screen.getByText(/a new third-party dependency/)).toBeTruthy()
    expect(screen.getByText('lights-out')).toBeTruthy()
  })

  it('never shows a rule id to the operator', async () => {
    mount({ autonomy: 'lights-out', silenced: ['unit.boundary', 'new-dependency'] })
    await waitFor(() => screen.getByText('Nothing needs you.'))
    expect(document.body.textContent).not.toContain('unit.boundary')
    expect(document.body.textContent).not.toContain('new-dependency')
  })

  it('says nothing when every rule is live', async () => {
    mount({ autonomy: 'escorted', silenced: [] })
    await waitFor(() => screen.getByText('Nothing needs you.'))
    expect(screen.queryByText(/decides these for you/)).toBeNull()
  })
})

// The decision is the whole point of the surface. A refusal that showed
// nothing looked exactly like a decision that was taken: the reply was thrown
// away and the list simply redrew with the gate still on it.
describe('a decision the handler refused', () => {
  it('says why, rather than redrawing as though nothing happened', async () => {
    mount({ gates: [gate()], decide: { error: 'Gate G-1 was already decided (approve).' } })
    await waitFor(() => screen.getByRole('button', { name: /Approve/ }))
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }))
    await waitFor(() => expect(screen.getByText(/already decided/)).toBeTruthy())
  })

  it('says nothing when the decision was taken', async () => {
    mount({ gates: [gate()] })
    await waitFor(() => screen.getByRole('button', { name: /Approve/ }))
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:inbox.decide', expect.anything())
    )
    expect(screen.queryByText(/already decided/)).toBeNull()
  })
})

// ── Every rule can be drawn ─────────────────────────────────────────────
//
// `RULE_ICON` and `RULE_TONE` are keyed by `GateRuleId`, so a new rule with no
// entry hands React `undefined` as an element type. React does not skip it: it
// throws, unmounts the whole tree, and the extension renders a blank panel.
//
// Adding `run.interrupted` did exactly that. Nothing caught it — the build is
// green, `tsc` is not run over the components by any script, and every unit
// test here passed because none of them rendered that rule. What caught it was
// an e2e that seeded an order and looked at the screen.

describe('every gate rule can be rendered', () => {
  it.each(GATE_RULES)('%s draws a row rather than blanking the surface', async (rule) => {
    mount({
      gates: [gate({ id: `g-${rule}`, rule })],
      autonomy: 'escorted',
      silenced: [],
      summary: { waiting: 1, orders: 1, automatic: 0, building: 0, converging: 0 },
    })
    await waitFor(() => expect(screen.getByText(rule)).toBeTruthy())
    // The stripe as well as the icon: a missing tone is a silent `undefined`
    // in the class list rather than a throw, so it needs its own assertion.
    expect(document.querySelector('.fdry-gate')?.className).toMatch(/\bis-(p0|warn|info|ok)\b/)
  })
})

describe('ci.red', () => {
  it('renders a row with its summary and both options', async () => {
    mount({
      gates: [
        gate({
          id: 'g-ci-red',
          rule: 'ci.red',
          summary: 'PR #200 has been red for two fix rounds',
          why: 'checks: lint, unit',
        }),
      ],
      autonomy: 'lights-out',
      silenced: [],
      summary: { waiting: 1, orders: 1, automatic: 0, building: 0, converging: 0 },
    })
    await waitFor(() => expect(screen.getByText('ci.red')).toBeTruthy())
    expect(screen.getByText(/PR #200 has been red/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Another round' })).toBeTruthy()
    expect(screen.getByText(/if ignored: hold/)).toBeTruthy()
  })
})

// From the factory's sensors: an open signal never starts anything by
// itself. The two moves the operator has over one live here, below the
// gates band, because gates are the surface's whole point and a heuristic's
// hunch is not the same class of interruption as a gate that blocks work.
describe("from the factory's sensors", () => {
  const highSignal = () =>
    signal({ id: 'SIG-1', title: 'test-foo flakes on main', occurrences: 4, severity: 'high' })
  const lowSignal = () =>
    signal({
      id: 'SIG-2',
      sensorId: 'issue-churn',
      title: 'many issues opened against auth',
      occurrences: 2,
      severity: 'low',
      evidence: [
        { kind: 'issue', title: 'Issue #9', url: 'https://tracker/9', at: '2026-09-19T00:00:00Z' },
      ],
    })

  it('lists open signals, each with its count, severity, sensor and evidence link', async () => {
    mount({
      signals: [highSignal()],
      sensors: [
        {
          def: { id: 'ci-flake', description: 'CI flake watch' },
          rung: 'data-root',
          state: { enabled: true, repoPath: '/repos/app', lastRunAt: null, lastProblem: null },
          nextDueAt: null,
        },
      ],
    })
    await waitFor(() => screen.getByText('test-foo flakes on main'))
    expect(screen.getByText('×4')).toBeTruthy()
    expect(screen.getByText('high')).toBeTruthy()
    expect(screen.getByText('CI flake watch')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Run #42 failed' })).toHaveProperty(
      'href',
      'https://ci.example/42'
    )
  })

  it('renders more than one signal, in the order the channel ranked them', async () => {
    mount({ signals: [highSignal(), lowSignal()] })
    await waitFor(() => screen.getByText('test-foo flakes on main'))
    const titles = Array.from(document.querySelectorAll('.fdry-signal')).map(
      (el) => el.querySelector('b')?.textContent
    )
    expect(titles).toEqual(['test-foo flakes on main', 'many issues opened against auth'])
  })

  // Seen live: a sensor recorded a signal while the Inbox was open, and the
  // Inbox went on saying "Nothing needs you." until something remounted it.
  it('shows a signal that arrives while the Inbox is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mount({ signals: [] })
      await waitFor(() => screen.getByText('Nothing needs you.'))
      const before = invoke.getMockImplementation() as (c: string, p?: unknown) => Promise<unknown>
      invoke.mockImplementation(async (channel: string, payload?: unknown) =>
        channel === 'foundry:signals.list'
          ? { signals: [highSignal()], counts: { open: 1 } }
          : before(channel, payload)
      )
      await act(async () => {
        vi.advanceTimersByTime(SIGNAL_POLL_MS)
      })
      await waitFor(() => screen.getByText('test-foo flakes on main'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not show the section when there are no open signals', async () => {
    mount({ signals: [] })
    await waitFor(() => screen.getByText('Nothing needs you.'))
    expect(screen.queryByText("From the factory's sensors")).toBeNull()
  })

  it('promotes with the repository, defaulting to the sensor’s own', async () => {
    mount({
      signals: [highSignal()],
      sensors: [
        {
          def: { id: 'ci-flake', description: 'CI flake watch' },
          rung: 'data-root',
          state: { enabled: true, repoPath: '/repos/app', lastRunAt: null, lastProblem: null },
          nextDueAt: null,
        },
      ],
    })
    await waitFor(() => screen.getByText('test-foo flakes on main'))
    fireEvent.click(screen.getByRole('button', { name: 'Promote' }))
    const repoInput = screen.getByRole('textbox', { name: /repository/i }) as HTMLInputElement
    expect(repoInput.value).toBe('/repos/app')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm promote' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:signals.promote', {
        id: 'SIG-1',
        repoPaths: ['/repos/app'],
      })
    )
    expect(await screen.findByText(/Draft WO-9 created — open it in the Forge/)).toBeTruthy()
  })

  it('lets the repository be changed before promoting', async () => {
    mount({ signals: [highSignal()] })
    await waitFor(() => screen.getByText('test-foo flakes on main'))
    fireEvent.click(screen.getByRole('button', { name: 'Promote' }))
    fireEvent.change(screen.getByRole('textbox', { name: /repository/i }), {
      target: { value: '/repos/other' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm promote' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:signals.promote', {
        id: 'SIG-1',
        repoPaths: ['/repos/other'],
      })
    )
  })

  it('dismisses a signal and removes it from the list', async () => {
    mount({ signals: [highSignal()] })
    await waitFor(() => screen.getByText('test-foo flakes on main'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:signals.dismiss', { id: 'SIG-1' })
    )
    await waitFor(() => expect(screen.queryByText('test-foo flakes on main')).toBeNull())
  })

  it('does not touch the attention badge — it never calls foundry:attention', async () => {
    mount({ signals: [highSignal()] })
    await waitFor(() => screen.getByText('test-foo flakes on main'))
    expect(invoke).not.toHaveBeenCalledWith('foundry:attention', expect.anything())
  })
})
