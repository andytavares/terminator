import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SidebarSearch } from '../../../../src/renderer/components/sidebar/SidebarSearch'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SidebarSearch', () => {
  it('renders a text input element', () => {
    render(<SidebarSearch query="" onChange={vi.fn()} onClear={vi.fn()} />)
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('calls onChange as user types', () => {
    const onChange = vi.fn()
    render(<SidebarSearch query="" onChange={onChange} onClear={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'api' } })
    expect(onChange).toHaveBeenCalledWith('api')
  })

  it('calls onClear on Escape keydown', () => {
    const onClear = vi.fn()
    render(<SidebarSearch query="api" onChange={vi.fn()} onClear={onClear} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('renders clear button when query is non-empty', () => {
    render(<SidebarSearch query="api" onChange={vi.fn()} onClear={vi.fn()} />)
    expect(screen.getByRole('button', { name: /clear/i })).toBeTruthy()
  })

  it('does not render clear button when query is empty', () => {
    render(<SidebarSearch query="" onChange={vi.fn()} onClear={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull()
  })

  it('clear button calls onClear', () => {
    const onClear = vi.fn()
    render(<SidebarSearch query="something" onChange={vi.fn()} onClear={onClear} />)
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('input has placeholder text', () => {
    render(<SidebarSearch query="" onChange={vi.fn()} onClear={vi.fn()} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.placeholder).toBeTruthy()
  })

  it('reflects query value in input', () => {
    render(<SidebarSearch query="auth" onChange={vi.fn()} onClear={vi.fn()} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('auth')
  })
})
