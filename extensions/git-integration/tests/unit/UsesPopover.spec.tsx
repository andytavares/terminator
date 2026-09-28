import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UsesPopover, type Use } from '../../src/components/pr-review/UsesPopover'

vi.mock('@terminator/extension-ui', () => ({
  Popover: ({
    label,
    children,
  }: {
    label: string
    onDismiss: () => void
    children: React.ReactNode
    className?: string
  }) => (
    <div data-testid="popover" aria-label={label} role="group">
      {children}
    </div>
  ),
}))

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
    const btn = screen.getByRole('button', { name: 'Uses 2 · 1 unread' })
    expect(btn.getAttribute('title')).toBe('Uses 2 · 1 unread')
  })

  it('shows only the count when compact', () => {
    render(<UsesPopover uses={USES} compact onPeekDefinition={vi.fn()} />)
    const btn = screen.getByRole('button', { name: 'Uses 2' })
    expect(btn.getAttribute('title')).toBe('Uses 2 · 1 unread')
  })

  it('shows only the count when there are no unread uses', () => {
    const allRead = USES.map((u) => ({ ...u, read: true }))
    render(<UsesPopover uses={allRead} onPeekDefinition={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Uses 2' })).toBeTruthy()
  })

  it('lists each symbol with its step and read state', async () => {
    render(<UsesPopover uses={USES} onPeekDefinition={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Uses 2 · 1 unread' }))
    expect(screen.getByText('usePrReview')).toBeTruthy()
    expect(screen.getByText('step 2 · read')).toBeTruthy()
    expect(screen.getByText('buildSplitRows')).toBeTruthy()
    expect(screen.getByText('step 4 · not read')).toBeTruthy()
  })

  it('calls onPeekDefinition and closes when Peek definition is clicked', async () => {
    const onPeekDefinition = vi.fn()
    render(<UsesPopover uses={USES} onPeekDefinition={onPeekDefinition} />)
    await userEvent.click(screen.getByRole('button', { name: 'Uses 2 · 1 unread' }))
    await userEvent.click(screen.getByRole('button', { name: /Peek definition/ }))
    expect(onPeekDefinition).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('popover')).toBeNull()
  })
})
