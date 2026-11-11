import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewFooter } from '../../src/components/pr-review/ReviewFooter'

describe('ReviewFooter', () => {
  it('says where the reader is', () => {
    render(<ReviewFooter position="Chapter 2 of 5 · 40% read" onOpenShortcuts={vi.fn()} />)
    expect(screen.getByText('Chapter 2 of 5 · 40% read')).toBeTruthy()
  })

  it('opens the keyboard sheet', async () => {
    const onOpenShortcuts = vi.fn()
    render(<ReviewFooter position="40% read" onOpenShortcuts={onOpenShortcuts} />)
    await userEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }))
    expect(onOpenShortcuts).toHaveBeenCalledTimes(1)
  })

  it('offers no file navigation', () => {
    render(<ReviewFooter position="40% read" onOpenShortcuts={vi.fn()} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
})
