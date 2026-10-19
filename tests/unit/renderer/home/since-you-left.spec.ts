import { describe, it, expect } from 'vitest'
import { sinceYouLeft } from '../../../../src/renderer/home/since-you-left'
import { facet } from './fixtures'
import type { HomeAsk } from '../../../../src/shared/schemas/home-feed.schema'

const LEFT = Date.parse('2026-10-18T08:00:00.000Z')
const after = '2026-10-18T09:00:00.000Z'
const before = '2026-10-18T07:00:00.000Z'
const ask = (kind: HomeAsk['kind'], since: string): HomeAsk => ({
  id: kind + since,
  kind,
  title: `${kind} title`,
  detail: `${kind} detail`,
  facts: [],
  workKey: null,
  since,
  actions: [],
  open: { command: 'x' },
})

const prOn = (branch: string, patch: Parameters<typeof facet>[0] = {}) =>
  facet({ workKey: { repoRoot: '/r', branch }, updatedAt: after, ...patch })

describe('sinceYouLeft: asks', () => {
  it('reports finished agents and review requests after you left, newest first', () => {
    const asks = [
      ask('finished', after),
      ask('review', '2026-10-18T10:00:00.000Z'),
      ask('finished', before),
      ask('answer', after),
    ]
    expect(sinceYouLeft(asks, [], LEFT).map((e) => e.kind)).toEqual([
      'review-requested',
      'agent-finished',
    ])
  })

  it('reports nothing when Home was never left', () => {
    expect(sinceYouLeft([ask('finished', after)], [], null)).toEqual([])
  })
})

describe('sinceYouLeft: pull requests', () => {
  it('reports merged, approved and failed pull requests', () => {
    const facets = [
      prOn('a', { closedAt: after, tone: 'good' }),
      prOn('b', { stage: 'merging', tone: 'good' }),
      prOn('c', { checks: [{ name: 'unit', state: 'failed' }] }),
    ]
    expect(
      sinceYouLeft([], facets, LEFT)
        .map((e) => e.kind)
        .sort()
    ).toEqual(['checks-failed', 'pull-request-approved', 'pull-request-merged'])
  })

  it('leaves out quiet pull requests, tasks, and anything merged before you left', () => {
    const facets = [
      prOn('d'),
      prOn('e', { kind: 'task' }),
      prOn('f', { closedAt: before, tone: 'good', updatedAt: before }),
    ]
    expect(sinceYouLeft([], facets, LEFT)).toEqual([])
  })
})
