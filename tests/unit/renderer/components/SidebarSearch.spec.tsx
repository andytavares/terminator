import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SidebarSearch } from '../../../../src/renderer/components/sidebar/SidebarSearch'

beforeEach(() => {
  vi.clearAllMocks()
})

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

describe('SidebarSearch', () => {
  it('calls onChange as user types', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SidebarSearch query="" onChange={onChange} onClear={vi.fn()} />)
    await user.type(screen.getByRole('textbox'), 'a')
    expect(onChange).toHaveBeenCalledWith('a')
    expect(recordUse).toHaveBeenCalledWith('core.sidebar.search')
  })

  it('calls onClear on Escape keydown', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<SidebarSearch query="api" onChange={vi.fn()} onClear={onClear} />)
    await user.click(screen.getByRole('textbox'))
    await user.keyboard('{Escape}')
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('does not render clear button when query is empty', () => {
    render(<SidebarSearch query="" onChange={vi.fn()} onClear={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull()
  })
})

describe('SidebarSearch — clear button calls onClear', () => {
  it('clear button calls onClear', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<SidebarSearch query="something" onChange={vi.fn()} onClear={onClear} />)
    await user.click(screen.getByRole('button', { name: /clear/i }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('reflects query value in input', () => {
    render(<SidebarSearch query="auth" onChange={vi.fn()} onClear={vi.fn()} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('auth')
  })
})
