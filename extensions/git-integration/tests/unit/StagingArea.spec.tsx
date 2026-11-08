import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
const mockRecordUsage = vi.fn()

const makeFile = (status: Status, staged: boolean, path?: string): GitFileStatus => ({
  path: path ?? `test.${status}.ts`,
  status,
  staged,
  isBinary: false,
})

// The badge used to carry git's porcelain letters — M, A, D, R, U, and a bare
// "?" for an untracked file — with the raw status word as its tooltip. Both say
// it in the reader's language now.
const STATUS_BADGES: Array<[Status, string, string]> = [
  ['modified', 'Changed since the last commit', 'Changed'],
  ['added', 'Staged as a new file', 'Added'],
  ['deleted', 'Deleted', 'Deleted'],
  ['renamed', 'Renamed', 'Renamed'],
  ['untracked', 'New — not tracked by git yet', 'New'],
  ['conflicted', 'Conflicted — needs resolving before it can be committed', 'Conflict'],
]

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
  vi.stubGlobal('electronAPI', {
    extensionBridge: { invoke: mockInvoke },
    usage: { record: mockRecordUsage },
  })
})

describe('StagingArea — file status badge tooltips', () => {
  it.each(STATUS_BADGES)(
    'a "%s" file shows the tooltip "%s" on a "%s" badge',
    (status, tooltip, text) => {
      setupStore({
        branch: 'main',
        files: [makeFile(status, false)],
        truncated: false,
        hasConflicts: false,
      })
      render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
      // Never a porcelain letter: the panel says what the file is in words.
      expect(screen.getByTitle(tooltip).textContent).toBe(text)
    }
  )
})

const sectionTitled = (title: string) =>
  screen.getByText(title).closest('.staging-area__section') as HTMLElement

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

  it('lists a staged file under Staged and an unstaged file under Changes', () => {
    const files = [makeFile('modified', true, 'staged.ts'), makeFile('added', false, 'unstaged.ts')]
    mockStore({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    })
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    expect(within(sectionTitled('Staged (1)')).getByText('staged.ts')).toBeTruthy()
    expect(within(sectionTitled('Changes (1)')).getByText('unstaged.ts')).toBeTruthy()
  })
})

describe('StagingArea — interactions', () => {
  it('calls onFileSelect when a file row is clicked', async () => {
    const user = userEvent.setup()
    const onFileSelect = vi.fn()
    const files = [makeFile('modified', false, 'src/a.ts')]
    mockStore({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    })
    render(<StagingArea repoRoot="/repo" onFileSelect={onFileSelect} />)
    await user.click(screen.getByText('src/a.ts'))
    expect(onFileSelect).toHaveBeenCalledWith('src/a.ts', false)
  })
})

describe('StagingArea — interactions — calls git.stage and refreshes when unstaged checkbox is checked', () => {
  it('calls git.stage and refreshes when unstaged checkbox is checked', async () => {
    const user = userEvent.setup()
    const files = [makeFile('modified', false, 'src/a.ts')]
    mockStore({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    })
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    await user.click(screen.getByRole('checkbox'))
    await waitFor(() =>
      expect(mockStage).toHaveBeenCalledWith({ repoRoot: '/repo', paths: ['src/a.ts'] })
    )
    expect(mockStatus).toHaveBeenCalled()
    expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith('stage')
  })
})

describe('StagingArea — interactions — calls git.unstage when staged checkbox is unchecked', () => {
  it('calls git.unstage when staged checkbox is unchecked', async () => {
    const user = userEvent.setup()
    const files = [makeFile('modified', true, 'src/b.ts')]
    mockStore({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    })
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    await user.click(screen.getByRole('checkbox'))
    await waitFor(() =>
      expect(mockUnstage).toHaveBeenCalledWith({ repoRoot: '/repo', paths: ['src/b.ts'] })
    )
  })
})

describe('StagingArea — interactions — calls git.stage for all unstaged files when Stage All is clicked', () => {
  it('calls git.stage for all unstaged files when Stage All is clicked', async () => {
    const user = userEvent.setup()
    const files = [makeFile('modified', false, 'a.ts'), makeFile('added', false, 'b.ts')]
    mockStore({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    })
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Stage All' }))
    await waitFor(() =>
      expect(mockStage).toHaveBeenCalledWith({ repoRoot: '/repo', paths: ['a.ts', 'b.ts'] })
    )
  })
})

describe('StagingArea — interactions — calls git.unstage for all staged files when Unstage All is clicked', () => {
  it('calls git.unstage for all staged files when Unstage All is clicked', async () => {
    const user = userEvent.setup()
    const files = [makeFile('modified', true, 'a.ts'), makeFile('added', true, 'b.ts')]
    mockStore({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    })
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Unstage All' }))
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
