import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const mockInvoke = vi.fn().mockResolvedValue({ data: { id: 'c-new' } })

Object.defineProperty(window, 'electronAPI', {
  value: { extensionBridge: { invoke: mockInvoke } },
  writable: true,
  configurable: true,
})

// CommentComposer does not exist yet — these tests will fail at import
import { CommentComposer } from '../../src/components/CommentComposer'

const baseAnchor = {
  noteId: 'n1',
  from: 6,
  to: 11,
  quote: 'world',
  prefix: 'Hello ',
  suffix: ' this',
}

describe('CommentComposer', () => {
  beforeEach(() => {
    mockInvoke.mockClear()
  })

  it('renders a textarea for the comment body', () => {
    render(<CommentComposer anchor={baseAnchor} onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('submit button is disabled when body is empty', () => {
    render(<CommentComposer anchor={baseAnchor} onClose={vi.fn()} onCreated={vi.fn()} />)
    const btn = screen.getByRole('button', { name: /add comment/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('submit calls comments.create IPC with anchor data', async () => {
    const onCreated = vi.fn()
    render(<CommentComposer anchor={baseAnchor} onClose={vi.fn()} onCreated={onCreated} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My comment' } })
    fireEvent.click(screen.getByRole('button', { name: /add comment/i }))
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'terminator.notepad:comments.create',
        expect.objectContaining({
          noteId: 'n1',
          body: 'My comment',
          startOffset: 6,
          endOffset: 11,
          quote: 'world',
        })
      )
    })
    expect(onCreated).toHaveBeenCalled()
  })

  it('cancel button calls onClose without saving', () => {
    const onClose = vi.fn()
    render(<CommentComposer anchor={baseAnchor} onClose={onClose} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('closes on Escape key press', () => {
    const onClose = vi.fn()
    render(<CommentComposer anchor={baseAnchor} onClose={onClose} onCreated={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
