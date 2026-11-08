import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

const mockInvoke = vi.fn()
const mockRecord = vi.fn()

beforeEach(() => {
  mockInvoke.mockResolvedValue({ data: { id: 'c-new' } })
  vi.stubGlobal('electronAPI', {
    extensionBridge: { invoke: mockInvoke },
    usage: { record: mockRecord },
  })
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

describe('CommentComposer', commentComposerTests)

function commentComposerTests() {
  describe('editing', commentComposerEditingTests)
  describe('submitting', commentComposerSubmittingTests)
  describe('cancelling', commentComposerCancellingTests)
}

function commentComposerEditingTests() {
  it('submit button is disabled when body is empty', () => {
    render(<CommentComposer anchor={baseAnchor} onClose={vi.fn()} onCreated={vi.fn()} />)
    const btn = screen.getByRole('button', { name: /add comment/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })
}

function commentComposerSubmittingTests() {
  it('submit calls comments.create IPC with anchor data', async () => {
    const onCreated = vi.fn()
    render(<CommentComposer anchor={baseAnchor} onClose={vi.fn()} onCreated={onCreated} />)
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox'), 'My comment')
    await user.click(screen.getByRole('button', { name: /add comment/i }))
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

  it('counts a created comment as one use of the comment feature', async () => {
    render(<CommentComposer anchor={baseAnchor} onClose={vi.fn()} onCreated={vi.fn()} />)
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox'), 'My comment')
    await user.click(screen.getByRole('button', { name: /add comment/i }))
    await waitFor(() => expect(mockRecord).toHaveBeenCalledWith('comment'))
  })
}

function commentComposerCancellingTests() {
  it('cancel button calls onClose without saving', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<CommentComposer anchor={baseAnchor} onClose={onClose} onCreated={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('closes on Escape key press', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<CommentComposer anchor={baseAnchor} onClose={onClose} onCreated={vi.fn()} />)
    await user.click(screen.getByRole('textbox'))
    expect(screen.getByRole('textbox').matches(':focus')).toBe(true)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
}
