import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

describe('MobileControlToolbar', () => {
  it('renders exactly 6 buttons', async () => {
    const { MobileControlToolbar } = await import(
      '../../../../src/renderer-remote/components/MobileControlToolbar'
    )
    render(<MobileControlToolbar onKey={vi.fn()} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(6)
  })

  it('calls onKey with \\x03 when Ctrl+C is clicked', async () => {
    const onKey = vi.fn()
    const { MobileControlToolbar } = await import(
      '../../../../src/renderer-remote/components/MobileControlToolbar'
    )
    render(<MobileControlToolbar onKey={onKey} />)
    fireEvent.pointerDown(screen.getByLabelText('Ctrl+C'))
    expect(onKey).toHaveBeenCalledWith('\x03')
  })

  it('calls onKey with \\x04 when Ctrl+D is clicked', async () => {
    const onKey = vi.fn()
    const { MobileControlToolbar } = await import(
      '../../../../src/renderer-remote/components/MobileControlToolbar'
    )
    render(<MobileControlToolbar onKey={onKey} />)
    fireEvent.pointerDown(screen.getByLabelText('Ctrl+D'))
    expect(onKey).toHaveBeenCalledWith('\x04')
  })

  it('calls onKey with \\t when Tab is clicked', async () => {
    const onKey = vi.fn()
    const { MobileControlToolbar } = await import(
      '../../../../src/renderer-remote/components/MobileControlToolbar'
    )
    render(<MobileControlToolbar onKey={onKey} />)
    fireEvent.pointerDown(screen.getByLabelText('Tab'))
    expect(onKey).toHaveBeenCalledWith('\t')
  })

  it('calls onKey with \\x1b when Esc is clicked', async () => {
    const onKey = vi.fn()
    const { MobileControlToolbar } = await import(
      '../../../../src/renderer-remote/components/MobileControlToolbar'
    )
    render(<MobileControlToolbar onKey={onKey} />)
    fireEvent.pointerDown(screen.getByLabelText('Esc'))
    expect(onKey).toHaveBeenCalledWith('\x1b')
  })

  it('calls onKey with \\x1b[A when ↑ is clicked', async () => {
    const onKey = vi.fn()
    const { MobileControlToolbar } = await import(
      '../../../../src/renderer-remote/components/MobileControlToolbar'
    )
    render(<MobileControlToolbar onKey={onKey} />)
    fireEvent.pointerDown(screen.getByLabelText('↑'))
    expect(onKey).toHaveBeenCalledWith('\x1b[A')
  })

  it('calls onKey with \\x1b[B when ↓ is clicked', async () => {
    const onKey = vi.fn()
    const { MobileControlToolbar } = await import(
      '../../../../src/renderer-remote/components/MobileControlToolbar'
    )
    render(<MobileControlToolbar onKey={onKey} />)
    fireEvent.pointerDown(screen.getByLabelText('↓'))
    expect(onKey).toHaveBeenCalledWith('\x1b[B')
  })
})
