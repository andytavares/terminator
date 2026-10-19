import { describe, it, expect } from 'vitest'
import { MERGED_DAYS, mergedQuery, parseMerged } from '../../src/github/merged-search'

const NOW = Date.parse('2026-10-18T12:00:00Z')
const LOCAL_ROOTS = new Map([['acme/widgets', '/work/widgets']])

interface NodeOverrides {
  ready?: string | null
  reviews?: Array<{ login: string; at: string }>
  runs?: Array<{ startedAt: string | null; completedAt: string | null }>
}

function mergedNode({ ready = null, reviews = [], runs = [] }: NodeOverrides = {}) {
  return {
    number: 41,
    title: 'TAV-20 Add login redirect',
    url: 'https://github.com/acme/widgets/pull/41',
    headRefName: 'tav-20-login',
    createdAt: '2026-10-10T09:00:00Z',
    mergedAt: '2026-10-14T15:00:00Z',
    author: { login: 'andrew' },
    repository: { nameWithOwner: 'acme/widgets' },
    readyEvents: { nodes: ready === null ? [] : [{ createdAt: ready }] },
    reviews: {
      nodes: reviews.map((r) => ({ author: { login: r.login }, submittedAt: r.at })),
    },
    lastCommit: {
      nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: runs } } } }],
    },
  }
}

const parseMergedFixture = (node: unknown) =>
  parseMerged({ data: { merged: { nodes: [node] } } }, LOCAL_ROOTS)

describe('mergedQuery', () => {
  it('searches my merged pull requests of the last 90 days in one search', () => {
    const query = mergedQuery(NOW)
    expect(MERGED_DAYS).toBe(90)
    expect(query).toContain('is:pr author:@me is:merged merged:>=2026-07-20')
    expect(query.match(/search\(/g)).toHaveLength(1)
    expect(query).toContain('first: 50')
  })
})

describe('parseMerged', () => {
  it('reads the draft exit, the first review by someone else and the checks time', () => {
    const [merged] = parseMergedFixture(
      mergedNode({
        ready: '2026-10-12T10:00:00Z',
        reviews: [
          { login: 'andrew', at: '2026-10-12T11:00:00Z' },
          { login: 'sam', at: '2026-10-13T08:00:00Z' },
        ],
        runs: [
          { startedAt: '2026-10-12T10:00:00Z', completedAt: '2026-10-12T10:06:00Z' },
          { startedAt: '2026-10-12T10:00:00Z', completedAt: '2026-10-12T10:04:30Z' },
        ],
      })
    )
    expect(merged).toMatchObject({
      repo: 'acme/widgets',
      number: 41,
      localRepoRoot: '/work/widgets',
      openedAt: '2026-10-10T09:00:00Z',
      readyAt: '2026-10-12T10:00:00Z',
      firstReviewAt: '2026-10-13T08:00:00Z',
      mergedAt: '2026-10-14T15:00:00Z',
      checksMinutes: 10.5,
    })
  })
})

describe('parseMerged: what the timeline lacks', () => {
  it('takes the opening time as the ready time when there was no draft stage', () => {
    expect(parseMergedFixture(mergedNode())[0].readyAt).toBe('2026-10-10T09:00:00Z')
  })

  it('has no first review when nobody else reviewed, and no checks time without timing', () => {
    const [merged] = parseMergedFixture(
      mergedNode({
        reviews: [{ login: 'andrew', at: '2026-10-12T11:00:00Z' }],
        runs: [{ startedAt: null, completedAt: null }],
      })
    )
    expect(merged.firstReviewAt).toBeNull()
    expect(merged.checksMinutes).toBeNull()
  })
})

describe('parseMerged: nodes GitHub cannot show', () => {
  it('skips a null node, which GitHub returns for an inaccessible result', () => {
    expect(parseMerged({ data: { merged: { nodes: [null] } } }, LOCAL_ROOTS)).toEqual([])
    expect(parseMerged({}, LOCAL_ROOTS)).toEqual([])
  })
})
