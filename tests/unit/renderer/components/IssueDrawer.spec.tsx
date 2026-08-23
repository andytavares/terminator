import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IssueDrawer } from '../../../../src/renderer/components/integrations/IssueDrawer'
import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'
import type { Issue, IssueLink } from '../../../../src/shared/types/index'

const P = '11111111-1111-4111-8111-111111111111'

const api = {
  contextPreview: vi.fn(),
  getIssue: vi.fn(),
  comment: vi.fn(),
  setInjectContext: vi.fn(),
}
const openExternal = vi.fn()
const loadLink = vi.fn()
const unlinkIssue = vi.fn()

function link(over: Partial<IssueLink> = {}): IssueLink {
  return {
    projectId: P,
    tracker: 'linear',
    key: 'TAV-42',
    injectContext: true,
    linkedAt: '2026-08-22T00:00:00.000Z',
    ...over,
  }
}

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
    branchName: null,
    completed: false,
    updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    comments: [{ author: 'andrew', body: 'Fold it into P0.', createdAt: new Date().toISOString() }],
    ...over,
  }
}

/** Renders and lets the context preview settle, so no state update escapes the test. */
async function setupSettled(over: { link?: IssueLink | null; issue?: Issue | null } = {}) {
  const view = setup(over)
  await waitFor(() => expect(api.contextPreview).toHaveBeenCalled())
  return view
}

function setup(over: { link?: IssueLink | null; issue?: Issue | null } = {}) {
  useIntegrationsStore.setState({
    links: new Map([[P, over.link === undefined ? link() : over.link]]),
    issues: new Map([[P, over.issue === undefined ? issue() : over.issue]]),
    loadLink,
    unlinkIssue,
  } as never)
  return render(<IssueDrawer projectId={P} projectName="terminator" onClose={vi.fn()} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.contextPreview.mockResolvedValue({
    context: { markdown: '# Linked issue: TAV-42\nBody', chars: 2143, truncated: false },
  })
  api.getIssue.mockResolvedValue({ issue: issue() })
  api.comment.mockResolvedValue({ ok: true })
  api.setInjectContext.mockResolvedValue({ ok: true })
  Object.defineProperty(window, 'electronAPI', {
    value: { integrations: api, shell: { openExternal } },
    writable: true,
    configurable: true,
  })
})

describe('IssueDrawer — the issue', () => {
  it('shows key, state, title, assignee and labels', async () => {
    await setupSettled()
    expect(screen.getByText('TAV-42')).toBeTruthy()
    expect(screen.getByText('In Progress')).toBeTruthy()
    expect(screen.getByText(/Unify Linear connections/)).toBeTruthy()
    expect(screen.getByText('Andrew')).toBeTruthy()
    expect(screen.getByText('Improvement')).toBeTruthy()
  })

  it('renders the description as markdown, not as markup', async () => {
    const { container } = await setupSettled()
    // Scoped to the rendered body: the drawer's own title is also an h2.
    const body = container.querySelector('.issue-markdown') as Element
    expect(body.querySelector('h2')?.textContent).toBe('Summary')
    expect(body.querySelector('strong')?.textContent).toBe('three')
    expect(container.textContent).not.toContain('##')
  })

  it('renders comment bodies as markdown too', async () => {
    await setupSettled({
      issue: issue({
        comments: [
          { author: 'andrew', body: '`npm test` first', createdAt: new Date().toISOString() },
        ],
      }),
    })
    expect(document.querySelector('.issue-drawer__comment code')?.textContent).toBe('npm test')
  })

  it('says so when there is no description', async () => {
    await setupSettled({ issue: issue({ description: '' }) })
    expect(screen.getByText('No description.')).toBeTruthy()
  })

  it('omits the comments section when there are none', async () => {
    await setupSettled({ issue: issue({ comments: [] }) })
    expect(screen.queryByText('Comments')).toBeNull()
  })

  it('keeps the link visible when the issue could not be read', async () => {
    await setupSettled({ issue: null })
    expect(screen.getByText('TAV-42')).toBeTruthy()
    expect(screen.getByText(/could not be read/)).toBeTruthy()
    expect(screen.getByText(/still\s+attached/)).toBeTruthy()
  })

  it('renders nothing for a project with no link', async () => {
    const { container } = await setupSettled({ link: null })
    expect(container.querySelector('.issue-drawer')).toBeNull()
  })
})

describe('IssueDrawer — actions', () => {
  it('opens the issue in its tracker', async () => {
    await setupSettled()
    fireEvent.click(screen.getByTitle('Open in Linear'))
    expect(openExternal).toHaveBeenCalledWith('https://linear.app/tav/issue/TAV-42')
  })

  it('refresh bypasses the cache', async () => {
    await setupSettled()
    fireEvent.click(screen.getByTitle('Refresh'))
    await waitFor(() =>
      expect(api.getIssue).toHaveBeenCalledWith({
        tracker: 'linear',
        key: 'TAV-42',
        refresh: true,
      })
    )
    await waitFor(() => expect(loadLink).toHaveBeenCalledWith(P))
  })

  it('posts a comment and clears the box', async () => {
    await setupSettled()
    const box = screen.getByPlaceholderText(/Add a comment/)
    fireEvent.change(box, { target: { value: 'Verified against v3.' } })
    fireEvent.click(screen.getByText('Post comment'))

    await waitFor(() =>
      expect(api.comment).toHaveBeenCalledWith({
        tracker: 'linear',
        key: 'TAV-42',
        body: 'Verified against v3.',
      })
    )
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(''))
  })

  it('will not post an empty comment', async () => {
    await setupSettled()
    expect((screen.getByText('Post comment') as HTMLButtonElement).disabled).toBe(true)
  })

  it('reports a failed comment and keeps what was typed (FR-034a)', async () => {
    api.comment.mockResolvedValue({ error: 'auth-failed', message: 'no permission' })
    await setupSettled()
    const box = screen.getByPlaceholderText(/Add a comment/)
    fireEvent.change(box, { target: { value: 'important note' } })
    fireEvent.click(screen.getByText('Post comment'))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('no permission'))
    // Losing what someone just typed because a token expired is the worst
    // possible response to a failed write.
    expect((box as HTMLTextAreaElement).value).toBe('important note')
  })

  it('unlinks and closes', async () => {
    const onClose = vi.fn()
    useIntegrationsStore.setState({
      links: new Map([[P, link()]]),
      issues: new Map([[P, issue()]]),
      loadLink,
      unlinkIssue,
    } as never)
    render(<IssueDrawer projectId={P} projectName="terminator" onClose={onClose} />)
    await waitFor(() => expect(api.contextPreview).toHaveBeenCalled())

    fireEvent.click(screen.getByText('Unlink TAV-42'))
    expect(unlinkIssue).toHaveBeenCalledWith(P)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('IssueDrawer — agent context (FR-023)', () => {
  it('shows the exact text a session would receive', async () => {
    setup()
    expect(await screen.findByText(/# Linked issue: TAV-42/)).toBeTruthy()
  })

  it('shows the size against the runtime cap', async () => {
    setup()
    expect(await screen.findByText('2,143 / 10,000')).toBeTruthy()
  })

  it('warns before the cap, not at it (FR-022)', async () => {
    api.contextPreview.mockResolvedValue({
      context: { markdown: 'x', chars: 9_000, truncated: false },
    })
    setup()
    await waitFor(() => expect(document.querySelector('.issue-drawer__counter--warn')).toBeTruthy())
  })

  it('does not warn while there is room', async () => {
    setup()
    await screen.findByText('2,143 / 10,000')
    expect(document.querySelector('.issue-drawer__counter--warn')).toBeNull()
  })

  it('says when the context was shortened', async () => {
    api.contextPreview.mockResolvedValue({
      context: { markdown: 'x', chars: 9_900, truncated: true },
    })
    setup()
    expect(await screen.findByText(/Shortened to fit/)).toBeTruthy()
  })

  it('says plainly when nothing is fed', async () => {
    api.contextPreview.mockResolvedValue({ context: null })
    setup()
    expect(await screen.findByText(/Nothing is fed to agent sessions/)).toBeTruthy()
  })

  it('survives a preview that fails', async () => {
    api.contextPreview.mockResolvedValue({ error: 'failed', message: 'nope' })
    setup()
    await waitFor(() => expect(screen.getByText('TAV-42')).toBeTruthy())
  })

  it('toggles injection for the project', async () => {
    await setupSettled()
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() =>
      expect(api.setInjectContext).toHaveBeenCalledWith({ projectId: P, injectContext: false })
    )
  })

  it('reports a failed toggle rather than lying about the state', async () => {
    api.setInjectContext.mockResolvedValue({ error: 'failed', message: 'read-only' })
    await setupSettled()
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('read-only'))
  })

  it('reflects injection being off', async () => {
    await setupSettled({ link: link({ injectContext: false }) })
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  })
})
