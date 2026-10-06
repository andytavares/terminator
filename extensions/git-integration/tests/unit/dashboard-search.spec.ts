import { describe, it, expect } from 'vitest'
import {
  DASHBOARD_QUERIES,
  buildSectionQueries,
  parseDashboard,
} from '../../src/github/dashboard-search'

function prNode(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    title: 'Fix bug',
    url: 'https://github.com/acme/widgets/pull/1',
    isDraft: false,
    additions: 10,
    deletions: 5,
    changedFiles: 2,
    createdAt: '2026-01-01T00:00:00Z',
    repository: { nameWithOwner: 'acme/widgets' },
    author: { login: 'alice' },
    reviewDecision: 'REVIEW_REQUIRED',
    reviewRequests: { totalCount: 1 },
    reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }] },
    commits: {
      nodes: [
        {
          commit: {
            oid: 'a',
            committedDate: '2026-01-01T00:00:00Z',
            statusCheckRollup: { state: 'SUCCESS' },
          },
        },
      ],
    },
    latestReviews: { nodes: [] },
    ...overrides,
  }
}

describe('DASHBOARD_QUERIES', () => {
  it('defines a search query for every dashboard section', () => {
    expect(DASHBOARD_QUERIES['re-review']).toBe(
      'is:pr is:open archived:false reviewed-by:@me -author:@me'
    )
    expect(DASHBOARD_QUERIES.requested).toBe(
      'is:pr is:open archived:false user-review-requested:@me'
    )
    expect(DASHBOARD_QUERIES.team).toBe(
      'is:pr is:open archived:false team-review-requested-user:LOGIN'
    )
    expect(DASHBOARD_QUERIES.mine).toBe('is:pr is:open author:@me')
    expect(DASHBOARD_QUERIES.involved).toBe('is:pr is:open involves:@me -author:@me')
  })
})

describe('buildSectionQueries', () => {
  // GitHub resolves aliased searches one after another inside a single request,
  // so one combined query took the sum of every section and hit the ~10 s cutoff.
  it('builds one query per section, each holding exactly one search', () => {
    const queries = buildSectionQueries('bob')
    expect(Object.keys(queries).sort()).toEqual(
      ['involved', 'mine', 're-review', 'requested', 'team'].sort()
    )
    for (const query of Object.values(queries)) {
      expect(query.match(/: search\(/g)).toHaveLength(1)
      expect(query).toContain('fragment prFields on PullRequest')
    }
    expect(queries['re-review']).toContain('reReview: search')
    expect(queries.team).toContain('team-review-requested-user:bob')
    expect(queries.team).not.toContain('LOGIN')
  })
})

describe('parseDashboard', () => {
  it('maps a PR node into a DashboardPR with derived fields', () => {
    const raw = {
      data: {
        viewer: { login: 'alice' },
        mine: { nodes: [prNode({ number: 5, additions: 100, deletions: 50 })] },
        reReview: { nodes: [] },
        requested: { nodes: [] },
        team: { nodes: [] },
        involved: { nodes: [] },
      },
    }
    const [pr] = parseDashboard(raw, 'alice', new Map())
    expect(pr.section).toBe('mine')
    expect(pr.repo).toBe('acme/widgets')
    expect(pr.riskLevel).toBe('medium') // 150 total hits the medium threshold
    expect(pr.estimatedMinutes).toBe(3) // ceil(150/60)
    expect(pr.ciStatus).toBe('passing')
    expect(pr.reviewDecision).toBe('review-required')
    expect(pr.unresolvedThreads).toBe(1)
    expect(pr.localRepoRoot).toBeNull()
  })

  it('resolves localRepoRoot from the provided map', () => {
    const raw = { data: { mine: { nodes: [prNode()] } } }
    const localRoots = new Map([['acme/widgets', '/Users/me/repos/widgets']])
    const [pr] = parseDashboard(raw, 'alice', localRoots)
    expect(pr.localRepoRoot).toBe('/Users/me/repos/widgets')
  })

  it('maps ciStatus from the latest commit statusCheckRollup', () => {
    const failing = prNode({
      commits: {
        nodes: [
          {
            commit: {
              oid: 'a',
              committedDate: '2026-01-01',
              statusCheckRollup: { state: 'FAILURE' },
            },
          },
        ],
      },
    })
    const pending = prNode({
      number: 2,
      commits: {
        nodes: [
          {
            commit: {
              oid: 'b',
              committedDate: '2026-01-01',
              statusCheckRollup: { state: 'PENDING' },
            },
          },
        ],
      },
    })
    const none = prNode({
      number: 3,
      commits: {
        nodes: [{ commit: { oid: 'c', committedDate: '2026-01-01', statusCheckRollup: null } }],
      },
    })
    const raw = { data: { mine: { nodes: [failing, pending, none] } } }
    const [a, b, c] = parseDashboard(raw, 'alice', new Map())
    expect(a.ciStatus).toBe('failing')
    expect(b.ciStatus).toBe('pending')
    expect(c.ciStatus).toBe('none')
  })

  it('maps reviewDecision values, defaulting unknown to none', () => {
    const approved = prNode({ reviewDecision: 'APPROVED' })
    const changesRequested = prNode({ number: 2, reviewDecision: 'CHANGES_REQUESTED' })
    const unknown = prNode({ number: 3, reviewDecision: null })
    const raw = { data: { mine: { nodes: [approved, changesRequested, unknown] } } }
    const [a, b, c] = parseDashboard(raw, 'alice', new Map())
    expect(a.reviewDecision).toBe('approved')
    expect(b.reviewDecision).toBe('changes-requested')
    expect(c.reviewDecision).toBe('none')
  })

  it('computes reviewerCount as requested totalCount plus distinct review authors', () => {
    const node = prNode({
      reviewRequests: { totalCount: 2 },
      latestReviews: {
        nodes: [
          { author: { login: 'carol' }, submittedAt: '2026-01-01', commit: { oid: 'a' } },
          { author: { login: 'carol' }, submittedAt: '2026-01-02', commit: { oid: 'b' } },
          { author: { login: 'dave' }, submittedAt: '2026-01-01', commit: { oid: 'a' } },
        ],
      },
    })
    const raw = { data: { mine: { nodes: [node] } } }
    const [pr] = parseDashboard(raw, 'alice', new Map())
    expect(pr.reviewerCount).toBe(4) // 2 requested + 2 distinct (carol, dave)
  })

  it('computes commitsSinceMyReview by counting commits after my latest review', () => {
    const node = prNode({
      commits: {
        nodes: [
          { commit: { oid: 'a', committedDate: '2026-01-01T00:00:00Z', statusCheckRollup: null } },
          { commit: { oid: 'b', committedDate: '2026-01-03T00:00:00Z', statusCheckRollup: null } },
          { commit: { oid: 'c', committedDate: '2026-01-05T00:00:00Z', statusCheckRollup: null } },
        ],
      },
      latestReviews: {
        nodes: [
          { author: { login: 'alice' }, submittedAt: '2026-01-02T00:00:00Z', commit: { oid: 'a' } },
        ],
      },
    })
    const raw = { data: { reReview: { nodes: [node] } } }
    const [pr] = parseDashboard(raw, 'alice', new Map())
    expect(pr.commitsSinceMyReview).toBe(2)
  })

  it('drops re-review rows with no commits since my review', () => {
    const node = prNode({
      commits: {
        nodes: [
          { commit: { oid: 'a', committedDate: '2026-01-01T00:00:00Z', statusCheckRollup: null } },
        ],
      },
      latestReviews: {
        nodes: [
          { author: { login: 'alice' }, submittedAt: '2026-01-02T00:00:00Z', commit: { oid: 'a' } },
        ],
      },
    })
    const raw = { data: { reReview: { nodes: [node] } } }
    const result = parseDashboard(raw, 'alice', new Map())
    expect(result).toHaveLength(0)
  })

  it('returns 0 commitsSinceMyReview when I have no review on the PR', () => {
    const node = prNode({ latestReviews: { nodes: [] } })
    const raw = { data: { mine: { nodes: [node] } } }
    const [pr] = parseDashboard(raw, 'alice', new Map())
    expect(pr.commitsSinceMyReview).toBe(0)
  })

  it('dedupes across sections by precedence requested > re-review > team > involved', () => {
    const shared = prNode({ number: 9 })
    const sharedRequested = prNode({ number: 9 })
    const raw = {
      data: {
        reReview: { nodes: [shared] },
        requested: { nodes: [sharedRequested] },
        team: { nodes: [prNode({ number: 9 })] },
        involved: { nodes: [prNode({ number: 9 })] },
        mine: { nodes: [] },
      },
    }
    shared.latestReviews.nodes = [
      { author: { login: 'alice' }, submittedAt: '2020-01-01', commit: { oid: 'a' } },
    ]
    const result = parseDashboard(raw, 'alice', new Map())
    expect(result).toHaveLength(1)
    expect(result[0].section).toBe('requested')
  })

  it('keeps a re-review row the reviewer was not re-requested on', () => {
    const shared = prNode({ number: 9 })
    shared.latestReviews.nodes = [
      { author: { login: 'alice' }, submittedAt: '2020-01-01', commit: { oid: 'a' } },
    ]
    const raw = {
      data: { reReview: { nodes: [shared] }, team: { nodes: [prNode({ number: 9 })] } },
    }
    const result = parseDashboard(raw, 'alice', new Map())
    expect(result.map((r) => r.section)).toEqual(['re-review'])
  })

  it('keeps mine rows independent of dedup against other sections', () => {
    const node = prNode({ number: 9 })
    const raw = {
      data: {
        reReview: { nodes: [] },
        requested: { nodes: [] },
        team: { nodes: [] },
        involved: { nodes: [{ ...node }] },
        mine: { nodes: [{ ...node }] },
      },
    }
    const result = parseDashboard(raw, 'alice', new Map())
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.section).sort()).toEqual(['involved', 'mine'])
  })

  it('handles a missing data payload gracefully', () => {
    expect(parseDashboard({}, 'alice', new Map())).toEqual([])
  })

  it('flags a high-risk large PR', () => {
    const node = prNode({ additions: 300, deletions: 200 })
    const raw = { data: { mine: { nodes: [node] } } }
    const [pr] = parseDashboard(raw, 'alice', new Map())
    expect(pr.riskLevel).toBe('high')
    expect(pr.estimatedMinutes).toBe(9) // ceil(500/60)
  })
})
