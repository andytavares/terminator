import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { act } from '@testing-library/react'

let mockStoreState: Record<string, unknown> = {}

vi.mock('../../src/stores/merge-flow.store', () => ({
  useMergeFlowStore: (selector?: (s: unknown) => unknown) => {
    if (typeof selector === 'function') return selector(mockStoreState)
    return mockStoreState
  },
}))

import { ConflictHub } from '../../src/components/merge-flow/ConflictHub'

function makeFile(overrides = {}) {
  return {
    filePath: 'src/foo.ts',
    conflictCount: 2,
    resolvedCount: 0,
    conflictDescription: 'Alice added logging; Bob refactored',
    oursAuthor: { name: 'Alice', commitHash: 'abc', timestamp: '2026-01-01T00:00:00Z' },
    theirsAuthor: { name: 'Bob', commitHash: 'def', timestamp: '2026-01-01T00:00:00Z' },
    blocks: [],
    ...overrides,
  }
}

function makeSession(files = [makeFile()]) {
  return {
    repoRoot: '/repo',
    files,
    totalConflicts: files.reduce((s, f) => s + f.conflictCount, 0),
    totalResolved: files.reduce((s, f) => s + f.resolvedCount, 0),
    isRebase: false,
    startedAt: '',
  }
}

const mockSetActiveFile = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockStoreState = {
    session: makeSession(),
    setActiveFile: mockSetActiveFile,
  }
})

describe('ConflictHub', () => {
  it('renders the hub heading', () => {
    render(<ConflictHub onSelectFile={vi.fn()} />)
    expect(screen.getByText(/merge conflicts need resolving/i)).toBeTruthy()
  })

  it('shows total conflict count', () => {
    render(<ConflictHub onSelectFile={vi.fn()} />)
    expect(screen.getAllByText(/2/).length).toBeGreaterThan(0)
  })

  it('lists each conflicted file', () => {
    const files = [
      makeFile({ filePath: 'src/alpha.ts' }),
      makeFile({ filePath: 'src/beta.ts', conflictCount: 1 }),
    ]
    mockStoreState = { session: makeSession(files), setActiveFile: mockSetActiveFile }
    const { container } = render(<ConflictHub onSelectFile={vi.fn()} />)
    // path is split across dir/name spans — check textContent
    expect(container.textContent).toContain('src/alpha.ts')
    expect(container.textContent).toContain('src/beta.ts')
  })

  it('shows conflict description for each file', () => {
    render(<ConflictHub onSelectFile={vi.fn()} />)
    expect(screen.getByText(/Alice added logging/i)).toBeTruthy()
  })

  it('shows author names', () => {
    render(<ConflictHub onSelectFile={vi.fn()} />)
    expect(screen.getAllByText(/Alice/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Bob/).length).toBeGreaterThan(0)
  })

  it('calls onSelectFile when a file row is clicked', () => {
    const onSelectFile = vi.fn()
    render(<ConflictHub onSelectFile={onSelectFile} />)
    const fileRow = screen.getAllByTestId('conflict-file-row')[0]
    act(() => {
      fireEvent.click(fileRow)
    })
    expect(onSelectFile).toHaveBeenCalledWith(0)
  })

  it('shows rebase indicator when session isRebase is true', () => {
    mockStoreState = {
      session: { ...makeSession(), isRebase: true },
      setActiveFile: mockSetActiveFile,
    }
    render(<ConflictHub onSelectFile={vi.fn()} />)
    expect(screen.getByText(/rebase/i)).toBeTruthy()
  })

  it('renders null when session is null', () => {
    mockStoreState = { session: null, setActiveFile: mockSetActiveFile }
    const { container } = render(<ConflictHub onSelectFile={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows exit button when onExit prop is provided', () => {
    render(<ConflictHub onSelectFile={vi.fn()} onExit={vi.fn()} />)
    expect(screen.getByLabelText(/exit merge flow/i)).toBeTruthy()
  })

  it('calls onExit when exit button is clicked', () => {
    const onExit = vi.fn()
    render(<ConflictHub onSelectFile={vi.fn()} onExit={onExit} />)
    fireEvent.click(screen.getByLabelText(/exit merge flow/i))
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('does not show exit button when onExit is not provided', () => {
    render(<ConflictHub onSelectFile={vi.fn()} />)
    expect(screen.queryByLabelText(/exit merge flow/i)).toBeNull()
  })
})
