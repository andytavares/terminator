import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InboxList } from '../../../../../src/components/sidebar/InboxSidebar'
import { useWorkMarks } from '../../../../../src/home/work-marks'
import { useExtensionRegistry } from '../../../../../src/extensions/registry'
import { installElectronApi } from '../../../../../../test-support/src/electron-api'
import { eventually } from '../../../../../../test-support/src/eventually'
import type { WorkThread } from '../../../../../src/home/work-threads'
import type { TaskState } from '../../../../../src/home/task-state'

const revealSession = vi.hoisted(() => vi.fn())
vi.mock('../../../../../src/terminal/navigate-to-session', () => ({ revealSession }))
vi.mock('../../../../../src/usage/record', () => ({ recordUse: vi.fn() }))

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
}

function threadOf(key: string, fixture: Fixture = {}): WorkThread {
  const { repoRoot = '/repos/api', repoName = 'api', sessions = [] } = fixture
  return {
    key,
    title: `Work ${key}`,
    state: fixture.state ?? 'running',
    inferred: false,
    lastActivity: fixture.lastActivity ?? NOW,
    startedAt: fixture.startedAt ?? 0,
    focus: false,
    archived: false,
    nowLine: fixture.nowLine ?? '',
    lanes: [{ repoRoot, repoName, branch: `${key}-branch`, repoColor: null, sessionIds: [] }],
    sessions: sessions.map((s) => ({ ...s, isClosed: false })),
    opensIn: fixture.opensIn ?? null,
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
