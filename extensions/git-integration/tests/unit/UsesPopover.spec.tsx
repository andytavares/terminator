import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UsesPopover, type Use } from '../../src/components/pr-review/UsesPopover'

const USES: Use[] = [
  { symbol: 'usePrReview', definedInStep: 2, read: true },
  { symbol: 'buildSplitRows', definedInStep: 4, read: false },
]

describe('UsesPopover', () => {
  it('renders nothing when uses is empty', () => {
    const { container } = render(<UsesPopover uses={[]} onPeekDefinition={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the count and unread total, with the full text in the title', () => {
    render(<UsesPopover uses={USES} onPeekDefinition={vi.fn()} />)
    const btn = screen.getByRole('button', { name: 'Uses 2 symbols from this PR · 1 not yet read' })
    expect(btn.getAttribute('title')).toBe('Uses 2 symbols from this PR · 1 not yet read')
  })

  it('shows only the count when compact', () => {
    render(<UsesPopover uses={USES} compact onPeekDefinition={vi.fn()} />)
    const btn = screen.getByRole('button', { name: 'Uses 2 symbols from this PR' })
    expect(btn.getAttribute('title')).toBe('Uses 2 symbols from this PR · 1 not yet read')
  })

  it('shows only the count when there are no unread uses', () => {
    const allRead = USES.map((u) => ({ ...u, read: true }))
    render(<UsesPopover uses={allRead} onPeekDefinition={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Uses 2 symbols from this PR' })).toBeTruthy()
  })

  it('says "1 symbol" for a single use', () => {
    render(<UsesPopover uses={USES.slice(0, 1)} onPeekDefinition={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Uses 1 symbol from this PR' })).toBeTruthy()
  })
})

describe('UsesPopover — lists each symbol with its step and read state', () => {
  it('lists each symbol with its step and read state', async () => {
    render(<UsesPopover uses={USES} onPeekDefinition={vi.fn()} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Uses 2 symbols from this PR · 1 not yet read' })
    )
    expect(screen.getByText('usePrReview')).toBeTruthy()
    expect(screen.getByText('step 2 · read')).toBeTruthy()
    expect(screen.getByText('buildSplitRows')).toBeTruthy()
    expect(screen.getByText('step 4 · not read')).toBeTruthy()
  })

  it('calls onPeekDefinition and closes when Peek definition is clicked', async () => {
    const onPeekDefinition = vi.fn()
    render(<UsesPopover uses={USES} onPeekDefinition={onPeekDefinition} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Uses 2 symbols from this PR · 1 not yet read' })
    )
    await userEvent.click(screen.getByRole('button', { name: /Peek definition/ }))
    expect(onPeekDefinition).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('usePrReview')).toBeNull()
  })
})
