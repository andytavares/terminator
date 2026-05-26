import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'

const mockMergeCommit = vi.fn()
const mockClearSession = vi.fn()
const mockAddToast = vi.fn()

vi.mock('../../src/api/merge-flow', () => ({
  mergeFlowAPI: {
    mergeCommit: (...a: unknown[]) => mockMergeCommit(...a),
    clearSession: (...a: unknown[]) => mockClearSession(...a),
  },
}))

vi.mock('../../../../src/renderer/stores/toast.store', () => ({
  useToastStore: () => ({ addToast: mockAddToast }),
}))

let mockStoreState: Record<string, unknown> = {}
const mockStoreClearSession = vi.fn()
vi.mock('../../src/stores/merge-flow.store', () => ({
  useMergeFlowStore: (selector?: (s: unknown) => unknown) => {
    if (typeof selector === 'function') return selector(mockStoreState)
    return mockStoreState
  },
}))

import { CompletionScreen } from '../../src/components/merge-flow/CompletionScreen'

const baseSession = {
  repoRoot: '/repo',
  isRebase: false,
  totalConflicts: 2,
  totalResolved: 2,
  startedAt: '',
  files: [
    {
      filePath: 'src/foo.ts',
      conflictCount: 1,
      resolvedCount: 1,
      blocks: [],
      conflictDescription: '',
      oursAuthor: { name: 'A', commitHash: 'a', timestamp: '' },
      theirsAuthor: { name: 'B', commitHash: 'b', timestamp: '' },
    },
    {
      filePath: 'src/bar.ts',
      conflictCount: 1,
      resolvedCount: 1,
      blocks: [],
      conflictDescription: '',
      oursAuthor: { name: 'A', commitHash: 'a', timestamp: '' },
      theirsAuthor: { name: 'B', commitHash: 'b', timestamp: '' },
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockClearSession.mockResolvedValue({ success: true })
  mockStoreState = {
    session: baseSession,
    clearSession: mockStoreClearSession,
  }
})

describe('CompletionScreen', () => {
  it('renders completion heading', () => {
    render(<CompletionScreen repoRoot="/repo" onBack={vi.fn()} onExit={vi.fn()} />)
    expect(screen.getByText(/All conflicts resolved/i)).toBeTruthy()
  })

  it('shows resolved conflict count and file count', () => {
    render(<CompletionScreen repoRoot="/repo" onBack={vi.fn()} onExit={vi.fn()} />)
    expect(screen.getByText(/2 conflicts/i)).toBeTruthy()
    expect(screen.getByText(/2 files/i)).toBeTruthy()
  })

  it('has a commit message textarea', () => {
    render(<CompletionScreen repoRoot="/repo" onBack={vi.fn()} onExit={vi.fn()} />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea).toBeTruthy()
    expect(textarea.value).toContain('Merge')
  })

  it('calls mergeCommit on commit button click', async () => {
    mockMergeCommit.mockResolvedValueOnce({ commitHash: 'abc123' })
    const onExit = vi.fn()
    render(<CompletionScreen repoRoot="/repo" onExit={onExit} />)
    fireEvent.click(screen.getByText(/Commit merge/i))
    await waitFor(() => {
      expect(mockMergeCommit).toHaveBeenCalledWith(
        '/repo',
        ['src/foo.ts', 'src/bar.ts'],
        expect.any(String)
      )
    })
  })

  it('calls onExit after successful commit', async () => {
    mockMergeCommit.mockResolvedValueOnce({ commitHash: 'abc123' })
    const onExit = vi.fn()
    render(<CompletionScreen repoRoot="/repo" onExit={onExit} />)
    fireEvent.click(screen.getByText(/Commit merge/i))
    await waitFor(() => {
      expect(onExit).toHaveBeenCalledOnce()
    })
  })

  it('shows error toast and stays on screen if commit fails', async () => {
    mockMergeCommit.mockResolvedValueOnce({ error: 'hook failed' })
    const onExit = vi.fn()
    render(<CompletionScreen repoRoot="/repo" onExit={onExit} />)
    fireEvent.click(screen.getByText(/Commit merge/i))
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })
    expect(onExit).not.toHaveBeenCalled()
  })

  it('returns null when session is null', () => {
    mockStoreState = { session: null, clearSession: mockStoreClearSession }
    const { container } = render(
      <CompletionScreen repoRoot="/repo" onBack={vi.fn()} onExit={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })
})
