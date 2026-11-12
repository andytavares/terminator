import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InboxList } from '../../../../../src/components/sidebar/InboxSidebar'
import { useWorkMarks } from '../../../../../src/home/work-marks'
import { useExtensionRegistry } from '../../../../../src/extensions/registry'
import { useDraggedThread } from '../../../../../src/components/home/thread-drag'
import { SESSION_DRAG_TYPE } from '../../../../../src/components/agent/session-drag'
import { useInboxFilter } from '../../../../../src/components/sidebar/inbox'
import { useToastStore } from '../../../../../src/stores/toast.store'
import { useSessionStore } from '../../../../../src/stores/session.store'
import { useWorkspaceStore } from '../../../../../src/stores/workspace.store'
import { untilLabel } from '../../../../../src/components/home/desk-actions'
import { terminalSessionOf } from '../../../../../../test-support/src/renderer-stores'
import { installElectronApi } from '../../../../../../test-support/src/electron-api'
import { eventually } from '../../../../../../test-support/src/eventually'
import type { WorkThread } from '../../../../../src/home/work-threads'
import type { TaskState } from '../../../../../src/home/task-state'

const revealSession = vi.hoisted(() => vi.fn())
vi.mock('../../../../../src/terminal/navigate-to-session', () => ({ revealSession }))
vi.mock('../../../../../src/usage/record', () => ({ recordUse: vi.fn() }))
const attachSessions = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../../../../src/stores/attached-context.store', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  attachSessions,
}))

const HOUR_MS = 60 * 60 * 1000
const NOW = 1_000 * HOUR_MS

interface Fixture {
  state?: TaskState
  lastActivity?: number
  startedAt?: number
  repoRoot?: string
  repoName?: string
  sessions?: Array<{ sessionId: string; lastActivityAt: number }>
  nowLine?: string
  opensIn?: WorkThread['opensIn']
  title?: string
  laneSessionIds?: string[][]
  ticketKey?: string
  links?: WorkThread['links']
}

/** One lane per entry of `laneSessionIds`, each in the fixture's repo. */
function lanesOf(key: string, fixture: Fixture): WorkThread['lanes'] {
  const { repoRoot = '/repos/api', repoName = 'api', laneSessionIds = [[]] } = fixture
  const lane = { repoRoot, repoName, branch: `${key}-branch`, repoColor: null }
  return laneSessionIds.map((sessionIds) => ({ ...lane, sessionIds })) as WorkThread['lanes']
}

function threadOf(key: string, fixture: Fixture = {}): WorkThread {
  const { sessions = [], title = `Work ${key}` } = fixture
  return {
    key,
    title,
    state: fixture.state ?? 'running',
    inferred: false,
    lastActivity: fixture.lastActivity ?? NOW,
    startedAt: fixture.startedAt ?? 0,
    focus: false,
    archived: false,
    nowLine: fixture.nowLine ?? '',
    lanes: lanesOf(key, fixture),
    sessions: sessions.map((s) => ({ ...s, isClosed: false })),
    opensIn: fixture.opensIn ?? null,
    ticketKey: fixture.ticketKey,
    links: fixture.links ?? [],
  } as unknown as WorkThread
}

const repos = [
  { root: '/repos/api', name: 'api' },
  { root: '/repos/web', name: 'web' },
]

const renderInbox = (threads: WorkThread[], now = NOW) =>
  render(<InboxList threads={threads} now={now} repos={repos} />)

/** The card titles above the settled section, top to bottom. */
const cardTitles = () =>
  within(screen.getByRole('list', { name: 'Inbox' }))
    .queryAllByRole('listitem')
    .map((card) => card.getAttribute('aria-label'))

const settledTitles = () =>
  within(screen.getByRole('list', { name: 'Settled' }))
    .queryAllByRole('listitem')
    .map((card) => card.getAttribute('aria-label'))

const cardFor = (title: string) => screen.getByRole('listitem', { name: title })

const FOUNDRY = {
  source: 'terminator.foundry',
  command: 'show-order',
  args: { orderId: 'WO-1' },
}
const executeCommand = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  installElectronApi({ extension: { hasCommand: vi.fn(async () => true), executeCommand } })
  useExtensionRegistry.setState({
    workspaceTabs: new Map([
      ['terminator.foundry', { id: 'terminator.foundry', label: 'Foundry', component: () => null }],
    ]),
  })
  localStorage.clear()
  useWorkMarks.setState({ settled: {}, pinned: {}, snoozed: {} })
  useInboxFilter.setState({ filter: { text: '', repoRoot: null } })
  useDraggedThread.setState({ thread: null })
  useToastStore.setState({ toasts: [] })
  useSessionStore.setState(useSessionStore.getInitialState())
  useWorkspaceStore.setState({ activeProjectId: null })
})

describe('InboxList — order', () => {
  it('shows Needs you, then pinned, then active, and a collapsed settled section', async () => {
    const user = userEvent.setup()
    useWorkMarks.setState({ pinned: { pinned: 1 }, settled: { done: 1 } })
    renderInbox([
      threadOf('active', { startedAt: 3 }),
      threadOf('pinned', { startedAt: 1 }),
      threadOf('asking', { state: 'needs-you', nowLine: 'Asking: Run the migration?' }),
      threadOf('done'),
    ])
    expect(cardTitles()).toEqual(['Work asking', 'Work pinned', 'Work active'])
    expect(within(cardFor('Work asking')).getByText('Asking: Run the migration?')).toBeTruthy()
    const toggle = screen.getByRole('button', { name: '1 settled' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Work done')).toBeNull()
    await user.click(toggle)
    expect(settledTitles()).toEqual(['Work done'])
  })

  it('pins a card to the top', async () => {
    const user = userEvent.setup()
    renderInbox([threadOf('newer', { startedAt: 2 }), threadOf('older', { startedAt: 1 })])
    await user.click(within(cardFor('Work older')).getByRole('button', { name: 'Pin' }))
    expect(cardTitles()).toEqual(['Work older', 'Work newer'])
    expect(within(cardFor('Work older')).getByRole('button', { name: 'Unpin' })).toBeTruthy()
  })
})

describe('InboxList — settling', () => {
  it('settles a card into the settled section', async () => {
    const user = userEvent.setup()
    renderInbox([threadOf('a', { startedAt: 2 }), threadOf('b', { startedAt: 1 })])
    await user.click(within(cardFor('Work a')).getByRole('button', { name: 'Settle' }))
    expect(cardTitles()).toEqual(['Work b'])
    expect(screen.getByRole('button', { name: '1 settled' })).toBeTruthy()
  })
})

const opened = [
  'terminator.foundry.command.show-order',
  { projectId: null, sessionId: null, repoRoot: null },
  { orderId: 'WO-1' },
]

describe('InboxList — open in the extension', () => {
  it('opens the work in the extension that owns it', async () => {
    const user = userEvent.setup()
    renderInbox([threadOf('a', { opensIn: FOUNDRY })])
    await user.click(within(cardFor('Work a')).getByRole('button', { name: 'Open in Foundry' }))
    await eventually(() => expect(executeCommand).toHaveBeenCalledWith(...opened))
  })

  it('offers nothing when no extension can open the work', () => {
    renderInbox([threadOf('a')])
    expect(within(cardFor('Work a')).queryByRole('button', { name: /^Open in / })).toBeNull()
  })

  it('says "Open in app" when the extension has no tab to name it', () => {
    useExtensionRegistry.setState({ workspaceTabs: new Map() })
    renderInbox([threadOf('a', { opensIn: FOUNDRY })])
    expect(within(cardFor('Work a')).getByRole('button', { name: 'Open in app' })).toBeTruthy()
  })
})

describe('InboxList — opening a card', () => {
  it('opens the extension view, not the drawer, from a card with no terminal', async () => {
    const user = userEvent.setup()
    renderInbox([threadOf('a', { opensIn: FOUNDRY })])
    await user.click(within(cardFor('Work a')).getByText('Work a'))
    await eventually(() => expect(executeCommand).toHaveBeenCalledWith(...opened))
    expect(revealSession).not.toHaveBeenCalled()
  })

  it('reveals the terminal first when the card has one', async () => {
    const user = userEvent.setup()
    const sessions = [{ sessionId: 's1', lastActivityAt: 1 }]
    renderInbox([threadOf('a', { opensIn: FOUNDRY, sessions })])
    await user.click(within(cardFor('Work a')).getByText('Work a'))
    expect(revealSession).toHaveBeenCalledWith('s1')
    expect(executeCommand).not.toHaveBeenCalled()
  })
})

const dataTransfer = () => ({ setData: vi.fn(), effectAllowed: '', dropEffect: '' })
const openButtonOf = (title: string) =>
  within(cardFor(title)).getByRole('button', { name: new RegExp(title) })

describe('InboxList — dragging a card to an agent tab', () => {
  it('carries every session of every lane, and fades the card while held', () => {
    renderInbox([threadOf('a', { laneSessionIds: [['s1', 's2'], ['s3']] })])
    const transfer = dataTransfer()
    fireEvent.dragStart(openButtonOf('Work a'), { dataTransfer: transfer })
    expect(transfer.setData).toHaveBeenCalledWith(SESSION_DRAG_TYPE, 's1\ns2\ns3')
    expect(transfer.effectAllowed).toBe('copyMove')
    expect(cardFor('Work a').className).toContain('inbox-card--dragging')
    fireEvent.dragEnd(openButtonOf('Work a'))
    expect(useDraggedThread.getState().thread).toBeNull()
    expect(cardFor('Work a').className).not.toContain('inbox-card--dragging')
  })

  it('lifts a card with no session, carrying its title, ticket and links as text', () => {
    const links = [{ label: 'Pull request', url: 'https://github.com/acme/api/pull/12' }]
    renderInbox([threadOf('a', { ticketKey: 'API-12', links })])
    expect(openButtonOf('Work a').getAttribute('draggable')).toBe('true')
    const transfer = dataTransfer()
    fireEvent.dragStart(openButtonOf('Work a'), { dataTransfer: transfer })
    expect(transfer.setData).toHaveBeenCalledWith(
      'text/plain',
      'Work a · API-12\nPull request: https://github.com/acme/api/pull/12'
    )
    expect(transfer.setData).not.toHaveBeenCalledWith(SESSION_DRAG_TYPE, expect.anything())
  })
})

describe('InboxList — Settle offers Undo', () => {
  it('settles the card and Undo in the toast brings it back', async () => {
    const user = userEvent.setup()
    renderInbox([threadOf('a')])
    await user.click(within(cardFor('Work a')).getByRole('button', { name: 'Settle' }))
    const [toast] = useToastStore.getState().toasts
    expect(toast.message).toBe('Settled "Work a"')
    expect(cardTitles()).toEqual([])
    toast.action!.onSelect()
    await eventually(() => expect(cardTitles()).toEqual(['Work a']))
  })
})

describe('InboxList — Restore on a settled card', () => {
  it('shows Restore in place of Settle, and brings the card back', async () => {
    const user = userEvent.setup()
    useWorkMarks.setState({ settled: { a: 1 } })
    renderInbox([threadOf('a')])
    await user.click(screen.getByRole('button', { name: '1 settled' }))
    const card = within(cardFor('Work a'))
    expect(card.queryByRole('button', { name: 'Settle' })).toBeNull()
    await user.click(card.getByRole('button', { name: 'Restore' }))
    expect(cardTitles()).toEqual(['Work a'])
  })

  it('offers no Restore on a card settled only by a quiet day, which Restore cannot bring back', async () => {
    const user = userEvent.setup()
    renderInbox([threadOf('a', { lastActivity: NOW - 25 * HOUR_MS })])
    await user.click(screen.getByRole('button', { name: '1 settled' }))
    expect(within(cardFor('Work a')).queryByRole('button', { name: 'Restore' })).toBeNull()
  })
})

describe('InboxList — search reaches the settled section', () => {
  it('opens the settled section and counts its matches while searching', async () => {
    const user = userEvent.setup()
    useWorkMarks.setState({ settled: { login: 1, logout: 1 } })
    renderInbox([threadOf('login'), threadOf('logout'), threadOf('other')])
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'log')
    const toggle = screen.getByRole('button', { name: '2 settled matches' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(settledTitles()).toEqual(['Work login', 'Work logout'])
  })

  it('says no active work matches when only settled cards match', async () => {
    const user = userEvent.setup()
    useWorkMarks.setState({ settled: { login: 1 } })
    renderInbox([threadOf('login'), threadOf('other')])
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'login')
    expect(screen.getByText('No active work matches')).toBeTruthy()
    expect(screen.getByRole('button', { name: '1 settled match' })).toBeTruthy()
  })

  it('folds the settled section on a click while searching', async () => {
    const user = userEvent.setup()
    useWorkMarks.setState({ settled: { login: 1 } })
    renderInbox([threadOf('login'), threadOf('other')])
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'login')
    await user.click(screen.getByRole('button', { name: '1 settled match' }))
    expect(screen.queryByRole('list', { name: 'Settled' })).toBeNull()
  })
})

describe('InboxList — snoozing', () => {
  it('moves a snoozed card to the settled section and shows when it wakes', async () => {
    const user = userEvent.setup()
    renderInbox([threadOf('a'), threadOf('b')])
    await user.click(within(cardFor('Work a')).getByRole('button', { name: 'Snooze' }))
    await user.click(screen.getByRole('menuitem', { name: '1 hour' }))
    expect(cardTitles()).toEqual(['Work b'])
    await user.click(screen.getByRole('button', { name: '1 settled' }))
    expect(within(cardFor('Work a')).getByText(untilLabel(NOW + HOUR_MS))).toBeTruthy()
  })
})

describe('InboxList — asks the repo filter hides', () => {
  it('says how many asks another repo holds, and Show clears the filter', async () => {
    const user = userEvent.setup()
    useInboxFilter.setState({ filter: { text: '', repoRoot: '/repos/api' } })
    renderInbox([
      threadOf('a', { state: 'needs-you', repoRoot: '/repos/web', repoName: 'web' }),
      threadOf('b'),
    ])
    expect(screen.getByText('1 needs you in web')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Show' }))
    expect(cardTitles()).toEqual(['Work a', 'Work b'])
  })

  it('says "in other repos" when the hidden asks sit in more than one', () => {
    useInboxFilter.setState({ filter: { text: '', repoRoot: '/repos/api' } })
    renderInbox([
      threadOf('a', { state: 'needs-you', repoRoot: '/repos/web', repoName: 'web' }),
      threadOf('b', { state: 'needs-you', repoRoot: '/repos/docs', repoName: 'docs' }),
    ])
    expect(screen.getByText('2 needs you in other repos')).toBeTruthy()
  })

  it('leaves out an ask settled by hand in another repo, which Show would not bring to the cards', () => {
    useInboxFilter.setState({ filter: { text: '', repoRoot: '/repos/api' } })
    useWorkMarks.setState({ snoozed: { a: NOW + HOUR_MS } })
    renderInbox([
      threadOf('a', { state: 'needs-you', repoRoot: '/repos/web', repoName: 'web' }),
      threadOf('b'),
    ])
    expect(screen.queryByText(/needs you in/)).toBeNull()
  })
})

describe('InboxList — the filter outlives the Inbox', () => {
  it('shows the same search after the Inbox is closed and opened again', async () => {
    const user = userEvent.setup()
    const first = renderInbox([threadOf('login'), threadOf('other')])
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'login')
    first.unmount()
    renderInbox([threadOf('login'), threadOf('other')])
    expect(cardTitles()).toEqual(['Work login'])
  })
})

function showAgentTab(tabTitle: string): void {
  useSessionStore.setState({
    sessions: new Map([
      [
        'agent-1',
        terminalSessionOf({ id: 'agent-1', projectId: 'p1', tabTitle, surface: 'agent' }),
      ],
    ]),
    projectViews: new Map([
      ['p1', { activeSessionId: 'agent-1', order: ['agent-1'], terminalCounter: 1 }],
    ]),
  })
  useWorkspaceStore.setState({ activeProjectId: 'p1' })
}

describe('InboxList — attaching a card to the shown agent tab', () => {
  it("attaches the card's sessions to the agent tab on screen", async () => {
    const user = userEvent.setup()
    showAgentTab('Review')
    renderInbox([threadOf('a', { laneSessionIds: [['s1'], ['s2']] })])
    await user.click(within(cardFor('Work a')).getByRole('button', { name: 'Attach to Review' }))
    expect(attachSessions).toHaveBeenCalledWith('agent-1', ['s1', 's2'])
  })

  it('offers no Attach when the shown tab is a terminal', () => {
    showAgentTab('Review')
    useSessionStore.setState({
      sessions: new Map([['agent-1', terminalSessionOf({ id: 'agent-1', projectId: 'p1' })]]),
    })
    renderInbox([threadOf('a', { laneSessionIds: [['s1']] })])
    expect(within(cardFor('Work a')).queryByRole('button', { name: /^Attach to/ })).toBeNull()
  })

  it('offers no Attach on the card whose only session is the agent tab on screen', () => {
    showAgentTab('Review')
    renderInbox([threadOf('a', { laneSessionIds: [['agent-1']] })])
    expect(within(cardFor('Work a')).queryByRole('button', { name: /^Attach to/ })).toBeNull()
  })
})

describe('InboxList — the card names its work', () => {
  it('carries the full title as a tooltip, and drops the branch when it is the title', () => {
    renderInbox([threadOf('a', { title: 'a-branch' })])
    const open = openButtonOf('a-branch')
    expect(open.getAttribute('title')).toBe('a-branch')
    expect(within(open).getByText('api')).toBeTruthy()
    expect(within(open).queryByText('api · a-branch')).toBeNull()
  })
})

describe('InboxList — the age and the actions each have their own space', () => {
  it('puts the actions after the age, not over it', () => {
    renderInbox([threadOf('a')])
    const age = within(cardFor('Work a')).getByText('now')
    const pin = within(cardFor('Work a')).getByRole('button', { name: 'Pin' })
    expect(age.compareDocumentPosition(pin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // eslint-disable-next-line testing-library/no-node-access -- sharing one cell is the layout under test; the cell has no role
    expect(age.parentElement!.contains(pin)).toBe(true)
  })
})
