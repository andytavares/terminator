import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Insights } from '../../../../src/renderer/components/home/Insights'
import { useHomeFeedStore } from '../../../../src/renderer/stores/home-feed.store'
import { useSessionRecordsStore } from '../../../../src/renderer/stores/session-records.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { installElectronApi } from '../../../support/electron-api'
import type { AttentionMeasures } from '../../../../src/shared/home/attention-measures'
import type { HomeAsk, HomeMeasure, Sourced } from '../../../../src/shared/schemas/home-feed.schema'

const DAY = 86_400_000
const attention: AttentionMeasures = {
  waitsOnYou: { count: 38, medianMinutes: 6, over30: 3 },
  agentHours: 21.4,
  runningAtOnceMedian: 3.2,
  finishedWithoutHelpRatio: 0.58,
  waitedOnYouToday: 0,
  longestWait: 52,
  perDay: [
    { dayStart: 0, agentHours: 1, waitMinutes: 4, waits: 2 },
    { dayStart: 1, agentHours: 2, waitMinutes: 9, waits: 3 },
  ],
}
const before: AttentionMeasures = {
  ...attention,
  waitsOnYou: { ...attention.waitsOnYou, medianMinutes: 4 },
}
const merged: HomeMeasure = {
  id: 'merged',
  question: 'How much shipped?',
  value: 28,
  unit: 'count',
  window: 'quarter',
  series: [1, 2, 3, 2, 3, 4, 2, 1, 2, 3, 1, 3, 7],
  previous: 20,
}
const firstPass: HomeMeasure = {
  id: 'foundry-first-pass',
  question: 'Orders that shipped first time',
  value: 71,
  unit: 'percent',
  window: '30d',
  series: [],
}
const usage = {
  sessions: [{}, {}],
  totals: {
    tokens: { input: 9_000_000, output: 3_400_000, cacheCreation: 0, cacheRead: 0 },
    costUsd: 12.4,
    costIsPartial: false,
  },
}

const measuresCall = vi.fn()
const usageCall = vi.fn()

function seedFeed(measures: HomeMeasure[]): void {
  useHomeFeedStore.setState({ asks: [], facets: [], focus: [], measures })
}

beforeEach(() => {
  vi.clearAllMocks()
  measuresCall.mockImplementation(() => Promise.resolve({ data: attention }))
  measuresCall.mockImplementationOnce(() => Promise.resolve({ data: attention }))
  measuresCall.mockImplementationOnce(() => Promise.resolve({ data: before }))
  usageCall.mockResolvedValue({ data: usage })
  installElectronApi({ attention: { measures: measuresCall }, agentUsage: { get: usageCall } })
  useSessionRecordsStore.setState({ records: new Map() })
  useExtensionRegistry.setState({ insightsSections: new Map() })
  seedFeed([merged, firstPass])
})

const card = (question: string): HTMLElement =>
  screen.getByText(question, { exact: false }).closest('.tmui-metric-card') as HTMLElement

describe('Insights: the cards', () => {
  it('shows the shipped count for the week, cut from the weekly points, against last week', async () => {
    render(<Insights />)
    const shipped = card('How much shipped?')
    expect(within(shipped).getByText('7')).toBeTruthy()
    expect(within(shipped).getByText('4 more than last week')).toBeTruthy()
  })

  it('shows how long agents waited, and that it rose from the range before', async () => {
    render(<Insights />)
    const wait = await waitFor(() => {
      const el = card('How long do agents wait on me?')
      expect(within(el).getByText('6')).toBeTruthy()
      return el
    })
    expect(within(wait).getByText(/up from 4/)).toBeTruthy()
    expect(within(wait).getByText(/38 asks, 3 waited over 30 min/)).toBeTruthy()
  })
})

describe('Insights: agent time', () => {
  it('spends agent time from the attention measures, tokens and an estimated cost', async () => {
    render(<Insights />)
    const spending = await waitFor(() => {
      const el = card('How am I spending agent time?')
      expect(within(el).getByText('21')).toBeTruthy()
      return el
    })
    expect(within(spending).getByText('58%')).toBeTruthy()
    expect(within(spending).getByText('12M')).toBeTruthy()
    expect(within(spending).getByText('$12.40')).toBeTruthy()
    expect(within(spending).getByText(/\(estimate\)/)).toBeTruthy()
  })

  it('says the cost is partial when some model had no price', async () => {
    usageCall.mockResolvedValue({
      data: { ...usage, totals: { ...usage.totals, costIsPartial: true } },
    })
    render(<Insights />)
    expect(await screen.findByText(/estimate, partial/)).toBeTruthy()
  })
})

describe('Insights: nothing made up', () => {
  it('says there is not enough merged work rather than inventing a duration', () => {
    render(<Insights />)
    expect(
      within(card('How long from start to merge?')).getByText('Not enough merged work yet')
    ).toBeTruthy()
    expect(
      within(card('Where did the time go?')).getByText('Not enough merged work yet')
    ).toBeTruthy()
  })
})

describe('Insights: nothing made up, measures', () => {
  it('shows no shipped number when nobody published the measure, and hides the Foundry card', () => {
    seedFeed([])
    render(<Insights />)
    expect(within(card('How much shipped?')).getByText('Not measured for this range')).toBeTruthy()
    expect(screen.queryByText('How often does it pass first time?', { exact: false })).toBeNull()
  })

  it('shows the Foundry card as not measured for a range its measure does not cover', () => {
    render(<Insights />)
    expect(
      within(card('How often does it pass first time?')).getByText('Not measured for this range')
    ).toBeTruthy()
  })

  it('shows empty cards when attention cannot be read', async () => {
    measuresCall.mockReset()
    measuresCall.mockRejectedValue(new Error('no'))
    render(<Insights />)
    await waitFor(() => expect(measuresCall).toHaveBeenCalled())
    expect(
      within(card('How long do agents wait on me?')).getByText(
        'No agent has waited on you in this range'
      )
    ).toBeTruthy()
  })
})

describe('Insights: the window', () => {
  it('asks for a week first, and for 30 days, and the 30 before, after switching', async () => {
    render(<Insights />)
    await waitFor(() => expect(measuresCall).toHaveBeenCalledTimes(2))
    const week = measuresCall.mock.calls[0][0].window
    expect(week.to - week.from).toBe(7 * DAY)

    fireEvent.click(screen.getByRole('radio', { name: '30 days' }))
    await waitFor(() => expect(measuresCall).toHaveBeenCalledTimes(4))
    const [current, previous] = measuresCall.mock.calls.slice(2).map((call) => call[0].window)
    expect(current.to - current.from).toBe(30 * DAY)
    expect(previous.to).toBe(current.from)
    expect(usageCall.mock.calls[1][0].from).toBe(new Date(current.from).toISOString())
  })

  it('shows the Foundry measure once the window it covers is chosen', async () => {
    render(<Insights />)
    fireEvent.click(screen.getByRole('radio', { name: '30 days' }))
    expect(within(card('How often does it pass first time?')).getByText('71')).toBeTruthy()
  })
})

describe('Insights: sections from extensions', () => {
  it('draws an extension section under "When do I ship?"', () => {
    useExtensionRegistry.getState().registerInsightsSection({
      id: 'com.test.ext',
      label: 'Contributions',
      component: () => <p>heatmap here</p>,
    })
    render(<Insights />)
    const ship = card('When do I ship?')
    const section = within(ship).getByRole('region', { name: 'Contributions' })
    expect(within(section).getByText('heatmap here')).toBeTruthy()
  })
})

const feedAsk = (patch: Partial<Sourced<HomeAsk>>): Sourced<HomeAsk> => ({
  id: 'x',
  source: 'git',
  kind: 'review',
  title: '',
  detail: '',
  facts: [],
  workKey: null,
  since: new Date().toISOString(),
  actions: [],
  open: { command: 'x' },
  ...patch,
})
const weeklyReview = feedAsk({
  id: 'weekly-review',
  source: 'vault',
  kind: 'task',
  title: 'Weekly review is ready',
  detail: 'Look back',
  actions: [{ id: 'start-review', label: 'Start', primary: true }],
})
const oldestReviewAsk = feedAsk({
  id: 'review:acme#41',
  title: 'Review requested',
  detail: 'Fluent #41',
  since: new Date(Date.now() - 3 * 3_600_000).toISOString(),
})

describe('Insights: looking back', () => {
  it('offers the weekly review through the feed action, the longest wait and the oldest review', async () => {
    const runAction = vi.fn().mockResolvedValue(true)
    useHomeFeedStore.setState({ runAction, asks: [weeklyReview, oldestReviewAsk] })
    render(<Insights />)
    const back = card('Looking back')
    fireEvent.click(within(back).getByRole('button', { name: 'Start' }))
    expect(runAction).toHaveBeenCalledWith('vault', 'weekly-review', 'start-review')
    expect(within(back).getByText(/Fluent #41 · 3 h/)).toBeTruthy()
    await waitFor(() => expect(within(back).getByText(/52 min/)).toBeTruthy())
  })

  it('says there is nothing to look back on when there is none', () => {
    render(<Insights />)
    expect(within(card('Looking back')).getByText('Nothing to look back on yet.')).toBeTruthy()
  })
})
