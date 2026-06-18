import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react'

const mockInvoke = vi.fn().mockResolvedValue({ data: [] })
const mockOn = vi.fn().mockReturnValue(vi.fn())

Object.defineProperty(window, 'electronAPI', {
  value: {
    extensionBridge: { invoke: mockInvoke, on: mockOn },
  },
  writable: true,
  configurable: true,
})

import { SearchOverlay } from '../../src/components/SearchOverlay'
import { useNotesStore } from '../../src/stores/notes.store'

afterEach(() => {
  cleanup()
  mockInvoke.mockClear()
  vi.clearAllTimers()
})

describe('SearchOverlay', () => {
  it('renders search input', () => {
    render(<SearchOverlay onClose={vi.fn()} />)
    expect(screen.getByPlaceholderText(/search across all notes/i)).toBeTruthy()
  })

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn()
    render(<SearchOverlay onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when backdrop clicked', () => {
    const onClose = vi.fn()
    const { container } = render(<SearchOverlay onClose={onClose} />)
    const backdrop = container.querySelector('.notepad-overlay-backdrop')!
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalled()
  })

  it('shows result count label when results exist', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: [
        {
          id: 'n1',
          title: 'Auth retry',
          snippet: '…retry budget…',
          tags: ['infra'],
          updatedAt: new Date().toISOString(),
          archivedAt: null,
        },
      ],
    })
    vi.useFakeTimers()
    render(<SearchOverlay onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/search across all notes/i), {
      target: { value: 'retry' },
    })
    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })
    vi.useRealTimers()
    expect(screen.getByText(/1 result/)).toBeTruthy()
  })

  it('selects note and closes on Enter', async () => {
    const result = {
      id: 'note-x',
      title: 'My Note',
      snippet: 'snippet',
      tags: [],
      updatedAt: new Date().toISOString(),
      archivedAt: null,
    }
    mockInvoke.mockResolvedValueOnce({ data: [result] })
    vi.useFakeTimers()
    const onClose = vi.fn()
    render(<SearchOverlay onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText(/search across all notes/i), {
      target: { value: 'my note' },
    })
    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })
    vi.useRealTimers()
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(useNotesStore.getState().selectedNoteId).toBe('note-x')
    expect(onClose).toHaveBeenCalled()
  })
})
