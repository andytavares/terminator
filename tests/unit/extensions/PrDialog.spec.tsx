import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PrDialog } from '../../../extensions/git-integration/src/components/PrDialog'
import type { PullRequest } from '../../../extensions/git-integration/src/schemas/git.schema'
import type { ElectronAPI } from '../../../src/shared/electron-api/api-type'
import { installElectronApi } from '../../support/electron-api'

const mockShellExec = vi.fn<ElectronAPI['shell']['exec']>()
const mockListBranches = vi.fn<ElectronAPI['git']['listBranches']>()
const mockReadFile = vi.fn<ElectronAPI['fs']['readFile']>()
const mockInvoke = vi.fn<ElectronAPI['extensionBridge']['invoke']>()

/** What `git`/`gh` printed and how it exited, as shell.exec answers. */
const ran = (exitCode: number, stdout = '', stderr = '') => ({
  exitCode,
  stdout,
  stderr,
  timedOut: false,
})

beforeEach(() => {
  vi.resetAllMocks()
  installElectronApi({
    shell: { exec: mockShellExec },
    extensionBridge: { invoke: mockInvoke },
    git: { listBranches: mockListBranches },
    fs: { readFile: mockReadFile },
  })
  mockListBranches.mockResolvedValue({
    branches: [
      { name: 'main', isCurrent: false, isRemote: false },
      { name: 'teammate/fix', isCurrent: false, isRemote: true },
    ],
  })
  mockReadFile.mockResolvedValue({ error: 'not found' })
})

const defaultProps = {
  repoRoot: '/repo',
  branch: 'feature/my-feature',
  existingPr: null,
  onClose: vi.fn(),
  onCreated: vi.fn(),
}

describe('PrDialog', () => {
  it('renders the dialog with title input pre-filled from branch', async () => {
    render(<PrDialog {...defaultProps} />)
    await waitFor(() => screen.getByRole('dialog'))
    const input = screen.getByPlaceholderText('Pull request title') as HTMLInputElement
    // feature/ prefix isn't stripped (only feat/fix/chore/docs/refactor), dashes become spaces
    expect(input.value).toBe('feature/my feature')
  })

  it('calls onClose when overlay is clicked', async () => {
    const onClose = vi.fn()
    render(<PrDialog {...defaultProps} onClose={onClose} />)
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(document.querySelector('.tmui-dialog__scrim')!)
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn()
    render(<PrDialog {...defaultProps} onClose={onClose} />)
    await waitFor(() => screen.getByLabelText('Close'))
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows existing PR notice when existingPr is set', async () => {
    const existingPr: PullRequest = {
      number: 42,
      title: 'Old PR',
      url: 'https://github.com/foo/bar/pull/42',
      state: 'open',
      isDraft: false,
      baseRefName: 'main',
      headRefName: 'feature/my-feature',
      body: '',
    }
    render(<PrDialog {...defaultProps} existingPr={existingPr} />)
    await waitFor(() => screen.getByRole('dialog'))
    expect(screen.getByText(/A PR already exists/)).toBeTruthy()
    expect(screen.getByText(/#42: Old PR/)).toBeTruthy()
  })

  it('shows default branch warning when branch is main', async () => {
    render(<PrDialog {...defaultProps} branch="main" />)
    await waitFor(() => screen.getByRole('dialog'))
    expect(screen.getByText(/creating a PR from the default branch/)).toBeTruthy()
  })

  it('disables Create PR button when title is empty', async () => {
    render(<PrDialog {...defaultProps} />)
    await waitFor(() => screen.getByRole('dialog'))
    const input = screen.getByPlaceholderText('Pull request title') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    const btn = screen.getByText('Create PR').closest('button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('switches between write and preview modes', async () => {
    render(<PrDialog {...defaultProps} />)
    await waitFor(() => screen.getByRole('dialog'))
    expect(screen.getByPlaceholderText(/Describe your changes/)).toBeTruthy()
    fireEvent.click(screen.getByText('Preview'))
    expect(screen.queryByPlaceholderText(/Describe your changes/)).toBeNull()
    fireEvent.click(screen.getByText('Write'))
    expect(screen.getByPlaceholderText(/Describe your changes/)).toBeTruthy()
  })

  it('toggles draft checkbox', async () => {
    render(<PrDialog {...defaultProps} />)
    await waitFor(() => screen.getByRole('dialog'))
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)
    expect(screen.getByText('Create Draft PR')).toBeTruthy()
  })

  it('loads branches and sets base branch', async () => {
    mockListBranches.mockResolvedValue({
      branches: [
        { name: 'main', isCurrent: false, isRemote: false },
        { name: 'develop', isCurrent: false, isRemote: false },
        { name: 'feature/my-feature', isCurrent: true, isRemote: false },
      ],
    })
    render(<PrDialog {...defaultProps} />)
    await waitFor(() => screen.getByRole('dialog'))
    await waitFor(() => {
      const select = screen.getByRole('listbox') as HTMLSelectElement
      expect(select.value).toBe('main')
    })
  })

  it('loads PR template from filesystem', async () => {
    mockReadFile.mockResolvedValue({ content: '## Summary\n' })
    render(<PrDialog {...defaultProps} />)
    await waitFor(() => screen.getByRole('dialog'))
    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(/Describe your changes/) as HTMLTextAreaElement
      expect(textarea.value).toBe('## Summary\n')
    })
  })

  it('creates PR and calls onCreated on success', async () => {
    const onCreated = vi.fn()
    mockShellExec
      .mockResolvedValueOnce(ran(0, '5', '')) // checkCommitsAhead
      .mockResolvedValueOnce(ran(0, '', '')) // push
    mockInvoke.mockResolvedValueOnce({ number: 99, url: 'https://github.com/foo/bar/pull/99' })

    render(<PrDialog {...defaultProps} onCreated={onCreated} />)
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByText('Create PR'))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    const pr = onCreated.mock.calls[0][0] as PullRequest
    expect(pr.number).toBe(99)
    // The view asks the main process to open it; it never runs gh itself.
    expect(mockInvoke).toHaveBeenCalledWith('github:pr-create', {
      repoRoot: '/repo',
      title: 'feature/my feature',
      body: '',
      base: 'main',
      head: 'feature/my-feature',
      draft: false,
    })
  })

  it('shows error when PR creation fails', async () => {
    mockShellExec.mockResolvedValueOnce(ran(0, '3', '')).mockResolvedValueOnce(ran(0, '', ''))
    mockInvoke.mockResolvedValueOnce({ error: 'gh error' })

    render(<PrDialog {...defaultProps} />)
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByText('Create PR'))
    await waitFor(() => expect(screen.getByText('gh error')).toBeTruthy())
  })

  it('shows error when no commits ahead of base', async () => {
    mockShellExec.mockResolvedValue(ran(0, '0', ''))
    render(<PrDialog {...defaultProps} />)
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByText('Create PR'))
    await waitFor(() => expect(screen.getByText(/No commits ahead/)).toBeTruthy())
  })

  it('shows error when push fails', async () => {
    mockShellExec
      .mockResolvedValueOnce(ran(0, '2', ''))
      .mockResolvedValueOnce(ran(1, '', 'push failed'))

    render(<PrDialog {...defaultProps} />)
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByText('Create PR'))
    await waitFor(() => expect(screen.getByText('push failed')).toBeTruthy())
  })
})
