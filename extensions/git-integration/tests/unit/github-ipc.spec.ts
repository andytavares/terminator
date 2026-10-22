import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }))

vi.mock('child_process', () => ({ execFile: mockExecFile }))
const { sessionData } = vi.hoisted(() => ({ sessionData: {} as Record<string, unknown> }))
vi.mock('electron-store', () => ({
  default: class {
    constructor(opts?: { name?: string }) {
      if (opts?.name === 'pr-review-sessions') this.store = sessionData
    }
    get() {
      return undefined
    }
    set() {}
    delete() {}
    store: Record<string, unknown> = {}
  },
}))
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('no file')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

// ── import after mocks ────────────────────────────────────────────────────────

import ElectronStore from 'electron-store'
import { dispatchChannel, type ChannelSpec } from '@terminator/extension-sdk'
import { registerGithubHandlers } from '../../src/ipc/github.ipc'
import { bindWorkspaceRoots } from '../../src/ipc/repo-root'
import { reviewQueuePr } from './support/review-queue-pr'
import { stateForSearch } from '../../src/github/gh-cli'
import {
  bindShellToStub,
  githubOverStub,
  stubAnswering,
  stubFails,
  stubPrints,
} from './support/shell'

bindShellToStub(mockExecFile)
bindWorkspaceRoots(() => ['/repo', '/other', '/Users/me/repos/widgets'])

// api.paths.globalStorage: where gh runs when it needs no checkout, inside a root the core allows.
const GLOBAL_STORAGE =
  '/Users/me/Library/Application Support/Terminator/extensions/terminator.git-integration'

// ── helpers ───────────────────────────────────────────────────────────────────

// Vitest hands the real electron-store to a dynamic import that runs while the first one is still
// loading the mock, and remove-active-review opens two stores at once. Open each store alone first.
beforeAll(async () => {
  const handlers = captureHandlers()
  await handlers['github:sessions-for-repo']({ repoRoot: '/repo' })
  await handlers['github:active-reviews-for-repo']({ repoRoot: '/repo' })
})

type Handler = (payload: unknown) => Promise<unknown>
/** Registers each channel into `handlers`, answered as the core answers an invoke. */
const answerInto = (handlers: Record<string, Handler>) => (spec: ChannelSpec) => {
  handlers[spec.channel] = (payload) => dispatchChannel(spec, payload)
}

function captureHandlers(
  getReviewRepos?: () => string[],
  isBranchExcluded?: (branch: string, repoPath?: string) => Promise<boolean>
): Record<string, Handler> {
  const handlers: Record<string, Handler> = {}
  registerGithubHandlers(
    answerInto(handlers),
    { github: githubOverStub(mockExecFile), getToken: () => '', noCheckoutCwd: GLOBAL_STORAGE },
    { getReviewRepos, isBranchExcluded }
  )
  return handlers
}

/** Handlers registered afresh, with mocks cleared, before each test of the describe. */
function freshHandlers(): Record<string, Handler> {
  const handlers: Record<string, Handler> = {}
  beforeEach(() => {
    vi.clearAllMocks()
    // A gh call no test queued fails, as it does when gh cannot answer, instead of never replying.
    mockExecFile.mockImplementation(stubFails(new Error('no reply queued')))
    Object.assign(handlers, captureHandlers())
  })
  return handlers
}

function captureHandlersWithToken(token: string): Record<string, Handler> {
  const handlers: Record<string, Handler> = {}
  registerGithubHandlers(answerInto(handlers), {
    github: githubOverStub(mockExecFile),
    getToken: () => token,
    noCheckoutCwd: GLOBAL_STORAGE,
  })
  return handlers
}

function mockGitSuccess(stdout: string) {
  mockExecFile.mockImplementationOnce(stubPrints(stdout))
}

function mockGitFailure(message: string) {
  mockExecFile.mockImplementationOnce(stubFails(new Error(message)))
}

/** The graphql reply for the section a dashboard query names by its alias, or its failure. */
function dashboardSectionReply(
  args: string[],
  sections: Record<string, unknown[]>,
  failing: Record<string, Error>
): string | Error {
  const alias = /(\w+): search\(/.exec(args[3])![1]
  if (failing[alias]) return failing[alias]
  return JSON.stringify({ data: { [alias]: { nodes: sections[alias] ?? [] } } })
}

// The dashboard sends one graphql request per section in parallel, so replies are
// routed by the alias in each query rather than queued in call order.
function mockDashboardExec(
  sections: Record<string, unknown[]>,
  remotes: Record<string, string | Error> = {},
  failing: Record<string, Error> = {}
) {
  mockExecFile.mockImplementation(
    stubAnswering(({ args, cwd }) => {
      if (args[0] === 'api' && args[1] === 'user') return 'alice'
      if (args[0] === 'api' && args[1] === 'graphql')
        return dashboardSectionReply(args, sections, failing)
      return remotes[cwd ?? ''] ?? new Error('no remote')
    })
  )
}

function mockGitFailureWithStdout(message: string, stdout: string) {
  mockExecFile.mockImplementationOnce(
    stubFails(Object.assign(new Error(message), { stdout, stderr: '' }))
  )
}

// ── tests ─────────────────────────────────────────────────────────────────────

// Minimal valid PR meta returned by `gh pr view --json ...`
const PR_META = {
  number: 6,
  title: 'Add feature',
  body: 'description',
  author: { login: 'alice', avatarUrl: '' },
  createdAt: '2024-01-01T00:00:00Z',
  headRefName: 'feat/thing',
  baseRefName: 'main',
  headRefOid: 'abc1234',
  statusCheckRollup: [],
}

// REST API format (filename + patch); handler now fetches this instead of gh pr view --json files
const PR_FILES_REST: unknown[] = []
const REPO_VIEW = { owner: { login: 'test-owner' }, name: 'test-repo' }

// Queue the five gh calls the pr-review-detail handler makes:
//   1. gh repo view (ownerAndName)
//   2. gh pr view --json ... (meta)         } parallel
//   3. gh api --paginate .../files          }
//   4. gh api .../reviews                  }
//   5. gh api .../requested_reviewers      }
function mockPrDetail(meta: unknown, files: unknown[] = PR_FILES_REST, reviews: unknown[] = []) {
  mockGitSuccess(JSON.stringify(REPO_VIEW))
  mockGitSuccess(JSON.stringify(meta))
  mockGitSuccess(JSON.stringify(files))
  mockGitSuccess(JSON.stringify(reviews))
  mockGitSuccess('{"users":[],"teams":[]}') // requested_reviewers — empty by default
}

/** A caller in usePrReview.ts and the computeRiskScore it calls, defined in the same PR. */
const CALLER_AND_DEFINITION_FILES = [
  {
    filename: 'src/hooks/usePrReview.ts',
    status: 'modified',
    additions: 2,
    deletions: 0,
    patch:
      '@@ -309,4 +309,6 @@ export function useFetchFileMetrics\n       for (const { file, metrics } of collected) {\n+        const riskScore = computeRiskScore(metrics, allMetrics)\n+        updateFileRiskScore(chapter.id, file.path, riskScore)\n       }',
  },
  {
    filename: 'src/github/pr-review-service.ts',
    status: 'modified',
    additions: 4,
    deletions: 0,
    patch:
      '@@ -86,3 +86,7 @@\n+export function computeRiskScore(metrics: FileMetrics, all: FileMetrics[]): RiskScore {\n+  if (all.length === 0 && metrics) return defaultRiskScore()\n+  return score(metrics, all)\n+}',
  },
]

/** What pr-review-detail answers that the reading-order test reads. */
interface AnalysedPr {
  readingOrder: Array<{ path: string; reason: string }>
  chapters: Array<{ files: Array<{ path: string; whyHere: string }> }>
  insights: { complexity: { branchDelta: number } } | null
}

/** A GraphQL page of a repository's pull requests holding `nodes`, the last page. */
function openPrPage(nodes: unknown[], extra: Record<string, unknown> = {}) {
  const pageInfo = { endCursor: null, hasNextPage: false }
  return { data: { repository: { pullRequests: { ...extra, pageInfo, nodes } } } }
}

/** A GraphQL pull request node with none of the optional fields. */
function minimalPrNode(number: number, title: string, headRefName: string) {
  return {
    number,
    title,
    isDraft: false,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    createdAt: '2025-06-01T00:00:00Z',
    headRefName,
    baseRefName: 'main',
    mergeStateStatus: 'CLEAN',
    author: { login: 'alice', avatarUrl: '' },
  }
}

/** A node's optional fields: an assignee, bob's approval, carol requested, CI passing. */
const OPTIONAL_PR_FIELDS = {
  assignees: { nodes: [{ login: 'reviewer1' }] },
  latestReviews: {
    nodes: [
      {
        author: { login: 'bob', avatarUrl: '' },
        state: 'APPROVED',
        submittedAt: '2025-06-02T00:00:00Z',
      },
    ],
  },
  reviewRequests: { nodes: [{ requestedReviewer: { login: 'carol', avatarUrl: '' } }] },
  commits: {
    nodes: [
      {
        commit: {
          statusCheckRollup: {
            contexts: { nodes: [{ name: 'CI', conclusion: 'SUCCESS', status: 'COMPLETED' }] },
          },
        },
      },
    ],
  },
}

/** A REST review comment by alice on line 10 of src/foo.ts. */
const REST_REVIEW_COMMENT = {
  id: 1,
  user: { login: 'alice', avatar_url: '' },
  body: 'Nice code',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  path: 'src/foo.ts',
  line: 10,
  start_line: null,
  side: 'RIGHT',
  diff_hunk: '@@ -1,3 +1,4 @@',
  in_reply_to_id: null,
  pull_request_review_id: 1,
}

/** A stored review session of PR 42 in /repo at abc123, with `overrides`. */
function storedSession(overrides: Record<string, unknown> = {}) {
  return {
    repoRoot: '/repo',
    prNumber: 42,
    headSHA: 'abc123',
    currentChapterId: null,
    currentFilePath: null,
    viewedFiles: [],
    fileOrderOverrides: {},
    scrollPosition: null,
    pausedAt: null,
    lastAccessedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** Makes the stores' set and delete write through to their data; returns the delete spy. */
function keepStoreWrites() {
  // spyOn types a mock by the last overload, set(object); the stores call set(key, value).
  vi.spyOn(ElectronStore.prototype, 'set').mockImplementation(function (
    this: { store: Record<string, unknown> },
    ...args: unknown[]
  ) {
    const [key, value] = args
    this.store[String(key)] = value
  })
  return vi.spyOn(ElectronStore.prototype, 'delete').mockImplementation(function (
    this: { store: Record<string, unknown> },
    key: PropertyKey
  ) {
    Reflect.deleteProperty(this.store, key)
  })
}

/** Handlers whose project checkouts are `projectRoots`. */
function handlersWithProjectRoots(projectRoots: string[]): Record<string, Handler> {
  const handlers: Record<string, Handler> = {}
  registerGithubHandlers(
    answerInto(handlers),
    { github: githubOverStub(mockExecFile), getToken: () => '', noCheckoutCwd: GLOBAL_STORAGE },
    { listProjectRoots: () => projectRoots }
  )
  return handlers
}

/** A dashboard search node: alice's PR `number` of `repo`, with nothing to note, and `overrides`. */
function dashboardSearchNode(
  repo: string,
  number: number,
  overrides: Record<string, unknown> = {}
) {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    isDraft: false,
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    createdAt: '2026-09-01T00:00:00Z',
    repository: { nameWithOwner: repo },
    author: { login: 'alice' },
    reviewDecision: null,
    reviewRequests: { totalCount: 0 },
    reviewThreads: { nodes: [] },
    commits: { nodes: [] },
    latestReviews: { nodes: [] },
    ...overrides,
  }
}

describe('github:pr-review-detail', () => {
  const handlers = freshHandlers()

  it('puts definitions before their callers and attaches the analysis', async () => {
    mockPrDetail(PR_META, CALLER_AND_DEFINITION_FILES)
    mockGitFailure('no history') // co-change git log
    mockGitFailure('not found') // check-suites fallback
    mockGitFailure('no match') // git grep for test references

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: AnalysedPr }
    const order = ['src/github/pr-review-service.ts', 'src/hooks/usePrReview.ts']
    expect(result.pr.readingOrder.map((s) => s.path)).toEqual(order)
    const flat = result.pr.chapters.flatMap((c) => c.files)
    expect(flat.map((f) => f.path)).toEqual(order)
    expect(flat[1].whyHere).toBe('Calls computeRiskScore (step 1)')
    expect(result.pr.insights?.complexity.branchDelta).toBeGreaterThan(0)
  })
})

const OWNER_TEST_FILES = ['web/app.tsx', 'api/main.py'].map((filename) => ({
  filename,
  status: 'modified',
  additions: 1,
  deletions: 0,
  patch: '@@ -1 +1,2 @@\n+x',
}))

/** Answers the owner lookups by what they ask for, after the PR's own calls have been queued. */
function answerOwnerLookups(codeowners: string | null) {
  mockExecFile.mockImplementation(
    stubAnswering(({ args, maxBuffer }) => {
      if (args[1].includes('contents/.github/CODEOWNERS') && codeowners !== null) {
        // gh turns -f into a POST unless told otherwise, and GitHub has no such route.
        if (args.includes('-f') && !args.includes('GET')) return new Error('404')
        // A real monorepo's CODEOWNERS is over the 1 MiB default output cap.
        if ((maxBuffer ?? 1024 * 1024) < 16 * 1024 * 1024) return new Error('maxBuffer exceeded')
        return codeowners
      }
      if (args[1] === 'user/teams') return 'klaviyo/frontend'
      if (args[1] === 'user') return 'ana'
      return new Error('404')
    })
  )
}

describe('github:pr-review-detail — the files the viewer owns', () => {
  const handlers = freshHandlers()

  async function ownedPathsOfPr(): Promise<string[]> {
    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { ownedPaths: string[] } }
    return result.pr.ownedPaths
  }

  it('lists the changed files that base-branch CODEOWNERS gives to the viewer or their team', async () => {
    mockPrDetail(PR_META, OWNER_TEST_FILES)
    answerOwnerLookups('* @klaviyo/backend\nweb/ @klaviyo/frontend')
    expect(await ownedPathsOfPr()).toEqual(['web/app.tsx'])
  })

  it('lists none when the base branch has no CODEOWNERS', async () => {
    mockPrDetail(PR_META, OWNER_TEST_FILES)
    answerOwnerLookups(null)
    expect(await ownedPathsOfPr()).toEqual([])
  })
})

describe('github:pr-review-detail — returns a pr object on success with no status checks', () => {
  const handlers = freshHandlers()

  it('returns a pr object on success with no status checks', async () => {
    mockPrDetail(PR_META)
    mockGitFailure('not found') // check-suites fallback when rollup is empty (best-effort, caught)

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: Record<string, unknown> }

    expect(result.pr.number).toBe(6)
    expect(result.pr.title).toBe('Add feature')
    expect(result.pr.statusChecks).toEqual([])
    expect(result.pr.ciStatus).toBe('none')
  })
})

describe('github:pr-review-detail — falls back to check-suites when statusCheckRollup is empty and suites are returned', () => {
  const handlers = freshHandlers()

  it('falls back to check-suites when statusCheckRollup is empty and suites are returned', async () => {
    mockPrDetail(PR_META)
    mockGitSuccess(JSON.stringify([{ name: 'Buildkite', state: 'queued', conclusion: null }]))

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { statusChecks: Array<{ name: string; state: string }> } }

    expect(result.pr.statusChecks).toHaveLength(1)
    expect(result.pr.statusChecks[0].name).toBe('Buildkite')
    expect(result.pr.statusChecks[0].state).toBe('pending')
  })
})

describe('github:pr-review-detail — leaves statusChecks empty when check-suites also returns empty array', () => {
  const handlers = freshHandlers()

  it('leaves statusChecks empty when check-suites also returns empty array', async () => {
    mockPrDetail(PR_META)
    mockGitSuccess(JSON.stringify([]))

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { statusChecks: unknown[] } }

    expect(result.pr.statusChecks).toEqual([])
  })
})

describe('github:pr-review-detail — skips check-suites fallback when headSHA is empty', () => {
  const handlers = freshHandlers()

  it('skips check-suites fallback when headSHA is empty', async () => {
    mockPrDetail({ ...PR_META, headRefOid: '' })
    // No 4th mock needed — the branch is skipped entirely

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { statusChecks: unknown[] } }

    expect(result.pr.statusChecks).toEqual([])
    const asked = mockExecFile.mock.calls.map((call) => (call[1] as string[]).join(' '))
    expect(asked.some((request) => request.includes('check-suites'))).toBe(false)
  })
})

describe('github:pr-review-detail — maps isDraft=true onto pr object', () => {
  const handlers = freshHandlers()

  it('maps isDraft=true onto pr object', async () => {
    mockPrDetail({ ...PR_META, isDraft: true })
    mockGitFailure('not found')

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { isDraft: boolean } }

    expect(result.pr.isDraft).toBe(true)
  })
})

describe('github:pr-review-detail — maps SUCCESS conclusion to pass state', () => {
  const handlers = freshHandlers()

  it('maps SUCCESS conclusion to pass state', async () => {
    mockPrDetail({
      ...PR_META,
      statusCheckRollup: [{ name: 'ci / build', conclusion: 'SUCCESS', url: 'https://ci/1' }],
    })

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { statusChecks: Array<{ name: string; state: string; url?: string }> } }

    expect(result.pr.statusChecks).toHaveLength(1)
    expect(result.pr.statusChecks[0].state).toBe('pass')
    expect(result.pr.statusChecks[0].url).toBe('https://ci/1')
  })
})

describe('github:pr-review-detail — maps FAILURE conclusion to fail state', () => {
  const handlers = freshHandlers()

  it('maps FAILURE conclusion to fail state', async () => {
    mockPrDetail({ ...PR_META, statusCheckRollup: [{ name: 'lint', conclusion: 'FAILURE' }] })

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { statusChecks: Array<{ state: string }> } }

    expect(result.pr.statusChecks[0].state).toBe('fail')
  })
})

describe('github:pr-review-detail — maps TIMED_OUT and ACTION_REQUIRED conclusions to fail', () => {
  const handlers = freshHandlers()

  it('maps TIMED_OUT and ACTION_REQUIRED conclusions to fail', async () => {
    for (const conclusion of ['TIMED_OUT', 'ACTION_REQUIRED', 'ERROR']) {
      Object.assign(handlers, captureHandlers()) // the owner lookup is cached per registration
      mockPrDetail({ ...PR_META, statusCheckRollup: [{ name: 'check', conclusion }] })

      const result = (await handlers['github:pr-review-detail']({
        repoRoot: '/repo',
        prNumber: 6,
      })) as { pr: { statusChecks: Array<{ state: string }> } }

      expect(result.pr.statusChecks[0].state).toBe('fail')
    }
  })
})

describe('github:pr-review-detail — maps IN_PROGRESS and QUEUED to pending state', () => {
  const handlers = freshHandlers()

  it('maps IN_PROGRESS and QUEUED to pending state', async () => {
    for (const conclusion of ['IN_PROGRESS', 'QUEUED', 'PENDING', 'WAITING']) {
      Object.assign(handlers, captureHandlers()) // the owner lookup is cached per registration
      mockPrDetail({ ...PR_META, statusCheckRollup: [{ name: 'check', conclusion }] })

      const result = (await handlers['github:pr-review-detail']({
        repoRoot: '/repo',
        prNumber: 6,
      })) as { pr: { statusChecks: Array<{ state: string }> } }

      expect(result.pr.statusChecks[0].state).toBe('pending')
    }
  })
})

describe('github:pr-review-detail — maps SKIPPED, NEUTRAL, CANCELLED to skipped state', () => {
  const handlers = freshHandlers()

  it('maps SKIPPED, NEUTRAL, CANCELLED to skipped state', async () => {
    for (const conclusion of ['SKIPPED', 'NEUTRAL', 'CANCELLED']) {
      Object.assign(handlers, captureHandlers()) // the owner lookup is cached per registration
      mockPrDetail({ ...PR_META, statusCheckRollup: [{ name: 'check', conclusion }] })

      const result = (await handlers['github:pr-review-detail']({
        repoRoot: '/repo',
        prNumber: 6,
      })) as { pr: { statusChecks: Array<{ state: string }> } }

      expect(result.pr.statusChecks[0].state).toBe('skipped')
    }
  })
})

describe('github:pr-review-detail — maps unknown conclusion string to unknown state', () => {
  const handlers = freshHandlers()

  it('maps unknown conclusion string to unknown state', async () => {
    mockPrDetail({
      ...PR_META,
      statusCheckRollup: [{ name: 'check', conclusion: 'SOMETHING_NEW' }],
    })

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { statusChecks: Array<{ state: string }> } }

    expect(result.pr.statusChecks[0].state).toBe('unknown')
  })
})

describe('github:pr-review-detail — uses state field when conclusion is absent (StatusContext)', () => {
  const handlers = freshHandlers()

  it('uses state field when conclusion is absent (StatusContext)', async () => {
    mockPrDetail({
      ...PR_META,
      statusCheckRollup: [{ context: 'legacy/check', state: 'SUCCESS' }],
    })

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { statusChecks: Array<{ name: string; state: string }> } }

    expect(result.pr.statusChecks[0].name).toBe('legacy/check')
    expect(result.pr.statusChecks[0].state).toBe('pass')
  })
})

describe('github:pr-review-detail — preserves multiple checks with mixed states', () => {
  const handlers = freshHandlers()

  it('preserves multiple checks with mixed states', async () => {
    mockPrDetail({
      ...PR_META,
      statusCheckRollup: [
        { name: 'build', conclusion: 'SUCCESS' },
        { name: 'lint', conclusion: 'FAILURE' },
        { name: 'deploy', conclusion: 'IN_PROGRESS' },
      ],
    })

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { statusChecks: Array<{ name: string; state: string }> } }

    expect(result.pr.statusChecks).toHaveLength(3)
    expect(result.pr.statusChecks.find((c) => c.name === 'build')?.state).toBe('pass')
    expect(result.pr.statusChecks.find((c) => c.name === 'lint')?.state).toBe('fail')
    expect(result.pr.statusChecks.find((c) => c.name === 'deploy')?.state).toBe('pending')
  })
})

describe('github:pr-review-detail — maps mergeStateStatus BEHIND to behind', () => {
  const handlers = freshHandlers()

  it('maps mergeStateStatus BEHIND to behind', async () => {
    mockPrDetail({ ...PR_META, mergeStateStatus: 'BEHIND' })
    mockGitFailure('not found')
    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { mergeStateStatus: string } }
    expect(result.pr.mergeStateStatus).toBe('behind')
  })

  it('maps mergeStateStatus DIRTY to dirty', async () => {
    mockPrDetail({ ...PR_META, mergeStateStatus: 'DIRTY' })
    mockGitFailure('not found')
    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { mergeStateStatus: string } }
    expect(result.pr.mergeStateStatus).toBe('dirty')
  })
})

describe('github:pr-review-detail — maps mergeStateStatus CLEAN to clean', () => {
  const handlers = freshHandlers()

  it('maps mergeStateStatus CLEAN to clean', async () => {
    mockPrDetail({ ...PR_META, mergeStateStatus: 'CLEAN' })
    mockGitFailure('not found')
    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { mergeStateStatus: string } }
    expect(result.pr.mergeStateStatus).toBe('clean')
  })
})

describe('github:pr-review-detail — maps lintStatus to fail when eslint check has FAILURE conclusion', () => {
  const handlers = freshHandlers()

  it('maps lintStatus to fail when eslint check has FAILURE conclusion', async () => {
    mockPrDetail({
      ...PR_META,
      statusCheckRollup: [{ name: 'eslint', conclusion: 'FAILURE' }],
    })
    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { lintStatus: string } }
    expect(result.pr.lintStatus).toBe('fail')
  })
})

describe('github:pr-review-detail — maps lintStatus to warn when lint check is PENDING', () => {
  const handlers = freshHandlers()

  it('maps lintStatus to warn when lint check is PENDING', async () => {
    mockPrDetail({
      ...PR_META,
      statusCheckRollup: [{ name: 'lint', conclusion: 'IN_PROGRESS' }],
    })
    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { lintStatus: string } }
    expect(result.pr.lintStatus).toBe('warn')
  })
})

describe('github:pr-review-detail — maps lintStatus to pass when lint check has SUCCESS conclusion', () => {
  const handlers = freshHandlers()

  it('maps lintStatus to pass when lint check has SUCCESS conclusion', async () => {
    mockPrDetail({
      ...PR_META,
      statusCheckRollup: [{ name: 'lint', conclusion: 'SUCCESS' }],
    })
    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { lintStatus: string } }
    expect(result.pr.lintStatus).toBe('pass')
  })
})

describe('github:pr-review-detail — maps lintStatus to unknown when lint check is SKIPPED (non-blocking)', () => {
  const handlers = freshHandlers()

  it('maps lintStatus to unknown when lint check is SKIPPED (non-blocking)', async () => {
    mockPrDetail({
      ...PR_META,
      statusCheckRollup: [{ name: 'lint', conclusion: 'SKIPPED' }],
    })
    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { lintStatus: string } }
    expect(result.pr.lintStatus).toBe('unknown')
  })
})

describe('github:pr-review-detail — extracts approvals from REST reviews field', () => {
  const handlers = freshHandlers()

  it('extracts approvals from REST reviews field', async () => {
    const reviews = [
      {
        user: { login: 'bob', avatar_url: 'https://example.com/bob.png' },
        state: 'APPROVED',
        submitted_at: '2026-05-01T10:00:00Z',
      },
      {
        user: { login: 'carol', avatar_url: '' },
        state: 'CHANGES_REQUESTED',
        submitted_at: '2026-05-01T11:00:00Z',
      },
    ]
    mockPrDetail({ ...PR_META, statusCheckRollup: [] }, PR_FILES_REST, reviews)
    mockGitFailure('not found')
    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { approvals: Array<{ author: string }> } }
    expect(result.pr.approvals).toHaveLength(1)
    expect(result.pr.approvals[0].author).toBe('bob')
  })
})

describe('github:pr-review-detail — skips reviews with no login in mapApprovals', () => {
  const handlers = freshHandlers()

  it('skips reviews with no login in mapApprovals', async () => {
    const reviews = [{ user: {}, state: 'APPROVED', submitted_at: '2026-05-01T10:00:00Z' }]
    mockPrDetail({ ...PR_META, statusCheckRollup: [] }, PR_FILES_REST, reviews)
    mockGitFailure('not found')
    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { approvals: Array<{ author: string }> } }
    expect(result.pr.approvals).toHaveLength(0)
  })
})

describe('github:pr-review-detail — deduplicates approvals keeping the later non-COMMENTED review', () => {
  const handlers = freshHandlers()

  it('deduplicates approvals keeping the later non-COMMENTED review', async () => {
    const reviews = [
      {
        user: { login: 'bob', avatar_url: '' },
        state: 'APPROVED',
        submitted_at: '2026-05-01T10:00:00Z',
      },
      {
        user: { login: 'bob', avatar_url: '' },
        state: 'COMMENTED',
        submitted_at: '2026-05-01T11:00:00Z',
      },
    ]
    mockPrDetail({ ...PR_META, statusCheckRollup: [] }, PR_FILES_REST, reviews)
    mockGitFailure('not found')
    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { approvals: Array<{ author: string }> } }
    // COMMENTED review should not overwrite the APPROVED one
    expect(result.pr.approvals).toHaveLength(1)
    expect(result.pr.approvals[0].author).toBe('bob')
  })
})

describe('github:pr-review-detail — lintStatus is unknown for a lint check with a non-blocking-but-unrecognized conclusion', () => {
  const handlers = freshHandlers()

  it('lintStatus is unknown for a lint check with a non-blocking-but-unrecognized conclusion', async () => {
    // STARTUP_FAILURE is not in FAILURE/ERROR/TIMED_OUT/ACTION_REQUIRED, not in PENDING set,
    // not SUCCESS, and not in NON_BLOCKING (SKIPPED/NEUTRAL/CANCELLED/STALE).
    // This hits the final `return 'unknown'` (line 901) in mapCheckStatus.
    mockPrDetail({
      ...PR_META,
      statusCheckRollup: [{ name: 'eslint lint check', conclusion: 'STARTUP_FAILURE' }],
    })

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { lintStatus: string } }

    expect(result.pr.lintStatus).toBe('unknown')
  })
})

describe('github:pr-review-detail — maps mergeStateStatus CONFLICTING to dirty', () => {
  const handlers = freshHandlers()

  it('maps mergeStateStatus CONFLICTING to dirty', async () => {
    mockPrDetail({
      ...PR_META,
      mergeStateStatus: 'CONFLICTING',
      statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }],
    })
    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { mergeStateStatus: string } }
    expect(result.pr.mergeStateStatus).toBe('dirty')
  })
})

describe('github:pr-review-detail — maps unknown mergeStateStatus to unknown', () => {
  const handlers = freshHandlers()

  it('maps unknown mergeStateStatus to unknown', async () => {
    mockPrDetail({
      ...PR_META,
      mergeStateStatus: 'TOTALLY_UNKNOWN_STATE',
      statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }],
    })
    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { mergeStateStatus: string } }
    expect(result.pr.mergeStateStatus).toBe('unknown')
  })
})

describe('github:pr-review-detail — exercises computeCoChangeAffinityFromGit when PR has 2+ files', () => {
  const handlers = freshHandlers()

  it('exercises computeCoChangeAffinityFromGit when PR has 2+ files', async () => {
    const twoFiles = [
      { filename: 'src/foo.ts', additions: 3, deletions: 1, patch: '@@ -1 +1 @@' },
      { filename: 'src/bar.ts', additions: 1, deletions: 0, patch: '@@ -1 +1 @@' },
    ]
    // mockPrDetail uses 5 gh calls (ownerAndName + meta + files + reviews + reviewers)
    mockPrDetail(
      { ...PR_META, statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }] },
      twoFiles
    )
    // 6th call: git log --name-only for co-change affinity (fired when filePaths.length >= 2)
    // Provide a commit that touched both files so the prFilesInCommit.length >= 2 branch is hit
    const gitHash = 'a'.repeat(40)
    mockGitSuccess(`${gitHash}\nsrc/foo.ts\nsrc/bar.ts\n`)

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { chapters: unknown[] } }
    // chapters should be built (non-empty because we have 2 files)
    expect(result.pr.chapters).toBeDefined()
  })
})

describe('github:pr-file-diff', () => {
  const handlers = freshHandlers()

  it('fetches PR ref with --force so stale local refs do not block the diff', async () => {
    mockGitSuccess('') // git fetch
    mockGitSuccess('{"baseRefName":"main"}') // gh pr view (also goes through execFile)
    mockGitSuccess('') // git fetch of the base branch
    mockGitSuccess('abc123\n') // git merge-base
    mockGitSuccess('') // git diff

    const result = await handlers['github:pr-file-diff']({
      repoRoot: '/repo',
      prNumber: 6,
      path: 'src/foo.ts',
    })

    expect(result).toEqual({
      diff: expect.objectContaining({ path: 'src/foo.ts', hunks: [], isBinary: false }),
    })

    // The fetch call must include --force
    const fetchArgs: string[] = mockExecFile.mock.calls[0][1]
    expect(fetchArgs).toContain('--force')
  })

  it('returns an error when git fetch fails', async () => {
    mockGitFailure('fatal: cannot lock ref')

    const result = await handlers['github:pr-file-diff']({
      repoRoot: '/repo',
      prNumber: 6,
      path: 'src/foo.ts',
    })

    expect(result).toMatchObject({ error: expect.stringContaining('cannot lock ref') })
  })
})

describe('github:pr-file-diff — parses a diff with binary file indicator', () => {
  const handlers = freshHandlers()

  it('parses a diff with binary file indicator', async () => {
    mockGitSuccess('') // git fetch
    mockGitSuccess('{"baseRefName":"main"}') // gh pr view
    mockGitSuccess('') // git fetch of the base branch
    mockGitSuccess('abc123\n') // git merge-base
    mockGitSuccess('Binary files a/image.png and b/image.png differ\n') // git diff

    const result = (await handlers['github:pr-file-diff']({
      repoRoot: '/repo',
      prNumber: 6,
      path: 'image.png',
    })) as { diff: { isBinary: boolean } }

    expect(result.diff.isBinary).toBe(true)
  })
})

describe('github:pr-file-diff — parses a diff with actual hunks', () => {
  const handlers = freshHandlers()

  it('parses a diff with actual hunks', async () => {
    const diffContent = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const x = 1
+const y = 2
 const z = 3
-const w = 4
 export { x }
`
    mockGitSuccess('') // git fetch
    mockGitSuccess('{"baseRefName":"main"}') // gh pr view
    mockGitSuccess('') // git fetch of the base branch
    mockGitSuccess('abc123\n') // git merge-base
    mockGitSuccess(diffContent) // git diff

    const result = (await handlers['github:pr-file-diff']({
      repoRoot: '/repo',
      prNumber: 6,
      path: 'src/foo.ts',
    })) as { diff: { hunks: Array<{ lines: unknown[] }> } }

    expect(result.diff.hunks).toHaveLength(1)
    expect(result.diff.hunks[0].lines.length).toBeGreaterThan(0)
  })
})

describe('github:pr-file-content', () => {
  let handlers: Record<string, Handler>
  const payload = { repoRoot: '/repo', prNumber: 6, path: 'src/foo.ts', ref: 'abc123' }

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('reads the file at the commit with git show for a local repo', async () => {
    mockGitSuccess('const x = 1')
    const result = await handlers['github:pr-file-content'](payload)
    expect(result).toEqual({ content: 'const x = 1' })
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    expect(mockExecFile.mock.calls[0][0]).toBe('git')
    expect(mockExecFile.mock.calls[0][1]).toEqual(['show', 'abc123:src/foo.ts'])
  })
})

describe('github:pr-file-content — fetches the PR head and retries once when the commit is not local', () => {
  let handlers: Record<string, Handler>
  const payload = { repoRoot: '/repo', prNumber: 6, path: 'src/foo.ts', ref: 'abc123' }

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('fetches the PR head and retries once when the commit is not local', async () => {
    mockGitFailure('fatal: bad object abc123')
    mockGitSuccess('') // git fetch
    mockGitSuccess('const x = 1') // git show retry
    const result = await handlers['github:pr-file-content'](payload)
    expect(result).toEqual({ content: 'const x = 1' })
    expect(mockExecFile.mock.calls[1][1]).toEqual([
      'fetch',
      '--force',
      'origin',
      'pull/6/head:refs/remotes/pull/6/head',
    ])
    expect(mockExecFile.mock.calls[2][1]).toEqual(['show', 'abc123:src/foo.ts'])
  })
})

describe('github:pr-file-content — returns an error when the retry also fails', () => {
  let handlers: Record<string, Handler>
  const payload = { repoRoot: '/repo', prNumber: 6, path: 'src/foo.ts', ref: 'abc123' }

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('returns an error when the retry also fails', async () => {
    mockGitFailure('fatal: bad object abc123')
    mockGitSuccess('') // git fetch
    mockGitFailure('fatal: path not in abc123')
    const result = await handlers['github:pr-file-content'](payload)
    expect(result).toMatchObject({ error: expect.stringContaining('path not in abc123') })
    expect(mockExecFile).toHaveBeenCalledTimes(3)
  })
})

describe('github:pr-file-content — asks GitHub for the raw file with an encoded path for a gh: root, never git', () => {
  let handlers: Record<string, Handler>
  const payload = { repoRoot: '/repo', prNumber: 6, path: 'src/foo.ts', ref: 'abc123' }

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('asks GitHub for the raw file with an encoded path for a gh: root, never git', async () => {
    mockGitSuccess('hello')
    const result = await handlers['github:pr-file-content']({
      ...payload,
      repoRoot: 'gh:acme/widgets',
      path: 'src/my dir/a#b.ts',
    })
    expect(result).toEqual({ content: 'hello' })
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    expect(mockExecFile.mock.calls[0][0]).not.toBe('git')
    const args: string[] = mockExecFile.mock.calls[0][1]
    expect(args).toContain('Accept: application/vnd.github.raw+json')
    expect(args).toContain('repos/{owner}/{repo}/contents/src/my%20dir/a%23b.ts?ref=abc123')
  })
})

describe('github:pr-file-content — returns tooLarge instead of content past two megabytes', () => {
  let handlers: Record<string, Handler>
  const payload = { repoRoot: '/repo', prNumber: 6, path: 'src/foo.ts', ref: 'abc123' }

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('returns tooLarge instead of content past two megabytes', async () => {
    mockGitSuccess('x'.repeat(2 * 1024 * 1024 + 1))
    expect(await handlers['github:pr-file-content'](payload)).toEqual({ tooLarge: true })
  })

  it('returns the content at exactly two megabytes', async () => {
    const content = 'x'.repeat(2 * 1024 * 1024)
    mockGitSuccess(content)
    expect(await handlers['github:pr-file-content'](payload)).toEqual({ content })
  })

  it('measures the limit in bytes, not characters', async () => {
    mockGitSuccess('é'.repeat(1024 * 1024 + 1))
    expect(await handlers['github:pr-file-content'](payload)).toEqual({ tooLarge: true })
  })
})

describe('github:pr-file-content — keeps leading and trailing blank lines, which line numbers depend on', () => {
  let handlers: Record<string, Handler>
  const payload = { repoRoot: '/repo', prNumber: 6, path: 'src/foo.ts', ref: 'abc123' }

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('keeps leading and trailing blank lines, which line numbers depend on', async () => {
    mockGitSuccess('\n\nconst x = 1\n')
    expect(await handlers['github:pr-file-content'](payload)).toEqual({
      content: '\n\nconst x = 1\n',
    })
  })

  it('bounds the read one byte past the limit on both paths', async () => {
    mockGitSuccess('a')
    await handlers['github:pr-file-content'](payload)
    mockGitSuccess('b')
    await handlers['github:pr-file-content']({ ...payload, repoRoot: 'gh:acme/widgets' })
    for (const call of mockExecFile.mock.calls) {
      expect(call[2]).toMatchObject({ maxBuffer: 2 * 1024 * 1024 + 1 })
    }
    expect(mockExecFile).toHaveBeenCalledTimes(2)
  })
})

describe('github:pr-file-content — returns tooLarge when the read overflows, without fetching and retrying', () => {
  let handlers: Record<string, Handler>
  const payload = { repoRoot: '/repo', prNumber: 6, path: 'src/foo.ts', ref: 'abc123' }

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('returns tooLarge when the read overflows, without fetching and retrying', async () => {
    mockExecFile.mockImplementationOnce(
      stubFails(
        Object.assign(new Error('stdout maxBuffer length exceeded'), {
          code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        })
      )
    )
    expect(await handlers['github:pr-file-content'](payload)).toEqual({ tooLarge: true })
    expect(mockExecFile).toHaveBeenCalledTimes(1)
  })
})

describe('github:list-open-prs', () => {
  const handlers = freshHandlers()

  it('returns NOT_AUTHENTICATED when auth error is thrown', async () => {
    mockGitFailure('You need to run: gh auth login')
    const result = (await handlers['github:list-open-prs']({
      repoRoot: '/repo',
    })) as { error: string }
    expect(result.error).toBe('NOT_AUTHENTICATED')
  })

  it('returns RATE_LIMITED error when rate limit message appears', async () => {
    mockGitFailure('API rate limit exceeded for user')
    const result = (await handlers['github:list-open-prs']({
      repoRoot: '/repo',
    })) as { error: string; resetAt?: number }
    expect(result.error).toBe('RATE_LIMITED')
    expect(result.resetAt).toBeTypeOf('number')
  })
})

describe('github:list-open-prs — returns generic error message for other failures', () => {
  const handlers = freshHandlers()

  it('returns generic error message for other failures', async () => {
    mockGitFailure('network timeout')
    const result = (await handlers['github:list-open-prs']({
      repoRoot: '/repo',
    })) as { error: string }
    expect(result.error).toContain('network timeout')
  })
})

describe('github:list-open-prs — handles numeric PR number search', () => {
  const handlers = freshHandlers()

  it('handles numeric PR number search', async () => {
    const prData = {
      number: 42,
      title: 'Test PR',
      author: { login: 'alice', avatarUrl: '' },
      createdAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat/thing',
      baseRefName: 'main',
      isDraft: false,
      statusCheckRollup: [],
      files: [],
      additions: 0,
      deletions: 0,
    }
    mockGitSuccess(JSON.stringify(prData))

    const result = (await handlers['github:list-open-prs']({
      repoRoot: '/repo',
      search: '42',
    })) as { prs: unknown[]; hasMore: boolean }
    expect(result.prs).toHaveLength(1)
    expect(result.hasMore).toBe(false)
  })
})

describe('github:list-open-prs — handles text search', () => {
  const handlers = freshHandlers()

  it('handles text search', async () => {
    const prList = [
      {
        number: 10,
        title: 'Fix bug',
        author: { login: 'bob', avatarUrl: '' },
        createdAt: '2025-01-01T00:00:00Z',
        headRefName: 'fix/bug',
        baseRefName: 'main',
        isDraft: false,
        statusCheckRollup: [],
        files: [],
        additions: 5,
        deletions: 2,
      },
    ]
    mockGitSuccess(JSON.stringify(prList))

    const result = (await handlers['github:list-open-prs']({
      repoRoot: '/repo',
      search: 'fix bug',
    })) as { prs: unknown[]; hasMore: boolean }
    expect(result.prs).toHaveLength(1)
    expect(result.hasMore).toBe(false)
  })

  // Settings → Git → Branch Exclude Patterns: the queue leaves out pull
  // requests opened from an excluded branch, and does not count them.
})

describe('github:list-open-prs — leaves out pull requests opened from an excluded branch', () => {
  const handlers = freshHandlers()

  it('leaves out pull requests opened from an excluded branch', async () => {
    Object.assign(
      handlers,
      captureHandlers(undefined, async (branch, repoPath) =>
        repoPath === '/repo' ? branch.startsWith('renovate/') : false
      )
    )
    mockGitSuccess(JSON.stringify(REPO_VIEW))
    const nodes = [
      { number: 1, title: 'bump', state: 'OPEN', headRefName: 'renovate/vitest-4' },
      { number: 2, title: 'login', state: 'OPEN', headRefName: 'feat/login' },
    ]
    mockGitSuccess(JSON.stringify(openPrPage(nodes, { totalCount: 2 })))
    const result = (await handlers['github:list-open-prs']({ repoRoot: '/repo' })) as {
      prs: { number: number }[]
      totalCount: number
    }
    expect(result.prs.map((pr) => pr.number)).toEqual([2])
    expect(result.totalCount).toBe(1)
  })
})

describe('github:list-open-prs — leaves excluded branches out of a text search too', () => {
  const handlers = freshHandlers()

  it('leaves excluded branches out of a text search too', async () => {
    Object.assign(
      handlers,
      captureHandlers(undefined, async (branch) => branch.startsWith('renovate/'))
    )
    mockGitSuccess(
      JSON.stringify([
        { number: 1, title: 'bump', headRefName: 'renovate/x', author: { login: 'bot' } },
        { number: 2, title: 'fix', headRefName: 'fix/y', author: { login: 'bob' } },
      ])
    )
    const result = (await handlers['github:list-open-prs']({
      repoRoot: '/repo',
      search: 'bump',
    })) as { prs: { number: number }[] }
    expect(result.prs.map((pr) => pr.number)).toEqual([2])
  })
})

describe('github:list-open-prs — handles paginated GraphQL load with cursor', () => {
  const handlers = freshHandlers()

  it('handles paginated GraphQL load with cursor', async () => {
    mockGitSuccess(JSON.stringify(REPO_VIEW)) // repo view
    const gqlResponse = {
      data: {
        repository: {
          pullRequests: {
            pageInfo: { endCursor: 'cursor-xyz', hasNextPage: true },
            nodes: [],
          },
        },
      },
    }
    mockGitSuccess(JSON.stringify(gqlResponse)) // graphql query

    const result = (await handlers['github:list-open-prs']({
      repoRoot: '/repo',
      cursor: 'cursor-abc',
    })) as { prs: unknown[]; hasMore: boolean; nextCursor?: string }
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe('cursor-xyz')
  })
})

describe('github:list-open-prs — always asks GraphQL for open PRs, newest first, and ignores includeClosedPrs', () => {
  const handlers = freshHandlers()

  it('always asks GraphQL for open PRs, newest first, and ignores includeClosedPrs', async () => {
    mockGitSuccess(JSON.stringify(REPO_VIEW))
    mockGitSuccess(
      JSON.stringify({
        data: {
          repository: {
            pullRequests: {
              pageInfo: { endCursor: null, hasNextPage: false },
              nodes: [],
            },
          },
        },
      })
    )

    await handlers['github:list-open-prs']({ repoRoot: '/repo', includeClosedPrs: true })
    const args = mockExecFile.mock.calls
      .map((c) => c[1] as string[])
      .find((a) => a[1] === 'graphql')!
    const query = args.find((a) => a.startsWith('query='))!
    expect(query).toContain('states:OPEN,')
    expect(query).not.toContain('MERGED')
    expect(query).toContain('direction:DESC')
    expect(query).not.toContain('direction:ASC')
    expect(query).toMatch(/nodes\{number title state isDraft/)
  })
})

describe('github:list-open-prs — maps the PR state of a GraphQL node', () => {
  const handlers = freshHandlers()

  it('maps the PR state of a GraphQL node', async () => {
    mockGitSuccess(JSON.stringify(REPO_VIEW))
    mockGitSuccess(
      JSON.stringify({
        data: {
          repository: {
            pullRequests: {
              pageInfo: { endCursor: null, hasNextPage: false },
              nodes: [{ number: 3, title: 't', state: 'OPEN', createdAt: '2026-01-01T00:00:00Z' }],
            },
          },
        },
      })
    )
    const result = (await handlers['github:list-open-prs']({ repoRoot: '/repo' })) as {
      prs: Array<{ state: string }>
    }
    expect(result.prs[0].state).toBe('open')
  })
})

describe('github:list-open-prs — searches open PRs only for plain text', () => {
  const handlers = freshHandlers()

  it('searches open PRs only for plain text', async () => {
    mockGitSuccess('[]')
    await handlers['github:list-open-prs']({ repoRoot: '/repo', search: 'fix bug' })
    const args = mockExecFile.mock.calls[0][1] as string[]
    expect(args.slice(args.indexOf('--state'), args.indexOf('--state') + 4)).toEqual([
      '--state',
      'open',
      '--search',
      'fix bug',
    ])
    expect(args[args.indexOf('--json') + 1]).toContain('state')
  })
})

describe('github:list-open-prs — searches merged PRs for is:merged and strips the qualifier', () => {
  const handlers = freshHandlers()

  it('searches merged PRs for is:merged and strips the qualifier', async () => {
    mockGitSuccess('[]')
    await handlers['github:list-open-prs']({ repoRoot: '/repo', search: 'Is:Merged  login' })
    const args = mockExecFile.mock.calls[0][1] as string[]
    expect(args[args.indexOf('--state') + 1]).toBe('merged')
    expect(args[args.indexOf('--search') + 1]).toBe('login')
  })

  it('omits --search when only a state qualifier is typed', async () => {
    mockGitSuccess('[]')
    await handlers['github:list-open-prs']({ repoRoot: '/repo', search: 'is:closed' })
    const args = mockExecFile.mock.calls[0][1] as string[]
    expect(args[args.indexOf('--state') + 1]).toBe('closed')
    expect(args).not.toContain('--search')
  })
})

describe('github:list-open-prs — normalizes GQL nodes with optional fields when response contains PRs', () => {
  const handlers = freshHandlers()

  it('normalizes GQL nodes with optional fields when response contains PRs', async () => {
    mockGitSuccess(JSON.stringify(REPO_VIEW))
    const node = {
      ...minimalPrNode(7, 'Test PR', 'feat/test'),
      additions: 10,
      deletions: 5,
      changedFiles: 2,
      author: { login: 'alice', avatarUrl: 'https://example.com/alice.png' },
      ...OPTIONAL_PR_FIELDS,
    }
    mockGitSuccess(JSON.stringify(openPrPage([node])))

    const result = (await handlers['github:list-open-prs']({
      repoRoot: '/repo',
    })) as { prs: Array<{ number: number; requestedReviewers: string[] }> }
    expect(result.prs).toHaveLength(1)
    expect(result.prs[0].number).toBe(7)
    expect(result.prs[0].requestedReviewers).toContain('carol')
  })
})

describe('github:list-open-prs — normalizes GQL nodes when optional fields are absent', () => {
  const handlers = freshHandlers()

  it('normalizes GQL nodes when optional fields are absent', async () => {
    mockGitSuccess(JSON.stringify(REPO_VIEW))
    // Optional fields ABSENT (undefined paths in normalizeGraphQLNode)
    mockGitSuccess(JSON.stringify(openPrPage([minimalPrNode(8, 'Minimal PR', 'fix/minor')])))

    const result = (await handlers['github:list-open-prs']({
      repoRoot: '/repo',
    })) as { prs: Array<{ number: number }> }
    expect(result.prs).toHaveLength(1)
    expect(result.prs[0].number).toBe(8)
  })
})

describe('github:pr-inline-comments', () => {
  const handlers = freshHandlers()

  it('returns comments and resolvedCommentIds on success', async () => {
    mockGitSuccess(JSON.stringify([REST_REVIEW_COMMENT]))
    mockGitSuccess(JSON.stringify({ owner: { login: 'owner' }, name: 'repo' }))
    const reviewThreads = {
      nodes: [
        { isResolved: true, comments: { nodes: [{ databaseId: 1 }] } },
        { isResolved: false, comments: { nodes: [{ databaseId: 2 }] } },
      ],
    }
    mockGitSuccess(JSON.stringify({ data: { repository: { pullRequest: { reviewThreads } } } }))

    const result = (await handlers['github:pr-inline-comments']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { comments: unknown[]; resolvedCommentIds: number[] }
    expect(result.comments).toHaveLength(1)
    expect(result.resolvedCommentIds).toEqual([1])
  })
})

describe('github:pr-inline-comments — returns resolvedCommentIds: [] when the GraphQL resolved-threads call fails', () => {
  const handlers = freshHandlers()

  it('returns resolvedCommentIds: [] when the GraphQL resolved-threads call fails', async () => {
    mockGitSuccess(JSON.stringify([REST_REVIEW_COMMENT]))
    mockGitFailure('boom')

    const result = (await handlers['github:pr-inline-comments']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { comments: unknown[]; resolvedCommentIds: number[] }
    expect(result.comments).toHaveLength(1)
    expect(result.resolvedCommentIds).toEqual([])
  })
})

describe('github:pr-inline-comments — returns NOT_AUTHENTICATED on auth error', () => {
  const handlers = freshHandlers()

  it('returns NOT_AUTHENTICATED on auth error', async () => {
    mockGitFailure('GH_TOKEN is not set — run: gh auth login')
    const result = (await handlers['github:pr-inline-comments']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { error: string }
    expect(result.error).toBe('NOT_AUTHENTICATED')
  })
})

describe('github:pr-comment-reply', () => {
  const handlers = freshHandlers()

  it('posts a reply and returns comment', async () => {
    const reply = {
      id: 200,
      user: { login: 'bob', avatar_url: '' },
      body: 'Agreed',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      path: 'src/foo.ts',
      line: 5,
      start_line: null,
      side: 'RIGHT',
      diff_hunk: '',
      in_reply_to_id: 100,
      pull_request_review_id: 1,
    }
    mockGitSuccess(JSON.stringify(reply))

    const result = (await handlers['github:pr-comment-reply']({
      repoRoot: '/repo',
      prNumber: 6,
      inReplyToId: 100,
      body: 'Agreed',
    })) as { comment: { id: number; isReply: boolean } }
    expect(result.comment.id).toBe(200)
    expect(result.comment.isReply).toBe(true)
  })
})

describe('github:pr-review-submit', () => {
  const handlers = freshHandlers()

  it('submits an APPROVE review and returns reviewId', async () => {
    mockGitSuccess(JSON.stringify({ owner: { login: 'owner' }, name: 'repo' }))
    mockGitSuccess(JSON.stringify({ id: 999 }))

    const result = (await handlers['github:pr-review-submit']({
      repoRoot: '/repo',
      prNumber: 6,
      event: 'APPROVE',
      body: 'LGTM!',
    })) as { reviewId: number }
    expect(result.reviewId).toBe(999)
  })
})

describe('github:pr-review-submit — returns error string on failure', () => {
  const handlers = freshHandlers()

  it('returns error string on failure', async () => {
    mockGitFailure('permission denied')

    const result = (await handlers['github:pr-review-submit']({
      repoRoot: '/repo',
      prNumber: 6,
      event: 'COMMENT',
      body: '',
    })) as { error: string }
    expect(result.error).toContain('permission denied')
  })
})

describe('github:pr-review-submit — extracts string error from JSON stdout errors array (covers 731T, 740T branches)', () => {
  const handlers = freshHandlers()

  it('extracts string error from JSON stdout errors array (covers 731T, 740T branches)', async () => {
    const errBody = JSON.stringify({
      message: 'Validation Failed',
      errors: ['Cannot approve your own pull request'],
    })
    mockGitSuccess(JSON.stringify({ owner: { login: 'owner' }, name: 'repo' }))
    mockGitFailureWithStdout('Unprocessable Entity (HTTP 422)', errBody)
    const result = (await handlers['github:pr-review-submit']({
      repoRoot: '/repo',
      prNumber: 6,
      event: 'APPROVE',
      body: 'LGTM',
    })) as { error: string }
    expect(result.error).toBe('Cannot approve your own pull request')
  })
})

/** The draft comments as the review POST carries them, a range with its start. */
const DRAFTS_AS_SENT = [
  { path: 'src/foo.ts', line: 10, side: 'RIGHT', body: 'nit' },
  {
    path: 'src/foo.ts',
    line: 20,
    side: 'RIGHT',
    body: 'range comment',
    start_line: 15,
    start_side: 'RIGHT',
  },
]

type SubmitCall = [string, string[], { input: string }]

describe('github:pr-review-submit — sends draft comments in the same POST via --input (S5)', () => {
  const handlers = freshHandlers()

  it('sends draft comments in the same POST via --input (S5)', async () => {
    mockGitSuccess(JSON.stringify({ owner: { login: 'owner' }, name: 'repo' }))
    mockGitSuccess(JSON.stringify({ id: 555 }))

    const comments = [
      { path: 'src/foo.ts', line: 10, startLine: null, side: 'RIGHT', body: 'nit' },
      { path: 'src/foo.ts', line: 20, startLine: 15, side: 'RIGHT', body: 'range comment' },
    ]
    const review = { event: 'COMMENT', body: 'Some findings', comments }
    const result = (await handlers['github:pr-review-submit']({
      repoRoot: '/repo',
      prNumber: 6,
      ...review,
    })) as { reviewId: number }
    expect(result.reviewId).toBe(555)

    const [, submitArgs, { input }] = mockExecFile.mock.calls[1] as SubmitCall
    expect(submitArgs.slice(submitArgs.indexOf('--input'))).toEqual(['--input', '-'])
    const written = JSON.parse(input)
    expect([written.event, written.body]).toEqual(['COMMENT', 'Some findings'])
    expect(written.comments).toEqual(DRAFTS_AS_SENT)
  })
})

describe('github:sessions-for-repo and github:session-get/set', () => {
  const handlers = freshHandlers()

  it('github:sessions-for-repo returns sessions for valid repo', async () => {
    const result = (await handlers['github:sessions-for-repo']({
      repoRoot: '/repo',
    })) as { sessions: unknown[] }
    expect(Array.isArray(result.sessions)).toBe(true)
  })

  it('github:session-get returns { session: null } for unknown key', async () => {
    const result = (await handlers['github:session-get']({ key: 'unknown-key' })) as {
      session: null
    }
    expect(result.session).toBeNull()
  })
})

describe('github:sessions-for-repo and github:session-get/set — github:session-set stores a valid session', () => {
  const handlers = freshHandlers()

  it('github:session-set stores a valid session', async () => {
    const validSession = {
      repoRoot: '/repo',
      prNumber: 42,
      headSHA: 'abc123',
      currentChapterId: null,
      currentFilePath: null,
      viewedFiles: [],
      fileOrderOverrides: {},
      scrollPosition: null,
      pausedAt: null,
      lastAccessedAt: '2026-01-01T00:00:00Z',
    }

    const result = (await handlers['github:session-set']({
      key: '/repo:::42:::abc123',
      session: validSession,
    })) as { ok?: boolean; error?: string }
    expect(result.ok).toBe(true)
  })
})

describe('github:remove-active-review', () => {
  const handlers = freshHandlers()

  it('returns { ok: true } when entry is deleted successfully', async () => {
    const result = (await handlers['github:remove-active-review']({
      repoRoot: '/repo',
      prNumber: 42,
    })) as { ok: boolean }
    expect(result.ok).toBe(true)
  })
})

describe('github:prune-active-reviews', () => {
  const handlers = freshHandlers()

  it('returns { openNumbers: [] } immediately for empty prNumbers array (no gh calls)', async () => {
    const result = (await handlers['github:prune-active-reviews']({
      repoRoot: '/repo',
      prNumbers: [],
    })) as { openNumbers: number[] }
    expect(result.openNumbers).toEqual([])
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('includes OPEN PRs in openNumbers', async () => {
    mockGitSuccess(JSON.stringify({ number: 7, state: 'OPEN' }))
    const result = (await handlers['github:prune-active-reviews']({
      repoRoot: '/repo',
      prNumbers: [7],
    })) as { openNumbers: number[] }
    expect(result.openNumbers).toEqual([7])
  })
})

describe('github:prune-active-reviews — excludes CLOSED PRs from openNumbers and removes them from the store', () => {
  const handlers = freshHandlers()

  it('excludes CLOSED PRs from openNumbers and removes them from the store', async () => {
    mockGitSuccess(JSON.stringify({ number: 8, state: 'CLOSED' }))
    const result = (await handlers['github:prune-active-reviews']({
      repoRoot: '/repo',
      prNumbers: [8],
    })) as { openNumbers: number[] }
    expect(result.openNumbers).toEqual([])
  })

  it('excludes MERGED PRs from openNumbers', async () => {
    mockGitSuccess(JSON.stringify({ number: 9, state: 'MERGED' }))
    const result = (await handlers['github:prune-active-reviews']({
      repoRoot: '/repo',
      prNumbers: [9],
    })) as { openNumbers: number[] }
    expect(result.openNumbers).toEqual([])
  })
})

describe('github:prune-active-reviews — silently skips PRs whose gh call fails and excludes them from openNumbers', () => {
  const handlers = freshHandlers()

  it('silently skips PRs whose gh call fails and excludes them from openNumbers', async () => {
    mockGitFailure('not found')
    const result = (await handlers['github:prune-active-reviews']({
      repoRoot: '/repo',
      prNumbers: [10],
    })) as { openNumbers: number[] }
    expect(result.openNumbers).toEqual([])
  })

  it('handles mixed results: OPEN kept, CLOSED excluded, failed silently skipped', async () => {
    mockGitSuccess(JSON.stringify({ number: 1, state: 'OPEN' }))
    mockGitSuccess(JSON.stringify({ number: 2, state: 'CLOSED' }))
    mockGitFailure('network error')
    const result = (await handlers['github:prune-active-reviews']({
      repoRoot: '/repo',
      prNumbers: [1, 2, 3],
    })) as { openNumbers: number[] }
    expect(result.openNumbers).toEqual([1])
  })
})

describe('github:pr-review-detail — catchError branches', () => {
  const handlers = freshHandlers()

  it('returns NOT_AUTHENTICATED when auth error thrown', async () => {
    mockGitFailure('You need to run: gh auth login')

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { error: string }
    expect(result.error).toBe('NOT_AUTHENTICATED')
  })
})

describe('github:pr-review-detail — catchError branches — returns RATE_LIMITED when rate limit error thrown', () => {
  const handlers = freshHandlers()

  it('returns RATE_LIMITED when rate limit error thrown', async () => {
    mockGitFailure('rate limit exceeded')

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { error: string; resetAt?: number }
    expect(result.error).toBe('RATE_LIMITED')
    expect(result.resetAt).toBeTypeOf('number')
  })
})

describe('github:pr-review-detail — catchError branches — returns generic error string for other failures', () => {
  const handlers = freshHandlers()

  it('returns generic error string for other failures', async () => {
    mockGitFailure('ENOENT: gh not found')

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { error: string }
    expect(result.error).toContain('ENOENT')
  })
})

describe('github:pr-create', () => {
  const input = {
    repoRoot: '/repo',
    title: 'Add x',
    body: 'Why',
    base: 'main',
    head: 'feat/x',
    draft: false,
  }
  const handlers = freshHandlers()

  it('opens the pull request in the main process and returns its number and URL', async () => {
    mockGitSuccess('https://github.com/o/r/pull/12\n')

    const result = await handlers['github:pr-create'](input)

    expect(result).toEqual({ number: 12, url: 'https://github.com/o/r/pull/12' })
    expect(mockExecFile.mock.calls[0].slice(0, 2)).toEqual([
      'gh',
      ['pr', 'create', '--title', 'Add x', '--body', 'Why', '--base', 'main', '--head', 'feat/x'],
    ])
  })

  it("returns gh's message when GitHub refuses", async () => {
    mockGitFailure('a pull request for branch "feat/x" already exists')

    const result = await handlers['github:pr-create'](input)

    expect(result).toEqual({ error: 'a pull request for branch "feat/x" already exists' })
  })
})

/** The open draft pull request from feat/greeting. */
const openPr = {
  number: 4,
  title: 'Greet in either order',
  body: 'Adds a greeting.',
  url: 'https://github.com/o/r/pull/4',
  state: 'OPEN',
  isDraft: true,
  baseRefName: 'main',
  headRefName: 'feat/greeting',
}

describe('git:pr-status', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it("answers the checkout's branch's open pull request", async () => {
    mockGitSuccess('feat/greeting\n')
    mockGitSuccess(JSON.stringify(openPr))

    const result = await handlers['git:pr-status']({ repoRoot: '/repo' })

    expect(result).toEqual({ pr: { ...openPr, state: 'open' } })
    expect(mockExecFile.mock.calls[0].slice(0, 2)).toEqual(['git', ['branch', '--show-current']])
    const [command, args] = mockExecFile.mock.calls[1]
    expect([command, args.slice(0, 3)]).toEqual(['gh', ['pr', 'view', 'feat/greeting']])
  })
})

describe('git:pr-status — answers null when the branch has no pull request', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('answers null when the branch has no pull request', async () => {
    mockGitSuccess('feat/greeting\n')
    mockGitFailure('no pull requests found for branch "feat/greeting"')

    expect(await handlers['git:pr-status']({ repoRoot: '/repo' })).toEqual({ pr: null })
  })

  it("answers null when the branch's pull request is merged, so a new one can be opened", async () => {
    mockGitSuccess('feat/greeting\n')
    mockGitSuccess(JSON.stringify({ ...openPr, state: 'MERGED' }))

    expect(await handlers['git:pr-status']({ repoRoot: '/repo' })).toEqual({ pr: null })
  })
})

describe('git:pr-status — answers null on a detached HEAD without asking GitHub', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('answers null on a detached HEAD without asking GitHub', async () => {
    mockGitSuccess('\n')

    expect(await handlers['git:pr-status']({ repoRoot: '/repo' })).toEqual({ pr: null })
    expect(mockExecFile).toHaveBeenCalledTimes(1)
  })
})

describe('github:pr-mark-ready', () => {
  const handlers = freshHandlers()

  it('returns { ok: true } on success', async () => {
    mockGitSuccess('')

    const result = (await handlers['github:pr-mark-ready']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { ok: boolean }
    expect(result.ok).toBe(true)
    const args: string[] = mockExecFile.mock.calls[0][1]
    expect(args).toContain('ready')
    expect(args).toContain('6')
  })
})

describe('github:pr-mark-ready — returns error string when gh fails', () => {
  const handlers = freshHandlers()

  it('returns error string when gh fails', async () => {
    mockGitFailure('not in draft state')

    const result = (await handlers['github:pr-mark-ready']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { error: string }
    expect(result.error).toContain('not in draft state')
  })
})

describe('github:pr-issue-comments', () => {
  const handlers = freshHandlers()

  it('returns mapped comments on success', async () => {
    const raw = [
      {
        id: 1,
        user: { login: 'alice', avatar_url: 'https://example.com/avatar.png' },
        body: 'Looks good',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      },
    ]
    // First call: issue comments. Second call: review bodies (empty here).
    mockGitSuccess(JSON.stringify(raw))
    mockGitSuccess('[]')

    const result = (await handlers['github:pr-issue-comments']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { comments: Array<{ id: number; author: string; body: string }> }

    expect(result.comments).toHaveLength(1)
    expect(result.comments[0].id).toBe(1)
    expect(result.comments[0].author).toBe('alice')
    expect(result.comments[0].body).toBe('Looks good')
  })
})

describe('github:pr-issue-comments — includes PR review body comments merged with issue comments', () => {
  const handlers = freshHandlers()

  it('includes PR review body comments merged with issue comments', async () => {
    const authorNamed = (login: string) => ({ login, avatar_url: '' })
    const issueComment = { id: 1, user: authorNamed('alice'), body: 'Issue comment' }
    const at = { created_at: '2025-01-02T00:00:00Z', updated_at: '2025-01-02T00:00:00Z' }
    mockGitSuccess(JSON.stringify([{ ...issueComment, ...at }]))
    const reviewBody = { id: 2, user: authorNamed('bob'), body: 'Review body comment' }
    mockGitSuccess(JSON.stringify([{ ...reviewBody, submitted_at: '2025-01-01T00:00:00Z' }]))

    const result = (await handlers['github:pr-issue-comments']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { comments: Array<{ id: number; author: string; body: string }> }

    expect(result.comments).toHaveLength(2)
    // sorted by createdAt — review body (Jan 1) before issue comment (Jan 2)
    expect(result.comments[0].body).toBe('Review body comment')
    expect(result.comments[1].body).toBe('Issue comment')
  })
})

describe('github:pr-issue-comments — returns error string when gh fails', () => {
  const handlers = freshHandlers()

  it('returns error string when gh fails', async () => {
    mockGitFailure('network error')

    const result = (await handlers['github:pr-issue-comments']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { error: string }
    expect(result.error).toContain('network error')
  })
})

describe('github:pr-issue-comment-add', () => {
  const handlers = freshHandlers()

  it('returns mapped comment on success', async () => {
    const raw = {
      id: 42,
      user: { login: 'bob', avatar_url: '' },
      body: 'LGTM!',
      created_at: '2025-01-02T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z',
    }
    mockGitSuccess(JSON.stringify(raw))

    const result = (await handlers['github:pr-issue-comment-add']({
      repoRoot: '/repo',
      prNumber: 6,
      body: 'LGTM!',
    })) as { comment: { id: number; author: string; body: string } }

    expect(result.comment.id).toBe(42)
    expect(result.comment.author).toBe('bob')
    expect(result.comment.body).toBe('LGTM!')
    const args: string[] = mockExecFile.mock.calls[0][1]
    expect(args).toContain('POST')
    expect(args).toContain('body=LGTM!')
  })
})

describe('github:pr-issue-comment-add — returns error string when gh fails', () => {
  const handlers = freshHandlers()

  it('returns error string when gh fails', async () => {
    mockGitFailure('forbidden')

    const result = (await handlers['github:pr-issue-comment-add']({
      repoRoot: '/repo',
      prNumber: 6,
      body: 'hello',
    })) as { error: string }
    expect(result.error).toContain('forbidden')
  })
})

describe('github:pr-update-branch', () => {
  let handlers: Record<string, Handler>
  beforeEach(() => {
    mockExecFile.mockReset()
    handlers = captureHandlers()
  })

  it('returns ok:true on success', async () => {
    mockGitSuccess('')

    const result = (await handlers['github:pr-update-branch']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { ok: boolean }
    expect(result.ok).toBe(true)
    const args: string[] = mockExecFile.mock.calls[0][1]
    expect(args).toContain('update-branch')
    expect(args).toContain('6')
    expect(args).toContain('--rebase=false')
  })
})

describe('github:pr-update-branch — returns error string when gh fails', () => {
  let handlers: Record<string, Handler>
  beforeEach(() => {
    mockExecFile.mockReset()
    handlers = captureHandlers()
  })

  it('returns error string when gh fails', async () => {
    mockGitFailure('merge conflict')

    const result = (await handlers['github:pr-update-branch']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { error: string }
    expect(result.error).toContain('merge conflict')
  })
})

describe('github:current-user', () => {
  const handlers = freshHandlers()

  it('returns login on success', async () => {
    mockGitSuccess('alice\n')
    const result = (await handlers['github:current-user']({ repoRoot: '/repo' })) as {
      login: string
    }
    expect(result.login).toBe('alice')
  })

  it('returns error string on failure', async () => {
    mockGitFailure('not authenticated')
    const result = (await handlers['github:current-user']({ repoRoot: '/repo' })) as {
      error: string
    }
    expect(result.error).toContain('not authenticated')
  })
})

describe('github:current-user — passes GH_TOKEN env var to gh when a token is configured', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captureHandlers()
  })

  it('passes GH_TOKEN env var to gh when a token is configured', async () => {
    const handlersWithToken = captureHandlersWithToken('my-secret-token')
    mockGitSuccess('alice\n')
    await handlersWithToken['github:current-user']({ repoRoot: '/repo' })
    const callOpts = mockExecFile.mock.calls[0][2] as { env?: Record<string, string> }
    expect(callOpts.env?.GH_TOKEN).toBe('my-secret-token')
  })
})

describe('github:current-user — retries without token when token is set but gh returns auth error', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captureHandlers()
  })

  it('retries without token when token is set but gh returns auth error', async () => {
    const handlersWithToken = captureHandlersWithToken('expired-token')
    // First call with token → auth error
    mockGitFailure('You need to run: gh auth login')
    // Second call (retry without token) → success
    mockGitSuccess('bob\n')
    const result = (await handlersWithToken['github:current-user']({ repoRoot: '/repo' })) as {
      login: string
    }
    expect(result.login).toBe('bob')
    // Second call must have no GH_TOKEN env var
    const retryOpts = mockExecFile.mock.calls[1][2] as { env?: Record<string, string> }
    expect(retryOpts.env?.GH_TOKEN).toBeUndefined()
  })
})

describe('github:save-active-review and github:active-reviews-for-repo', () => {
  const handlers = freshHandlers()

  it('github:save-active-review stores and returns ok:true', async () => {
    const result = (await handlers['github:save-active-review']({
      repoRoot: '/repo',
      pr: reviewQueuePr(42),
    })) as { ok: boolean }
    expect(result.ok).toBe(true)
  })

  it('github:active-reviews-for-repo returns prs array for valid repoRoot', async () => {
    const result = (await handlers['github:active-reviews-for-repo']({
      repoRoot: '/repo',
    })) as { prs: unknown[] }
    expect(Array.isArray(result.prs)).toBe(true)
  })
})

describe('github:remove-active-review — store side-effects', () => {
  const handlers = freshHandlers()

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('deletes matching session-store keys when a session key shares the repoRoot+prNumber prefix', async () => {
    // Make set/delete functional so the store records the session
    const deleteSpy = keepStoreWrites()
    await handlers['github:session-set']({ key: '/repo:::42:::abc123', session: storedSession() })

    const result = (await handlers['github:remove-active-review']({
      repoRoot: '/repo',
      prNumber: 42,
    })) as { ok: boolean }
    expect(result.ok).toBe(true)
    // Verify sessionStore.delete was called for the matching session key (line 842)
    expect(deleteSpy).toHaveBeenCalledWith('/repo:::42:::abc123')
  })
})

describe('github:remove-active-review — store side-effects — returns { error } when activeReviewStore.delete throws (line 846)', () => {
  const handlers = freshHandlers()

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("deletes the pull request's own session key, so a refresh does not bring it back as paused", async () => {
    keepStoreWrites()
    const paused = (prNumber: number) =>
      storedSession({ prNumber, pausedAt: '2026-01-01T00:00:00Z' })
    await handlers['github:session-set']({ key: '/repo:::42', session: paused(42) })
    await handlers['github:session-set']({ key: '/repo:::420', session: paused(420) })

    await handlers['github:remove-active-review']({ repoRoot: '/repo', prNumber: 42 })

    const { sessions } = (await handlers['github:sessions-for-repo']({ repoRoot: '/repo' })) as {
      sessions: Array<{ prNumber: number }>
    }
    expect(sessions.map((s) => s.prNumber)).toEqual([420])
    delete sessionData['/repo:::420']
  })

  it('returns { error } when activeReviewStore.delete throws (line 846)', async () => {
    vi.spyOn(ElectronStore.prototype, 'delete').mockImplementationOnce(() => {
      throw new Error('store write failed')
    })
    const result = (await handlers['github:remove-active-review']({
      repoRoot: '/repo',
      prNumber: 42,
    })) as { error: string }
    expect(result.error).toContain('store write failed')
  })
})

describe('github:sessions-for-repo — v1/v2 key precedence', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    keepStoreWrites()
    handlers = captureHandlers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const session = storedSession

  it('reads a v1 key ("repo:::pr:::sha")', async () => {
    await handlers['github:session-set']({
      key: '/repo:::42:::abc123',
      session: session({}),
    })
    const result = (await handlers['github:sessions-for-repo']({ repoRoot: '/repo' })) as {
      sessions: Array<{ prNumber: number }>
    }
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].prNumber).toBe(42)
  })
})

describe('github:sessions-for-repo — v1/v2 key precedence — reads a v2 key ("repo:::pr")', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    keepStoreWrites()
    handlers = captureHandlers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const session = storedSession

  it('reads a v2 key ("repo:::pr")', async () => {
    await handlers['github:session-set']({
      key: '/repo:::42',
      session: session({}),
    })
    const result = (await handlers['github:sessions-for-repo']({ repoRoot: '/repo' })) as {
      sessions: Array<{ prNumber: number }>
    }
    expect(result.sessions).toHaveLength(1)
  })
})

describe('github:sessions-for-repo — v1/v2 key precedence — prefers the v2 key over a v1 key for the same PR', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    keepStoreWrites()
    handlers = captureHandlers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const session = storedSession

  it('prefers the v2 key over a v1 key for the same PR', async () => {
    await handlers['github:session-set']({
      key: '/repo:::42:::abc123',
      session: session({ lastAccessedAt: '2026-01-01T00:00:00Z' }),
    })
    await handlers['github:session-set']({
      key: '/repo:::42',
      session: session({ lastAccessedAt: '2026-02-01T00:00:00Z' }),
    })
    const result = (await handlers['github:sessions-for-repo']({ repoRoot: '/repo' })) as {
      sessions: Array<{ prNumber: number; lastAccessedAt: string }>
    }
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].lastAccessedAt).toBe('2026-02-01T00:00:00Z')
  })
})

describe('github:file-viewed-set', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    handlers = captureHandlers()
  })

  it('marks a file viewed via markFileAsViewed', async () => {
    mockGitSuccess(JSON.stringify({ owner: { login: 'owner' }, name: 'repo' }))
    mockGitSuccess(JSON.stringify({ data: { repository: { pullRequest: { id: 'PR_id123' } } } }))
    mockGitSuccess(JSON.stringify({ data: { markFileAsViewed: { clientMutationId: null } } }))

    const result = (await handlers['github:file-viewed-set']({
      repoRoot: '/repo',
      prNumber: 6,
      path: 'src/foo.ts',
      viewed: true,
    })) as { ok: boolean }
    expect(result.ok).toBe(true)

    const mutationArgs: string[] = mockExecFile.mock.calls[2][1]
    expect(mutationArgs.join(' ')).toContain('markFileAsViewed')
    expect(mutationArgs.some((a) => a.includes('id=PR_id123'))).toBe(true)
  })
})

describe('github:file-viewed-set — unmarks a file via unmarkFileAsViewed', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    handlers = captureHandlers()
  })

  it('unmarks a file via unmarkFileAsViewed', async () => {
    mockGitSuccess(JSON.stringify({ owner: { login: 'owner' }, name: 'repo' }))
    mockGitSuccess(JSON.stringify({ data: { repository: { pullRequest: { id: 'PR_id123' } } } }))
    mockGitSuccess(JSON.stringify({ data: { unmarkFileAsViewed: { clientMutationId: null } } }))

    const result = (await handlers['github:file-viewed-set']({
      repoRoot: '/repo',
      prNumber: 6,
      path: 'src/foo.ts',
      viewed: false,
    })) as { ok: boolean }
    expect(result.ok).toBe(true)
    const mutationArgs: string[] = mockExecFile.mock.calls[2][1]
    expect(mutationArgs.join(' ')).toContain('unmarkFileAsViewed')
  })
})

describe('github:file-viewed-set — returns an error when the PR id lookup fails', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    handlers = captureHandlers()
  })

  it('returns an error when the PR id lookup fails', async () => {
    mockGitFailure('boom')
    const result = (await handlers['github:file-viewed-set']({
      repoRoot: '/repo',
      prNumber: 6,
      path: 'src/foo.ts',
      viewed: true,
    })) as { error: string }
    expect(result.error).toContain('boom')
  })
})

describe('github:pr-compare', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    handlers = captureHandlers()
  })

  it('returns files with patches on success', async () => {
    mockGitSuccess(JSON.stringify({ owner: { login: 'owner' }, name: 'repo' }))
    mockGitSuccess(
      JSON.stringify({
        ahead_by: 3,
        files: [{ filename: 'src/foo.ts', status: 'modified', patch: '@@ -1 +1 @@' }],
      })
    )
    const result = (await handlers['github:pr-compare']({
      repoRoot: '/repo',
      fromSha: 'aaa',
      toSha: 'bbb',
    })) as { rewritten: boolean; commits: number; files: Array<{ path: string }> }
    expect(result.rewritten).toBe(false)
    expect(result.commits).toBe(3)
    expect(result.files).toEqual([{ path: 'src/foo.ts', status: 'modified', patch: '@@ -1 +1 @@' }])
    const compareArgs: string[] = mockExecFile.mock.calls[1][1]
    expect(compareArgs.join(' ')).toContain('compare/aaa...bbb')
  })
})

describe('github:pr-compare — returns rewritten:true when gh reports no common ancestor', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    handlers = captureHandlers()
  })

  it('returns rewritten:true when gh reports no common ancestor', async () => {
    mockGitSuccess(JSON.stringify({ owner: { login: 'owner' }, name: 'repo' }))
    mockGitFailure('No common ancestor between aaa and bbb')
    const result = (await handlers['github:pr-compare']({
      repoRoot: '/repo',
      fromSha: 'aaa',
      toSha: 'bbb',
    })) as { rewritten: boolean; files: unknown[] }
    expect(result.rewritten).toBe(true)
    expect(result.files).toEqual([])
  })
})

describe('github:tests-for-block', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    handlers = captureHandlers()
  })

  it('names the block and returns the test lines that mention it', async () => {
    mockGitSuccess('abc:src/utils.spec.ts:7:  expect(sortByPriority([])).toEqual([])')
    const result = (await handlers['github:tests-for-block']({
      repoRoot: '/repo',
      headSHA: 'abc',
      path: 'src/utils.ts',
      code: 'export function sortByPriority(items: number[]) {\n  return items\n}',
    })) as { symbols: string[]; locations: unknown[] }
    expect(result.symbols).toEqual(['sortByPriority'])
    expect(result.locations).toEqual([
      {
        path: 'src/utils.spec.ts',
        line: 7,
        symbol: 'sortByPriority',
        text: 'expect(sortByPriority([])).toEqual([])',
      },
    ])
    const args: string[] = mockExecFile.mock.calls[0][1]
    expect(args.slice(0, 2)).toEqual(['grep', '-n'])
  })
})

describe('github:clone-repo', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    handlers = captureHandlers()
  })

  it('returns FOLDER_NOT_FOUND when the folder does not exist', async () => {
    const result = (await handlers['github:clone-repo']({
      repo: 'acme/widgets',
      folder: '/does/not/exist/xyz',
    })) as { error: string }
    expect(result.error).toBe('FOLDER_NOT_FOUND')
  })

  it('clones into <folder>/<name> and returns repoRoot', async () => {
    mockGitSuccess('Cloning into widgets...')
    const result = (await handlers['github:clone-repo']({
      repo: 'acme/widgets',
      folder: '/tmp',
    })) as { repoRoot: string }
    expect(result.repoRoot).toBe('/tmp/widgets')
    const cloneArgs: string[] = mockExecFile.mock.calls[0][1]
    expect(cloneArgs).toEqual(['repo', 'clone', 'acme/widgets', 'widgets'])
  })
})

/** shardByDuration gaining a guard against fewer than one shard. */
const SHARD_GUARD_FILE = {
  filename: 'scripts/e2e-shard.ts',
  status: 'modified',
  additions: 2,
  deletions: 0,
  patch:
    '@@ -40,2 +40,4 @@\n export function shardByDuration(t: Timing[], n: number) {\n+  if (n < 1) throw new Error("shards must be at least 1")\n+  return split(t, n)\n }',
}

describe('review revamp — edge branches', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    mockExecFile.mockImplementation(stubFails(new Error('no reply queued')))
    handlers = captureHandlers()
  })

  it('reads patch coverage from a status context description', async () => {
    const statusCheckRollup = [
      { context: 'codecov/patch', state: 'SUCCESS', description: '84.21% of diff hit' },
      { name: 'Lint', conclusion: 'SUCCESS' },
    ]
    mockPrDetail({ ...PR_META, statusCheckRollup }, [SHARD_GUARD_FILE])
    mockGitFailure('no match') // git grep for test references
    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as {
      pr: { insights: { coverage: { patchPercent: number | null; source: string } } | null }
    }
    expect(result.pr.insights?.coverage.patchPercent).toBe(84)
  })
})

describe('review revamp — edge branches — compare tolerates a response with no files or counts', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    handlers = captureHandlers()
  })

  it('compare tolerates a response with no files or counts', async () => {
    mockGitSuccess(JSON.stringify({ owner: { login: 'owner' }, name: 'repo' }))
    mockGitSuccess(JSON.stringify({}))
    const result = await handlers['github:pr-compare']({
      repoRoot: '/repo',
      fromSha: 'aaa',
      toSha: 'bbb',
    })
    expect(result).toEqual({ rewritten: false, commits: 0, files: [] })
  })
})

describe('review revamp — edge branches — compare keeps a file whose patch GitHub omitted (a binary or huge file)', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    handlers = captureHandlers()
  })

  it('compare keeps a file whose patch GitHub omitted (a binary or huge file)', async () => {
    mockGitSuccess(JSON.stringify({ owner: { login: 'owner' }, name: 'repo' }))
    mockGitSuccess(
      JSON.stringify({ ahead_by: 1, files: [{ filename: 'logo.png', status: 'added' }] })
    )
    const result = (await handlers['github:pr-compare']({
      repoRoot: '/repo',
      fromSha: 'aaa',
      toSha: 'bbb',
    })) as { files: unknown[] }
    expect(result.files).toEqual([{ path: 'logo.png', status: 'added', patch: '' }])
  })
})

describe('review revamp — edge branches — compare reports other failures as errors, not as rewritten history', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    handlers = captureHandlers()
  })

  it('compare reports other failures as errors, not as rewritten history', async () => {
    mockGitSuccess(JSON.stringify({ owner: { login: 'owner' }, name: 'repo' }))
    mockGitFailure('HTTP 500: server error')
    const result = (await handlers['github:pr-compare']({
      repoRoot: '/repo',
      fromSha: 'aaa',
      toSha: 'bbb',
    })) as { error?: string; rewritten?: boolean }
    expect(result.rewritten).toBeUndefined()
    expect(result.error).toContain('500')
  })
})

describe('review revamp — edge branches — clone reports a gh failure', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    handlers = captureHandlers()
  })

  it('clone reports a gh failure', async () => {
    mockGitFailure('repository not found')
    const result = (await handlers['github:clone-repo']({
      repo: 'acme/widgets',
      folder: '/tmp',
    })) as { error: string }
    expect(result.error).toContain('repository not found')
  })
})

describe('review revamp — edge branches — maps ssh remotes, and ignores non-GitHub and unreadable ones', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    captureHandlers()
  })

  it('maps ssh remotes, and ignores non-GitHub and unreadable ones', async () => {
    const hs = handlersWithProjectRoots(['/src/widgets', '/src/gadgets', '/src/broken'])
    mockDashboardExec(
      { mine: [dashboardSearchNode('acme/widgets', 1), dashboardSearchNode('acme/gadgets', 2)] },
      {
        '/src/widgets': 'git@github.com:acme/widgets.git',
        '/src/gadgets': 'https://gitlab.com/acme/gadgets.git',
        '/src/broken': new Error('not a git repository'),
      }
    )
    const result = (await hs['github:dashboard-search']({})) as {
      prs: Array<{ repo: string; localRepoRoot: string | null }>
    }
    const roots = Object.fromEntries(result.prs.map((p) => [p.repo, p.localRepoRoot]))
    expect(roots).toEqual({ 'acme/widgets': '/src/widgets', 'acme/gadgets': null })
  })
})

const WIDGETS_REMOTE = 'https://github.com/acme/widgets.git'

/** alice's acme/widgets PR 1, "Fix bug", waiting on review with CI passing. */
const FIX_BUG_NODE = dashboardSearchNode('acme/widgets', 1, {
  title: 'Fix bug',
  additions: 10,
  deletions: 5,
  changedFiles: 2,
  createdAt: '2026-01-01T00:00:00Z',
  reviewDecision: 'REVIEW_REQUIRED',
  commits: {
    nodes: [
      {
        commit: { oid: 'a', committedDate: '2026-01-01', statusCheckRollup: { state: 'SUCCESS' } },
      },
    ],
  },
})

describe('github:dashboard-search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
  })

  it('runs gh from api.paths.globalStorage, builds the dashboard, and maps local roots', async () => {
    const handlers = handlersWithProjectRoots(['/Users/me/repos/widgets'])
    mockDashboardExec({ mine: [FIX_BUG_NODE] }, { '/Users/me/repos/widgets': WIDGETS_REMOTE })

    const result = (await handlers['github:dashboard-search']({})) as {
      prs: Array<{ localRepoRoot: string | null; repo: string }>
      login: string
    }
    expect(result.login).toBe('alice')
    expect(result.prs).toHaveLength(1)
    expect(result.prs[0].localRepoRoot).toBe('/Users/me/repos/widgets')

    const userCallOpts = mockExecFile.mock.calls[0][2] as { cwd?: string }
    expect(userCallOpts.cwd).toBe(GLOBAL_STORAGE)
  })
})

describe('github:dashboard-search — sends each section as its own graphql request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
  })

  it('sends each section as its own graphql request', async () => {
    const handlers = captureHandlers()
    mockDashboardExec({})
    await handlers['github:dashboard-search']({})
    const queries = mockExecFile.mock.calls
      .map((c) => c[1] as string[])
      .filter((args) => args[1] === 'graphql')
      .map((args) => args[3])
    expect(queries).toHaveLength(5)
    for (const q of queries) expect(q.match(/: search\(/g)).toHaveLength(1)
  })
})

describe('github:dashboard-search — scopes every section to the selected repositories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
  })

  it('scopes every section to the selected repositories', async () => {
    const handlers = captureHandlers(() => ['acme/widgets', 'acme/gadgets'])
    mockDashboardExec({})
    const result = (await handlers['github:dashboard-search']({})) as { scopedTo: number }
    const queries = mockExecFile.mock.calls
      .map((c) => c[1] as string[])
      .filter((args) => args[1] === 'graphql')
      .map((args) => args[3])
    expect(queries).toHaveLength(5)
    for (const q of queries) expect(q).toContain(' repo:acme/widgets repo:acme/gadgets"')
    expect(result.scopedTo).toBe(2)
  })
})

describe('github:dashboard-search — reports no scope when no repositories are selected', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
  })

  it('reports no scope when no repositories are selected', async () => {
    const handlers = captureHandlers(() => [])
    mockDashboardExec({})
    const result = (await handlers['github:dashboard-search']({})) as {
      scopedTo: number
      failed: unknown[]
    }
    expect(result.scopedTo).toBe(0)
    expect(result.failed).toEqual([])
  })
})

describe('github:dashboard-search — keeps the other sections when one fails, naming the failure briefly', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
  })

  it('keeps the other sections when one fails, naming the failure briefly', async () => {
    const handlers = captureHandlers()
    const node = dashboardSearchNode('acme/widgets', 7, {
      title: 'Mine',
      createdAt: '2026-01-01T00:00:00Z',
    })
    const failure =
      'Command failed: gh api graphql -f query=query { team: search(...) }\ngh: HTTP 502\n'
    mockDashboardExec({ mine: [node] }, {}, { team: new Error(failure) })
    const result = (await handlers['github:dashboard-search']({})) as {
      prs: Array<{ number: number }>
      failed: Array<{ section: string; error: string }>
    }
    expect(result.prs.map((p) => p.number)).toEqual([7])
    expect(result.failed).toEqual([{ section: 'team', error: 'gh: HTTP 502' }])
  })
})

describe('github:dashboard-search — returns the error when every section fails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
  })

  it('returns the error when every section fails', async () => {
    const handlers = captureHandlers()
    const boom = new Error('Command failed: gh api graphql\ngh: HTTP 502')
    mockDashboardExec(
      {},
      {},
      { reReview: boom, requested: boom, team: boom, mine: boom, involved: boom }
    )
    const result = (await handlers['github:dashboard-search']({})) as { error: string }
    expect(result.error).toContain('HTTP 502')
  })
})

describe('github:dashboard-search — returns catchError shape when the login lookup fails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
  })

  it('returns catchError shape when the login lookup fails', async () => {
    const handlers: Record<string, Handler> = {}
    registerGithubHandlers(answerInto(handlers), {
      github: githubOverStub(mockExecFile),
      getToken: () => '',
      noCheckoutCwd: GLOBAL_STORAGE,
    })
    mockGitFailure('boom')
    const result = (await handlers['github:dashboard-search']({})) as { error: string }
    expect(result.error).toContain('boom')
  })
})

const JSONL = [
  {
    fullName: 'acme/zeta',
    owner: 'acme',
    private: true,
    archived: false,
    pushedAt: '2026-01-02T00:00:00Z',
  },
  {
    fullName: 'acme/old',
    owner: 'acme',
    private: false,
    archived: true,
    pushedAt: '2020-01-01T00:00:00Z',
  },
  {
    fullName: 'Acme/alpha',
    owner: 'Acme',
    private: false,
    archived: false,
    pushedAt: '2026-02-02T00:00:00Z',
  },
]
  .map((r) => JSON.stringify(r))
  .join('\n')

describe('github:accessible-repos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    mockExecFile.mockImplementation(stubPrints(JSONL + '\n'))
  })

  it('drops archived repositories and sorts by name ignoring case', async () => {
    const handlers = captureHandlers()
    const result = await handlers['github:accessible-repos']({})
    expect(result).toEqual({
      repos: [
        { fullName: 'Acme/alpha', owner: 'Acme', private: false, pushedAt: '2026-02-02T00:00:00Z' },
        { fullName: 'acme/zeta', owner: 'acme', private: true, pushedAt: '2026-01-02T00:00:00Z' },
      ],
    })
    const [, args, options] = mockExecFile.mock.calls[0]
    expect(args.slice(0, 3)).toEqual([
      'api',
      'user/repos?affiliation=owner,collaborator,organization_member&per_page=100',
      '--paginate',
    ])
    expect(options).toMatchObject({
      cwd: GLOBAL_STORAGE,
      maxBuffer: 50 * 1024 * 1024,
      timeout: 60_000,
    })
  })
})

describe('github:accessible-repos — serves a second call from the cache and re-runs on refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    mockExecFile.mockImplementation(stubPrints(JSONL + '\n'))
  })

  it('serves a second call from the cache and re-runs on refresh', async () => {
    const handlers = captureHandlers()
    await handlers['github:accessible-repos']({})
    await handlers['github:accessible-repos']({})
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    await handlers['github:accessible-repos']({ refresh: true })
    expect(mockExecFile).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failure', async () => {
    const handlers = captureHandlers()
    mockExecFile.mockImplementationOnce(stubFails(new Error('boom')))
    expect(await handlers['github:accessible-repos']({})).toHaveProperty('error')
    expect(await handlers['github:accessible-repos']({})).toHaveProperty('repos')
  })
})

describe('gh: pseudo-root (uncloned repo)', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    handlers = captureHandlers()
  })

  it('routes github:pr-mark-ready through GH_REPO with cwd in api.paths.globalStorage, no git spawned', async () => {
    mockExecFile.mockImplementationOnce(stubPrints(''))
    const result = (await handlers['github:pr-mark-ready']({
      repoRoot: 'gh:acme/widgets',
      prNumber: 6,
    })) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    const [cmd, args, callOpts] = mockExecFile.mock.calls[0] as [
      string,
      string[],
      { cwd?: string; env?: Record<string, string> },
    ]
    expect(cmd).not.toBe('git')
    expect(args).toEqual(['pr', 'ready', '6'])
    expect(callOpts.cwd).toBe(GLOBAL_STORAGE)
    // Passed per call, so concurrent calls for different repos cannot see each other's.
    expect(callOpts.env?.GH_REPO).toBe('acme/widgets')
    expect(process.env.GH_REPO).toBeUndefined()
  })
})

describe('gh: pseudo-root (uncloned repo) — builds owner/repo API paths for a gh: root', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    handlers = captureHandlers()
  })

  it('builds owner/repo API paths for a gh: root', async () => {
    mockGitSuccess(JSON.stringify({ ahead_by: 1, files: [] }))
    await handlers['github:pr-compare']({
      repoRoot: 'gh:acme/widgets',
      fromSha: 'aaa111',
      toSha: 'bbb222',
    })
    expect(mockExecFile.mock.calls[0][1]).toContain('repos/acme/widgets/compare/aaa111...bbb222')
  })
})

describe('gh: pseudo-root (uncloned repo) — github:pr-file-diff reads the patch from GitHub for a gh: root, never git', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    handlers = captureHandlers()
  })

  it('github:pr-file-diff reads the patch from GitHub for a gh: root, never git', async () => {
    mockGitSuccess(
      JSON.stringify([
        { filename: 'src/other.ts', patch: '@@ -1 +1 @@\n-a\n+b' },
        {
          filename: 'scripts/e2e-shard.ts',
          patch:
            '@@ -41,2 +41,2 @@\n-  return shards.map((s) => s.specs)\n+  return shards.map((s) => s.specs.concat(s.hooks))',
        },
      ])
    )
    const result = (await handlers['github:pr-file-diff']({
      repoRoot: 'gh:acme/widgets',
      prNumber: 211,
      path: 'scripts/e2e-shard.ts',
    })) as { diff: { hunks: Array<{ lines: Array<{ type: string; content: string }> }> } }
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    expect(mockExecFile.mock.calls[0][0]).not.toBe('git')
    expect(mockExecFile.mock.calls[0][1]).toContain('repos/{owner}/{repo}/pulls/211/files')
    expect(result.diff.hunks[0].lines.map((l) => l.type)).toEqual(['remove', 'add'])
    expect(result.diff.hunks[0].lines[1].content).toContain('s.specs.concat(s.hooks)')
  })
})

// ── repeated-work removal ─────────────────────────────────────────────────────

type Spawn = { cmd: string; args: string[] }

/** Routes every spawned process to `route`; returns the list of spawns for counting. */
function routeExec(route: (args: string[]) => string | Error): Spawn[] {
  const spawns: Spawn[] = []
  mockExecFile.mockReset()
  mockExecFile.mockImplementation(
    stubAnswering(({ command, args }) => {
      spawns.push({ cmd: command, args })
      return route(args)
    })
  )
  return spawns
}

const isGhPrView = (a: string[]) => a[0] === 'pr' && a[1] === 'view'
const isGhRepoView = (a: string[]) => a[0] === 'repo' && a[1] === 'view'

describe('handler timing', () => {
  it('logs each handler with its duration and passes the result through', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const handlers = captureHandlers()
    const result = await handlers['github:files-metrics']({
      repoRoot: 'gh:acme/widgets',
      paths: [],
    })
    expect(result).toEqual({ metrics: {} })
    expect(debug).toHaveBeenCalledWith(
      expect.stringMatching(/^\[git-integration\] github:files-metrics \d+ms$/)
    )
    debug.mockRestore()
  })
})

const gitRoute = (a: string[]) => {
  if (isGhPrView(a)) return '{"baseRefName":"main"}'
  if (a[0] === 'merge-base') return 'mb111\n'
  return ''
}

describe('github:pr-file-diff caching', () => {
  const payload = { repoRoot: '/repo', prNumber: 6, path: 'src/foo.ts' }
  let handlers: Record<string, Handler>

  beforeEach(() => {
    handlers = captureHandlers()
  })

  it('skips fetch and gh pr view when the head commit is unchanged', async () => {
    const spawns = routeExec(gitRoute)
    await handlers['github:pr-file-diff']({ ...payload, headSHA: 'h1' })
    spawns.length = 0

    const result = await handlers['github:pr-file-diff']({ ...payload, headSHA: 'h1' })

    expect(result).toEqual({ diff: expect.objectContaining({ path: 'src/foo.ts' }) })
    expect(spawns.map((s) => s.args.slice(0, 2))).toEqual([
      ['diff', 'mb111...refs/remotes/pull/6/head'],
    ])
  })
})

describe('github:pr-file-diff caching — fetches again when the head commit changed', () => {
  const payload = { repoRoot: '/repo', prNumber: 6, path: 'src/foo.ts' }
  let handlers: Record<string, Handler>

  beforeEach(() => {
    handlers = captureHandlers()
  })

  it('fetches again when the head commit changed', async () => {
    const spawns = routeExec(gitRoute)
    await handlers['github:pr-file-diff']({ ...payload, headSHA: 'h1' })
    spawns.length = 0

    await handlers['github:pr-file-diff']({ ...payload, headSHA: 'h2' })

    expect(spawns.some((s) => s.args[0] === 'fetch')).toBe(true)
  })

  it('fetches the base branch before taking the merge base, so a stacked PR resolves', async () => {
    const spawns = routeExec(gitRoute)

    await handlers['github:pr-file-diff']({ ...payload, baseRef: 'develop', headSHA: 'h1' })

    const order = spawns.map((s) => s.args.join(' '))
    const baseFetch = order.findIndex((a) => a.startsWith('fetch') && a.includes('develop'))
    expect(baseFetch).toBeGreaterThan(-1)
    expect(baseFetch).toBeLessThan(order.findIndex((a) => a.startsWith('merge-base')))
  })

  it('does not ask gh for the base branch when the caller supplies it', async () => {
    const spawns = routeExec(gitRoute)

    await handlers['github:pr-file-diff']({ ...payload, baseRef: 'develop', headSHA: 'h1' })

    expect(spawns.some((s) => isGhPrView(s.args))).toBe(false)
    expect(spawns.find((s) => s.args[0] === 'merge-base')?.args).toContain('origin/develop')
  })
})

describe('github:pr-file-diff caching — does not reuse a cached merge base without a head commit', () => {
  const payload = { repoRoot: '/repo', prNumber: 6, path: 'src/foo.ts' }
  let handlers: Record<string, Handler>

  beforeEach(() => {
    handlers = captureHandlers()
  })

  it('does not reuse a cached merge base without a head commit', async () => {
    const spawns = routeExec(gitRoute)
    await handlers['github:pr-file-diff']({ ...payload, headSHA: 'h1' })
    spawns.length = 0

    await handlers['github:pr-file-diff'](payload)

    expect(spawns.some((s) => s.args[0] === 'fetch')).toBe(true)
  })
})

describe('repository lookups run once', () => {
  it('asks gh for the owner and name once across handlers', async () => {
    const handlers = captureHandlers()
    const spawns = routeExec((a) => {
      if (isGhRepoView(a)) return JSON.stringify(REPO_VIEW)
      return JSON.stringify({ ahead_by: 0, files: [] })
    })

    await handlers['github:pr-compare']({ repoRoot: '/repo', fromSha: 'a', toSha: 'b' })
    await handlers['github:file-viewed-set']({
      repoRoot: '/repo',
      prNumber: 6,
      path: 'a.ts',
      viewed: true,
    })

    expect(spawns.filter((s) => isGhRepoView(s.args))).toHaveLength(1)
  })
})

describe('repository lookups run once — asks again after a failed lookup', () => {
  it('asks again after a failed lookup', async () => {
    const handlers = captureHandlers()
    let fail = true
    const spawns = routeExec((a) => {
      if (isGhRepoView(a)) return fail ? new Error('network down') : JSON.stringify(REPO_VIEW)
      return JSON.stringify({ ahead_by: 0, files: [] })
    })
    const input = { repoRoot: '/repo', fromSha: 'a', toSha: 'b' }

    await handlers['github:pr-compare'](input)
    fail = false
    await handlers['github:pr-compare'](input)

    expect(spawns.filter((s) => isGhRepoView(s.args))).toHaveLength(2)
  })
})

describe('repository lookups run once — looks up the signed-in user once across handlers', () => {
  it('looks up the signed-in user once across handlers', async () => {
    const handlers = captureHandlers()
    const spawns = routeExec((a) => (a[0] === 'api' && a[1] === 'user' ? 'alice\n' : '{"data":{}}'))

    const first = await handlers['github:current-user']({ repoRoot: '/repo' })
    await handlers['github:dashboard-search']({})
    await handlers['github:current-user']({ repoRoot: '/repo' })

    expect(first).toEqual({ login: 'alice' })
    expect(spawns.filter((s) => s.args[0] === 'api' && s.args[1] === 'user')).toHaveLength(1)
  })
})

const REPO_FILES: Record<string, string> = {
  'src/a.ts': 'export const a = 1',
  'src/b.ts': "import { a } from './a'\nexport const b = a",
  'src/c.ts': "import x from './b'\nimport y from './a'",
  'src/a.spec.ts': "import { a } from './a'",
  'lib/d.py': 'import a',
  'top.ts': 'export const t = 1',
  'top.spec.ts': 'x',
}
const COMMITS: Record<string, string[]> = {
  ['1'.repeat(40)]: ['src/a.ts', 'src/b.ts'],
  ['2'.repeat(40)]: ['src/a.ts'],
  ['3'.repeat(40)]: ['lib/d.py', 'top.ts'],
}
const globToRegExp = (g: string) =>
  new RegExp('^' + g.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*') + '$')

/** `git log`: every commit with its files, or the commits touching the one path asked. */
function fakeLog(a: string[]): string {
  if (a.includes('--name-only')) {
    return Object.entries(COMMITS)
      .map(([h, files]) => `${h}\n\n${files.join('\n')}`)
      .join('\n\n')
  }
  const path = a[a.indexOf('--') + 1]
  return Object.entries(COMMITS)
    .filter(([, files]) => files.includes(path))
    .map(([h]) => `${h.slice(0, 7)} c`)
    .join('\n')
}

/** `git grep` over REPO_FILES: matching files with -rl, else file, line and text. */
function fakeGrep(a: string[]): string {
  const pattern = new RegExp(a[a.length - 1])
  const lines = Object.entries(REPO_FILES).flatMap(([file, text]) =>
    text
      .split('\n')
      .map((l, i) => ({ file, n: i + 1, l }))
      .filter((x) => pattern.test(x.l))
  )
  if (a.includes('-rl')) return [...new Set(lines.map((x) => x.file))].join('\n')
  return lines.map((x) => `${x.file}\0${x.n}\0${x.l}`).join('\n')
}

/** A fake repository answering the git commands the metrics handlers use. */
function fakeGit(a: string[]): string {
  if (a.includes('log')) return fakeLog(a)
  if (a[0] === 'grep') return fakeGrep(a)
  if (a[0] === 'ls-files') {
    const globs = a.slice(a.indexOf('--') + 1).map(globToRegExp)
    return Object.keys(REPO_FILES)
      .filter((f) => globs.some((g) => g.test(f)))
      .join('\n')
  }
  return ''
}

describe('github:files-metrics', () => {
  let handlers: Record<string, Handler>
  beforeEach(() => {
    handlers = captureHandlers()
  })

  it('reports churn, importers and test presence for each path', async () => {
    routeExec(fakeGit)
    const paths = Object.keys(REPO_FILES)

    const batch = (await handlers['github:files-metrics']({ repoRoot: '/repo', paths })) as {
      metrics: Record<string, unknown>
    }

    expect(Object.keys(batch.metrics).sort()).toEqual([...paths].sort())
    expect(batch.metrics['src/a.ts']).toMatchObject({
      churn90d: 2,
      importerCount: 3,
      testFilePresent: true,
    })
  })

  it('spawns the same number of processes for 1 path as for 20', async () => {
    const few = routeExec(fakeGit)
    await handlers['github:files-metrics']({ repoRoot: '/repo', paths: ['src/a.ts'] })
    const manyPaths = Array.from({ length: 20 }, (_, i) => `src/gen${i}.ts`)
    const many = routeExec(fakeGit)
    await handlers['github:files-metrics']({ repoRoot: '/repo', paths: manyPaths })

    expect(few.length).toBe(3)
    expect(many.length).toBe(few.length)
  })
})

describe('github:files-metrics — falls back to a search per file when the combined search overflows', () => {
  let handlers: Record<string, Handler>
  beforeEach(() => {
    handlers = captureHandlers()
  })

  it('falls back to a search per file when the combined search overflows', async () => {
    const overflow = Object.assign(new Error('maxBuffer'), {
      code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    })
    const spawns = routeExec((a) => (a[0] === 'grep' && !a.includes('-rl') ? overflow : fakeGit(a)))
    const paths = ['src/a.ts', 'src/b.ts']

    const batch = (await handlers['github:files-metrics']({ repoRoot: '/repo', paths })) as {
      metrics: Record<string, { importerCount: number }>
    }

    expect(spawns.filter((s) => s.args[0] === 'grep' && s.args.includes('-rl'))).toHaveLength(2)
    expect(batch.metrics['src/a.ts'].importerCount).toBe(3)
  })

  it('returns an error object when the history cannot be read', async () => {
    routeExec((a) => (a.includes('log') ? new Error('not a git repo') : ''))
    const result = await handlers['github:files-metrics']({ repoRoot: '/repo', paths: ['a.ts'] })
    expect(result).toMatchObject({ error: expect.stringContaining('not a git repo') })
  })
})

describe('viewed files', () => {
  let handlers: Record<string, Handler>
  beforeEach(() => {
    handlers = captureHandlers()
  })

  it('github:pr-review-detail asks for and returns the pull request node id', async () => {
    const spawns = routeExec((a) => {
      if (isGhRepoView(a)) return JSON.stringify(REPO_VIEW)
      if (isGhPrView(a)) return JSON.stringify({ ...PR_META, id: 'PR_node1' })
      if (a[0] === 'api' && a[1] === '--paginate') return '[]'
      if (a[0] === 'api') return '[]'
      return ''
    })

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { nodeId?: string } }

    expect(result.pr.nodeId).toBe('PR_node1')
    expect(spawns.find((s) => isGhPrView(s.args))?.args.join(' ')).toContain('id,')
  })
})

describe('viewed files — github:file-viewed-set with a node id makes one gh call', () => {
  let handlers: Record<string, Handler>
  beforeEach(() => {
    handlers = captureHandlers()
  })

  it('github:file-viewed-set with a node id makes one gh call', async () => {
    const spawns = routeExec(() => '{}')

    const result = await handlers['github:file-viewed-set']({
      repoRoot: '/repo',
      prNumber: 6,
      nodeId: 'PR_node1',
      path: 'a.ts',
      viewed: true,
    })

    expect(result).toEqual({ ok: true })
    expect(spawns).toHaveLength(1)
    expect(spawns[0].args.join(' ')).toContain('markFileAsViewed')
    expect(spawns[0].args).toContain('id=PR_node1')
  })
})

describe('viewed files — github:files-viewed-set sends one request with one mutation per path', () => {
  let handlers: Record<string, Handler>
  beforeEach(() => {
    handlers = captureHandlers()
  })

  it('github:files-viewed-set sends one request with one mutation per path', async () => {
    const spawns = routeExec(() => '{}')

    const result = await handlers['github:files-viewed-set']({
      repoRoot: '/repo',
      prNumber: 6,
      nodeId: 'PR_node1',
      paths: ['a.ts', 'b.ts', 'c.ts'],
      viewed: false,
    })

    expect(result).toEqual({ ok: true })
    expect(spawns).toHaveLength(1)
    const query = spawns[0].args.find((x) => x.startsWith('query='))!
    expect(query.match(/unmarkFileAsViewed/g)).toHaveLength(3)
    expect(spawns[0].args).toEqual(expect.arrayContaining(['p0=a.ts', 'p1=b.ts', 'p2=c.ts']))
  })
})

describe('viewed files — github:files-viewed-set looks up the node id when none is given', () => {
  let handlers: Record<string, Handler>
  beforeEach(() => {
    handlers = captureHandlers()
  })

  it('github:files-viewed-set looks up the node id when none is given', async () => {
    const spawns = routeExec((a) =>
      a.join(' ').includes('pullRequest(number')
        ? JSON.stringify({ data: { repository: { pullRequest: { id: 'PR_looked_up' } } } })
        : isGhRepoView(a)
          ? JSON.stringify(REPO_VIEW)
          : '{}'
    )

    await handlers['github:files-viewed-set']({
      repoRoot: '/repo',
      prNumber: 6,
      paths: ['a.ts'],
      viewed: true,
    })

    expect(spawns.at(-1)!.args).toContain('id=PR_looked_up')
  })
})

describe('stateForSearch', () => {
  it.each([
    ['is:merged', 'merged', ''],
    ['is:closed', 'closed', ''],
    ['is:all', 'all', ''],
    ['IS:Merged auth fix', 'merged', 'auth fix'],
    ['auth  is:closed   fix', 'closed', 'auth fix'],
    ['fix bug', 'open', 'fix bug'],
    ['', 'open', ''],
  ])('%j -> %s / %j', (query, state, text) => {
    expect(stateForSearch(query)).toEqual({ state, text })
  })
})

const widgetsNode = dashboardSearchNode('acme/widgets', 5, {
  title: 'Mine',
  changedFiles: 4,
  createdAt: '2026-01-01T00:00:00Z',
})

/** A stored session of acme/widgets PR 5 that viewed two files, with `over`. */
const widgetsSession = (over: Record<string, unknown>) => ({
  repoRoot: '/Users/me/repos/widgets',
  prNumber: 5,
  headSHA: 'a',
  currentChapterId: null,
  currentFilePath: null,
  viewedFiles: ['a.ts', 'b.ts'],
  fileOrderOverrides: {},
  scrollPosition: null,
  pausedAt: null,
  lastAccessedAt: '2026-02-01T00:00:00Z',
  ...over,
})

/** The dashboard with widgets PR 5 in "mine", checked out at /Users/me/repos/widgets. */
async function widgetsDashboard() {
  const handlers = handlersWithProjectRoots(['/Users/me/repos/widgets'])
  mockDashboardExec(
    { mine: [widgetsNode] },
    { '/Users/me/repos/widgets': 'https://github.com/acme/widgets.git' }
  )
  return (await handlers['github:dashboard-search']({})) as {
    prs: Array<{ sessionStatus: string; viewedFileCount: number }>
    capped: string[]
  }
}

describe('github:dashboard-search hands Home its rows', () => {
  it('hands over the rows and failed sections of each search, and refreshDashboard runs one', async () => {
    const onDashboard = vi.fn()
    mockDashboardExec(
      { mine: [widgetsNode] },
      { '/Users/me/repos/widgets': 'https://github.com/acme/widgets.git' }
    )
    const { refreshDashboard } = registerGithubHandlers(
      () => {},
      { github: githubOverStub(mockExecFile), getToken: () => '', noCheckoutCwd: GLOBAL_STORAGE },
      { listProjectRoots: () => ['/Users/me/repos/widgets'], onDashboard }
    )
    await refreshDashboard()
    expect(onDashboard).toHaveBeenCalledTimes(1)
    expect(onDashboard.mock.calls[0][0]).toMatchObject({
      failed: [],
      prs: [{ number: 5, section: 'mine', localRepoRoot: '/Users/me/repos/widgets' }],
    })
  })
})

describe('github:dashboard-search sessions and cap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    for (const k of Object.keys(sessionData)) delete sessionData[k]
  })

  it('fills the latest local session for a row with a checkout', async () => {
    sessionData['/Users/me/repos/widgets:::5'] = widgetsSession({})
    sessionData['/Users/me/repos/widgets:::5:::old'] = widgetsSession({ viewedFiles: [] })
    const result = await widgetsDashboard()
    expect(result.prs[0]).toMatchObject({ sessionStatus: 'in-progress', viewedFileCount: 2 })
  })

  it('marks a paused session paused', async () => {
    sessionData['/Users/me/repos/widgets:::5'] = widgetsSession({
      pausedAt: '2026-02-02T00:00:00Z',
    })
    const result = await widgetsDashboard()
    expect(result.prs[0].sessionStatus).toBe('paused')
  })

  it('leaves a row with no session not-started', async () => {
    const result = await widgetsDashboard()
    expect(result.prs[0]).toMatchObject({ sessionStatus: 'not-started', viewedFileCount: 0 })
  })
})

describe('github:dashboard-search sessions and cap — reports sections whose search matched more than it returned', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockReset()
    for (const k of Object.keys(sessionData)) delete sessionData[k]
  })

  it('reports sections whose search matched more than it returned', async () => {
    const handlers = captureHandlers()
    mockExecFile.mockImplementation(
      stubAnswering(({ args }) => {
        if (args[1] === 'user') return 'alice'
        const alias = /(\w+): search\(/.exec(args[3])![1]
        const issueCount = alias === 'mine' ? 120 : 0
        return JSON.stringify({ data: { [alias]: { issueCount, nodes: [] } } })
      })
    )
    const result = (await handlers['github:dashboard-search']({})) as { capped: string[] }
    expect(result.capped).toEqual(['mine'])
  })
})
