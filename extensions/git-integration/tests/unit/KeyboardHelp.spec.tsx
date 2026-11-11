import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeyboardHelp } from '../../src/components/pr-review/KeyboardHelp'

vi.mock('@terminator/extension-ui', () => ({
  Dialog: ({
    title,
    onDismiss,
    children,
  }: {
    title: string
    onDismiss: () => void
    children: React.ReactNode
  }) => (
    <div data-testid="dialog">
      <h1>{title}</h1>
      <button onClick={onDismiss}>Dismiss</button>
      {children}
    </div>
  ),
}))

describe('KeyboardHelp', () => {
  it('lists the six review shortcuts and nothing else', () => {
    render(<KeyboardHelp onClose={vi.fn()} />)
    expect(screen.getByText('Keyboard')).toBeTruthy()
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent)
    expect(rows).toEqual([
      'kNext hunk',
      'jPrevious hunk',
      'SpaceMark hunk read, next hunk',
      'cComment on line',
      'lLater: revisit after the last hunk',
      '⌘↵Go to the verdict bar, then submit',
    ])
  })

  it('calls onClose when dismissed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<KeyboardHelp onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
