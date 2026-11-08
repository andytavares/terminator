import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SidebarHeader } from '../../../../src/components/sidebar/SidebarHeader'

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
  it('calls onSearchChange when search input value changes', async () => {
    const user = userEvent.setup()
    const onSearchChange = vi.fn()
    render(<SidebarHeader {...defaultProps} onSearchChange={onSearchChange} />)
    await user.type(screen.getByRole('textbox'), 't')
    expect(onSearchChange).toHaveBeenCalledWith('t')
  })

  it('calls onAddWorkspace when + button is clicked', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(<SidebarHeader {...defaultProps} onAddWorkspace={onAdd} />)
    await user.click(screen.getByLabelText(/new repo/i))
    expect(onAdd).toHaveBeenCalledOnce()
  })
})
