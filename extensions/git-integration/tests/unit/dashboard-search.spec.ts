import { describe, it, expect, vi } from 'vitest'
import {
  DASHBOARD_QUERIES,
  buildSectionQueries,
  dashboardBranches,
  parseDashboard,
  resolveBranchExclusions,
} from '../../src/github/dashboard-search'

/** A PR's `commits` field whose latest commit carries `rollup` as its status check rollup. */
function commitsWithRollup(oid: string, rollup: unknown, committedDate = '2026-01-01') {
  return { nodes: [{ commit: { oid, committedDate, statusCheckRollup: rollup } }] }
}

/** One of a pull request's latest reviews, as the dashboard query returns it. */
interface LatestReview {
  author: { login: string }
  submittedAt: string
  commit: { oid: string }
}

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
    updatedAt: '2026-01-02T00:00:00Z',
    repository: { nameWithOwner: 'acme/widgets' },
    headRefName: 'fix/bug',
    author: { login: 'alice' },
    reviewDecision: 'REVIEW_REQUIRED',
    reviewRequests: { totalCount: 1 },
    reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }] },
    commits: commitsWithRollup('a', { state: 'SUCCESS' }, '2026-01-01T00:00:00Z'),
    latestReviews: { nodes: [] as LatestReview[] },
    ...overrides,
  }
}

const sections = ['involved', 'mine', 're-review', 'requested', 'team']

const repoCount = (search: string) => search.match(/ repo:/g)?.length ?? 0

/** The query `buildSectionQueries('bob')` builds for `section`. */
const queryOf = (section: string) =>
  buildSectionQueries('bob').find((q) => q.section === section)!.query

describe('buildSectionQueries', () => {
  it.each(sections)('builds the %s query with exactly one search and no repository', (section) => {
    const query = queryOf(section)
    expect(query.match(/: search\(/g)).toHaveLength(1)
    expect(query).toContain('fragment prFields on PullRequest')
    expect(query).not.toContain(' repo:')
  })

  it('builds one query per section, named for its section', () => {
    const queries = buildSectionQueries('bob')
    expect(queries.map((q) => q.section).sort()).toEqual(sections)
    const byName = Object.fromEntries(queries.map((q) => [q.section, q.query]))
    expect(byName['re-review']).toContain('reReview: search')
    expect(byName.team).toContain('team-review-requested-user:bob')
    expect(byName.team).not.toContain('LOGIN')
  })
})

describe('buildSectionQueries — splits 450 repositories into chunks of at most 200 per section', () => {
  const repos = Array.from({ length: 450 }, (_, i) => `acme/repo-${i}`)

  it('builds three queries for each of the five sections', () => {
    expect(buildSectionQueries('bob', repos)).toHaveLength(15)
  })

  it.each(sections)('splits the %s section into chunks of 200, 200 and 50', (section) => {
    const own = buildSectionQueries('bob', repos).filter((q) => q.section === section)
    expect(own.map((q) => repoCount(q.query))).toEqual([200, 200, 50])
    const covered = own.flatMap((q) =>
      [...q.query.matchAll(/ repo:(acme\/repo-\d+)/g)].map((m) => m[1])
    )
    expect(covered).toEqual(repos)
  })

  it('appends the qualifiers to the section query inside the search string', () => {
    const [first] = buildSectionQueries('bob', ['acme/widgets', 'acme/gadgets']).filter(
      (q) => q.section === 'mine'
    )
    expect(first.query).toContain(`${DASHBOARD_QUERIES.mine} repo:acme/widgets repo:acme/gadgets"`)
  })
})

describe('buildSectionQueries — sorts every section newest first and asks for the match count', () => {
  it.each(sections)('sorts the %s section newest first and asks for the match count', (section) => {
    const query = queryOf(section)
    expect(query).toContain('sort:created-desc')
    expect(query).toContain('issueCount')
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
    const [pr] = parseDashboard(raw, { login: 'alice', localRoots: new Map() })
    expect(pr.section).toBe('mine')
    expect(pr.repo).toBe('acme/widgets')
    expect([pr.additions, pr.deletions]).toEqual([100, 50])
    expect(pr.ciStatus).toBe('passing')
    expect(pr.reviewDecision).toBe('review-required')
    expect(pr.unresolvedThreads).toBe(1)
    expect(pr.updatedAt).toBe('2026-01-02T00:00:00Z')
    expect(pr.localRepoRoot).toBeNull()
  })
})

describe('parseDashboard — leaves out pull requests whose source branch is excluded', () => {
  // Settings → Git → Branch Exclude Patterns: a pull request opened from an
  // excluded branch (a bot's renovate/*, a merge queue's gh-readonly-queue/*)
  // is not one to review, in any section.
  it('leaves out pull requests whose source branch is excluded', () => {
    const raw = {
      data: {
        requested: {
          nodes: [
            prNode({ number: 1, headRefName: 'renovate/vitest-4' }),
            prNode({ number: 2, headRefName: 'feat/login' }),
          ],
        },
        mine: { nodes: [prNode({ number: 3, headRefName: 'renovate/eslint' })] },
      },
    }
    const localRoots = new Map([['acme/widgets', '/Users/me/repos/widgets']])
    const asked: Array<[string, string | undefined]> = []
    const prs = parseDashboard(
      raw,
      { login: 'alice', localRoots: localRoots },
      (branch, repoPath) => {
        asked.push([branch, repoPath])
        return branch.startsWith('renovate/')
      }
    )
    expect(prs.map((pr) => pr.number)).toEqual([2])
    expect(asked).toContainEqual(['renovate/vitest-4', '/Users/me/repos/widgets'])
  })
})

describe('parseDashboard — asks for the source branch in the search query', () => {
  it('asks for the source branch in the search query', () => {
    expect(buildSectionQueries('alice')[0].query).toContain('headRefName')
  })

  it('resolves localRepoRoot from the provided map', () => {
    const raw = { data: { mine: { nodes: [prNode()] } } }
    const localRoots = new Map([['acme/widgets', '/Users/me/repos/widgets']])
    const [pr] = parseDashboard(raw, { login: 'alice', localRoots: localRoots })
    expect(pr.localRepoRoot).toBe('/Users/me/repos/widgets')
  })
})

describe('parseDashboard — CI status', () => {
  it('maps ciStatus from the latest commit statusCheckRollup', () => {
    const failing = prNode({ commits: commitsWithRollup('a', { state: 'FAILURE' }) })
    const pending = prNode({ number: 2, commits: commitsWithRollup('b', { state: 'PENDING' }) })
    const none = prNode({ number: 3, commits: commitsWithRollup('c', null) })
    const raw = { data: { mine: { nodes: [failing, pending, none] } } }
    const [a, b, c] = parseDashboard(raw, { login: 'alice', localRoots: new Map() })
    expect(a.ciStatus).toBe('failing')
    expect(b.ciStatus).toBe('pending')
    expect(c.ciStatus).toBe('none')
  })
})

describe('parseDashboard — review decision', () => {
  it('maps reviewDecision values, defaulting unknown to none', () => {
    const approved = prNode({ reviewDecision: 'APPROVED' })
    const changesRequested = prNode({ number: 2, reviewDecision: 'CHANGES_REQUESTED' })
    const unknown = prNode({ number: 3, reviewDecision: null })
    const raw = { data: { mine: { nodes: [approved, changesRequested, unknown] } } }
    const [a, b, c] = parseDashboard(raw, { login: 'alice', localRoots: new Map() })
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
    const [pr] = parseDashboard(raw, { login: 'alice', localRoots: new Map() })
    expect(pr.reviewerCount).toBe(4) // 2 requested + 2 distinct (carol, dave)
  })
})

describe('parseDashboard — computes commitsSinceMyReview by counting commits after my latest review', () => {
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
    const [pr] = parseDashboard(raw, { login: 'alice', localRoots: new Map() })
    expect(pr.commitsSinceMyReview).toBe(2)
  })
})

describe('parseDashboard — reviewedByMe from my latest reviews', () => {
  const reviewByAlice = {
    author: { login: 'alice' },
    submittedAt: '2026-01-02T00:00:00Z',
    commit: { oid: 'a' },
  }

  it.each([
    ['flags a pull request whose latestReviews include the viewer', [reviewByAlice], true],
    ['does not flag a pull request the viewer never reviewed', [], false],
  ])('%s', (_name, reviews, reviewedByMe) => {
    const node = prNode({ latestReviews: { nodes: reviews } })
    const raw = { data: { requested: { nodes: [node] } } }
    const [pr] = parseDashboard(raw, { login: 'alice', localRoots: new Map() })
    expect(pr.reviewedByMe).toBe(reviewedByMe)
  })
})

describe('parseDashboard — drops re-review rows with no commits since my review', () => {
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
    const result = parseDashboard(raw, { login: 'alice', localRoots: new Map() })
    expect(result).toHaveLength(0)
  })

  it('returns 0 commitsSinceMyReview when I have no review on the PR', () => {
    const node = prNode({ latestReviews: { nodes: [] } })
    const raw = { data: { mine: { nodes: [node] } } }
    const [pr] = parseDashboard(raw, { login: 'alice', localRoots: new Map() })
    expect(pr.commitsSinceMyReview).toBe(0)
  })
})

describe('parseDashboard — dedupes across sections by precedence requested > re-review > team > involved', () => {
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
    const result = parseDashboard(raw, { login: 'alice', localRoots: new Map() })
    expect(result).toHaveLength(1)
    expect(result[0].section).toBe('requested')
  })
})

describe('parseDashboard — keeps a re-review row the reviewer was not re-requested on', () => {
  it('keeps a re-review row the reviewer was not re-requested on', () => {
    const shared = prNode({ number: 9 })
    shared.latestReviews.nodes = [
      { author: { login: 'alice' }, submittedAt: '2020-01-01', commit: { oid: 'a' } },
    ]
    const raw = {
      data: { reReview: { nodes: [shared] }, team: { nodes: [prNode({ number: 9 })] } },
    }
    const result = parseDashboard(raw, { login: 'alice', localRoots: new Map() })
    expect(result.map((r) => r.section)).toEqual(['re-review'])
  })
})

describe('parseDashboard — keeps mine rows independent of dedup against other sections', () => {
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
    const result = parseDashboard(raw, { login: 'alice', localRoots: new Map() })
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.section).sort()).toEqual(['involved', 'mine'])
  })

  it('handles a missing data payload gracefully', () => {
    expect(parseDashboard({}, { login: 'alice', localRoots: new Map() })).toEqual([])
  })
})

// The core answers whether a branch is excluded across the extension host's
// port (SDK 4.0.0), so the answers are gathered before the pure filter runs.
describe('resolveBranchExclusions', () => {
  it('asks once per distinct branch and checkout, and answers from the replies', async () => {
    const query = vi.fn(async (branch: string, repoPath?: string) =>
      repoPath === '/repo' ? branch.startsWith('renovate/') : false
    )
    const excluded = await resolveBranchExclusions(query, [
      { branch: 'renovate/x', repoPath: '/repo' },
      { branch: 'renovate/x', repoPath: '/repo' },
      { branch: 'renovate/x', repoPath: '/other' },
      { branch: 'feat/y', repoPath: '/repo' },
    ])

    expect(query).toHaveBeenCalledTimes(3)
    expect(excluded('renovate/x', '/repo')).toBe(true)
    expect(excluded('renovate/x', '/other')).toBe(false)
    expect(excluded('feat/y', '/repo')).toBe(false)
  })
})

describe('dashboardBranches', () => {
  it('lists the pull requests of every section with the checkout of their repository', () => {
    const raw = {
      data: {
        requested: { nodes: [prNode({ headRefName: 'renovate/x' }), null] },
        mine: { nodes: [prNode({ repository: { nameWithOwner: 'acme/other' } })] },
      },
    }
    const roots = new Map([['acme/widgets', '/widgets']])

    expect(dashboardBranches(raw, roots)).toEqual([
      { branch: 'renovate/x', repoPath: '/widgets' },
      { branch: 'fix/bug', repoPath: undefined },
    ])
  })
})

describe('buildSectionQueries — asks only the sections that need them for checks and request times', () => {
  it('asks for the latest commit checks on my pull requests', () => {
    expect(queryOf('mine')).toContain('latestChecks')
    expect(queryOf('mine')).toContain('contexts(first: 50)')
  })

  it.each(['requested', 're-review', 'team', 'involved'])(
    'asks for no latest commit checks on the %s section',
    (section) => {
      expect(queryOf(section)).not.toContain('latestChecks')
    }
  )

  it('asks for the review request time on requested and re-review only', () => {
    expect(queryOf('requested')).toContain('REVIEW_REQUESTED_EVENT')
    expect(queryOf('re-review')).toContain('REVIEW_REQUESTED_EVENT')
    expect(queryOf('mine')).not.toContain('REVIEW_REQUESTED_EVENT')
  })
})

describe('parseDashboard — checks and request time', () => {
  const viewer = { login: 'alice', localRoots: new Map<string, string>() }

  it('maps my pull request checks from the latest commit', () => {
    const latestChecks = {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                nodes: [
                  {
                    __typename: 'CheckRun',
                    name: 'e2e',
                    status: 'COMPLETED',
                    conclusion: 'FAILURE',
                  },
                ],
              },
            },
          },
        },
      ],
    }
    const raw = { data: { mine: { nodes: [prNode({ latestChecks })] } } }
    expect(parseDashboard(raw, viewer)[0].checks).toEqual([{ name: 'e2e', state: 'failed' }])
  })
})

describe('parseDashboard — request time', () => {
  const viewer = { login: 'alice', localRoots: new Map<string, string>() }

  it('maps when a review was requested of me', () => {
    const reviewRequestEvents = {
      nodes: [{ createdAt: '2026-10-17T10:00:00Z', requestedReviewer: { login: 'alice' } }],
    }
    const raw = { data: { requested: { nodes: [prNode({ reviewRequestEvents })] } } }
    expect(parseDashboard(raw, viewer)[0].reviewRequestedAt).toBe('2026-10-17T10:00:00Z')
  })

  it('leaves them out when the section did not ask', () => {
    const [pr] = parseDashboard({ data: { mine: { nodes: [prNode()] } } }, viewer)
    expect(pr).not.toHaveProperty('checks')
    expect(pr).not.toHaveProperty('reviewRequestedAt')
  })
})
