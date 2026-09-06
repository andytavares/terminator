import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { Inbox } from '../../src/components/Inbox.js'
import { raiseGate } from '../../src/gates/rules.js'

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

function mount(over: Record<string, unknown> = {}) {
  invoke = vi.fn(async (channel: string) => {
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
  it('says which rules this setting is not asking about', async () => {
    mount({ autonomy: 'lights-out', silenced: ['unit.boundary', 'new-dependency'] })
    await waitFor(() => expect(screen.getByText(/not asking about/)).toBeTruthy())
    expect(screen.getByText(/unit.boundary, new-dependency/)).toBeTruthy()
    expect(screen.getByText('lights-out')).toBeTruthy()
  })

  it('says nothing when every rule is live', async () => {
    mount({ autonomy: 'escorted', silenced: [] })
    await waitFor(() => screen.getByText('Nothing needs you.'))
    expect(screen.queryByText(/not asking about/)).toBeNull()
  })
})
