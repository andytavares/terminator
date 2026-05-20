import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PrDialog } from '../../../extensions/git-integration/src/components/PrDialog'
import type { PullRequest } from '../../../extensions/git-integration/src/schemas/git.schema'

vi.mock('marked', () => ({
  marked: { parse: (s: string) => `<p>${s}</p>` },
}))

const mockShellExec = vi.fn()
const mockListBranches = vi.fn()
const mockReadFile = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    shell: { exec: mockShellExec },
    git: { listBranches: mockListBranches },
    fs: { readFile: mockReadFile },
  }
  mockListBranches.mockResolvedValue({
    branches: [
      { name: 'main', isCurrent: false, isRemote: false },
      { name: 'origin/main', isCurrent: false, isRemote: true },
    ],
  })
  mockReadFile.mockResolvedValue({ error: 'not found' })
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
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
    const overlay = document.querySelector('.pr-dialog')
    if (overlay) fireEvent.click(overlay)
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
      .mockResolvedValueOnce({ exitCode: 0, stdout: '5', stderr: '' }) // checkCommitsAhead
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // push
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'https://github.com/foo/bar/pull/99',
        stderr: '',
      }) // gh pr create

    render(<PrDialog {...defaultProps} onCreated={onCreated} />)
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByText('Create PR'))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    const pr = onCreated.mock.calls[0][0] as PullRequest
    expect(pr.number).toBe(99)
  })

  it('shows error when PR creation fails', async () => {
    mockShellExec
      .mockResolvedValueOnce({ exitCode: 0, stdout: '3', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'gh error' })

    render(<PrDialog {...defaultProps} />)
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByText('Create PR'))
    await waitFor(() => expect(screen.getByText('gh error')).toBeTruthy())
  })

  it('shows error when no commits ahead of base', async () => {
    mockShellExec.mockResolvedValue({ exitCode: 0, stdout: '0', stderr: '' })
    render(<PrDialog {...defaultProps} />)
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByText('Create PR'))
    await waitFor(() => expect(screen.getByText(/No commits ahead/)).toBeTruthy())
  })

  it('shows error when push fails', async () => {
    mockShellExec
      .mockResolvedValueOnce({ exitCode: 0, stdout: '2', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'push failed' })

    render(<PrDialog {...defaultProps} />)
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByText('Create PR'))
    await waitFor(() => expect(screen.getByText('push failed')).toBeTruthy())
  })
})
