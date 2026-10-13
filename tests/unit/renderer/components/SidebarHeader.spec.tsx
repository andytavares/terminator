import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SidebarHeader } from '../../../../src/renderer/components/sidebar/SidebarHeader'

const defaultProps = {
  onSearchFocus: vi.fn(),
  onAddWorkspace: vi.fn(),
  searchQuery: '',
  onSearchChange: vi.fn(),
  onSearchClear: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SidebarHeader', () => {
  it('renders a search input element', () => {
    const { container } = render(<SidebarHeader {...defaultProps} />)
    expect(container.querySelector('.sidebar-search')).toBeTruthy()
    expect(container.querySelector('input')).toBeTruthy()
  })

  it('calls onSearchChange when search input value changes', () => {
    const onSearchChange = vi.fn()
    const { container } = render(
      <SidebarHeader {...defaultProps} onSearchChange={onSearchChange} />
    )
    fireEvent.change(container.querySelector('input')!, { target: { value: 'test' } })
    expect(onSearchChange).toHaveBeenCalledWith('test')
  })

  it('renders + workspace button', () => {
    render(<SidebarHeader {...defaultProps} />)
    expect(screen.getByLabelText(/new repo/i)).toBeTruthy()
  })

  it('calls onAddWorkspace when + button is clicked', () => {
    const onAdd = vi.fn()
    render(<SidebarHeader {...defaultProps} onAddWorkspace={onAdd} />)
    fireEvent.click(screen.getByLabelText(/new repo/i))
    expect(onAdd).toHaveBeenCalledOnce()
  })
})
