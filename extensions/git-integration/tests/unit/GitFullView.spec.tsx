import React from 'react'
import { describe, it, beforeAll, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { GitFullView } from '../../src/components/GitFullView'
import { useGitStore } from '../../src/stores/git.store'
import type { GitStatus } from '../../src/schemas/git.schema'
import { partialFake } from '../../../../tests/support/fakes'

type GitState = ReturnType<typeof useGitStore.getState>

vi.mock('../../src/stores/git.store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/stores/git.store')>()),
  useGitStore: vi.fn(),
}))
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
    existingPr,
  }: {
    onClose: () => void
    onCreated: (pr: { number: number; url: string; title: string; state: string }) => void
    existingPr?: { number: number } | null
  }) => (
    <div data-testid="pr-dialog">
      {existingPr && <span>existing PR #{existingPr.number}</span>}
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
vi.mock('./git-integration.css', () => ({}))
vi.mock('../../src/components/git-integration.css', () => ({}))

const mockSetSelectedFile = vi.fn()
const mockSetDiff = vi.fn()
const mockSetLoading = vi.fn()
const mockGitCommit = vi.fn()
const mockGitPush = vi.fn()
const mockGitPrStatus = vi.fn()
const mockGitDiffFile = vi.fn()
const mockInvoke = vi.fn()
const channelHandlers = new Map<string, (data: unknown) => void>()
const mockOn = vi.fn((channel: string, cb: (data: unknown) => void) => {
  channelHandlers.set(channel, cb)
  return () => channelHandlers.delete(channel)
})

/** The feature branch with src/foo.ts staged. */
function featureWithStagedFile(): GitStatus {
  const stagedFile = {
    path: 'src/foo.ts',
    staged: true,
    status: 'modified' as const,
    isBinary: false,
  }
  return { branch: 'feature', files: [stagedFile], hasConflicts: false, truncated: false }
}

function setupStore(overrides: Partial<GitState> = {}) {
  {
    const state: Partial<GitState> = {
      status: { branch: 'feature', files: [], hasConflicts: false, truncated: false },
      selectedFile: null,
      diffCache: new Map(),
      setSelectedFile: mockSetSelectedFile,
      setDiff: mockSetDiff,
      setLoading: mockSetLoading,
      clearDiffCache: vi.fn(),
      ...overrides,
    }
    vi.mocked(useGitStore).mockImplementation((sel?: (s: GitState) => unknown) =>
      sel ? sel(partialFake<GitState>(state)) : state
    )
  }
}

const mockRecordUsage = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  channelHandlers.clear()
  setupStore()
  mockGitDiffFile.mockResolvedValue({ diff: { hunks: [] } })
  mockGitCommit.mockResolvedValue({ commitHash: 'abc123' })
  mockGitPush.mockResolvedValue({ success: true })
  mockGitPrStatus.mockResolvedValue({ pr: null })
  mockInvoke.mockImplementation((channel: string, payload: unknown) => {
    if (channel === 'git:diff-file') return mockGitDiffFile(payload)
    if (channel === 'git:commit') return mockGitCommit(payload)
    if (channel === 'git:push') return mockGitPush(payload)
    if (channel === 'git:pr-status') return mockGitPrStatus(payload)
    if (channel === 'git:commit-output-poll') return Promise.resolve({ lines: [] })
    return Promise.resolve({})
  })
  Object.assign(globalThis, {
    electronAPI: {
      extensionBridge: { invoke: mockInvoke, on: mockOn },
      usage: { record: mockRecordUsage },
    },
  })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'electronAPI')
})

async function renderView(
  repoRoot: string | null = '/repo',
  storeOverrides: Record<string, unknown> = {}
) {
  setupStore(storeOverrides)
  return render(<GitFullView repoRoot={repoRoot} />)
}

/** Renders the view for /repo and opens the PR dialog. */
async function renderWithPrDialogOpen() {
  await renderView()
  fireEvent.click(screen.getByText('Open PR'))
  await screen.findByTestId('pr-dialog')
}

// The first import compiles the component tree, which on a loaded machine takes longer
// than one test's 5 s; load it once here so every test times only its own work.
beforeAll(async () => {
  await import('../../src/components/GitFullView')
})

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
})

describe('GitFullView — shows Enter a commit message hint when files staged but no message', () => {
  it('shows "Enter a commit message" hint when files staged but no message', async () => {
    setupStore({ status: featureWithStagedFile() })
    render(<GitFullView repoRoot="/repo" />)
    expect(screen.getByText('Enter a commit message')).toBeTruthy()
  })

  it('disables Commit button when no staged files', async () => {
    await renderView()
    const btn = screen.getByText('Commit')
    expect(btn).toHaveProperty('disabled', true)
  })
})

describe('GitFullView — calls commit when Commit is clicked with staged files and message', () => {
  it('calls commit when Commit is clicked with staged files and message', async () => {
    setupStore({ status: featureWithStagedFile() })
    render(<GitFullView repoRoot="/repo" />)
    fireEvent.change(screen.getByPlaceholderText('Commit message…'), {
      target: { value: 'fix: something' },
    })
    fireEvent.click(screen.getByText('Commit'))
    await waitFor(() =>
      expect(mockGitCommit).toHaveBeenCalledWith({
        repoRoot: '/repo',
        message: 'fix: something',
        noVerify: false,
      })
    )
    expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith('commit', {})
  })
})

describe('GitFullView — shows commit error message when commit returns error', () => {
  it('shows commit error message when commit returns error', async () => {
    mockGitCommit.mockResolvedValue({ error: 'NOTHING_TO_COMMIT' })
    setupStore({ status: featureWithStagedFile() })
    render(<GitFullView repoRoot="/repo" />)
    fireEvent.change(screen.getByPlaceholderText('Commit message…'), {
      target: { value: 'fix: something' },
    })
    fireEvent.click(screen.getByText('Commit'))
    expect(
      await screen.findByText('Nothing staged to commit. Stage at least one file first.')
    ).toBeTruthy()
    expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith('commit', { failed: true })
  })
})

describe('GitFullView — calls commit and push when Commit & Push is clicked', () => {
  it('calls commit and push when Commit & Push is clicked', async () => {
    setupStore({ status: featureWithStagedFile() })
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
    await screen.findByTestId('pr-dialog')
  })
})

describe('GitFullView — closes PR dialog when ClosePrDialog is clicked', () => {
  it('closes PR dialog when ClosePrDialog is clicked', async () => {
    await renderWithPrDialogOpen()
    fireEvent.click(screen.getByText('ClosePrDialog'))
    expect(screen.queryByTestId('pr-dialog')).toBeNull()
  })

  it('closes PR dialog and dispatches event when PR is created', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    await renderWithPrDialogOpen()
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
})

describe('GitFullView — the pull request Open PR created', () => {
  it('shows the created pull request with a link that opens it, and announces it', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    Object.assign(window.electronAPI, {
      shell: { openExternal },
    })
    await renderWithPrDialogOpen()
    fireEvent.click(screen.getByText('CreatePr'))

    fireEvent.click(await screen.findByRole('link', { name: '#42 PR' }))
    expect(openExternal).toHaveBeenCalledWith('http://example.com/pull/42')
    expect(mockInvoke).toHaveBeenCalledWith(
      'git:notify',
      expect.objectContaining({ type: 'success', key: 'prCreated', title: 'Opened #42 PR' })
    )
  })
})

describe('GitFullView — fetches diff when file is selected', () => {
  it('fetches diff when file is selected', async () => {
    await renderView()
    fireEvent.click(screen.getByText('SelectFile'))
    await waitFor(() =>
      expect(mockGitDiffFile).toHaveBeenCalledWith({
        repoRoot: '/repo',
        path: 'src/foo.ts',
        staged: false,
        isUntracked: false,
      })
    )
  })

  it('caches the fetched diff under its staged/unstaged key', async () => {
    await renderView()
    fireEvent.click(screen.getByText('SelectFile'))
    await waitFor(() =>
      expect(mockSetDiff).toHaveBeenCalledWith('unstaged:src/foo.ts', { hunks: [] })
    )
  })
})

describe('GitFullView — does not refetch when the same side of the file is already cached', () => {
  it('does not refetch when the same side of the file is already cached', async () => {
    await renderView('/repo', { diffCache: new Map([['unstaged:src/foo.ts', { hunks: [] }]]) })
    fireEvent.click(screen.getByText('SelectFile'))
    expect(mockGitDiffFile).not.toHaveBeenCalled()
  })

  it('refetches when only the other side of the file is cached', async () => {
    await renderView('/repo', { diffCache: new Map([['staged:src/foo.ts', { hunks: [] }]]) })
    fireEvent.click(screen.getByText('SelectFile'))
    await waitFor(() => expect(mockGitDiffFile).toHaveBeenCalledTimes(1))
  })
})

describe('GitFullView — shows hook output when commit fails due to hook failure', () => {
  it('shows hook output when commit fails due to hook failure', async () => {
    mockGitCommit.mockResolvedValue({
      error: 'HOOK_FAILED',
      hookOutput: 'eslint found 3 errors',
      isHookFailure: true,
    })
    setupStore({ status: featureWithStagedFile() })
    render(<GitFullView repoRoot="/repo" />)
    fireEvent.change(screen.getByPlaceholderText('Commit message…'), {
      target: { value: 'fix: something' },
    })
    fireEvent.click(screen.getByText('Commit'))
    await screen.findByText('Pre-commit hooks failed.')
    expect(screen.getByText('Hook output')).toBeTruthy()
    expect(screen.getByText('Commit without hooks')).toBeTruthy()
  })
})

describe('GitFullView — commits with --no-verify when Commit without hooks is clicked', () => {
  it('commits with --no-verify when Commit without hooks is clicked', async () => {
    mockGitCommit
      .mockResolvedValueOnce({
        error: 'HOOK_FAILED',
        hookOutput: 'lint failed',
        isHookFailure: true,
      })
      .mockResolvedValueOnce({ commitHash: 'def456' })
    setupStore({ status: featureWithStagedFile() })
    render(<GitFullView repoRoot="/repo" />)
    fireEvent.change(screen.getByPlaceholderText('Commit message…'), {
      target: { value: 'fix: skip hooks' },
    })
    fireEvent.click(screen.getByText('Commit'))
    fireEvent.click(await screen.findByText('Commit without hooks'))
    await waitFor(() =>
      expect(mockGitCommit).toHaveBeenCalledWith({
        repoRoot: '/repo',
        message: 'fix: skip hooks',
        noVerify: true,
      })
    )
  })
})

describe('GitFullView — shows running hooks status text while committing', () => {
  it('shows running hooks status text while committing', async () => {
    let resolve: (v: unknown) => void
    mockGitCommit.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    setupStore({ status: featureWithStagedFile() })
    render(<GitFullView repoRoot="/repo" />)
    fireEvent.change(screen.getByPlaceholderText('Commit message…'), {
      target: { value: 'wip' },
    })
    fireEvent.click(screen.getByText('Commit'))
    await screen.findByText(/Running pre-commit hooks/)
    resolve!({ commitHash: 'abc' })
  })
})

describe('GitFullView — shows push error when push fails after commit & push', () => {
  it('shows push error when push fails after commit & push', async () => {
    mockGitPush.mockResolvedValue({ error: 'REJECTED' })
    setupStore({ status: featureWithStagedFile() })
    render(<GitFullView repoRoot="/repo" />)
    fireEvent.change(screen.getByPlaceholderText('Commit message…'), {
      target: { value: 'feat: add x' },
    })
    fireEvent.click(screen.getByText('Commit & Push'))
    expect(
      await screen.findByText('Committed but push rejected — pull changes first.')
    ).toBeTruthy()
  })

  it('focuses the commit message box on git:focus-commit-message for this repo', async () => {
    await renderView('/repo')
    const textarea = screen.getByPlaceholderText('Commit message…')
    expect(document.activeElement).not.toBe(textarea)
    channelHandlers.get('git:focus-commit-message')?.({ repoRoot: '/repo' })
    await waitFor(() => expect(document.activeElement).toBe(textarea))
  })
})

describe('GitFullView — ignores git:focus-commit-message for a different repo', () => {
  it('ignores git:focus-commit-message for a different repo', async () => {
    await renderView('/repo')
    const textarea = screen.getByPlaceholderText('Commit message…')
    channelHandlers.get('git:focus-commit-message')?.({ repoRoot: '/other-repo' })
    expect(document.activeElement).not.toBe(textarea)
  })

  it('opens the PR dialog on git:open-pr-dialog for this repo', async () => {
    await renderView('/repo')
    expect(screen.queryByTestId('pr-dialog')).toBeNull()
    channelHandlers.get('git:open-pr-dialog')?.({ repoRoot: '/repo' })
    await screen.findByTestId('pr-dialog')
  })

  it('shows the pull request the branch already has when git:open-pr-dialog opens it', async () => {
    mockGitPrStatus.mockResolvedValue({
      pr: { number: 7, url: 'http://example.com/pull/7', title: 'Existing', state: 'open' },
    })
    await renderView('/repo')
    channelHandlers.get('git:open-pr-dialog')?.({ repoRoot: '/repo' })
    await screen.findByText('existing PR #7')
    expect(mockGitPrStatus).toHaveBeenCalledWith({ repoRoot: '/repo' })
  })

  it('ignores git:open-pr-dialog for a different repo', async () => {
    await renderView('/repo')
    channelHandlers.get('git:open-pr-dialog')?.({ repoRoot: '/other-repo' })
    expect(screen.queryByTestId('pr-dialog')).toBeNull()
  })
})

/** Answers git:ui.consume-pending-request with `request`, the rest as beforeEach does. */
function leavePendingRequest(request: { kind: string; repoRoot: string } | null) {
  const answer = mockInvoke.getMockImplementation()!
  mockInvoke.mockImplementation((channel: string, payload: unknown) =>
    channel === 'git:ui.consume-pending-request'
      ? Promise.resolve({ request })
      : answer(channel, payload)
  )
}

describe('GitFullView — a Commit… or Create PR… run before the view existed', () => {
  it('focuses the commit message box for a pending Commit… on this repo', async () => {
    leavePendingRequest({ kind: 'commit', repoRoot: '/repo' })
    await renderView('/repo')
    const textarea = screen.getByPlaceholderText('Commit message…')
    await waitFor(() => expect(document.activeElement).toBe(textarea))
  })

  it('opens the PR dialog for a pending Create PR… on this repo', async () => {
    leavePendingRequest({ kind: 'pull-request', repoRoot: '/repo' })
    await renderView('/repo')
    await screen.findByTestId('pr-dialog')
  })
})

describe('GitFullView — a pending Create PR… and the pull request a branch has', () => {
  it('shows the pull request the branch already has for a pending Create PR…', async () => {
    mockGitPrStatus.mockResolvedValue({
      pr: { number: 9, url: 'http://example.com/pull/9', title: 'Existing', state: 'open' },
    })
    leavePendingRequest({ kind: 'pull-request', repoRoot: '/repo' })
    await renderView('/repo')
    await screen.findByText('existing PR #9')
  })

  it("leaves another repository's pending request alone", async () => {
    leavePendingRequest({ kind: 'pull-request', repoRoot: '/other-repo' })
    await renderView('/repo')
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('git:ui.consume-pending-request', {})
    )
    expect(screen.queryByTestId('pr-dialog')).toBeNull()
  })
})
