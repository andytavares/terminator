import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { LinkIssueDialog } from '../../../../src/renderer/components/integrations/LinkIssueDialog'
import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'
import type { IssueSummary, TrackerConnection } from '../../../../src/shared/types/index'

vi.mock('../../../../src/renderer/stores/modal.store', () => ({ useModalEffect: () => {} }))

const P = '11111111-1111-4111-8111-111111111111'

function summary(over: Partial<IssueSummary> = {}): IssueSummary {
  return {
    tracker: 'linear',
    id: 'id-1',
    key: 'TAV-42',
    title: 'Unify Linear connections',
    url: 'https://linear.app/tav/issue/TAV-42',
    state: { name: 'In Progress', type: 'started' },
    assignee: null,
    branchName: null,
    ...over,
  }
}

function connected(): TrackerConnection {
  return {
    tracker: 'linear',
    connected: true,
    account: { name: 'A', email: 'a@b.co' },
    site: null,
    mine: { kind: 'assignee', email: null },
    lastError: null,
  }
}

const listMine = vi.fn()
const searchIssues = vi.fn()
const linkIssue = vi.fn()
const loadConnections = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  listMine.mockResolvedValue({ issues: [summary()], failures: [] })
  searchIssues.mockResolvedValue({ issues: [], failures: [] })
  linkIssue.mockResolvedValue(true)
  loadConnections.mockResolvedValue(undefined)
  useIntegrationsStore.setState({
    connections: [connected()],
    links: new Map(),
    issues: new Map(),
    listMine,
    searchIssues,
    linkIssue,
    loadConnections,
  } as never)
})

afterEach(() => vi.useRealTimers())

function open(props: Partial<React.ComponentProps<typeof LinkIssueDialog>> = {}) {
  return render(
    <LinkIssueDialog projectId={P} projectName="terminator" onClose={vi.fn()} {...props} />
  )
}

describe('LinkIssueDialog — opening', () => {
  it('lists assigned issues immediately, with no search typed', async () => {
    open()
    await waitFor(() => expect(listMine).toHaveBeenCalled())
    expect(await screen.findByText('TAV-42')).toBeTruthy()
    expect(screen.getByText('Assigned to you')).toBeTruthy()
    expect(searchIssues).not.toHaveBeenCalled()
  })

  it('shows which tracker each issue came from', async () => {
    listMine.mockResolvedValue({
      issues: [summary(), summary({ tracker: 'jira', key: 'TAV-7', id: 'id-2' })],
      failures: [],
    })
    open()
    await waitFor(() => expect(screen.getByText('Jira')).toBeTruthy())
    expect(screen.getByText('Linear')).toBeTruthy()
  })

  it('shows each issue state by name', async () => {
    open()
    expect(await screen.findByText('In Progress')).toBeTruthy()
  })

  it('says so when there is nothing assigned', async () => {
    listMine.mockResolvedValue({ issues: [], failures: [] })
    open()
    expect(await screen.findByText('No issues found.')).toBeTruthy()
  })
})

describe('LinkIssueDialog — partial failures', () => {
  it('shows what arrived and names the tracker that did not', async () => {
    listMine.mockResolvedValue({
      issues: [summary()],
      failures: [{ tracker: 'jira', error: 'auth-failed' }],
    })
    open()

    expect(await screen.findByText('TAV-42')).toBeTruthy()
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('Jira')
    expect(status.textContent).toContain('credential rejected')
  })

  it('names an unconnected tracker without hiding the other one', async () => {
    listMine.mockResolvedValue({
      issues: [summary()],
      failures: [{ tracker: 'jira', error: 'not-connected' }],
    })
    open()
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('not connected')
    expect(screen.getByText('TAV-42')).toBeTruthy()
  })
})

describe('LinkIssueDialog — searching', () => {
  it('debounces before searching', async () => {
    vi.useFakeTimers()
    open()
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'sidebar' } })

    expect(searchIssues).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(searchIssues).toHaveBeenCalledWith('sidebar')
  })

  it('switches the heading once searching', async () => {
    vi.useFakeTimers()
    open()
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'x' } })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.getByText('Results')).toBeTruthy()
  })

  it('goes back to assigned issues when the search is cleared', async () => {
    vi.useFakeTimers()
    open()
    const input = screen.getByPlaceholderText(/Search/)
    fireEvent.change(input, { target: { value: 'x' } })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    listMine.mockClear()
    fireEvent.change(input, { target: { value: '' } })
    await act(async () => {
      await Promise.resolve()
    })
    expect(listMine).toHaveBeenCalled()
  })
})

describe('LinkIssueDialog — linking', () => {
  it('cannot link until something is picked', async () => {
    open()
    await screen.findByText('TAV-42')
    expect((screen.getByText('Link issue') as HTMLButtonElement).disabled).toBe(true)
  })

  it('names the issue on the button once picked', async () => {
    open()
    fireEvent.click(await screen.findByText('TAV-42'))
    expect(screen.getByText('Link TAV-42')).toBeTruthy()
  })

  it('links the picked issue and closes', async () => {
    const onClose = vi.fn()
    open({ onClose })
    fireEvent.click(await screen.findByText('TAV-42'))
    fireEvent.click(screen.getByText('Link TAV-42'))

    await waitFor(() => expect(linkIssue).toHaveBeenCalledWith(P, 'linear', 'TAV-42'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('reports a failure and stays open rather than pretending', async () => {
    const onClose = vi.fn()
    linkIssue.mockResolvedValue(false)
    open({ onClose })
    fireEvent.click(await screen.findByText('TAV-42'))
    fireEvent.click(screen.getByText('Link TAV-42'))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Nothing was changed')
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('warns that linking replaces the issue already attached (FR-033)', async () => {
    open({ currentKey: 'TAV-9' })
    fireEvent.click(await screen.findByText('TAV-42'))

    const warning = screen.getByRole('alert')
    expect(warning.textContent).toContain('TAV-9')
    expect(warning.textContent).toContain('replaces it')
  })

  it('does not warn when the picked issue is the one already attached', async () => {
    open({ currentKey: 'TAV-42' })
    fireEvent.click(await screen.findByText('TAV-42'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not warn for a project that has no issue yet', async () => {
    open()
    fireEvent.click(await screen.findByText('TAV-42'))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('LinkIssueDialog — not connected', () => {
  it('points at settings instead of showing an empty list', async () => {
    useIntegrationsStore.setState({ connections: [] } as never)
    open()

    expect(await screen.findByText(/No issue tracker is connected/)).toBeTruthy()
    expect(screen.getByText(/Settings → Integrations/)).toBeTruthy()
    expect(screen.queryByPlaceholderText(/Search/)).toBeNull()
    expect(listMine).not.toHaveBeenCalled()
  })
})

describe('LinkIssueDialog — dismissal', () => {
  it('closes on Cancel', async () => {
    const onClose = vi.fn()
    open({ onClose })
    // Let the initial load settle first, or its state update lands after the
    // test and React warns about an unwrapped update.
    await screen.findByText('TAV-42')
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes when the backdrop is clicked but not the dialog itself', async () => {
    const onClose = vi.fn()
    const { container } = open({ onClose })
    await screen.findByText('TAV-42')

    fireEvent.click(container.querySelector('.dialog') as Element)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(container.querySelector('.dialog-overlay') as Element)
    expect(onClose).toHaveBeenCalled()
  })
})
