import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
  it('renders the Keyboard title and every binding row', () => {
    render(<KeyboardHelp onClose={vi.fn()} />)
    expect(screen.getByText('Keyboard')).toBeTruthy()
    expect(screen.getByText('Next / previous hunk')).toBeTruthy()
    expect(screen.getByText('Next / previous file')).toBeTruthy()
    expect(screen.getByText('Next / previous chapter')).toBeTruthy()
    expect(screen.getByText('Submit review')).toBeTruthy()
    expect(screen.getByText('Peek definition')).toBeTruthy()
  })

  it('calls onClose when dismissed', () => {
    const onClose = vi.fn()
    render(<KeyboardHelp onClose={onClose} />)
    fireEvent.click(screen.getByText('Dismiss'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
