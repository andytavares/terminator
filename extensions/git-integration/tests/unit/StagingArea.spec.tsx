import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'

vi.mock('../../src/stores/git.store', () => ({
  useGitStore: vi.fn(),
}))

import { useGitStore } from '../../src/stores/git.store'
import { StagingArea } from '../../src/components/StagingArea'

const mockUseGitStore = vi.mocked(useGitStore)
const mockStage = vi.fn()
const mockUnstage = vi.fn()
const mockStatus = vi.fn()
const mockSetStatus = vi.fn()

const makeFile = (status: string, staged: boolean, path?: string) => ({
  path: path ?? `test.${status}.ts`,
  status,
  staged,
  isBinary: false,
})

const STATUS_TOOLTIP: Record<string, string> = {
  modified: 'modified',
  added: 'added',
  deleted: 'deleted',
  renamed: 'renamed',
  untracked: 'untracked',
  conflicted: 'conflicted',
}

function setupStore(
  files: ReturnType<typeof makeFile>[] = [],
  overrides: Record<string, unknown> = {}
) {
  mockUseGitStore.mockReturnValue({
    status:
      files.length === 0 && !overrides.status
        ? null
        : { branch: 'main', files, truncated: false, hasConflicts: false, ...overrides.status },
    setStatus: mockSetStatus,
    selectedFile: overrides.selectedFile ?? null,
    setSelectedFile: vi.fn(),
    diffCache: new Map(),
    setDiff: vi.fn(),
    setLoading: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useGitStore>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStatus.mockResolvedValue({ branch: 'main', files: [], truncated: false, hasConflicts: false })
  mockStage.mockResolvedValue({ success: true })
  mockUnstage.mockResolvedValue({ success: true })
  Object.defineProperty(window, 'electronAPI', {
    value: { git: { status: mockStatus, stage: mockStage, unstage: mockUnstage } },
    writable: true,
    configurable: true,
  })
})

describe('StagingArea — file status badge tooltips', () => {
  Object.entries(STATUS_TOOLTIP).forEach(([status, label]) => {
    it(`badge for "${status}" has title="${label}"`, () => {
      setupStore([makeFile(status, false)], {
        status: {
          branch: 'main',
          files: [makeFile(status, false)],
          truncated: false,
          hasConflicts: false,
        },
      })
      render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
      const badge = document.querySelector(`.staging-area__badge--${status}`)
      expect(badge).not.toBeNull()
      expect(badge?.getAttribute('title')).toBe(label)
    })
  })
})

describe('StagingArea — states', () => {
  it('shows loading state when status is null', () => {
    mockUseGitStore.mockReturnValue({
      status: null,
      setStatus: mockSetStatus,
      selectedFile: null,
    } as unknown as ReturnType<typeof useGitStore>)
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('shows empty staged/unstaged sections', () => {
    mockUseGitStore.mockReturnValue({
      status: { branch: 'main', files: [], truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    } as unknown as ReturnType<typeof useGitStore>)
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    expect(screen.getAllByText('No staged changes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('No unstaged changes').length).toBeGreaterThan(0)
  })

  it('shows truncation banner when truncated is true', () => {
    mockUseGitStore.mockReturnValue({
      status: { branch: 'main', files: [], truncated: true, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    } as unknown as ReturnType<typeof useGitStore>)
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    expect(screen.getByText('Showing first 500 files.')).toBeTruthy()
  })

  it('renders staged and unstaged files in correct sections', () => {
    const files = [makeFile('modified', true, 'staged.ts'), makeFile('added', false, 'unstaged.ts')]
    mockUseGitStore.mockReturnValue({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    } as unknown as ReturnType<typeof useGitStore>)
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    expect(screen.getByText('staged.ts')).toBeTruthy()
    expect(screen.getByText('unstaged.ts')).toBeTruthy()
  })

  it('shows Unstage All button when files are staged', () => {
    const files = [makeFile('modified', true, 'staged.ts')]
    mockUseGitStore.mockReturnValue({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    } as unknown as ReturnType<typeof useGitStore>)
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    expect(screen.getByText('Unstage All')).toBeTruthy()
  })

  it('shows Stage All button when files are unstaged', () => {
    const files = [makeFile('modified', false, 'unstaged.ts')]
    mockUseGitStore.mockReturnValue({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    } as unknown as ReturnType<typeof useGitStore>)
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    expect(screen.getByText('Stage All')).toBeTruthy()
  })
})

describe('StagingArea — interactions', () => {
  it('calls onFileSelect when a file row is clicked', () => {
    const onFileSelect = vi.fn()
    const files = [makeFile('modified', false, 'src/a.ts')]
    mockUseGitStore.mockReturnValue({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    } as unknown as ReturnType<typeof useGitStore>)
    render(<StagingArea repoRoot="/repo" onFileSelect={onFileSelect} />)
    fireEvent.click(screen.getByText('src/a.ts'))
    expect(onFileSelect).toHaveBeenCalledWith('src/a.ts', false)
  })

  it('calls git.stage and refreshes when unstaged checkbox is checked', async () => {
    const files = [makeFile('modified', false, 'src/a.ts')]
    mockUseGitStore.mockReturnValue({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    } as unknown as ReturnType<typeof useGitStore>)
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    await waitFor(() => expect(mockStage).toHaveBeenCalledWith('/repo', ['src/a.ts']))
    expect(mockStatus).toHaveBeenCalled()
  })

  it('calls git.unstage when staged checkbox is unchecked', async () => {
    const files = [makeFile('modified', true, 'src/b.ts')]
    mockUseGitStore.mockReturnValue({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    } as unknown as ReturnType<typeof useGitStore>)
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    await waitFor(() => expect(mockUnstage).toHaveBeenCalledWith('/repo', ['src/b.ts']))
  })

  it('calls git.stage for all unstaged files when Stage All is clicked', async () => {
    const files = [makeFile('modified', false, 'a.ts'), makeFile('added', false, 'b.ts')]
    mockUseGitStore.mockReturnValue({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    } as unknown as ReturnType<typeof useGitStore>)
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    fireEvent.click(screen.getByText('Stage All'))
    await waitFor(() => expect(mockStage).toHaveBeenCalledWith('/repo', ['a.ts', 'b.ts']))
  })

  it('calls git.unstage for all staged files when Unstage All is clicked', async () => {
    const files = [makeFile('modified', true, 'a.ts'), makeFile('added', true, 'b.ts')]
    mockUseGitStore.mockReturnValue({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: null,
    } as unknown as ReturnType<typeof useGitStore>)
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    fireEvent.click(screen.getByText('Unstage All'))
    await waitFor(() => expect(mockUnstage).toHaveBeenCalledWith('/repo', ['a.ts', 'b.ts']))
  })

  it('disables checkbox for conflicted files', () => {
    const files = [makeFile('conflicted', false, 'conflict.ts')]
    mockUseGitStore.mockReturnValue({
      status: { branch: 'main', files, truncated: false, hasConflicts: true },
      setStatus: mockSetStatus,
      selectedFile: null,
    } as unknown as ReturnType<typeof useGitStore>)
    render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toHaveProperty('disabled', true)
  })

  it('highlights selected file row', () => {
    const files = [makeFile('modified', false, 'selected.ts')]
    mockUseGitStore.mockReturnValue({
      status: { branch: 'main', files, truncated: false, hasConflicts: false },
      setStatus: mockSetStatus,
      selectedFile: 'selected.ts',
    } as unknown as ReturnType<typeof useGitStore>)
    const { container } = render(<StagingArea repoRoot="/repo" onFileSelect={vi.fn()} />)
    expect(container.querySelector('.staging-area__file-row--selected')).toBeTruthy()
  })
})
