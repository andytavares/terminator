import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LinkIssueDialog } from '../../../../src/renderer/components/integrations/LinkIssueDialog'
import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'
import { issueSummaryOf, trackerConnectionOf } from '../../../support/renderer-stores'
import { installElectronApi } from '../../../support/electron-api'
import type { IssueLink } from '../../../../src/shared/types/index'

const P = '11111111-1111-4111-8111-111111111111'

const listMine = vi.fn()
const searchIssues = vi.fn()
const linkIssue = vi.fn()
const loadConnections = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  listMine.mockResolvedValue({ issues: [issueSummaryOf()], failures: [] })
  searchIssues.mockResolvedValue({ issues: [], failures: [] })
  linkIssue.mockResolvedValue(true)
  loadConnections.mockResolvedValue(undefined)
  useIntegrationsStore.setState({
    ...useIntegrationsStore.getInitialState(),
    connections: [trackerConnectionOf()],
    listMine,
    searchIssues,
    linkIssue,
    loadConnections,
  })
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
    open()
    expect(await screen.findByText('Linear')).toBeTruthy()
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
      issues: [issueSummaryOf()],
      failures: [{ tracker: 'linear', error: 'auth-failed' }],
    })
    open()

    expect(await screen.findByText('TAV-42')).toBeTruthy()
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('Linear')
    expect(status.textContent).toContain('credential rejected')
  })

  it('names an unconnected tracker without hiding the other one', async () => {
    listMine.mockResolvedValue({
      issues: [issueSummaryOf()],
      failures: [{ tracker: 'linear', error: 'not-connected' }],
    })
    open()
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('not connected')
    expect(screen.getByText('TAV-42')).toBeTruthy()
  })
})

/** Fake timers that user-event can wait through: it pauses between keys on the clock. */
function typingUnderFakeTimers() {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

describe('LinkIssueDialog — searching', () => {
  it('debounces before searching', async () => {
    const user = typingUnderFakeTimers()
    open()
    await user.type(screen.getByPlaceholderText(/Search/), 'sidebar')

    expect(searchIssues).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(searchIssues).toHaveBeenCalledWith('sidebar')
  })

  it('switches the heading once searching', async () => {
    const user = typingUnderFakeTimers()
    open()
    await user.type(screen.getByPlaceholderText(/Search/), 'x')
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.getByText('Results')).toBeTruthy()
  })
})

describe('LinkIssueDialog — searching — goes back to assigned issues when the search is cleared', () => {
  it('goes back to assigned issues when the search is cleared', async () => {
    const user = typingUnderFakeTimers()
    open()
    const input = screen.getByPlaceholderText(/Search/)
    await user.type(input, 'x')
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.queryByText('Assigned to you')).toBeNull()
    await user.clear(input)
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.getByText('Assigned to you')).toBeTruthy()
  })
})

describe('LinkIssueDialog — linking', () => {
  it('cannot link until something is picked', async () => {
    open()
    await screen.findByText('TAV-42')
    expect((screen.getByText('Link issue') as HTMLButtonElement).disabled).toBe(true)
  })

  it('names the issue on the button once picked', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByText('TAV-42'))
    expect(screen.getByText('Link TAV-42')).toBeTruthy()
  })
})

describe('LinkIssueDialog — linking — the write', () => {
  it('asks main to link the picked issue, keeps the link it reads back, and closes', async () => {
    const user = userEvent.setup()
    const link: IssueLink = {
      projectId: P,
      tracker: 'linear',
      key: 'TAV-42',
      injectContext: true,
      linkedAt: '2026-11-07T09:00:00.000Z',
    }
    const linkSet = vi.fn(async () => ({ link }))
    const linkGet = vi.fn(async () => ({ link, issue: null }))
    installElectronApi({ integrations: { linkSet, linkGet } })
    useIntegrationsStore.setState({ linkIssue: useIntegrationsStore.getInitialState().linkIssue })
    const onClose = vi.fn()
    open({ onClose })
    await user.click(await screen.findByText('TAV-42'))
    await user.click(await screen.findByText('Link TAV-42'))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(linkSet).toHaveBeenCalledWith({ projectId: P, tracker: 'linear', key: 'TAV-42' })
    expect(useIntegrationsStore.getState().links.get(P)).toEqual(link)
  })
})

describe('LinkIssueDialog — linking — reports a failure and stays open rather than pretending', () => {
  it('reports a failure and stays open rather than pretending', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    linkIssue.mockResolvedValue(false)
    open({ onClose })
    await user.click(await screen.findByText('TAV-42'))
    await user.click(await screen.findByText('Link TAV-42'))

    expect((await screen.findByRole('alert')).textContent).toContain('Nothing was changed')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('warns that linking replaces the issue already attached (FR-033)', async () => {
    const user = userEvent.setup()
    open({ currentKey: 'TAV-9' })
    await user.click(await screen.findByText('TAV-42'))

    const warning = screen.getByRole('alert')
    expect(warning.textContent).toContain('TAV-9')
    expect(warning.textContent).toContain('replaces it')
  })

  it('does not warn when the picked issue is the one already attached', async () => {
    const user = userEvent.setup()
    open({ currentKey: 'TAV-42' })
    await user.click(await screen.findByText('TAV-42'))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('LinkIssueDialog — linking — does not warn for a project that has no issue yet', () => {
  it('does not warn for a project that has no issue yet', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByText('TAV-42'))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('LinkIssueDialog — not connected', () => {
  it('points at settings instead of showing an empty list', async () => {
    useIntegrationsStore.setState({ connections: [] })
    open()

    expect(await screen.findByText(/No issue tracker is connected/)).toBeTruthy()
    expect(screen.getByText(/Settings → Integrations/)).toBeTruthy()
    expect(screen.queryByPlaceholderText(/Search/)).toBeNull()
    expect(listMine).not.toHaveBeenCalled()
  })
})

describe('LinkIssueDialog — dismissal', () => {
  it('closes on Cancel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    open({ onClose })
    // Let the initial load settle first, or its state update lands after the
    // test and React warns about an unwrapped update.
    await screen.findByText('TAV-42')
    await user.click(await screen.findByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('LinkIssueDialog — shortcuts and odd failures', () => {
  it('links a row on double click, and tells the caller', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onLinked = vi.fn()
    open({ onClose, onLinked })
    const row = await screen.findByText('TAV-42')
    await user.click(row)
    await user.dblClick(row)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(linkIssue).toHaveBeenCalledWith(P, { tracker: 'linear', key: 'TAV-42' })
    expect(onLinked).toHaveBeenCalledWith(expect.objectContaining({ key: 'TAV-42' }))
  })

  it('names a failure it has no words for by its code', async () => {
    listMine.mockResolvedValue({
      issues: [issueSummaryOf()],
      failures: [{ tracker: 'linear', error: 'brand-new-error' }],
    })
    open()
    expect((await screen.findByRole('status')).textContent).toBe('Linear brand-new-error')
  })
})
