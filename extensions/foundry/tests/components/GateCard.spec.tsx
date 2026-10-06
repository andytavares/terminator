import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { GateCard } from '../../src/components/GateCard.js'
import { raiseGate } from '../../src/gates/rules.js'

// One gate, one line. What it asks, who it is about and the answers are all on
// that line; why it fired and what it saw are a click away, because a queue of
// six gates that each print a paragraph is a queue nobody reads.

let openExternal: ReturnType<typeof vi.fn>

function gate(over: Partial<Parameters<typeof raiseGate>[0]> = {}) {
  return raiseGate({
    id: 'G-1',
    rule: 'risk.p0',
    orderId: 'WO-1',
    summary: 'U-4 rewrites session token refresh',
    why: 'The diff touches:\n\n- src/main/auth/session.ts\n- src/main/auth/token.ts',
    blockedUnits: 3,
    riskGrade: 'P0',
    at: '2026-09-06T10:00:00.000Z',
    evidence: [{ kind: 'stdout', excerpt: 'Error: token refresh failed', exitCode: 1 }],
    ...over,
  })
}

beforeEach(() => {
  openExternal = vi.fn(async () => ({ ok: true }))
  ;(window as unknown as Record<string, unknown>).electronAPI = { shell: { openExternal } }
})

describe('a gate collapsed to one line', () => {
  it('shows the question, the grade, the default and the answers, and nothing else', () => {
    render(<GateCard gate={gate()} onDecide={vi.fn()} />)
    expect(screen.getByText('U-4 rewrites session token refresh')).toBeTruthy()
    expect(screen.getByText(/If nobody answers: Hold/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send back' })).toBeTruthy()
    expect(screen.queryByText(/session\.ts/)).toBeNull()
    expect(screen.queryByText(/token refresh failed/)).toBeNull()
  })

  it('says the grade in words, not as a code', () => {
    render(<GateCard gate={gate()} onDecide={vi.fn()} />)
    expect(document.body.textContent).not.toMatch(/\bP0\b/)
  })

  it('links the pull request and the ticket, opened outside the application', () => {
    render(
      <GateCard
        gate={gate()}
        onDecide={vi.fn()}
        pulls={[{ number: 233, url: 'https://github.com/x/y/pull/233' }]}
        source={{ key: 'TAV-15', url: 'https://linear.app/t/issue/TAV-15' }}
      />
    )
    fireEvent.click(screen.getByRole('link', { name: /#233/ }))
    expect(openExternal).toHaveBeenCalledWith('https://github.com/x/y/pull/233')
    fireEvent.click(screen.getByRole('link', { name: /TAV-15/ }))
    expect(openExternal).toHaveBeenCalledWith('https://linear.app/t/issue/TAV-15')
    expect(screen.queryByText(/session\.ts/)).toBeNull()
  })

  it('answers from the line without opening the gate', () => {
    const onDecide = vi.fn()
    render(<GateCard gate={gate()} onDecide={onDecide} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onDecide).toHaveBeenCalledWith('approve')
    expect(screen.queryByText(/session\.ts/)).toBeNull()
  })

  it('disables every answer while one is being sent', () => {
    render(<GateCard gate={gate()} busy onDecide={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })
})

describe('a gate opened', () => {
  function open() {
    fireEvent.click(screen.getByText('U-4 rewrites session token refresh'))
  }

  it('shows why as markdown, so a list is a list', () => {
    const { container } = render(<GateCard gate={gate()} onDecide={vi.fn()} />)
    open()
    const items = Array.from(container.querySelectorAll('.fdry-md li')).map((li) => li.textContent)
    expect(items).toEqual(['src/main/auth/session.ts', 'src/main/auth/token.ts'])
  })

  it('still shows a reason written as plain text', () => {
    render(<GateCard gate={gate({ why: 'the budget ran out' })} onDecide={vi.fn()} />)
    open()
    expect(screen.getByText('the budget ran out')).toBeTruthy()
  })

  it('keeps the evidence closed until it is asked for', () => {
    const { container } = render(<GateCard gate={gate()} onDecide={vi.fn()} />)
    open()
    const details = container.querySelector('details') as HTMLDetailsElement
    expect(details).not.toBeNull()
    expect(details.open).toBe(false)
  })

  it('says what each answer does', () => {
    render(<GateCard gate={gate()} onDecide={vi.fn()} />)
    open()
    expect(screen.getByText('The change proceeds as it stands.')).toBeTruthy()
  })

  it('closes again from the chevron, which says its state', () => {
    render(<GateCard gate={gate()} onDecide={vi.fn()} />)
    const chevron = screen.getByRole('button', { name: 'Show the reason' })
    expect(chevron.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(chevron)
    expect(
      screen.getByRole('button', { name: 'Hide the reason' }).getAttribute('aria-expanded')
    ).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Hide the reason' }))
    expect(screen.queryByText(/session\.ts/)).toBeNull()
  })

  it('does not close when a link inside the line is clicked', () => {
    render(
      <GateCard
        gate={gate()}
        onDecide={vi.fn()}
        pulls={[{ number: 233, url: 'https://github.com/x/y/pull/233' }]}
      />
    )
    open()
    fireEvent.click(screen.getByRole('link', { name: /#233/ }))
    expect(screen.getByText(/session\.ts/)).toBeTruthy()
  })
})

describe('raising a budget from the card', () => {
  const budget = () =>
    gate({
      rule: 'budget.exceeded',
      summary: 'x has gone past its wall clock budget',
      why: 'The order budgets 45 and this run is at 46.',
      breach: { kind: 'wall_clock', limit: 45, actual: 45.6 },
    })

  it('asks for the new limit instead of deciding, then sends it', () => {
    const onDecide = vi.fn()
    render(<GateCard gate={budget()} onDecide={onDecide} />)
    fireEvent.click(screen.getByRole('button', { name: 'Raise the budget' }))
    expect(onDecide).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Minutes' }), {
      target: { value: '90' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Raise and resume' }))
    expect(onDecide).toHaveBeenCalledWith('raise', 90)
  })

  it('goes back to the answers on cancel', () => {
    render(<GateCard gate={budget()} onDecide={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Raise the budget' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('spinbutton', { name: 'Minutes' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Raise the budget' })).toBeTruthy()
  })

  it('names the grade once, in words', () => {
    const { container } = render(<GateCard gate={gate({ riskGrade: 'P2' })} onDecide={vi.fn()} />)
    expect(container.textContent).toContain('ordinary risk')
    expect(container.textContent).not.toContain('risk risk')
  })
})
