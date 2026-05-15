import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useGitStore } from '../../src/stores/git.store'

vi.mock('../../src/stores/git.store', () => ({ useGitStore: vi.fn() }))
vi.mock('../../src/hooks/useGitStatus', () => ({ useGitStatus: vi.fn() }))
vi.mock('../../src/components/StagingArea', () => ({
  StagingArea: ({ onFileSelect }: { onFileSelect: (path: string, staged: boolean) => void }) => (
    <div data-testid="staging-area">
      <button onClick={() => onFileSelect('src/foo.ts', false)}>SelectFile</button>
    </div>
  ),
}))
vi.mock('../../src/components/FileDiffView', () => ({
  FileDiffView: () => <div data-testid="file-diff-view" />,
}))
vi.mock('../../src/components/PrDialog', () => ({
  PrDialog: ({
    onClose,
    onCreated,
  }: {
    onClose: () => void
    onCreated: (pr: { number: number; url: string; title: string; state: string }) => void
  }) => (
    <div data-testid="pr-dialog">
      <button onClick={onClose}>ClosePrDialog</button>
      <button
        onClick={() =>
          onCreated({ number: 42, url: 'http://example.com/pull/42', title: 'PR', state: 'open' })
        }
      >
        CreatePr
      </button>
    </div>
  ),
}))
vi.mock('./git-integration.css', () => ({}), { virtual: true })
vi.mock('../../src/components/git-integration.css', () => ({}), { virtual: true })

const mockSetSelectedFile = vi.fn()
const mockSetDiff = vi.fn()
const mockSetLoading = vi.fn()
const mockGitCommit = vi.fn()
const mockGitPush = vi.fn()
const mockGitPrStatus = vi.fn()
const mockGitDiffFile = vi.fn()

function setupStore(overrides: Record<string, unknown> = {}) {
  vi.mocked(useGitStore).mockReturnValue({
    status: { branch: 'feature', files: [] },
    selectedFile: null,
    diffCache: new Map(),
    setSelectedFile: mockSetSelectedFile,
    setDiff: mockSetDiff,
    setLoading: mockSetLoading,
    clearDiffCache: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useGitStore>)
}

beforeEach(() => {
  vi.clearAllMocks()
  setupStore()
  mockGitDiffFile.mockResolvedValue({ diff: { hunks: [] } })
  mockGitCommit.mockResolvedValue({ commitHash: 'abc123' })
  mockGitPush.mockResolvedValue({ success: true })
  mockGitPrStatus.mockResolvedValue({ pr: null })
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    git: {
      diffFile: mockGitDiffFile,
      commit: mockGitCommit,
      push: mockGitPush,
      prStatus: mockGitPrStatus,
    },
  }
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

async function renderView(
  repoRoot: string | null = '/repo',
  storeOverrides: Record<string, unknown> = {}
) {
  setupStore(storeOverrides)
  const { GitFullView } = await import('../../src/components/GitFullView')
  return render(<GitFullView repoRoot={repoRoot} />)
}

describe('GitFullView', () => {
  it('shows "No project selected" when repoRoot is null', async () => {
    await renderView(null)
    expect(screen.getByText('No project selected.')).toBeTruthy()
  })

  it('renders staging area and diff view when repoRoot provided', async () => {
    await renderView()
    expect(screen.getByTestId('staging-area')).toBeTruthy()
    expect(screen.getByTestId('file-diff-view')).toBeTruthy()
  })

  it('renders commit message textarea', async () => {
    await renderView()
    expect(screen.getByPlaceholderText('Commit message…')).toBeTruthy()
  })

  it('shows hint when no files are staged', async () => {
    await renderView()
    expect(screen.getByText('Stage at least one file to commit')).toBeTruthy()
  })

  it('shows "Enter a commit message" hint when files staged but no message', async () => {
    const stagedFile = { path: 'src/foo.ts', staged: true, status: 'M' }
    setupStore({ status: { branch: 'feature', files: [stagedFile] } })
    const { GitFullView } = await import('../../src/components/GitFullView')
    render(<GitFullView repoRoot="/repo" />)
    expect(screen.getByText('Enter a commit message')).toBeTruthy()
  })

  it('disables Commit button when no staged files', async () => {
    await renderView()
    const btn = screen.getByText('Commit')
    expect(btn).toHaveProperty('disabled', true)
  })

  it('calls commit when Commit is clicked with staged files and message', async () => {
    const stagedFile = { path: 'src/foo.ts', staged: true, status: 'M' }
    setupStore({ status: { branch: 'feature', files: [stagedFile] } })
    const { GitFullView } = await import('../../src/components/GitFullView')
    render(<GitFullView repoRoot="/repo" />)
    fireEvent.change(screen.getByPlaceholderText('Commit message…'), {
      target: { value: 'fix: something' },
    })
    fireEvent.click(screen.getByText('Commit'))
    await waitFor(() =>
      expect(mockGitCommit).toHaveBeenCalledWith('/repo', 'fix: something', false, false)
    )
  })

  it('shows commit error message when commit returns error', async () => {
    mockGitCommit.mockResolvedValue({ error: 'NOTHING_TO_COMMIT' })
    const stagedFile = { path: 'src/foo.ts', staged: true, status: 'M' }
    setupStore({ status: { branch: 'feature', files: [stagedFile] } })
    const { GitFullView } = await import('../../src/components/GitFullView')
    render(<GitFullView repoRoot="/repo" />)
    fireEvent.change(screen.getByPlaceholderText('Commit message…'), {
      target: { value: 'fix: something' },
    })
    fireEvent.click(screen.getByText('Commit'))
    await waitFor(() =>
      expect(
        screen.getByText('Nothing staged to commit. Stage at least one file first.')
      ).toBeTruthy()
    )
  })

  it('calls commit and push when Commit & Push is clicked', async () => {
    const stagedFile = { path: 'src/foo.ts', staged: true, status: 'M' }
    setupStore({ status: { branch: 'feature', files: [stagedFile] } })
    const { GitFullView } = await import('../../src/components/GitFullView')
    render(<GitFullView repoRoot="/repo" />)
    fireEvent.change(screen.getByPlaceholderText('Commit message…'), {
      target: { value: 'feat: add x' },
    })
    fireEvent.click(screen.getByText('Commit & Push'))
    await waitFor(() => {
      expect(mockGitCommit).toHaveBeenCalled()
      expect(mockGitPush).toHaveBeenCalled()
    })
  })

  it('opens PR dialog when Open PR is clicked', async () => {
    await renderView()
    fireEvent.click(screen.getByText('Open PR'))
    await waitFor(() => expect(screen.getByTestId('pr-dialog')).toBeTruthy())
  })

  it('closes PR dialog when ClosePrDialog is clicked', async () => {
    await renderView()
    fireEvent.click(screen.getByText('Open PR'))
    await waitFor(() => screen.getByTestId('pr-dialog'))
    fireEvent.click(screen.getByText('ClosePrDialog'))
    expect(screen.queryByTestId('pr-dialog')).toBeNull()
  })

  it('closes PR dialog and dispatches event when PR is created', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    await renderView()
    fireEvent.click(screen.getByText('Open PR'))
    await waitFor(() => screen.getByTestId('pr-dialog'))
    fireEvent.click(screen.getByText('CreatePr'))
    expect(screen.queryByTestId('pr-dialog')).toBeNull()
    expect(dispatchSpy).toHaveBeenCalled()
    dispatchSpy.mockRestore()
  })

  it('shows char count when commit message exceeds 50 chars', async () => {
    await renderView()
    const msg = 'a'.repeat(51)
    fireEvent.change(screen.getByPlaceholderText('Commit message…'), { target: { value: msg } })
    expect(screen.getByText('51 chars')).toBeTruthy()
  })

  it('fetches diff when file is selected', async () => {
    await renderView()
    fireEvent.click(screen.getByText('SelectFile'))
    await waitFor(() =>
      expect(mockGitDiffFile).toHaveBeenCalledWith('/repo', 'src/foo.ts', false, false)
    )
  })

  it('shows hook output when commit fails due to hook failure', async () => {
    mockGitCommit.mockResolvedValue({
      error: 'HOOK_FAILED',
      hookOutput: 'eslint found 3 errors',
      isHookFailure: true,
    })
    const stagedFile = { path: 'src/foo.ts', staged: true, status: 'M' }
    setupStore({ status: { branch: 'feature', files: [stagedFile] } })
    const { GitFullView } = await import('../../src/components/GitFullView')
    render(<GitFullView repoRoot="/repo" />)
    fireEvent.change(screen.getByPlaceholderText('Commit message…'), {
      target: { value: 'fix: something' },
    })
    fireEvent.click(screen.getByText('Commit'))
    await waitFor(() => expect(screen.getByText('Pre-commit hooks failed.')).toBeTruthy())
    expect(screen.getByText('Hook output')).toBeTruthy()
    expect(screen.getByText('Commit without hooks')).toBeTruthy()
  })

  it('commits with --no-verify when Commit without hooks is clicked', async () => {
    mockGitCommit
      .mockResolvedValueOnce({
        error: 'HOOK_FAILED',
        hookOutput: 'lint failed',
        isHookFailure: true,
      })
      .mockResolvedValueOnce({ commitHash: 'def456' })
    const stagedFile = { path: 'src/foo.ts', staged: true, status: 'M' }
    setupStore({ status: { branch: 'feature', files: [stagedFile] } })
    const { GitFullView } = await import('../../src/components/GitFullView')
    render(<GitFullView repoRoot="/repo" />)
    fireEvent.change(screen.getByPlaceholderText('Commit message…'), {
      target: { value: 'fix: skip hooks' },
    })
    fireEvent.click(screen.getByText('Commit'))
    await waitFor(() => screen.getByText('Commit without hooks'))
    fireEvent.click(screen.getByText('Commit without hooks'))
    await waitFor(() =>
      expect(mockGitCommit).toHaveBeenCalledWith('/repo', 'fix: skip hooks', false, true)
    )
  })

  it('shows running hooks status text while committing', async () => {
    let resolve: (v: unknown) => void
    mockGitCommit.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    const stagedFile = { path: 'src/foo.ts', staged: true, status: 'M' }
    setupStore({ status: { branch: 'feature', files: [stagedFile] } })
    const { GitFullView } = await import('../../src/components/GitFullView')
    render(<GitFullView repoRoot="/repo" />)
    fireEvent.change(screen.getByPlaceholderText('Commit message…'), {
      target: { value: 'wip' },
    })
    fireEvent.click(screen.getByText('Commit'))
    await waitFor(() => expect(screen.getByText(/Running pre-commit hooks/)).toBeTruthy())
    resolve!({ commitHash: 'abc' })
  })

  it('shows push error when push fails after commit & push', async () => {
    mockGitPush.mockResolvedValue({ error: 'REJECTED' })
    const stagedFile = { path: 'src/foo.ts', staged: true, status: 'M' }
    setupStore({ status: { branch: 'feature', files: [stagedFile] } })
    const { GitFullView } = await import('../../src/components/GitFullView')
    render(<GitFullView repoRoot="/repo" />)
    fireEvent.change(screen.getByPlaceholderText('Commit message…'), {
      target: { value: 'feat: add x' },
    })
    fireEvent.click(screen.getByText('Commit & Push'))
    await waitFor(() =>
      expect(screen.getByText('Committed but push rejected — pull changes first.')).toBeTruthy()
    )
  })
})
