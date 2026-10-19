import { describe, it, expect } from 'vitest'
import {
  buildAsks,
  buildFacets,
  buildMergedFacets,
  buildMeasures,
  buildGitHomeFeed,
} from '../../src/home/feed'
import {
  buildContributionCalendar,
  type Contribution,
} from '../../src/review/contribution-calendar'
import type { TicketIndex } from '../../src/home/work-key'
import { dashboardPrFixture } from './support/dashboard-pr'

const NO_ISSUES: TicketIndex = new Map()
const MY_ISSUES: TicketIndex = new Map([['TAV-20', 'linear']])

describe('buildAsks: review', () => {
  it('asks for a review of each requested pull request, with its size and risk', () => {
    const pr = dashboardPrFixture({ section: 'requested', number: 40, title: 'Fix cache' })
    const [ask] = buildAsks([pr], NO_ISSUES)
    expect(ask).toMatchObject({
      id: 'review:acme/widgets#40',
      title: 'Review requested',
      detail: 'Fix cache',
      facts: ['6 files', '+120 −30', 'about 3 min', 'medium risk'],
      since: '2026-10-15T09:00:00Z',
      actions: [{ id: 'start-review', label: 'Start review', primary: true }],
      open: { args: { repoRoot: '/work/widgets', number: 40 } },
    })
    expect(ask.open.command).toBe('terminator.git-integration.command.review-pull-request')
  })

  it('titles a re-review differently', () => {
    const [ask] = buildAsks([dashboardPrFixture({ section: 're-review' })], NO_ISSUES)
    expect(ask.title).toBe('Re-review requested')
  })

  it('names the repository when there is no local checkout', () => {
    const [ask] = buildAsks(
      [dashboardPrFixture({ section: 'requested', localRepoRoot: null })],
      NO_ISSUES
    )
    expect(ask.open.args).toEqual({ repoRoot: 'gh:acme/widgets', number: 275 })
  })

  it.each(['team', 'involved'] as const)('asks nothing for the %s section', (section) => {
    expect(buildAsks([dashboardPrFixture({ section })], NO_ISSUES)).toEqual([])
  })
})

describe('buildAsks: where', () => {
  it('says where the request comes from: the repo, its ticket and the number', () => {
    const pr = dashboardPrFixture({ section: 'requested', number: 41, headRefName: 'tav-20-cache' })
    const [ask] = buildAsks([pr], new Map([['TAV-20', 'linear']]) as TicketIndex)
    expect(ask.where).toBe('widgets · TAV-20 · pull request #41')
  })
})

describe('buildAsks: fix', () => {
  it('asks to fix my open pull request with failing checks', () => {
    const [ask] = buildAsks(
      [dashboardPrFixture({ section: 'mine', ciStatus: 'failing' })],
      NO_ISSUES
    )
    expect(ask).toMatchObject({
      id: 'fix:acme/widgets#275',
      kind: 'fix',
      title: 'Check failed',
      detail: 'Checks failed',
      facts: [],
      workKey: { repoRoot: '/work/widgets', branch: 'feat/login' },
      actions: [
        { id: 'send-to-agent', label: 'Send to agent', primary: true },
        { id: 'open-log', label: 'Open log' },
      ],
    })
  })

  it.each(['passing', 'pending', 'none'] as const)('asks nothing when checks are %s', (ci) => {
    expect(buildAsks([dashboardPrFixture({ ciStatus: ci })], NO_ISSUES)).toEqual([])
  })

  it('carries the ticket key of the branch as the work key', () => {
    const [ask] = buildAsks(
      [dashboardPrFixture({ ciStatus: 'failing', headRefName: 'tav-20-overview' })],
      MY_ISSUES
    )
    expect(ask.workKey).toEqual({ tracker: 'linear', key: 'TAV-20' })
  })
})

const at = '2026-10-18T10:00:00Z'
const firstFacetOf = (overrides: Parameters<typeof dashboardPrFixture>[0]) =>
  buildFacets([dashboardPrFixture(overrides)], NO_ISSUES, at)[0]

const STATE_ROWS = [
  {
    given: { isDraft: true },
    stage: 'building',
    whoseMove: 'you',
    tone: 'neutral',
    line: '#275 draft',
  },
  {
    given: { ciStatus: 'none' },
    stage: 'in-review',
    whoseMove: 'others',
    tone: 'waiting',
    line: '#275 waiting for review',
  },
  {
    given: {},
    stage: 'in-review',
    whoseMove: 'others',
    tone: 'good',
    line: '#275 checks passed',
  },
  {
    given: { ciStatus: 'pending' },
    stage: 'in-review',
    whoseMove: 'others',
    tone: 'waiting',
    line: '#275 checks running',
  },
  {
    given: { ciStatus: 'failing' },
    stage: 'in-review',
    whoseMove: 'you',
    tone: 'bad',
    line: '#275 checks failing',
  },
  {
    given: { reviewDecision: 'changes-requested' },
    stage: 'in-review',
    whoseMove: 'you',
    tone: 'bad',
    line: '#275 changes requested',
  },
  {
    given: { reviewDecision: 'approved' },
    stage: 'merging',
    whoseMove: 'you',
    tone: 'good',
    line: '#275 approved',
  },
] as const

describe('buildFacets: stage and whose move', () => {
  it.each(STATE_ROWS)('$line is $stage, $whoseMove, $tone', ({ given, ...expected }) => {
    expect(firstFacetOf(given)).toMatchObject(expected)
  })
})

describe('buildFacets: shape', () => {
  it('describes the pull request and when it was read', () => {
    expect(firstFacetOf({})).toMatchObject({
      kind: 'pull-request',
      title: 'Add login redirect',
      url: 'https://github.com/acme/widgets/pull/275',
      closedAt: null,
      updatedAt: at,
      workKey: { repoRoot: '/work/widgets', branch: 'feat/login' },
    })
  })

  it('makes a facet for my pull requests only, and only those it can key', () => {
    const prs = [
      dashboardPrFixture({ section: 'requested' }),
      dashboardPrFixture({ number: 2, localRepoRoot: null, headRefName: 'x', title: 'no key' }),
      dashboardPrFixture({ number: 3, ciStatus: 'none' }),
    ]
    expect(buildFacets(prs, NO_ISSUES, at).map((f) => f.line)).toEqual(['#3 waiting for review'])
  })
})

const CHECKS = [
  { name: 'End-to-end tests', state: 'failed', completedAt: '2026-10-18T08:00:00Z' },
  { name: 'Unit tests', state: 'passed' },
  { name: 'Lint', state: 'passed' },
  { name: 'Type check', state: 'passed' },
  { name: 'Visual diff', state: 'failed', completedAt: '2026-10-18T09:00:00Z' },
  { name: 'Build', state: 'running' },
] as const

describe('buildAsks: what the data says about the checks and the request', () => {
  const failingCheck = () =>
    buildAsks([dashboardPrFixture({ ciStatus: 'failing', checks: [...CHECKS] })], NO_ISSUES)[0]

  it('names the first failing check and counts the failures', () => {
    expect(failingCheck()).toMatchObject({
      detail: 'End-to-end tests: 2 of 6 failed',
      facts: ['End-to-end tests', 'Visual diff'],
    })
  })

  it('dates the failure by the latest failing check', () => {
    expect(failingCheck().since).toBe('2026-10-18T09:00:00Z')
  })

  it('dates a review request by the request, else by the pull request', () => {
    const asked = dashboardPrFixture({
      section: 'requested',
      reviewRequestedAt: '2026-10-17T10:00:00Z',
    })
    const unknown = dashboardPrFixture({ section: 'requested' })
    expect(buildAsks([asked, unknown], NO_ISSUES).map((a) => a.since)).toEqual([
      '2026-10-17T10:00:00Z',
      '2026-10-15T09:00:00Z',
    ])
  })
})

describe('buildFacets: checks', () => {
  it('lists failed and running checks one by one and passed checks as one line', () => {
    const [facet] = buildFacets([dashboardPrFixture({ checks: [...CHECKS] })], NO_ISSUES, at)
    expect(facet.checks).toEqual([
      { name: 'End-to-end tests', state: 'failed' },
      { name: 'Visual diff', state: 'failed' },
      { name: 'Build', state: 'running' },
      { name: 'Unit tests, Lint, Type check', state: 'passed' },
    ])
  })

  it('carries no checks when the data has none', () => {
    expect(firstFacetOf({}).checks).toBeUndefined()
  })
})

function mergedAt(day: string, count: number): Contribution[] {
  return Array.from({ length: count }, () => ({
    kind: 'merged' as const,
    at: `${day}T12:00:00Z`,
    repo: 'acme/widgets',
  }))
}

// 2026-10-18 is a Sunday: the current week is Mon 10-12..Sun 10-18.
const calendar = buildContributionCalendar(
  [
    ...mergedAt('2026-10-13', 2),
    ...mergedAt('2026-10-16', 1),
    ...mergedAt('2026-10-06', 4),
    ...mergedAt('2026-07-15', 5),
    ...mergedAt('2026-03-02', 9),
  ],
  '2026-10-18',
  'UTC'
)

describe('buildMeasures', () => {
  it('publishes how much shipped as merged counts per week, oldest first', () => {
    const [merged] = buildMeasures(calendar)
    expect(merged).toMatchObject({
      id: 'shipped',
      question: 'How much shipped?',
      unit: 'count',
      window: 'quarter',
    })
    expect(merged.series).toHaveLength(13)
    expect(merged.series.slice(-2)).toEqual([4, 3])
    expect(merged.series[0]).toBe(0)
  })

  it('totals the quarter and compares it with the quarter before', () => {
    const [merged] = buildMeasures(calendar)
    expect(merged.value).toBe(7)
    expect(merged.previous).toBe(5)
  })

  it('publishes the last 36 days of contribution levels, oldest first, for the Today rail', () => {
    const days = buildMeasures(calendar).find((m) => m.id === 'contributions-days')
    expect(days?.series).toHaveLength(36)
    // 2026-10-18 is the last day; 10-16 had a merge, 10-17 and 10-18 none.
    expect(days?.series.at(-3)).toBeGreaterThan(0)
    expect(days?.series.at(-2)).toBe(0)
    expect(days?.series.at(-1)).toBe(0)
    expect(days?.series.every((level) => level >= 0 && level <= 4)).toBe(true)
  })

  it('publishes no measure before contributions have been fetched', () => {
    expect(buildMeasures(null)).toEqual([])
  })
})

describe('buildGitHomeFeed', () => {
  it('joins the three builders', () => {
    const feed = buildGitHomeFeed({
      prs: [dashboardPrFixture({ ciStatus: 'failing' })],
      tickets: NO_ISSUES,
      calendar: null,
      merged: [],
      updatedAt: '2026-10-18T10:00:00Z',
    })
    expect(feed.asks.map((a) => a.kind)).toEqual(['fix'])
    expect(feed.facets).toHaveLength(1)
    expect(feed.measures).toEqual([])
  })
})

const merged = {
  repo: 'acme/widgets',
  number: 41,
  title: 'TAV-20 Add login redirect',
  url: 'https://github.com/acme/widgets/pull/41',
  headRefName: 'tav-20-login',
  localRepoRoot: '/work/widgets',
  openedAt: '2026-10-10T09:00:00Z',
  readyAt: '2026-10-12T10:00:00Z',
  firstReviewAt: null,
  mergedAt: '2026-10-14T15:00:00Z',
  checksMinutes: 7,
}

describe('buildMergedFacets', () => {
  it('publishes a shipped, closed facet that carries the timeline', () => {
    const tickets = new Map([['TAV-20', 'linear' as const]])
    const [facet] = buildMergedFacets([merged], tickets, '2026-10-18T12:00:00Z')
    expect(facet).toMatchObject({
      workKey: { tracker: 'linear', key: 'TAV-20' },
      kind: 'pull-request',
      stage: 'shipped',
      tone: 'good',
      closedAt: merged.mergedAt,
      openedAt: merged.openedAt,
      readyAt: merged.readyAt,
      firstReviewAt: null,
      checksMinutes: 7,
    })
  })

  it('falls back to the checkout and branch without a matching issue', () => {
    const [facet] = buildMergedFacets([merged], new Map(), '2026-10-18T12:00:00Z')
    expect(facet.workKey).toEqual({ repoRoot: '/work/widgets', branch: 'tav-20-login' })
  })
})
