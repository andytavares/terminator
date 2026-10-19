import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { PlanTheDay, useMarkLeftHome } from '../../../../src/renderer/components/home/PlanTheDay'
import { useFocusStore } from '../../../../src/renderer/home/focus-store'
import { useHomeFeedStore } from '../../../../src/renderer/stores/home-feed.store'
import { localDateKey } from '../../../../src/renderer/home/focus'
import { yesterdayKey } from '../../../../src/renderer/home/plan-the-day'
import type { DeskAsk } from '../../../../src/renderer/home/core-asks'

const desk = vi.hoisted(() => ({ asks: [] as unknown[] }))
vi.mock('../../../../src/renderer/components/home/useDeskAsks', () => ({
  useDeskAsks: () => ({ asks: desk.asks }),
}))
vi.mock('../../../../src/renderer/components/home/useWorkThreads', () => ({
  useWorkThreads: () => ({ allThreads: [] }),
}))

const NOW = new Date(2026, 9, 18, 8, 30).getTime()
const LEFT = new Date(2026, 9, 17, 18, 0).getTime()
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

function seedStore(patch: Partial<ReturnType<typeof useFocusStore.getState>> = {}): void {
  useFocusStore.setState({ days: {}, lastLeftHomeAt: LEFT, planDismissedOn: null, ...patch })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  desk.asks = []
  seedStore()
  useHomeFeedStore.setState({ facets: [], focus: [], asks: [], measures: [] })
})

afterEach(() => vi.useRealTimers())

const band = () => screen.getByRole('region', { name: 'Plan today' })

describe('PlanTheDay: when it shows', () => {
  it('shows on the first view of a day, with what yesterday and the night held', () => {
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
        'Yesterday you finished 1 of 2 focus items. Overnight, 1 agent finished and 1 review came in.'
      )
    ).toBeTruthy()
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

const openTask = {
  id: 'task:1',
  source: 'vault',
  title: 'Weekly review',
  detail: 'Task Vault',
  workKey: null,
  done: false,
}
const finishedTask = { ...openTask, id: 'task:2', title: 'Finished task', done: true }

describe('PlanTheDay: the three columns', () => {
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

describe('PlanTheDay: what happened and what is owed', () => {
  it('lists what happened since you left, and nothing from before', () => {
    desk.asks = [
      ask({ id: 'new', detail: 'chapter 3 exercises' }),
      ask({ id: 'old', detail: 'too old', since: new Date(LEFT - 3_600_000).toISOString() }),
    ]
    render(<PlanTheDay />)
    expect(within(band()).getByText('chapter 3 exercises')).toBeTruthy()
    expect(within(band()).queryByText('too old')).toBeNull()
  })

  it('estimates the review time of the queue from the reviews owed', () => {
    desk.asks = [
      ask({ id: 'r1', kind: 'review', facts: ['about 15 min'] }),
      ask({ id: 'r2', kind: 'review', facts: ['about 25 min'] }),
    ]
    render(<PlanTheDay />)
    expect(within(band()).getByText(/Estimated review time for your queue: 40 min/)).toBeTruthy()
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

describe('useMarkLeftHome', () => {
  it('records when Home went away', () => {
    function Probe(): null {
      useMarkLeftHome()
      return null
    }
    const { unmount } = render(<Probe />)
    expect(useFocusStore.getState().lastLeftHomeAt).toBe(LEFT)
    unmount()
    expect(useFocusStore.getState().lastLeftHomeAt).toBe(NOW)
  })
})
