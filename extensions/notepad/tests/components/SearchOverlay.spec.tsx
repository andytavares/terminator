import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { pressOutside } from '../../../../packages/test-support/src/modal'

const mockInvoke = vi.fn()
const mockRecord = vi.fn()
const mockOn = vi.fn()

beforeEach(() => {
  mockInvoke.mockResolvedValue({ data: [] })
  mockOn.mockReturnValue(vi.fn())
  vi.stubGlobal('electronAPI', {
    extensionBridge: { invoke: mockInvoke, on: mockOn },
    usage: { record: mockRecord },
  })
})

import { SearchOverlay } from '../../src/components/SearchOverlay'
import { useNotesStore } from '../../src/stores/notes.store'

const SEARCH_DEBOUNCE_MS = 200

function searchResult(id: string, title: string) {
  return {
    id,
    title,
    snippet: 'snippet',
    tags: [],
    updatedAt: '2026-01-01T00:00:00Z',
    archivedAt: null,
  }
}

beforeEach(() => {
  // shouldAdvanceTime: Testing Library's async wrapper waits on a real setTimeout(0).
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  mockInvoke.mockReset().mockResolvedValue({ data: [] })
  mockRecord.mockClear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** Opens the overlay, types `query` and lets the debounced search run and answer. */
async function search(query: string, onClose = vi.fn()) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<SearchOverlay onClose={onClose} />)
  await user.type(screen.getByPlaceholderText(/search across all notes/i), query)
  await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS))
  return user
}

describe('SearchOverlay', searchOverlayTests)

function searchOverlayTests() {
  describe('closing', searchOverlayClosingTests)
  describe('results', searchOverlayResultsTests)
  describe('opening a result', searchOverlayOpeningResultTests)
  describe('usage', searchOverlayUsageTests)
}

function searchOverlayClosingTests() {
  it('calls onClose on Escape key', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onClose = vi.fn()
    render(<SearchOverlay onClose={onClose} />)
    expect(screen.getByPlaceholderText(/search across all notes/i).matches(':focus')).toBe(true)
    await user.keyboard('{Escape}')
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
    mockInvoke.mockResolvedValue({ data: [searchResult('n1', 'Auth retry')] })
    await search('retry')
    expect(screen.getByText('1 result · ranked').textContent).toBe('1 result · ranked')
  })
}

function searchOverlayUsageTests() {
  it('does not count the list shown on open as a search', async () => {
    mockInvoke.mockResolvedValue({ data: [searchResult('n1', 'Recent')] })
    render(<SearchOverlay onClose={vi.fn()} />)
    await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS))
    // The count shows once the opening search has answered, so a record would have happened.
    expect(screen.getByText('1 result').textContent).toBe('1 result')
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('counts a search for typed text', async () => {
    await search('retry')
    expect(mockRecord).toHaveBeenCalledWith('search')
  })

  it('counts a search that failed as failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockInvoke.mockRejectedValue(new Error('index down'))
    await search('retry')
    expect(mockRecord).toHaveBeenCalledWith('search', { failed: true })
  })
}

function searchOverlayOpeningResultTests() {
  it('selects note and closes on Enter', async () => {
    mockInvoke.mockResolvedValue({ data: [searchResult('note-x', 'My Note')] })
    const onClose = vi.fn()
    const user = await search('my note', onClose)
    expect(screen.getByText('1 result · ranked').textContent).toBe('1 result · ranked')
    await user.keyboard('{Enter}')
    expect(useNotesStore.getState().selectedNoteId).toBe('note-x')
    expect(onClose).toHaveBeenCalled()
  })
}
