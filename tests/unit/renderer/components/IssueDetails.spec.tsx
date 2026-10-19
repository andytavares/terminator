import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IssueDetails } from '../../../../src/renderer/components/integrations/IssueDetails'
import { useStartWorkStore } from '../../../../src/renderer/components/home/start-work'
import type { Issue } from '../../../../src/shared/types/index'

const api = {
  getIssue: vi.fn(),
}
const openExternal = vi.fn()
const openLauncher = vi.fn()

function issue(over: Partial<Issue> = {}): Issue {
  return {
    tracker: 'linear',
    id: 'id-1',
    key: 'TAV-42',
    title: 'Unify Linear connections behind one core service',
    url: 'https://linear.app/tav/issue/TAV-42',
    state: { name: 'In Progress', type: 'started' },
    assignee: { name: 'Andrew', email: 'a@b.co' },
    description: '## Summary\n\nReached from **three** places.',
    labels: ['Improvement'],
    branchName: 'tav-42-unify-linear-connections',
    completed: false,
    updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    comments: [{ author: 'andrew', body: 'Fold it into P0.', createdAt: new Date().toISOString() }],
    ...over,
  }
}

async function setupAndSettle(over: Partial<Issue> = {}) {
  api.getIssue.mockResolvedValue({ issue: issue(over) })
  const onClose = vi.fn()
  render(<IssueDetails tracker="linear" issueKey="TAV-42" onClose={onClose} />)
  await screen.findByText(/Unify Linear connections/)
  return onClose
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getIssue.mockResolvedValue({ issue: issue() })
  useStartWorkStore.setState({ open: false, prefill: '', openLauncher })
  Object.defineProperty(window, 'electronAPI', {
    value: { integrations: api, shell: { openExternal } },
    writable: true,
    configurable: true,
  })
})

describe('IssueDetails — the issue', () => {
  it('fetches by tracker and key, and shows key, title, assignee, description and comments', async () => {
    await setupAndSettle()
    expect(api.getIssue).toHaveBeenCalledWith({ tracker: 'linear', key: 'TAV-42' })
    expect(screen.getByText(/TAV-42 · Linear/)).toBeTruthy()
    expect(screen.getByText(/Unify Linear connections/)).toBeTruthy()
    expect(screen.getByText('Andrew')).toBeTruthy()
    expect(screen.getByText('In Progress')).toBeTruthy()
    expect(document.querySelector('.issue-markdown h2')?.textContent).toBe('Summary')
    expect(screen.getByText('Fold it into P0.')).toBeTruthy()
  })

  it('shows the branch the tracker suggests', async () => {
    await setupAndSettle()
    expect(screen.getByText(/tav-42-unify-linear-connections/)).toBeTruthy()
  })

  it('says Unassigned when no one holds it', async () => {
    await setupAndSettle({ assignee: null })
    expect(screen.getByText(/Unassigned/)).toBeTruthy()
  })

  it('shows a loading line until the issue arrives', () => {
    api.getIssue.mockReturnValue(new Promise(() => {}))
    render(<IssueDetails tracker="linear" issueKey="TAV-42" onClose={vi.fn()} />)
    expect(screen.getByText('Loading TAV-42…')).toBeTruthy()
  })
})

describe('IssueDetails — actions', () => {
  it('opens the issue in its tracker', async () => {
    await setupAndSettle()
    fireEvent.click(screen.getByText(/Open in Linear/))
    expect(openExternal).toHaveBeenCalledWith('https://linear.app/tav/issue/TAV-42')
  })

  it('refresh bypasses the cache', async () => {
    await setupAndSettle()
    fireEvent.click(screen.getByText('Refresh'))
    await waitFor(() =>
      expect(api.getIssue).toHaveBeenCalledWith({
        tracker: 'linear',
        key: 'TAV-42',
        refresh: true,
      })
    )
  })

  it('start work opens the launcher with the key and closes', async () => {
    const onClose = await setupAndSettle()
    fireEvent.click(screen.getByText('Start work'))
    expect(openLauncher).toHaveBeenCalledWith('TAV-42')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('IssueDetails — failure', () => {
  it('shows the error text when the read fails', async () => {
    api.getIssue.mockResolvedValue({ error: 'not-connected' })
    render(<IssueDetails tracker="linear" issueKey="TAV-42" onClose={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('not connected')
  })
})
