import type {
  HomeAsk,
  HomeFeed,
  HomeMeasure,
  ThreadFacet,
} from '../../../src/shared/schemas/home-feed.schema'

const ask: HomeAsk = {
  id: 'ask-1',
  kind: 'review',
  title: 'Review NW-88',
  detail: 'Two files changed since you looked',
  facts: ['+120 -4', '2 comments'],
  workKey: { tracker: 'linear', key: 'NW-88' },
  since: '2026-10-18T09:00:00.000Z',
  actions: [{ id: 'approve', label: 'Approve', primary: true }],
  open: { command: 'git.openPullRequest', args: { number: 12 } },
}

const facet: ThreadFacet = {
  workKey: { repoRoot: '/code/northwind', branch: 'nw-88' },
  kind: 'pull-request',
  stage: 'in-review',
  whoseMove: 'you',
  title: 'Keep the ticket',
  line: 'Waiting on your review',
  tone: 'waiting',
  url: 'https://github.com/northwind/api/pull/12',
  closedAt: null,
  checks: [{ name: 'ci', state: 'running', detail: 'unit' }],
  updatedAt: '2026-10-18T09:00:00.000Z',
}

const measure: HomeMeasure = {
  id: 'shipped',
  question: 'How many pull requests merged?',
  value: 4,
  unit: 'count',
  window: 'week',
  series: [1, 0, 3],
  previous: 2,
}

export function fullFeed(): HomeFeed {
  return {
    asks: [{ ...ask }],
    facets: [{ ...facet }],
    measures: [{ ...measure }],
    focus: [{ id: 'f1', title: 'Ship NW-88', workKey: null, done: false }],
  }
}
