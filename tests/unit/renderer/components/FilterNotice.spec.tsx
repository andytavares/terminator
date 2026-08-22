import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FilterNotice } from '../../../../src/renderer/components/sidebar/FilterNotice'

describe('FilterNotice (FR-016, SC-007)', () => {
  it('states the shown and total counts when something is hidden', () => {
    render(<FilterNotice shown={6} total={22} onShowAll={vi.fn()} />)
    expect(screen.getByText('showing 6 of 22')).toBeTruthy()
  })

  it('renders nothing when no session is hidden', () => {
    const { container } = render(<FilterNotice shown={22} total={22} onShowAll={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the list is empty for reasons other than filtering', () => {
    const { container } = render(<FilterNotice shown={0} total={0} onShowAll={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('still explains itself when a filter hides everything', () => {
    render(<FilterNotice shown={0} total={22} onShowAll={vi.fn()} />)
    expect(screen.getByText('showing 0 of 22')).toBeTruthy()
  })

  it('clears every filter in one interaction', () => {
    const onShowAll = vi.fn()
    render(<FilterNotice shown={6} total={22} onShowAll={onShowAll} />)
    fireEvent.click(screen.getByText('show all'))
    expect(onShowAll).toHaveBeenCalledOnce()
  })

  it('offers no way to dismiss it without clearing the filter', () => {
    const { container } = render(<FilterNotice shown={6} total={22} onShowAll={vi.fn()} />)
    expect(container.querySelectorAll('button')).toHaveLength(1)
    expect(container.querySelector('button')!.textContent).toBe('show all')
  })
})
