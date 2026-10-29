import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Insights } from '../../../../src/renderer/components/home/Insights'
import { InsightsBar } from '../../../../src/renderer/components/home/InsightsBar'
import { useInsightsWindow } from '../../../../src/renderer/components/home/insights-window'
import { useHomeFeedStore } from '../../../../src/renderer/stores/home-feed.store'
import { useDismissalsStore } from '../../../../src/renderer/home/dismissals'
import { askSignature } from '../../../../src/renderer/home/desk-order'
import { useSessionRecordsStore } from '../../../../src/renderer/stores/session-records.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { installElectronApi } from '../../../support/electron-api'
import type { AttentionMeasures } from '../../../../src/shared/home/attention-measures'
import type {
  HomeAsk,
  HomeMeasure,
  Sourced,
  ThreadFacet,
} from '../../../../src/shared/schemas/home-feed.schema'

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
const merged: Sourced<HomeMeasure> = {
  source: 'git-integration',
  id: 'shipped',
  question: 'How much shipped?',
  value: 28,
  unit: 'count',
  window: 'quarter',
  series: [1, 2, 3, 2, 3, 4, 2, 1, 2, 3, 1, 3, 7],
  previous: 20,
}
const firstPass: Sourced<HomeMeasure> = {
  source: 'foundry',
  id: 'first-pass',
  question: 'How often do Foundry orders pass first time?',
  detail: 'of Foundry orders passed their checks on the first try',
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
const intervalsCall = vi.fn()

function seedFeed(measures: Sourced<HomeMeasure>[]): void {
  useHomeFeedStore.setState({ asks: [], facets: [], focus: [], measures })
}

beforeEach(() => {
  useInsightsWindow.setState({ chosen: 'week' })
  useDismissalsStore.setState({ entries: {} })
  vi.clearAllMocks()
  measuresCall.mockImplementation(() => Promise.resolve({ data: attention }))
  measuresCall.mockImplementationOnce(() => Promise.resolve({ data: attention }))
  measuresCall.mockImplementationOnce(() => Promise.resolve({ data: before }))
  usageCall.mockResolvedValue({ data: usage })
  intervalsCall.mockResolvedValue({ data: [] })
  installElectronApi({
    attention: { measures: measuresCall, intervals: intervalsCall },
    agentUsage: { get: usageCall },
  })
  useSessionRecordsStore.setState({ records: new Map() })
  useExtensionRegistry.setState({ insightsSections: new Map() })
  seedFeed([merged, firstPass])
})

const card = (question: string): HTMLElement =>
  screen.getByText(question, { exact: false }).closest('.tmui-metric-card') as HTMLElement

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

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

const mergedFacet = (key: string): Sourced<ThreadFacet> => ({
  source: 'git-integration',
  workKey: { tracker: 'linear', key },
  kind: 'pull-request',
  stage: 'shipped',
  whoseMove: 'others',
  line: '#41 merged',
  tone: 'good',
  closedAt: new Date(Date.now() - DAY).toISOString(),
  openedAt: new Date(Date.now() - 4 * DAY).toISOString(),
  readyAt: new Date(Date.now() - 3 * DAY).toISOString(),
  firstReviewAt: new Date(Date.now() - 2 * DAY).toISOString(),
  checksMinutes: 12,
  updatedAt: new Date().toISOString(),
})

describe('Insights: where the time went', () => {
  it('draws a bar per merged ticket and a legend of the measured segments only', async () => {
    const facets = ['TAV-1', 'TAV-2', 'TAV-3'].map(mergedFacet)
    useHomeFeedStore.setState({ asks: [], facets, focus: [], measures: [merged] })
    render(<Insights />)
    const time = card('Where did the time go?')
    expect(await within(time).findAllByRole('img')).toHaveLength(3)
    expect(within(time).getByRole('img', { name: /TAV-1: 1 d Waiting for review/ })).toBeTruthy()
    const legend = within(time).getByRole('list', { name: 'Legend' })
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual(['Waiting for review', 'Checks running'])
    expect(within(card('How long from start to merge?')).getByText('3')).toBeTruthy()
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
  it('shows no shipped number when nobody published the measure, nor a first-pass figure', () => {
    seedFeed([])
    render(<Insights />)
    expect(within(card('How much shipped?')).getByText('Not measured for this range')).toBeTruthy()
    expect(
      within(card('How often does it pass first time?')).getByText('Nothing measures this yet')
    ).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Foundry/)
  })

  it('shows the Foundry card as not measured for a range its measure does not cover', () => {
    render(<Insights />)
    expect(within(card(firstPass.question)).getByText('Not measured for this range')).toBeTruthy()
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

/** Insights as Home draws it: the window control sits in Home's header. */
function WithHeaderBar(): React.JSX.Element {
  return (
    <>
      <InsightsBar />
      <Insights />
    </>
  )
}

describe('Insights: the window', () => {
  it('asks for a week first, and for 30 days, and the 30 before, after switching', async () => {
    render(<WithHeaderBar />)
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
    render(<WithHeaderBar />)
    fireEvent.click(screen.getByRole('radio', { name: '30 days' }))
    expect(within(card(firstPass.question)).getByText('71')).toBeTruthy()
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

const insightsFeedAsk = (patch: Partial<Sourced<HomeAsk>>): Sourced<HomeAsk> => ({
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
const oldestReviewAsk = insightsFeedAsk({
  id: 'review:acme#41',
  title: 'Review requested',
  detail: 'Fluent #41',
  since: new Date(Date.now() - 3 * 3_600_000).toISOString(),
})

describe('Insights: dismissing a looking-back row', () => {
  it('dismisses the oldest review so a dead request leaves the card and stays gone', () => {
    useHomeFeedStore.setState({ asks: [oldestReviewAsk] })
    render(<Insights />)
    const back = card('Looking back')
    fireEvent.click(within(back).getByRole('button', { name: 'Dismiss Fluent #41' }))
    expect(within(back).queryByText(/Fluent #41/)).toBeNull()
    expect(useDismissalsStore.getState().entries['review:acme#41']?.kind).toBe('done')
  })

  it('does not offer a review the operator already dismissed', () => {
    useHomeFeedStore.setState({ asks: [oldestReviewAsk] })
    useDismissalsStore.setState({ entries: { 'review:acme#41': { kind: 'done', at: Date.now() } } })
    render(<Insights />)
    expect(within(card('Looking back')).queryByText(/Fluent #41/)).toBeNull()
  })
})

describe('Insights: a snoozed row in looking back', () => {
  it('hides a row while it is snoozed and shows it again once the snooze has run out', () => {
    const snooze = (until: number) => ({
      'review:acme#41': {
        kind: 'snoozed' as const,
        at: 0,
        until,
        signature: askSignature(oldestReviewAsk),
      },
    })
    useHomeFeedStore.setState({ asks: [oldestReviewAsk] })
    useDismissalsStore.setState({ entries: snooze(Date.now() + 3_600_000) })
    const { unmount } = render(<Insights />)
    expect(within(card('Looking back')).queryByText(/Fluent #41/)).toBeNull()
    unmount()
    useDismissalsStore.setState({ entries: snooze(Date.now() - 1000) })
    render(<Insights />)
    expect(within(card('Looking back')).getByText(/Fluent #41/)).toBeTruthy()
  })
})

describe('Insights: looking back', () => {
  it('shows the longest wait and the oldest review', async () => {
    useHomeFeedStore.setState({ asks: [oldestReviewAsk] })
    render(<Insights />)
    const back = card('Looking back')
    expect(within(back).getByText(/Fluent #41 · 3 h/)).toBeTruthy()
    await waitFor(() => expect(within(back).getByText(/52 min/)).toBeTruthy())
  })

  it('says there is nothing to look back on when there is none', () => {
    render(<Insights />)
    expect(within(card('Looking back')).getByText('Nothing to look back on yet.')).toBeTruthy()
  })
})
