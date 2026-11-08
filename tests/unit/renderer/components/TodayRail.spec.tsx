import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TodayRail } from '../../../../src/renderer/components/home/TodayRail'
import { useHomeView } from '../../../../src/renderer/components/home/home-view'
import { useFocusStore } from '../../../../src/renderer/home/focus-store'
import { localDateKey } from '../../../../src/renderer/home/focus'
import { useHomeFeedStore } from '../../../../src/renderer/stores/home-feed.store'
import { installElectronApi } from '../../../support/electron-api'
import { facet } from '../home/fixtures'
import { FACETS, FACTS, NOW, REPO_ROOT, seedDesk } from '../home/desk-world'

const world = vi.hoisted(() => ({ facts: [] as unknown[] }))
vi.mock('../../../../src/renderer/components/session/useSessionFacts', () => ({
  useSessionFacts: () => world.facts,
}))

const shipped = facet({
  workKey: { repoRoot: REPO_ROOT, branch: 'streak' },
  title: 'Lesson streak widget',
  stage: 'shipped',
  closedAt: new Date(NOW).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
})
const week = (waits: number) => ({
  data: { waitsOnYou: { count: waits, medianMinutes: 6, over30: 0 }, agentHours: 21.4 },
})
const homeMeasure = (id: string, patch = {}) => ({
  id,
  question: id,
  value: 1,
  unit: 'count' as const,
  window: 'week' as const,
  series: [],
  source: 'git-integration',
  ...patch,
})

beforeEach(() => {
  localStorage.clear()
  world.facts = FACTS
  seedDesk()
  useHomeFeedStore.setState({ facets: [...FACETS, shipped] })
  useFocusStore.setState({ days: {} })
  useHomeView.setState({ view: 'desk' })
  installElectronApi({
    attention: { measures: vi.fn().mockResolvedValue(week(3)) },
    agentUsage: {
      get: vi.fn().mockResolvedValue({ data: { sessions: new Array(14).fill({}), totals: {} } }),
    },
    git: { changeStats: vi.fn().mockResolvedValue(null) },
  })
})

const pickToday = (items: object[]) =>
  useFocusStore.setState({ days: { [localDateKey(Date.now())]: items as never } })

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))
beforeEach(() => recordUse.mockClear())

describe("Today's focus", () => {
  it('ticks an item by itself when the work it points at shipped, and lets the operator tick the rest', async () => {
    const user = userEvent.setup()
    pickToday([
      { id: 'a', title: 'Ship the streak widget', workKey: shipped.workKey, doneByHand: false },
      { id: 'b', title: 'Review Fluent #41', doneByHand: false },
    ])
    render(<TodayRail />)
    const ticked = screen.getByRole('checkbox', { name: 'Ship the streak widget' })
    const open = screen.getByRole('checkbox', { name: 'Review Fluent #41' })
    expect(ticked.getAttribute('aria-checked')).toBe('true')
    expect(open.getAttribute('aria-checked')).toBe('false')
    await user.click(open)
    expect(
      screen.getByRole('checkbox', { name: 'Review Fluent #41' }).getAttribute('aria-checked')
    ).toBe('true')
  })
})

describe("Today's focus — Task Vault", () => {
  it("lists Task Vault's items for today under the picked focus, ticked by their own state", () => {
    useHomeFeedStore.setState({
      focus: [
        {
          source: 'task-vault',
          id: 'tv1',
          title: 'Write the report',
          workKey: null,
          done: true,
          detail: 'due today',
        },
        { source: 'task-vault', id: 'tv2', title: 'Call the bank', workKey: null, done: false },
      ],
    })
    render(<TodayRail />)
    expect(
      screen.getByRole('checkbox', { name: 'Write the report' }).getAttribute('aria-checked')
    ).toBe('true')
    expect(
      screen.getByRole('checkbox', { name: 'Call the bank' }).getAttribute('aria-checked')
    ).toBe('false')
    expect(screen.getByText('due today')).toBeTruthy()
  })
})

/** Opens the focus editor with one Task Vault candidate beside the threads. */
async function openFocusEditor(user: ReturnType<typeof userEvent.setup>) {
  useHomeFeedStore.setState({
    focus: [
      { source: 'task-vault', id: 'tv1', title: 'Write the report', workKey: null, done: false },
    ],
  })
  render(<TodayRail />)
  await user.click(screen.getByRole('button', { name: 'Edit' }))
  return screen.getByRole('list', { name: "Choose today's focus" })
}

const pickedToday = () => useFocusStore.getState().days[localDateKey(Date.now())] ?? []

describe("Today's focus — choosing", () => {
  it('picks a Task Vault candidate and a thread with its work key', async () => {
    const user = userEvent.setup()
    const editor = await openFocusEditor(user)
    await user.click(within(editor).getByRole('checkbox', { name: 'Write the report' }))
    await user.click(
      within(editor).getByRole('checkbox', { name: 'PR overview shows status before story' })
    )
    expect(pickedToday()).toMatchObject([
      { title: 'Write the report' },
      {
        title: 'PR overview shows status before story',
        workKey: { tracker: 'linear', key: 'TAV-20' },
      },
    ])
  })
})

describe("Today's focus — the cap", () => {
  it('ignores a fourth pick', async () => {
    const user = userEvent.setup()
    const editor = await openFocusEditor(user)
    await user.click(within(editor).getByRole('checkbox', { name: 'Write the report' }))
    await user.click(
      within(editor).getByRole('checkbox', { name: 'PR overview shows status before story' })
    )
    await user.click(
      within(editor).getByRole('checkbox', { name: 'Reproduce staging 429s before release' })
    )
    const fourth = 'Make all text in the app scale with settings'
    await user.click(within(editor).getByRole('checkbox', { name: fourth }))
    expect(pickedToday().map((item) => item.title)).not.toContain(fourth)
    expect(pickedToday()).toHaveLength(3)
  })
})

describe("Today's focus — unticking", () => {
  it('drops a pick when it is unticked', async () => {
    const user = userEvent.setup()
    const editor = await openFocusEditor(user)
    await user.click(within(editor).getByRole('checkbox', { name: 'Write the report' }))
    await user.click(within(editor).getByRole('checkbox', { name: 'Write the report' }))
    expect(pickedToday()).toEqual([])
  })
})

describe('This week — what is shown', () => {
  it('hides the tiles whose measure nobody published, and the heat strip', async () => {
    const { container } = render(<TodayRail />)
    expect(await screen.findByText('Agent hours')).toBeTruthy()
    expect(screen.queryByText('Merged')).toBeNull()
    expect(screen.queryByText('Your review wait')).toBeNull()
    expect(container.querySelector('.desk-heat')).toBeNull()
    expect(screen.getByText('across 14 sessions')).toBeTruthy()
    expect(screen.getByText('21')).toBeTruthy()
    expect(screen.getByText('6 min')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Foundry/)
  })

  it('draws the published numbers with their change from last week', async () => {
    useHomeFeedStore.setState({
      measures: [
        homeMeasure('shipped', { value: 9, previous: 7 }),
        homeMeasure('review-wait', { value: 190, unit: 'minutes' }),
        homeMeasure('contributions-days', { series: [0, 1, 2, 3, 4, 9, -2] }),
      ],
    })
    const { container } = render(<TodayRail />)
    expect(await screen.findByText('2 more')).toBeTruthy()
    expect(screen.getByText('9')).toBeTruthy()
    expect(screen.getByText('3 h 10')).toBeTruthy()
    expect(container.querySelectorAll('.desk-heat i')).toHaveLength(7)
    expect(container.querySelector('.desk-heat__4')).not.toBeNull()
  })
})

describe('This week — edge cases', () => {
  it('says so when no agent waited on you, rather than inventing a median', async () => {
    window.electronAPI.attention.measures = vi.fn().mockResolvedValue(week(0))
    render(<TodayRail />)
    expect(await screen.findByText('no waits')).toBeTruthy()
  })

  it('switches Home to Insights', async () => {
    const user = userEvent.setup()
    render(<TodayRail />)
    await user.click(screen.getByRole('button', { name: /Open Insights/ }))
    expect(useHomeView.getState().view).toBe('insights')
  })
})
