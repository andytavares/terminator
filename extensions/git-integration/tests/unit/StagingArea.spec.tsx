import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'

vi.mock('../../src/stores/git.store', () => ({
  useGitStore: vi.fn(),
}))

import { useGitStore } from '../../src/stores/git.store'
import { StagingArea } from '../../src/components/StagingArea'
import type { GitFileStatus, GitStatus } from '../../src/schemas/git.schema'
import { partialFake } from '../../../../tests/support/fakes'

type GitState = ReturnType<typeof useGitStore.getState>
type Status = GitFileStatus['status']

const mockUseGitStore = vi.mocked(useGitStore)
// The component reads the store through selectors; resolve them against a plain state object.
function mockStore(state: Partial<GitState>) {
  mockUseGitStore.mockImplementation((sel?: (s: GitState) => unknown) =>
    sel ? sel(partialFake<GitState>(state)) : state
  )
}
const mockStage = vi.fn()
const mockUnstage = vi.fn()
const mockStatus = vi.fn()
const mockSetStatus = vi.fn()
const mockInvoke = vi.fn()

const makeFile = (status: Status, staged: boolean, path?: string): GitFileStatus => ({
  path: path ?? `test.${status}.ts`,
  status,
  staged,
  isBinary: false,
})

// The badge used to carry git's porcelain letters — M, A, D, R, U, and a bare
// "?" for an untracked file — with the raw status word as its tooltip. Both say
// it in the reader's language now.
const STATUSES = ['modified', 'added', 'deleted', 'renamed', 'untracked', 'conflicted'] as const

const STATUS_TOOLTIP: Record<string, string> = {
  modified: 'Changed since the last commit',
  added: 'Staged as a new file',
  deleted: 'Deleted',
  renamed: 'Renamed',
  untracked: 'New — not tracked by git yet',
  conflicted: 'Conflicted — needs resolving before it can be committed',
}

const STATUS_BADGE_TEXT: Record<string, string> = {
  modified: 'Changed',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  untracked: 'New',
  conflicted: 'Conflict',
}

function setupStore(status: GitStatus) {
  mockStore({
    status,
    setStatus: mockSetStatus,
    selectedFile: null,
    setSelectedFile: vi.fn(),
    diffCache: new Map(),
    setDiff: vi.fn(),
    setLoading: vi.fn(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStatus.mockResolvedValue({ branch: 'main', files: [], truncated: false, hasConflicts: false })
  mockStage.mockResolvedValue({ success: true })
  mockUnstage.mockResolvedValue({ success: true })
  mockInvoke.mockImplementation((channel: string, payload: unknown) => {
    if (channel === 'git:status') return mockStatus(payload)
    if (channel === 'git:stage') return mockStage(payload)
    if (channel === 'git:unstage') return mockUnstage(payload)
    return Promise.resolve({})
  })
  Object.defineProperty(window, 'electronAPI', {
    value: { extensionBridge: { invoke: mockInvoke } },
    writable: true,
    configurable: true,
  })
})

describe('StagingArea — file status badge tooltips', () => {
  STATUSES.forEach((status) => {
    const label = STATUS_TOOLTIP[status]
    it(`badge for "${status}" has title="${label}"`, () => {
      setupStore({
        branch: 'main',
        files: [makeFile(status, false)],
        truncated: false,
        hasConflicts: false,
      })
      render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
      const badge = document.querySelector(`.staging-area__badge--${status}`)
      expect(badge).not.toBeNull()
      expect(badge?.getAttribute('title')).toBe(label)
      // Never a porcelain letter: the panel knows the file is new and should
      // say so rather than printing a punctuation mark.
      expect(badge?.textContent).toBe(STATUS_BADGE_TEXT[status])
    })
  })
})

describe('StagingArea — states', () => {
  it('shows loading state when status is null', () => {
    mockStore({
      status: null,
      setStatus: mockSetStatus,
      selectedFile: null,
    })
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('shows empty staged/unstaged sections', () => {
    mockStore({
      status: { branch: 'main', files: [], truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    })
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    expect(screen.getAllByText('No staged changes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('No unstaged changes').length).toBeGreaterThan(0)
  })
})

describe('StagingArea — states — shows truncation banner when truncated is true', () => {
  it('shows truncation banner, naming how many files the setting let through', () => {
    const files = Array.from({ length: 10 }, (_, i) => makeFile('modified', false, `f${i}.ts`))
    mockStore({
      status: { branch: 'main', files, truncated: true, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    })
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    expect(screen.getByText('Showing first 10 files.')).toBeTruthy()
  })

  it('renders staged and unstaged files in correct sections', () => {
    const files = [makeFile('modified', true, 'staged.ts'), makeFile('added', false, 'unstaged.ts')]
    mockStore({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    })
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    expect(screen.getByText('staged.ts')).toBeTruthy()
    expect(screen.getByText('unstaged.ts')).toBeTruthy()
  })
})

describe('StagingArea — states — shows Unstage All button when files are staged', () => {
  it('shows Unstage All button when files are staged', () => {
    const files = [makeFile('modified', true, 'staged.ts')]
    mockStore({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    })
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    expect(screen.getByText('Unstage All')).toBeTruthy()
  })

  it('shows Stage All button when files are unstaged', () => {
    const files = [makeFile('modified', false, 'unstaged.ts')]
    mockStore({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    })
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    expect(screen.getByText('Stage All')).toBeTruthy()
  })
})

describe('StagingArea — interactions', () => {
  it('calls onFileSelect when a file row is clicked', () => {
    const onFileSelect = vi.fn()
    const files = [makeFile('modified', false, 'src/a.ts')]
    mockStore({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    })
    render(<StagingArea repoRoot="/repo" onFileSelect={onFileSelect} />)
    fireEvent.click(screen.getByText('src/a.ts'))
    expect(onFileSelect).toHaveBeenCalledWith('src/a.ts', false)
  })
})

describe('StagingArea — interactions — calls git.stage and refreshes when unstaged checkbox is checked', () => {
  it('calls git.stage and refreshes when unstaged checkbox is checked', async () => {
    const files = [makeFile('modified', false, 'src/a.ts')]
    mockStore({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    })
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    await waitFor(() =>
      expect(mockStage).toHaveBeenCalledWith({ repoRoot: '/repo', paths: ['src/a.ts'] })
    )
    expect(mockStatus).toHaveBeenCalled()
  })
})

describe('StagingArea — interactions — calls git.unstage when staged checkbox is unchecked', () => {
  it('calls git.unstage when staged checkbox is unchecked', async () => {
    const files = [makeFile('modified', true, 'src/b.ts')]
    mockStore({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    })
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    await waitFor(() =>
      expect(mockUnstage).toHaveBeenCalledWith({ repoRoot: '/repo', paths: ['src/b.ts'] })
    )
  })
})

describe('StagingArea — interactions — calls git.stage for all unstaged files when Stage All is clicked', () => {
  it('calls git.stage for all unstaged files when Stage All is clicked', async () => {
    const files = [makeFile('modified', false, 'a.ts'), makeFile('added', false, 'b.ts')]
    mockStore({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    })
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    fireEvent.click(screen.getByText('Stage All'))
    await waitFor(() =>
      expect(mockStage).toHaveBeenCalledWith({ repoRoot: '/repo', paths: ['a.ts', 'b.ts'] })
    )
  })
})

describe('StagingArea — interactions — calls git.unstage for all staged files when Unstage All is clicked', () => {
  it('calls git.unstage for all staged files when Unstage All is clicked', async () => {
    const files = [makeFile('modified', true, 'a.ts'), makeFile('added', true, 'b.ts')]
    mockStore({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    })
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    fireEvent.click(screen.getByText('Unstage All'))
    await waitFor(() =>
      expect(mockUnstage).toHaveBeenCalledWith({ repoRoot: '/repo', paths: ['a.ts', 'b.ts'] })
    )
  })

  it('disables checkbox for conflicted files', () => {
    const files = [makeFile('conflicted', false, 'conflict.ts')]
    mockStore({
      status: { branch: 'main', files, truncated: false, hasConflicts: true },
      setStatus: mockSetStatus,
      selectedFile: null,
    })
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toHaveProperty('disabled', true)
  })
})

describe('StagingArea — interactions — highlights selected file row', () => {
  it('highlights selected file row', () => {
    const files = [makeFile('modified', false, 'selected.ts')]
    mockStore({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: 'selected.ts',
    })
    const { container } = render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    expect(container.querySelector('.staging-area__file-row--selected')).toBeTruthy()
  })
})
