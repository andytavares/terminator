import { HOME_MEASURES } from '@terminator/extension-sdk'
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ExtensionAPI, HomeFeed } from '@terminator/extension-sdk'
import { partialFake } from '../../../../tests/support/fakes'
import { createHomePublisher, HOME_REFRESH_MS, MERGED_REFRESH_MS } from '../../src/home/publisher'
import { buildContributionCalendar } from '../../src/review/contribution-calendar'
import { dashboardPrFixture } from './support/dashboard-pr'
import { eventually } from '../../../../tests/support/eventually'

const issue = (key: string) => ({ key, tracker: 'linear' as const })

function setupPublisher(myIssues: Array<ReturnType<typeof issue>> = []) {
  const published: HomeFeed[] = []
  const onActionDispose = vi.fn()
  const api = partialFake<ExtensionAPI>({
    home: {
      publish: (feed) => void published.push(feed),
      onAction: () => ({ dispose: onActionDispose }),
    },
    issues: partialFake<ExtensionAPI['issues']>({
      listMine: async () => ({ issues: myIssues as never, failures: [] }),
    }),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })
  const publisher = createHomePublisher(api, '/storage')
  return { published, publisher, api, onActionDispose }
}

afterEach(() => vi.useRealTimers())

describe('dashboard refresh', () => {
  it('publishes the asks and facets of the refreshed pull requests', () => {
    const { published, publisher } = setupPublisher()
    publisher.hooks.onDashboard({
      prs: [
        dashboardPrFixture({ ciStatus: 'failing' }),
        dashboardPrFixture({ number: 9, section: 'requested' }),
      ],
      failed: [],
    })
    expect(published).toHaveLength(1)
    expect(published[0].asks.map((a) => a.id)).toEqual([
      'fix:acme/widgets#275',
      'review:acme/widgets#9',
    ])
    expect(published[0].facets.map((f) => f.line)).toEqual(['#275 checks failing'])
  })

  it('keeps the previous feed when a section failed, so its asks do not vanish', () => {
    const { published, publisher } = setupPublisher()
    publisher.hooks.onDashboard({
      prs: [dashboardPrFixture({ section: 'mine' })],
      failed: [{ section: 'requested', error: 'HTTP 502' }],
    })
    expect(published).toEqual([])
  })
})

describe('dashboard refresh: facet times', () => {
  it('publishes identical facets when the same dashboard is read again later', () => {
    vi.useFakeTimers()
    const { published, publisher } = setupPublisher()
    const result = { prs: [dashboardPrFixture({ ciStatus: 'failing' })], failed: [] }
    publisher.hooks.onDashboard(result)
    vi.setSystemTime(Date.now() + HOME_REFRESH_MS)
    publisher.hooks.onDashboard(result)
    expect(published[1].facets).toEqual(published[0].facets)
    expect(published[0].facets[0].updatedAt).toBe('2026-10-16T09:00:00Z')
  })
})

describe('dashboard refresh: tickets', () => {
  it('republishes with the work keys of the issues once they arrive', async () => {
    const { published, publisher } = setupPublisher([issue('TAV-20')])
    const pr = dashboardPrFixture({ headRefName: 'tav-20-pr-overview', ciStatus: 'failing' })
    publisher.hooks.onDashboard({ prs: [pr], failed: [] })
    expect(published[0].asks[0].workKey).toEqual({
      repoRoot: '/work/widgets',
      branch: 'tav-20-pr-overview',
    })
    await eventually(() => expect(published).toHaveLength(2))
    expect(published[1].asks[0].workKey).toEqual({ tracker: 'linear', key: 'TAV-20' })
  })
})

describe('contributions fetch', () => {
  it('publishes the shipped measure beside the asks already read', () => {
    const { published, publisher } = setupPublisher()
    publisher.hooks.onDashboard({ prs: [dashboardPrFixture({ ciStatus: 'failing' })], failed: [] })
    publisher.hooks.onContributions(buildContributionCalendar([], '2026-10-18', 'UTC'))
    expect(published.at(-1)?.asks).toHaveLength(1)
    expect(published.at(-1)?.measures.map((m) => m.id)).toEqual([
      HOME_MEASURES.shipped,
      HOME_MEASURES.contributionsDays,
    ])
  })
})

describe('background refresh', () => {
  it('refreshes at once and at the dashboard interval until disposed', async () => {
    vi.useFakeTimers()
    const { publisher } = setupPublisher()
    const refresh = vi.fn(async () => {})
    const refreshing = publisher.refreshEvery(refresh)
    expect(refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(HOME_REFRESH_MS * 2)
    expect(refresh).toHaveBeenCalledTimes(3)
    refreshing.dispose()
    await vi.advanceTimersByTimeAsync(HOME_REFRESH_MS * 2)
    expect(refresh).toHaveBeenCalledTimes(3)
  })

  it('logs a failed refresh and carries on', async () => {
    vi.useFakeTimers()
    const { publisher, api } = setupPublisher()
    const refreshing = publisher.refreshEvery(async () => Promise.reject(new Error('HTTP 502')))
    await vi.advanceTimersByTimeAsync(0)
    expect(api.log.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 502'))
    refreshing.dispose()
  })
})

const merged = {
  repo: 'acme/widgets',
  number: 41,
  title: 'Add login redirect',
  url: 'https://github.com/acme/widgets/pull/41',
  headRefName: 'feat/login',
  localRepoRoot: '/work/widgets',
  openedAt: '2026-10-10T09:00:00Z',
  readyAt: '2026-10-10T09:00:00Z',
  firstReviewAt: null,
  mergedAt: '2026-10-14T15:00:00Z',
  checksMinutes: null,
}

describe('merged pull requests', () => {
  it('publishes them as shipped facets beside the open ones', () => {
    const { published, publisher } = setupPublisher()
    publisher.hooks.onMerged([merged])
    expect(published.at(-1)?.facets.map((f) => [f.stage, f.closedAt])).toEqual([
      ['shipped', merged.mergedAt],
    ])
  })
})

describe('merged search schedule', () => {
  it('searches at once and then every 15 minutes, not with the 2-minute dashboard refresh', async () => {
    vi.useFakeTimers()
    const { publisher } = setupPublisher()
    const search = vi.fn(async () => {})
    const searching = publisher.refreshMergedEvery(search)
    await vi.advanceTimersByTimeAsync(MERGED_REFRESH_MS - 1)
    expect(search).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(search).toHaveBeenCalledTimes(2)
    searching.dispose()
    await vi.advanceTimersByTimeAsync(MERGED_REFRESH_MS)
    expect(search).toHaveBeenCalledTimes(2)
  })
})
