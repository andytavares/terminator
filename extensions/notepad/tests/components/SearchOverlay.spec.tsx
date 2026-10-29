import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react'
import { pressOutside } from '../../../../tests/support/modal'

const mockInvoke = vi.fn().mockResolvedValue({ data: [] })
const mockRecord = vi.fn()
const mockOn = vi.fn().mockReturnValue(vi.fn())

Object.defineProperty(window, 'electronAPI', {
  value: {
    extensionBridge: { invoke: mockInvoke, on: mockOn },
    usage: { record: mockRecord },
  },
  writable: true,
  configurable: true,
})

import { SearchOverlay } from '../../src/components/SearchOverlay'
import { useNotesStore } from '../../src/stores/notes.store'
import { eventually } from './helpers/note-surface'

afterEach(() => {
  cleanup()
  mockInvoke.mockClear()
  mockRecord.mockClear()
  vi.clearAllTimers()
})

describe('SearchOverlay', searchOverlayTests)

function searchOverlayTests() {
  describe('closing', searchOverlayClosingTests)
  describe('results', searchOverlayResultsTests)
  describe('opening a result', searchOverlayOpeningResultTests)
  describe('usage', searchOverlayUsageTests)
}

function searchOverlayClosingTests() {
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
    render(<SearchOverlay onClose={onClose} />)
    pressOutside(screen.getByRole('dialog', { name: 'Search notes' }))
    expect(onClose).toHaveBeenCalled()
  })
}

function searchOverlayResultsTests() {
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
    })
    vi.useRealTimers()
    await eventually(() => expect(screen.getByText(/1 result/)).toBeTruthy())
  })
}

function searchOverlayUsageTests() {
  async function typeQuery(value: string) {
    vi.useFakeTimers()
    render(<SearchOverlay onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/search across all notes/i), {
      target: { value },
    })
    await act(async () => {
      vi.runAllTimers()
    })
    vi.useRealTimers()
  }

  it('counts a search for typed text, not the empty list shown on open', async () => {
    await typeQuery('')
    expect(mockRecord).not.toHaveBeenCalled()
    cleanup()
    await typeQuery('retry')
    await eventually(() => expect(mockRecord).toHaveBeenCalledWith('search'))
  })

  it('counts a search that failed as failed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockInvoke.mockRejectedValueOnce(new Error('index down'))
    await typeQuery('retry')
    await eventually(() => expect(mockRecord).toHaveBeenCalledWith('search', { failed: true }))
    error.mockRestore()
  })
}

function searchOverlayOpeningResultTests() {
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
    })
    vi.useRealTimers()
    await eventually(() => expect(screen.getByText(/1 result/)).toBeTruthy())
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(useNotesStore.getState().selectedNoteId).toBe('note-x')
    expect(onClose).toHaveBeenCalled()
  })
}
