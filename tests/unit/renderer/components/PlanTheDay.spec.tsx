import React from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { PlanTheDay } from '../../../../src/renderer/components/home/PlanTheDay'
import { useFocusStore } from '../../../../src/renderer/home/focus-store'
import { useHomeFeedStore } from '../../../../src/renderer/stores/home-feed.store'
import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'
import { localDateKey } from '../../../../src/renderer/home/focus'
import { yesterdayKey } from '../../../../src/renderer/home/plan-the-day'
import type { DeskAsk } from '../../../../src/renderer/home/core-asks'
import type { IssueSummary } from '../../../../src/shared/types/index'

const desk = vi.hoisted(() => ({ asks: [] as unknown[] }))
vi.mock('../../../../src/renderer/components/home/useDeskModel', () => ({
  useDeskModel: () => ({ asks: desk.asks }),
}))
vi.mock('../../../../src/renderer/components/home/useWorkThreads', () => ({
  useWorkThreads: () => ({ allThreads: [] }),
}))
vi.mock('../../../../src/renderer/components/integrations/IssueDetails', () => ({
  IssueDetails: function StubTicketDetails({ issueKey }: { issueKey: string }) {
    return <div>StubTicketDetails {issueKey}</div>
  },
}))

const NOW = new Date(2026, 9, 18, 8, 30).getTime()
const today = localDateKey(NOW)
const yesterday = yesterdayKey(NOW)

const ask = (patch: Partial<DeskAsk>): DeskAsk => ({
  id: 'a',
  source: 'core',
  kind: 'finished',
  title: 'Agent finished',
  detail: 'chapter 3 exercises',
  facts: [],
  workKey: null,
  since: new Date(NOW - 3_600_000).toISOString(),
  actions: [],
  open: { command: 'x' },
  ...patch,
})

const issueRow = (key: string, patch: Partial<IssueSummary> = {}): IssueSummary => ({
  tracker: 'linear',
  id: key,
  key,
  title: `Ticket ${key}`,
  url: `https://linear.app/x/${key}`,
  state: { name: 'Todo', type: 'unstarted' },
  assignee: { name: 'Andrew', email: 'andrew.tavares@klaviyo.com' },
  branchName: null,
  ...patch,
})

function seedStore(patch: Partial<ReturnType<typeof useFocusStore.getState>> = {}): void {
  useFocusStore.setState({ days: {}, planDismissedOn: null, planCollapsed: false, ...patch })
}

function seedTickets(
  issues: IssueSummary[],
  failures: { tracker: 'linear'; error: string }[] = []
) {
  const result = { issues, failures }
  useIntegrationsStore.setState({
    connections: [{ tracker: 'linear', connected: true, account: null } as never],
    listMine: vi.fn().mockResolvedValue(result),
    searchIssues: vi.fn().mockResolvedValue(result),
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  desk.asks = []
  seedStore()
  useHomeFeedStore.setState({ facets: [], focus: [], asks: [], measures: [] })
  seedTickets([])
})

afterEach(() => vi.useRealTimers())

const band = () => screen.getByRole('region', { name: 'Plan today' })

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))
beforeEach(() => recordUse.mockClear())

describe('PlanTheDay: when it shows', () => {
  it('shows on the first view of a day, with what yesterday held and what waits', () => {
    desk.asks = [
      ask({ id: 'f1' }),
      ask({ id: 'r1', kind: 'review', title: 'Review requested', facts: ['about 15 min'] }),
    ]
    seedStore({
      days: {
        [yesterday]: [
          { id: 'x', title: 'Get TAV-14 approved', doneByHand: true },
          { id: 'y', title: 'Open the pull request for TAV-20', doneByHand: false },
        ],
      },
    })
    render(<PlanTheDay />)
    expect(
      within(band()).getByText(
        'Yesterday you finished 1 of 2 focus items. Waiting on you: 1 agent finished and 1 review.'
      )
    ).toBeTruthy()
  })

  it('says nothing waits when the queue is empty', () => {
    render(<PlanTheDay />)
    expect(within(band()).getByText('Nothing is waiting on you.')).toBeTruthy()
  })
})

describe('PlanTheDay: dismissing', () => {
  it.each(['Start the day', 'Skip today'])('hides for the rest of the day after "%s"', (name) => {
    const { rerender } = render(<PlanTheDay />)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))
    expect(screen.queryByRole('region', { name: 'Plan today' })).toBeNull()
    expect(useFocusStore.getState().planDismissedOn).toBe(today)
    rerender(<PlanTheDay />)
    expect(screen.queryByRole('region', { name: 'Plan today' })).toBeNull()
  })

  it('shows again on a later day', () => {
    seedStore({ planDismissedOn: yesterday })
    render(<PlanTheDay />)
    expect(band()).toBeTruthy()
  })

  it('starts the day on Command+Enter', () => {
    render(<PlanTheDay />)
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    expect(screen.queryByRole('region', { name: 'Plan today' })).toBeNull()
  })
})

describe('PlanTheDay: collapsing', () => {
  it('hides the body but keeps the head, and says how much of the focus is picked', () => {
    seedStore({ days: { [today]: [{ id: 'x', title: 'Ship TAV-20', doneByHand: false }] } })
    render(<PlanTheDay />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(useFocusStore.getState().planCollapsed).toBe(true)
    expect(band().querySelector('.plan__body')).toBeNull()
    expect(within(band()).getByText(/1 of 3 focus picked/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Expand' })).toBeTruthy()
  })

  it('stays collapsed across a remount, and Expand restores the body', () => {
    seedStore({ planCollapsed: true })
    const { unmount } = render(<PlanTheDay />)
    expect(band().querySelector('.plan__body')).toBeNull()
    unmount()
    render(<PlanTheDay />)
    expect(band().querySelector('.plan__body')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(band().querySelector('.plan__body')).not.toBeNull()
    expect(useFocusStore.getState().planCollapsed).toBe(false)
  })
})

const openTask = {
  id: 'task:1',
  source: 'vault',
  title: 'Weekly review',
  detail: 'Task Vault',
  workKey: null,
  done: false,
}
const finishedTask = { ...openTask, id: 'task:2', title: 'Finished task', done: true }

describe('PlanTheDay: the carried over column', () => {
  it('carries over only what yesterday left undone, and open Task Vault tasks', () => {
    seedStore({
      days: {
        [yesterday]: [
          { id: 'x', title: 'Done by hand', doneByHand: true },
          { id: 'y', title: 'Open the pull request', doneByHand: false },
        ],
      },
    })
    useHomeFeedStore.setState({ focus: [openTask, finishedTask] })
    render(<PlanTheDay />)
    const carried = within(band()).getByText('CARRIED OVER').closest('.plan__column') as HTMLElement
    expect(within(carried).getByText('Open the pull request')).toBeTruthy()
    expect(within(carried).getByText('focus yesterday, not done')).toBeTruthy()
    expect(within(carried).getByText('Weekly review')).toBeTruthy()
    expect(within(carried).queryByText('Done by hand')).toBeNull()
    expect(within(carried).queryByText('Finished task')).toBeNull()
  })
})

describe('PlanTheDay: the tickets column lists mine', () => {
  it('lists my tickets with key, title and assignee, Unassigned for none', async () => {
    seedTickets([issueRow('TAV-1'), issueRow('TAV-2', { title: 'Unowned', assignee: null })])
    render(<PlanTheDay />)
    expect(await within(band()).findByText('Ticket TAV-1')).toBeTruthy()
    const column = within(band())
      .getByText('TICKETS · MINE')
      .closest('.plan__column') as HTMLElement
    expect(within(column).getByText('Andrew')).toBeTruthy()
    expect(within(column).getByText('Unassigned')).toBeTruthy()
    expect(within(column).queryByText('SINCE YOU LEFT')).toBeNull()
  })

  it('adds a ticket to the focus with its work key', async () => {
    seedTickets([issueRow('TAV-9', { title: 'Tidy the desk' })])
    render(<PlanTheDay />)
    fireEvent.click(
      await screen.findByRole('button', { name: "Add TAV-9 Tidy the desk to today's focus" })
    )
    expect(useFocusStore.getState().days[today]).toEqual([
      {
        id: 'linear:TAV-9',
        title: 'TAV-9 Tidy the desk',
        workKey: { tracker: 'linear', key: 'TAV-9' },
        doneByHand: false,
      },
    ])
  })
})

describe('PlanTheDay: searching the tickets column', () => {
  it('searches on a term and goes back to mine when it is cleared', async () => {
    render(<PlanTheDay />)
    expect(await within(band()).findByText('TICKETS · MINE')).toBeTruthy()
    act(() => {
      fireEvent.change(screen.getByPlaceholderText('Search all tickets…'), {
        target: { value: 'auth' },
      })
    })
    expect(await within(band()).findByText('TICKETS · SEARCH RESULTS')).toBeTruthy()
    await waitFor(() =>
      expect(useIntegrationsStore.getState().searchIssues).toHaveBeenCalledWith('auth')
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(await within(band()).findByText('TICKETS · MINE')).toBeTruthy()
  })
})

describe('PlanTheDay: the ticket details drawer', () => {
  it('opens the ticket details from the row, but not from its Add button', async () => {
    seedTickets([issueRow('TAV-4', { title: 'Openable' })])
    render(<PlanTheDay />)
    fireEvent.click(
      await screen.findByRole('button', { name: "Add TAV-4 Openable to today's focus" })
    )
    expect(screen.queryByText(/StubTicketDetails/)).toBeNull()
    fireEvent.click(screen.getByText('Openable'))
    expect(await screen.findByText('StubTicketDetails TAV-4')).toBeTruthy()
  })

  it('names a tracker failure once, muted', async () => {
    seedTickets([], [{ tracker: 'linear', error: 'not-connected' }])
    render(<PlanTheDay />)
    expect(await within(band()).findByText(/Linear: not connected/)).toBeTruthy()
  })
})

describe('PlanTheDay: the tickets column limits', () => {
  it('disables Add when the focus is full or the ticket is already picked', async () => {
    seedStore({
      days: {
        [today]: [
          { id: 'linear:TAV-1', title: 'TAV-1 Ticket TAV-1', doneByHand: false },
          { id: 'b', title: 'b', doneByHand: false },
          { id: 'c', title: 'c', doneByHand: false },
        ],
      },
    })
    seedTickets([issueRow('TAV-1'), issueRow('TAV-5', { title: 'Latecomer' })])
    render(<PlanTheDay />)
    const picked = await screen.findByRole('button', {
      name: "Add TAV-1 Ticket TAV-1 to today's focus",
    })
    const late = await screen.findByRole('button', { name: "Add TAV-5 Latecomer to today's focus" })
    expect((picked as HTMLButtonElement).disabled).toBe(true)
    expect((late as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('PlanTheDay: the tickets column when empty', () => {
  it('says when there are no tickets of mine and when nothing matches', async () => {
    const { rerender } = render(<PlanTheDay />)
    expect(await within(band()).findByText('No tickets assigned to you.')).toBeTruthy()
    act(() => {
      fireEvent.change(screen.getByPlaceholderText('Search all tickets…'), {
        target: { value: 'zzz' },
      })
    })
    rerender(<PlanTheDay />)
    expect(await within(band()).findByText('No tickets match.')).toBeTruthy()
  })
})

describe('PlanTheDay: what is owed', () => {
  it('estimates the review time of the queue from the reviews owed', () => {
    desk.asks = [
      ask({ id: 'r1', kind: 'review', facts: ['about 15 min'] }),
      ask({ id: 'r2', kind: 'review', facts: ['about 25 min'] }),
    ]
    render(<PlanTheDay />)
    expect(within(band()).getByText(/Estimated review time for your queue: 40 min/)).toBeTruthy()
  })
})

describe('PlanTheDay: the band caps its height and each column scrolls', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

  it('caps the band at a third of the Desk body and scrolls each column', () => {
    const css = read('../../../../src/renderer/components/home/PlanTheDay.css')
    const plan = css.slice(css.indexOf('.plan {'), css.indexOf('}', css.indexOf('.plan {')))
    expect(plan).toMatch(/max-height:\s*calc\(100cqh \/ 3\)/)
    expect(plan).toMatch(/display:\s*flex/)
    const column = css.slice(
      css.indexOf('.plan__column {'),
      css.indexOf('}', css.indexOf('.plan__column {'))
    )
    expect(column).toMatch(/overflow-y:\s*auto/)
    expect(column).toMatch(/min-height:\s*0/)
    const home = read('../../../../src/renderer/components/home/HomeScreen.css')
    const body = home.slice(
      home.indexOf('.desk__body {'),
      home.indexOf('}', home.indexOf('.desk__body {'))
    )
    expect(body).toMatch(/container-type:\s*size/)
  })
})

const tasks = ['One', 'Two', 'Three', 'Four'].map((title, index) => ({
  id: `task:${index}`,
  source: 'vault',
  title,
  workKey: null,
  done: false,
}))

describe('PlanTheDay: picking focus', () => {
  it('fills the next free slot with each Add, and takes the item out of the list', () => {
    useHomeFeedStore.setState({ focus: tasks })
    render(<PlanTheDay />)
    fireEvent.click(screen.getByRole('button', { name: "Add One to today's focus" }))
    fireEvent.click(screen.getByRole('button', { name: "Add Two to today's focus" }))
    expect(useFocusStore.getState().days[today].map((i) => i.title)).toEqual(['One', 'Two'])
    expect(screen.queryByRole('button', { name: "Add One to today's focus" })).toBeNull()
    const slots = band().querySelectorAll('.plan__slot')
    expect(slots[0].textContent).toContain('One')
    expect(slots[2].textContent).toContain('Press Add on any item')
  })
})

describe('PlanTheDay: the slot limit', () => {
  it('allows at most three, and disables Add once the slots are full', () => {
    useHomeFeedStore.setState({ focus: tasks })
    render(<PlanTheDay />)
    for (const title of ['One', 'Two', 'Three']) {
      fireEvent.click(screen.getByRole('button', { name: `Add ${title} to today's focus` }))
    }
    const fourth = screen.getByRole('button', { name: "Add Four to today's focus" })
    expect((fourth as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(fourth)
    expect(useFocusStore.getState().days[today]).toHaveLength(3)
  })

  it('removes an item with its ×', () => {
    useHomeFeedStore.setState({ focus: tasks })
    render(<PlanTheDay />)
    fireEvent.click(screen.getByRole('button', { name: "Add One to today's focus" }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove One' }))
    expect(useFocusStore.getState().days[today]).toEqual([])
    expect(screen.getByRole('button', { name: "Add One to today's focus" })).toBeTruthy()
  })
})
