import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InboxList } from '../../../../../src/renderer/components/sidebar/InboxSidebar'
import { useInboxMarks } from '../../../../../src/renderer/components/sidebar/inbox-marks'
import { useStartWorkStore } from '../../../../../src/renderer/components/home/start-work'
import type { WorkThread } from '../../../../../src/renderer/home/work-threads'
import type { TaskState } from '../../../../../src/renderer/home/task-state'

const revealSession = vi.hoisted(() => vi.fn())
vi.mock('../../../../../src/renderer/terminal/navigate-to-session', () => ({ revealSession }))
vi.mock('../../../../../src/renderer/usage/record', () => ({ recordUse: vi.fn() }))

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
    .map((card) => card.querySelector('.inbox-card__title')!.textContent)

const settledTitles = () =>
  within(screen.getByRole('list', { name: 'Settled' }))
    .queryAllByRole('listitem')
    .map((card) => card.querySelector('.inbox-card__title')!.textContent)

const cardFor = (title: string) => screen.getByText(title).closest('li')!

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useInboxMarks.setState({ settled: {}, pinned: {}, snoozed: {} })
})

describe('InboxList — order', () => {
  it('shows Needs you, then pinned, then active, and a collapsed settled section', async () => {
    const user = userEvent.setup()
    useInboxMarks.setState({ pinned: { pinned: 1 }, settled: { done: 1 } })
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

  it('brings a settled card back when its agent ends a turn', async () => {
    const user = userEvent.setup()
    const { rerender } = renderInbox([threadOf('a', { state: 'running' })])
    await user.click(within(cardFor('Work a')).getByRole('button', { name: 'Settle' }))
    expect(cardTitles()).toEqual([])
    rerender(<InboxList threads={[threadOf('a', { state: 'quiet' })]} now={NOW} repos={repos} />)
    expect(cardTitles()).toEqual(['Work a'])
  })

  it('brings a settled card back when it asks', async () => {
    const user = userEvent.setup()
    const { rerender } = renderInbox([threadOf('a', { state: 'quiet' })])
    await user.click(within(cardFor('Work a')).getByRole('button', { name: 'Settle' }))
    rerender(
      <InboxList threads={[threadOf('a', { state: 'needs-you' })]} now={NOW} repos={repos} />
    )
    expect(cardTitles()).toEqual(['Work a'])
  })
})

describe('InboxList — snoozing', () => {
  it('snoozes a card into the settled section', async () => {
    const user = userEvent.setup()
    renderInbox([threadOf('a')])
    await user.click(within(cardFor('Work a')).getByRole('button', { name: 'Snooze' }))
    await user.click(screen.getByRole('menuitem', { name: '1 hour' }))
    expect(cardTitles()).toEqual([])
    expect(useInboxMarks.getState().snoozed).toEqual({ a: NOW + HOUR_MS })
  })
})

describe('InboxList — search and repo filter', () => {
  const threads = [
    threadOf('login', { repoRoot: '/repos/api', repoName: 'api' }),
    threadOf('theme', { repoRoot: '/repos/web', repoName: 'web' }),
  ]

  it('filters by the search text', async () => {
    const user = userEvent.setup()
    renderInbox(threads)
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'theme-branch')
    expect(cardTitles()).toEqual(['Work theme'])
  })

  it('filters by repo', async () => {
    const user = userEvent.setup()
    renderInbox(threads)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Repo' }), '/repos/api')
    expect(cardTitles()).toEqual(['Work login'])
  })
})

/** Two cards; the first has an older and a more recent session. */
const keyboardThreads = [
  threadOf('first', {
    startedAt: 2,
    sessions: [
      { sessionId: 'old', lastActivityAt: NOW - HOUR_MS },
      { sessionId: 'recent', lastActivityAt: NOW },
    ],
  }),
  threadOf('second', { startedAt: 1, sessions: [{ sessionId: 's2', lastActivityAt: NOW }] }),
]

describe('InboxList — starting work', () => {
  // The tree's new-terminal buttons are hidden in Inbox mode, so the Inbox has its own way in.
  it('opens the Start work launcher, with no work listed', async () => {
    useStartWorkStore.getState().closeLauncher()
    renderInbox([])
    await userEvent.click(screen.getByRole('button', { name: 'Start work' }))
    expect(useStartWorkStore.getState().open).toBe(true)
  })
})

describe('InboxList — opening and the keyboard', () => {
  const threads = keyboardThreads
  it('opens the most recent session of a card', async () => {
    const user = userEvent.setup()
    renderInbox(threads)
    await user.click(screen.getByRole('button', { name: /Work first/ }))
    expect(revealSession).toHaveBeenCalledWith('recent')
  })

  it('moves between cards with the arrow keys from search, and opens with Enter', async () => {
    const user = userEvent.setup()
    renderInbox(threads)
    await user.click(screen.getByRole('textbox', { name: 'Search' }))
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Work first/ }))
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Work second/ }))
    await user.keyboard('{ArrowUp}')
    await user.keyboard('{Enter}')
    expect(revealSession).toHaveBeenCalledWith('recent')
  })
})

describe('InboxList — keys that belong to the controls', () => {
  const threads = keyboardThreads

  it('leaves arrow keys alone in the repo filter', async () => {
    const user = userEvent.setup()
    renderInbox(threads)
    const repo = screen.getByRole('combobox', { name: 'Repo' })
    repo.focus()
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(repo)
  })
})
