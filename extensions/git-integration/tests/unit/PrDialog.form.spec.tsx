import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PrDialog } from '../../src/components/PrDialog'
import type { PullRequest } from '../../src/schemas/git.schema'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import { installElectronApi } from '../../../../tests/support/electron-api'
import { pressOutside } from '../../../../tests/support/modal'

const mockShellExec = vi.fn<ElectronAPI['shell']['exec']>()
const mockListBranches = vi.fn<ElectronAPI['git']['listBranches']>()
const mockReadFile = vi.fn<ElectronAPI['fs']['readFile']>()
const mockInvoke = vi.fn<ElectronAPI['extensionBridge']['invoke']>()

/** What `git`/`gh` printed and how it exited, as shell.exec answers. */
const execResult = (exitCode: number, stdout = '', stderr = '') => ({
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
  // The view-only usage call the dialog makes; the core's window type does not list it.
  Object.assign(window.electronAPI, { usage: { record: vi.fn() } })
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
  hasStagedChanges: false,
  onClose: vi.fn(),
  onCreated: vi.fn(),
}

// The Title and Description labels are not tied to their fields, so the placeholder names them.
const titleBox = () => screen.getByRole('textbox', { name: 'Title' })
const descriptionBox = () => screen.queryByRole('textbox', { name: 'Description' })
const createButton = () => screen.findByRole('button', { name: 'Create PR' })

describe('PrDialog', () => {
  it('pre-fills the title from the branch, turning dashes into spaces', async () => {
    render(<PrDialog {...defaultProps} />)
    await screen.findByRole('dialog')
    // feature/ prefix isn't stripped (only feat/fix/chore/docs/refactor)
    expect((titleBox() as HTMLInputElement).value).toBe('feature/my feature')
  })

  it('closes on a press outside the dialog', async () => {
    const onClose = vi.fn()
    render(<PrDialog {...defaultProps} onClose={onClose} />)
    await screen.findByRole('dialog')
    pressOutside(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes from its Close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<PrDialog {...defaultProps} onClose={onClose} />)
    await user.click(await screen.findByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('PrDialog — notices', () => {
  it('names the PR that already exists for the branch', async () => {
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
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/A PR already exists:\s*#42: Old PR/)
  })

  it('warns when the PR would come from the default branch', async () => {
    render(<PrDialog {...defaultProps} branch="main" />)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Warning: creating a PR from the default branch (main).')
  })
})

describe('PrDialog — title, modes and draft', () => {
  it('disables Create PR once the title is cleared', async () => {
    const user = userEvent.setup()
    render(<PrDialog {...defaultProps} />)
    await screen.findByRole('dialog')
    await user.clear(titleBox())
    expect(((await createButton()) as HTMLButtonElement).disabled).toBe(true)
  })

  it('hides the description box in Preview and brings it back in Write', async () => {
    const user = userEvent.setup()
    render(<PrDialog {...defaultProps} />)
    await screen.findByRole('dialog')
    expect(descriptionBox()).not.toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(descriptionBox()).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Write' }))
    expect(descriptionBox()).not.toBeNull()
  })
})

describe('PrDialog — draft', () => {
  it('renames the create button when Draft is checked', async () => {
    const user = userEvent.setup()
    render(<PrDialog {...defaultProps} />)
    await screen.findByRole('dialog')
    const draft = screen.getByRole('checkbox', { name: 'Draft' }) as HTMLInputElement
    expect(draft.checked).toBe(false)
    await user.click(draft)
    expect(draft.checked).toBe(true)
    expect(screen.getByRole('button', { name: 'Create Draft PR' }).textContent).toBe(
      'Create Draft PR'
    )
  })
})

describe('PrDialog — branches and template', () => {
  it('lists the local branches and picks main as the base', async () => {
    mockListBranches.mockResolvedValue({
      branches: [
        { name: 'main', isCurrent: false, isRemote: false },
        { name: 'develop', isCurrent: false, isRemote: false },
        { name: 'feature/my-feature', isCurrent: true, isRemote: false },
      ],
    })
    render(<PrDialog {...defaultProps} />)
    await screen.findByRole('option', { name: 'develop' })
    expect((screen.getByRole('listbox') as HTMLSelectElement).value).toBe('main')
  })

  it('fills the description from the repo PR template', async () => {
    mockReadFile.mockResolvedValue({ content: '## Summary\n' })
    render(<PrDialog {...defaultProps} />)
    const description = (await screen.findByDisplayValue('## Summary')) as HTMLTextAreaElement
    expect(description.value).toBe('## Summary\n')
  })
})

/** Answers the commit count and the push, then GitHub's new PR #99. */
function answerCreate(): void {
  mockShellExec
    .mockResolvedValueOnce(execResult(0, '5', '')) // checkCommitsAhead
    .mockResolvedValueOnce(execResult(0, '', '')) // push
  mockInvoke.mockResolvedValueOnce({ number: 99, url: 'https://github.com/foo/bar/pull/99' })
}

describe('PrDialog — creating', () => {
  it('asks the main process to open the PR from the form', async () => {
    const user = userEvent.setup()
    answerCreate()
    render(<PrDialog {...defaultProps} />)
    await user.click(await createButton())
    // The view asks the main process to open it; it never runs gh itself.
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('github:pr-create', {
        repoRoot: '/repo',
        title: 'feature/my feature',
        body: '',
        base: 'main',
        head: 'feature/my-feature',
        draft: false,
      })
    )
  })
})

describe('PrDialog — created', () => {
  it('hands back the new PR, built from the form and GitHub answer', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    answerCreate()
    render(<PrDialog {...defaultProps} onCreated={onCreated} />)
    await user.click(await createButton())
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({
        number: 99,
        url: 'https://github.com/foo/bar/pull/99',
        title: 'feature/my feature',
        body: '',
        state: 'open',
        isDraft: false,
        baseRefName: 'main',
        headRefName: 'feature/my-feature',
      })
    )
  })
})

describe('PrDialog — creation errors', () => {
  it('shows the error GitHub returned', async () => {
    const user = userEvent.setup()
    mockShellExec
      .mockResolvedValueOnce(execResult(0, '3', ''))
      .mockResolvedValueOnce(execResult(0, '', ''))
    mockInvoke.mockResolvedValueOnce({ error: 'gh error' })

    render(<PrDialog {...defaultProps} />)
    await user.click(await createButton())
    expect((await screen.findByText('gh error')).textContent).toBe('gh error')
  })

  it('refuses to open a PR with no commits ahead of the base', async () => {
    const user = userEvent.setup()
    mockShellExec.mockResolvedValue(execResult(0, '0', ''))
    render(<PrDialog {...defaultProps} />)
    await user.click(await createButton())
    expect((await screen.findByText(/No commits ahead/)).textContent).toBe(
      'No commits ahead of "main". Commit your changes before opening a PR.'
    )
  })

  it('shows what git printed when the push fails', async () => {
    const user = userEvent.setup()
    mockShellExec
      .mockResolvedValueOnce(execResult(0, '2', ''))
      .mockResolvedValueOnce(execResult(1, '', 'push failed'))

    render(<PrDialog {...defaultProps} />)
    await user.click(await createButton())
    expect((await screen.findByText('push failed')).textContent).toBe('push failed')
  })
})
