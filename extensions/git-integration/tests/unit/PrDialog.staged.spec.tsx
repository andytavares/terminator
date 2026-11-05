import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PrDialog } from '../../src/components/PrDialog'
import { githubAPI } from '../../src/api/github'
import { gitAPI } from '../../src/api/git'
import { reviewAgentAPI } from '../../src/api/review-agent'

const mockExec = vi.fn()
const onCreated = vi.fn()

const DRAFT = {
  branch: 'add-login',
  commitMessage: 'Add login form',
  title: 'Add login',
  body: 'Adds a login form.',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockExec.mockResolvedValue({ exitCode: 0, stdout: '1\n', stderr: '' })
  Object.assign(globalThis, {
    electronAPI: {
      shell: { exec: mockExec, openExternal: vi.fn().mockResolvedValue({ ok: true }) },
      git: { listBranches: vi.fn().mockResolvedValue({ branches: [] }) },
      fs: { readFile: vi.fn().mockResolvedValue({ content: '' }) },
      usage: { record: vi.fn() },
    },
  })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'electronAPI')
})

function open(branch: string, hasStagedChanges: boolean) {
  render(
    <PrDialog
      repoRoot="/repo"
      branch={branch}
      hasStagedChanges={hasStagedChanges}
      existingPr={null}
      onClose={vi.fn()}
      onCreated={onCreated}
    />
  )
}

const valueOf = (placeholder: string) =>
  (screen.getByPlaceholderText(placeholder) as HTMLInputElement).value

describe('PrDialog with staged changes — the draft', () => {
  it('fills commit message, title and description from the draft and says who drafted them', async () => {
    vi.spyOn(reviewAgentAPI, 'draftChange').mockResolvedValue({ draft: DRAFT })
    open('feature/x', true)

    expect(screen.getByText('Commit and open a pull request')).toBeTruthy()
    expect(screen.getByText(/Drafting from the staged diff/)).toBeTruthy()
    await waitFor(() => expect(valueOf('Commit message')).toBe('Add login form'))
    expect(valueOf('Pull request title')).toBe('Add login')
    expect(
      (screen.getByPlaceholderText(/Describe your changes/) as HTMLTextAreaElement).value
    ).toBe('Adds a login form.')
    expect(screen.getByText(/Drafted by Claude from the staged diff/)).toBeTruthy()
    expect(screen.queryByPlaceholderText('branch-name')).toBeNull()
  })

  it('offers a new branch, not the default-branch warning, on the default branch', async () => {
    vi.spyOn(reviewAgentAPI, 'draftChange').mockResolvedValue({ draft: DRAFT })
    open('main', true)

    await waitFor(() => expect(valueOf('branch-name')).toBe('add-login'))
    expect(screen.queryByText(/creating a PR from the default branch/)).toBeNull()
  })

  it('opens empty with the plain reason when drafting fails', async () => {
    vi.spyOn(reviewAgentAPI, 'draftChange').mockResolvedValue({
      error: 'The agent is not signed in.',
    })
    open('feature/x', true)

    expect(await screen.findByText('The agent is not signed in.')).toBeTruthy()
    expect(valueOf('Pull request title')).toBe('')
    expect(valueOf('Commit message')).toBe('')
  })
})

describe('PrDialog with staged changes — the submit', () => {
  it('creates the branch, commits, pushes, then opens the PR', async () => {
    vi.spyOn(reviewAgentAPI, 'draftChange').mockResolvedValue({ draft: DRAFT })
    const commit = vi.spyOn(gitAPI, 'commit').mockResolvedValue({ commitHash: 'abc' })
    const prCreate = vi
      .spyOn(githubAPI, 'prCreate')
      .mockResolvedValue({ number: 7, url: 'https://github.com/o/r/pull/7' })
    open('main', true)
    await waitFor(() => expect(valueOf('Commit message')).toBe('Add login form'))

    fireEvent.click(screen.getByRole('button', { name: 'Commit, push and create PR' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    const gitArgs = mockExec.mock.calls.map(([call]) => call.args.join(' '))
    expect(gitArgs[0]).toBe('checkout -b add-login')
    expect(gitArgs).toContain('push --set-upstream origin HEAD')
    expect(commit).toHaveBeenCalledWith({ repoRoot: '/repo', message: 'Add login form' })
    expect(prCreate).toHaveBeenCalledWith(
      expect.objectContaining({ head: 'add-login', title: 'Add login', base: 'main' })
    )
  })

  it('stops with the commit error and opens no PR when the commit fails', async () => {
    vi.spyOn(reviewAgentAPI, 'draftChange').mockResolvedValue({ draft: DRAFT })
    vi.spyOn(gitAPI, 'commit').mockResolvedValue({ error: 'HOOK_FAILED' })
    const prCreate = vi.spyOn(githubAPI, 'prCreate')
    open('feature/x', true)
    await waitFor(() => expect(valueOf('Commit message')).toBe('Add login form'))

    fireEvent.click(screen.getByRole('button', { name: 'Commit, push and create PR' }))

    expect(await screen.findByText('Pre-commit hooks failed.')).toBeTruthy()
    expect(prCreate).not.toHaveBeenCalled()
  })
})

describe('PrDialog without staged changes', () => {
  it('stays the plain dialog and never asks for a draft', () => {
    const draft = vi.spyOn(reviewAgentAPI, 'draftChange')
    open('main', false)

    expect(screen.getByText('Open Pull Request')).toBeTruthy()
    expect(screen.getByText(/creating a PR from the default branch/)).toBeTruthy()
    expect(screen.queryByPlaceholderText('Commit message')).toBeNull()
    expect(draft).not.toHaveBeenCalled()
  })
})
