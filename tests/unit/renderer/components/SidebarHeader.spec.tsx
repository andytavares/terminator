import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SidebarHeader } from '../../../../src/renderer/components/sidebar/SidebarHeader'

const defaultProps = {
  globalTabs: [] as GlobalTabRegistration[],
  sidebarItems: [],
  activeGlobalTabId: null as string | null,
  onSelectGlobalTab: vi.fn(),
  onSearchFocus: vi.fn(),
  onAddWorkspace: vi.fn(),
  // The bell lives in the app band now and only renders with a handler — a
  // bell you cannot click is not worth drawing.
  onBellClick: vi.fn(),
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
      <SidebarHeader {...defaultProps} searchQuery="" onSearchChange={onSearchChange} />
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

describe('SidebarHeader — optional search handlers', () => {
  it('does not crash when typing with no onSearchChange supplied', () => {
    const { container } = render(<SidebarHeader {...defaultProps} />)
    expect(() =>
      fireEvent.change(container.querySelector('input')!, { target: { value: 'x' } })
    ).not.toThrow()
  })

  it('does not crash when clearing with no onSearchClear supplied', () => {
    const { container } = render(<SidebarHeader {...defaultProps} searchQuery="abc" />)
    const clear = container.querySelector('.sidebar-search__clear') as HTMLElement | null
    if (clear) expect(() => fireEvent.click(clear)).not.toThrow()
    else expect(container.querySelector('input')).toBeTruthy()
  })
})
