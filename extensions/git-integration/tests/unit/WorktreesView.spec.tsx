import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { WorktreesView } from '../../src/components/worktrees/WorktreesView'
import type { LocalInventoryRow } from '../../src/git/local-inventory'

const mockInvoke = vi.fn()
const mockListSessions = vi.fn()

function inventoryRow(overrides: Partial<LocalInventoryRow>): LocalInventoryRow {
  return {
    branch: null,
    worktreePath: null,
    isMain: false,
    isCurrent: false,
    lastCommitAt: 1700000000000,
    createdAt: 1699990000000,
    modifiedAt: 1699995000000,
    merged: false,
    upstream: null,
    upstreamGone: false,
    ahead: 0,
    behind: 0,
    prunable: false,
    isAgent: false,
    project: null,
    ...overrides,
  }
}

const MAIN = inventoryRow({ branch: 'main', worktreePath: '/repo', isMain: true, isCurrent: true })
const MERGED = inventoryRow({
  branch: 'feature-merged',
  merged: true,
  upstream: 'origin/feature-merged',
})
const GONE = inventoryRow({
  branch: 'feature-gone',
  upstream: 'origin/feature-gone',
  upstreamGone: true,
})
const AGENT = inventoryRow({
  branch: 'worktree-agent-x',
  worktreePath: '/repo/.claude/worktrees/agent-x',
  isAgent: true,
  project: { id: 'p1', name: 'Agent X' },
})
const OPEN = inventoryRow({
  branch: 'feature-open',
  worktreePath: '/repo/.worktrees/open',
  project: { id: 'p2', name: 'Open' },
})
const BEHIND = inventoryRow({
  branch: 'feature-behind',
  upstream: 'origin/feature-behind',
  behind: 4,
  merged: true,
})
const DETACHED = inventoryRow({ worktreePath: '/repo/.worktrees/detached' })

function inventory(rows: LocalInventoryRow[], sessions: unknown[] = []) {
  mockInvoke.mockImplementation((channel: string) => {
    if (channel === 'git:local-inventory') return Promise.resolve({ rows })
    if (channel === 'git:remove-local') return Promise.resolve({ results: [] })
    return Promise.resolve({})
  })
  mockListSessions.mockResolvedValue(sessions)
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'electronAPI', {
    value: {
      extensionBridge: { invoke: mockInvoke, on: () => () => {} },
      terminal: { listSessions: mockListSessions },
    },
    configurable: true,
    writable: true,
  })
})

async function renderWorktrees() {
  render(<WorktreesView repoRoot="/repo" />)
  await screen.findByRole('button', { name: 'Remove selected · 0' })
  await waitFor(() =>
    expect(mockInvoke.mock.calls.some(([c]) => c === 'git:local-inventory')).toBe(true)
  )
}

describe('WorktreesView — the header', () => {
  it('renders the header columns and a row per branch and worktree', async () => {
    inventory([MAIN, MERGED, DETACHED])
    await renderWorktrees()
    for (const column of [
      'BRANCH',
      'WORKTREE',
      'SESSION',
      'CREATED',
      'MODIFIED',
      'LAST COMMIT',
      'STATE',
    ])
      expect(screen.getByText(column)).toBeDefined()
    expect(screen.getByText('feature-merged')).toBeDefined()
    expect(screen.getByText('/repo/.worktrees/detached'.replace('/repo/', ''))).toBeDefined()
  })
})

describe('WorktreesView — cells and flags', () => {
  it('names the main checkout, and "no worktree" for a branch without one', async () => {
    inventory([MAIN, MERGED])
    await renderWorktrees()
    expect(screen.getByText('(main checkout)')).toBeDefined()
    expect(screen.getByText('no worktree')).toBeDefined()
  })

  it('shows the flags as chips', async () => {
    inventory([MAIN, MERGED, GONE, AGENT, BEHIND])
    await renderWorktrees()
    expect(screen.getByText('locked · main')).toBeDefined()
    expect(screen.getByText('current')).toBeDefined()
    expect(screen.getAllByText('merged').length).toBeGreaterThan(0)
    expect(screen.getByText('upstream gone')).toBeDefined()
    expect(screen.getByText('agent')).toBeDefined()
    expect(screen.getByText('Terminator branch')).toBeDefined()
    expect(screen.getByText('4 behind')).toBeDefined()
    expect(screen.getAllByText('not merged').length).toBeGreaterThan(0)
    expect(screen.getByText('no upstream')).toBeDefined()
  })
})

describe('WorktreesView — sessions', () => {
  it('shows the session’s tab title and type for a project with an open session', async () => {
    inventory(
      [MAIN, OPEN],
      [{ sessionId: 's1', projectId: 'p2', tabTitle: 'Fix the thing', type: 'agent' }]
    )
    await renderWorktrees()
    expect(screen.getByText('Fix the thing')).toBeDefined()
    expect(screen.getByText('agent')).toBeDefined()
    expect(screen.getByText('open session')).toBeDefined()
  })
})

describe('WorktreesView — locked rows', () => {
  it('locks the main, current and open-session rows', async () => {
    inventory(
      [MAIN, OPEN, MERGED],
      [{ sessionId: 's1', projectId: 'p2', tabTitle: 'T', type: 'terminal' }]
    )
    await renderWorktrees()
    const checkbox = (name: string) => screen.getByRole('checkbox', { name: `Select ${name}` })
    expect(checkbox('main').getAttribute('aria-disabled')).toBe('true')
    expect(checkbox('feature-open').getAttribute('aria-disabled')).toBe('true')
    expect(checkbox('feature-merged').getAttribute('aria-disabled')).toBe('false')
  })
})

describe('WorktreesView — selection', () => {
  it('Select stale checks the merged, gone and prunable rows that are not locked', async () => {
    const prunable = inventoryRow({ branch: 'feature-old', prunable: true })
    inventory(
      [MAIN, MERGED, GONE, prunable, OPEN],
      [{ sessionId: 's1', projectId: 'p2', tabTitle: 'T', type: 'agent' }]
    )
    await renderWorktrees()
    fireEvent.click(screen.getByRole('button', { name: 'Select stale' }))
    const isChecked = (name: string) =>
      screen.getByRole('checkbox', { name: `Select ${name}` }).getAttribute('aria-checked')
    expect(isChecked('feature-merged')).toBe('true')
    expect(isChecked('feature-gone')).toBe('true')
    expect(isChecked('feature-old')).toBe('true')
    expect(isChecked('main')).toBe('false')
    expect(isChecked('feature-open')).toBe('false')
    expect(screen.getByRole('button', { name: 'Remove selected · 3' })).toBeDefined()
  })

  it('Remove selected is disabled while nothing is checked', async () => {
    inventory([MAIN, MERGED])
    await renderWorktrees()
    const button = screen.getByRole('button', { name: 'Remove selected · 0' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })
})

describe('WorktreesView — the removal dialog', () => {
  it('lists the commands it will run, -D for an unmerged branch', async () => {
    inventory([MAIN, MERGED, GONE])
    await renderWorktrees()
    fireEvent.click(screen.getByRole('button', { name: 'Select stale' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected · 2' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Remove 2 worktrees and branches?')).toBeDefined()
    expect(
      within(dialog).getByText('This deletes the folders and local branches. Remote branches stay.')
    ).toBeDefined()
    const commands = within(dialog).getByTestId('remove-commands').textContent
    expect(commands).toContain('git branch -d feature-merged')
    expect(commands).toContain('git branch -D feature-gone  # not merged')
    expect(commands).toContain('git worktree prune')
  })
})

/** Answers the inventory with main and one merged branch, and `result` to git:remove-local. */
function stubRemoval(result: { ok: boolean; reason?: string }): void {
  mockInvoke.mockImplementation((channel: string) => {
    if (channel === 'git:local-inventory') return Promise.resolve({ rows: [MAIN, MERGED] })
    if (channel === 'git:remove-local') {
      return Promise.resolve({
        results: [{ branch: 'feature-merged', worktreePath: null, ...result }],
      })
    }
    return Promise.resolve({})
  })
  mockListSessions.mockResolvedValue([])
}

describe('WorktreesView — confirming a removal', () => {
  it('confirms with the danger button and calls git:remove-local', async () => {
    stubRemoval({ ok: true })
    await renderWorktrees()
    fireEvent.click(screen.getByRole('button', { name: 'Select stale' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected · 1' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove 1' }))
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('git:remove-local', {
        repoRoot: '/repo',
        items: [
          {
            branch: 'feature-merged',
            worktreePath: null,
            forceBranch: false,
          },
        ],
      })
    )
  })
})

describe('WorktreesView — confirming twice', () => {
  it('disables the confirm button while the removal is running', async () => {
    stubRemoval({ ok: true })
    mockInvoke.mockImplementation((channel: string) =>
      channel === 'git:remove-local'
        ? new Promise(() => {})
        : Promise.resolve({ rows: [MAIN, MERGED] })
    )
    await renderWorktrees()
    fireEvent.click(screen.getByRole('button', { name: 'Select stale' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected · 1' }))
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Remove 1',
    })
    fireEvent.click(confirm)
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(true))
    fireEvent.click(confirm)
    expect(mockInvoke.mock.calls.filter(([c]) => c === 'git:remove-local')).toHaveLength(1)
  })
})

describe('WorktreesView — a failed removal', () => {
  it('shows a failed item’s reason in its row and keeps the row', async () => {
    stubRemoval({ ok: false, reason: 'branch is checked out' })
    await renderWorktrees()
    fireEvent.click(screen.getByRole('button', { name: 'Select stale' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected · 1' }))
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove 1' })
    )
    expect(await screen.findByText('branch is checked out')).toBeDefined()
    expect(screen.getByText('feature-merged')).toBeDefined()
  })
})

describe('WorktreesView — empty and refresh', () => {
  it('says so when only main is left', async () => {
    inventory([MAIN])
    await renderWorktrees()
    expect(screen.getByText('No other branches or worktrees')).toBeDefined()
  })

  it('reloads from the refresh button', async () => {
    inventory([MAIN, MERGED])
    await renderWorktrees()
    const callsBefore = mockInvoke.mock.calls.filter(([c]) => c === 'git:local-inventory').length
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() =>
      expect(mockInvoke.mock.calls.filter(([c]) => c === 'git:local-inventory').length).toBe(
        callsBefore + 1
      )
    )
  })
})
