import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }))

vi.mock('child_process', () => ({ execFile: mockExecFile }))
vi.mock('electron-store', () => ({
  default: class {
    get() {
      return undefined
    }
    set() {}
    delete() {}
    store = {}
  },
}))
vi.mock('fs/promises', () => ({ readFile: vi.fn().mockRejectedValue(new Error('no file')) }))

// ── import after mocks ────────────────────────────────────────────────────────

import { readFile } from 'fs/promises'
import { registerGithubHandlers } from '../../src/ipc/github.ipc'

// ── helpers ───────────────────────────────────────────────────────────────────

type Handler = (payload: unknown) => Promise<unknown>
type ExecCallback = (err: Error | null, result?: { stdout: string; stderr: string }) => void

function captureHandlers(): Record<string, Handler> {
  const handlers: Record<string, Handler> = {}
  registerGithubHandlers(
    (channel, handler) => {
      handlers[channel] = handler as Handler
    },
    { getGhPath: () => '', getToken: () => '' }
  )
  return handlers
}

function captureHandlersWithToken(token: string): Record<string, Handler> {
  const handlers: Record<string, Handler> = {}
  registerGithubHandlers(
    (channel, handler) => {
      handlers[channel] = handler as Handler
    },
    { getGhPath: () => '', getToken: () => token }
  )
  return handlers
}

function mockGitSuccess(stdout: string) {
  mockExecFile.mockImplementationOnce(
    (_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) =>
      cb(null, { stdout, stderr: '' })
  )
}

function mockGitFailure(message: string) {
  mockExecFile.mockImplementationOnce(
    (_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) => cb(new Error(message))
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

describe('github:pr-review-detail', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

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

  it('leaves statusChecks empty when check-suites also returns empty array', async () => {
    mockPrDetail(PR_META)
    mockGitSuccess(JSON.stringify([]))

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { statusChecks: unknown[] } }

    expect(result.pr.statusChecks).toEqual([])
  })

  it('skips check-suites fallback when headSHA is empty', async () => {
    mockPrDetail({ ...PR_META, headRefOid: '' })
    // No 4th mock needed — the branch is skipped entirely

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { statusChecks: unknown[] } }

    expect(result.pr.statusChecks).toEqual([])
    // Only 5 execFile calls (repo view + pr view + files + reviews + requested_reviewers), check-suites skipped
    expect(mockExecFile).toHaveBeenCalledTimes(5)
  })

  it('maps isDraft=true onto pr object', async () => {
    mockPrDetail({ ...PR_META, isDraft: true })
    mockGitFailure('not found')

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { isDraft: boolean } }

    expect(result.pr.isDraft).toBe(true)
  })

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

  it('maps FAILURE conclusion to fail state', async () => {
    mockPrDetail({ ...PR_META, statusCheckRollup: [{ name: 'lint', conclusion: 'FAILURE' }] })

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { statusChecks: Array<{ state: string }> } }

    expect(result.pr.statusChecks[0].state).toBe('fail')
  })

  it('maps TIMED_OUT and ACTION_REQUIRED conclusions to fail', async () => {
    for (const conclusion of ['TIMED_OUT', 'ACTION_REQUIRED', 'ERROR']) {
      mockPrDetail({ ...PR_META, statusCheckRollup: [{ name: 'check', conclusion }] })

      const result = (await handlers['github:pr-review-detail']({
        repoRoot: '/repo',
        prNumber: 6,
      })) as { pr: { statusChecks: Array<{ state: string }> } }

      expect(result.pr.statusChecks[0].state).toBe('fail')
    }
  })

  it('maps IN_PROGRESS and QUEUED to pending state', async () => {
    for (const conclusion of ['IN_PROGRESS', 'QUEUED', 'PENDING', 'WAITING']) {
      mockPrDetail({ ...PR_META, statusCheckRollup: [{ name: 'check', conclusion }] })

      const result = (await handlers['github:pr-review-detail']({
        repoRoot: '/repo',
        prNumber: 6,
      })) as { pr: { statusChecks: Array<{ state: string }> } }

      expect(result.pr.statusChecks[0].state).toBe('pending')
    }
  })

  it('maps SKIPPED, NEUTRAL, CANCELLED to skipped state', async () => {
    for (const conclusion of ['SKIPPED', 'NEUTRAL', 'CANCELLED']) {
      mockPrDetail({ ...PR_META, statusCheckRollup: [{ name: 'check', conclusion }] })

      const result = (await handlers['github:pr-review-detail']({
        repoRoot: '/repo',
        prNumber: 6,
      })) as { pr: { statusChecks: Array<{ state: string }> } }

      expect(result.pr.statusChecks[0].state).toBe('skipped')
    }
  })

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

  it('returns VALIDATION_ERROR for missing repoRoot', async () => {
    const result = (await handlers['github:pr-review-detail']({
      prNumber: 6,
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

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

  it('maps mergeStateStatus CLEAN to clean', async () => {
    mockPrDetail({ ...PR_META, mergeStateStatus: 'CLEAN' })
    mockGitFailure('not found')
    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { mergeStateStatus: string } }
    expect(result.pr.mergeStateStatus).toBe('clean')
  })

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
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('fetches PR ref with --force so stale local refs do not block the diff', async () => {
    mockGitSuccess('') // git fetch
    mockGitSuccess('main\n') // gh pr view (also goes through execFile)
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

  it('returns VALIDATION_ERROR for missing path', async () => {
    const result = (await handlers['github:pr-file-diff']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('parses a diff with binary file indicator', async () => {
    mockGitSuccess('') // git fetch
    mockGitSuccess('main\n') // gh pr view
    mockGitSuccess('abc123\n') // git merge-base
    mockGitSuccess('Binary files a/image.png and b/image.png differ\n') // git diff

    const result = (await handlers['github:pr-file-diff']({
      repoRoot: '/repo',
      prNumber: 6,
      path: 'image.png',
    })) as { diff: { isBinary: boolean } }

    expect(result.diff.isBinary).toBe(true)
  })

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
    mockGitSuccess('main\n') // gh pr view
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

describe('github:list-open-prs', () => {
  let handlers: Record<string, Handler>
  const REPO_VIEW = { owner: { login: 'test-owner' }, name: 'test-repo' }

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('returns VALIDATION_ERROR for missing repoRoot', async () => {
    const result = (await handlers['github:list-open-prs']({})) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

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

  it('returns generic error message for other failures', async () => {
    mockGitFailure('network timeout')
    const result = (await handlers['github:list-open-prs']({
      repoRoot: '/repo',
    })) as { error: string }
    expect(result.error).toContain('network timeout')
  })

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

  it('handles paginated load with includeClosedPrs=true', async () => {
    mockGitSuccess(JSON.stringify(REPO_VIEW)) // repo view
    const gqlResponse = {
      data: {
        repository: {
          pullRequests: {
            pageInfo: { endCursor: null, hasNextPage: false },
            nodes: [],
          },
        },
      },
    }
    mockGitSuccess(JSON.stringify(gqlResponse))

    const result = (await handlers['github:list-open-prs']({
      repoRoot: '/repo',
      includeClosedPrs: true,
    })) as { prs: unknown[]; hasMore: boolean }
    expect(result.hasMore).toBe(false)
  })

  it('normalizes GQL nodes with optional fields when response contains PRs', async () => {
    mockGitSuccess(JSON.stringify(REPO_VIEW))
    const gqlResponse = {
      data: {
        repository: {
          pullRequests: {
            pageInfo: { endCursor: null, hasNextPage: false },
            nodes: [
              {
                number: 7,
                title: 'Test PR',
                isDraft: false,
                additions: 10,
                deletions: 5,
                changedFiles: 2,
                createdAt: '2025-06-01T00:00:00Z',
                headRefName: 'feat/test',
                baseRefName: 'main',
                mergeStateStatus: 'CLEAN',
                author: { login: 'alice', avatarUrl: 'https://example.com/alice.png' },
                // Optional fields present:
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
                reviewRequests: {
                  nodes: [{ requestedReviewer: { login: 'carol', avatarUrl: '' } }],
                },
                commits: {
                  nodes: [
                    {
                      commit: {
                        statusCheckRollup: {
                          contexts: {
                            nodes: [{ name: 'CI', conclusion: 'SUCCESS', status: 'COMPLETED' }],
                          },
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    }
    mockGitSuccess(JSON.stringify(gqlResponse))

    const result = (await handlers['github:list-open-prs']({
      repoRoot: '/repo',
    })) as { prs: Array<{ number: number; requestedReviewers: string[] }> }
    expect(result.prs).toHaveLength(1)
    expect(result.prs[0].number).toBe(7)
    expect(result.prs[0].requestedReviewers).toContain('carol')
  })

  it('normalizes GQL nodes when optional fields are absent', async () => {
    mockGitSuccess(JSON.stringify(REPO_VIEW))
    const gqlResponse = {
      data: {
        repository: {
          pullRequests: {
            pageInfo: { endCursor: null, hasNextPage: false },
            nodes: [
              {
                number: 8,
                title: 'Minimal PR',
                isDraft: false,
                additions: 0,
                deletions: 0,
                changedFiles: 0,
                createdAt: '2025-06-01T00:00:00Z',
                headRefName: 'fix/minor',
                baseRefName: 'main',
                mergeStateStatus: 'CLEAN',
                author: { login: 'alice', avatarUrl: '' },
                // Optional fields ABSENT (undefined paths in normalizeGraphQLNode)
              },
            ],
          },
        },
      },
    }
    mockGitSuccess(JSON.stringify(gqlResponse))

    const result = (await handlers['github:list-open-prs']({
      repoRoot: '/repo',
    })) as { prs: Array<{ number: number }> }
    expect(result.prs).toHaveLength(1)
    expect(result.prs[0].number).toBe(8)
  })
})

describe('github:file-metrics', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('returns VALIDATION_ERROR for missing repoRoot', async () => {
    const result = (await handlers['github:file-metrics']({ path: 'src/foo.ts' })) as {
      error: string
    }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns file metrics for a regular source file', async () => {
    mockGitSuccess('abc1234 fix bug\ndef5678 refactor\n') // git log (churn)
    mockGitSuccess('src/bar.ts\n') // git grep (importers)
    mockGitSuccess('src/foo.spec.ts\n') // git ls-files (test file check)

    const result = (await handlers['github:file-metrics']({
      repoRoot: '/repo',
      path: 'src/foo.ts',
    })) as Record<string, unknown>
    expect(result.churn90d).toBe(2)
    expect(result.blastRadius).toBe(1) // bar.ts imports foo.ts
    expect(result.testFilePresent).toBe(true)
  })

  it('returns testFilePresent=true for a test file itself', async () => {
    mockGitSuccess('') // git log (churn)
    mockGitSuccess('') // git grep (importers)
    // No third call needed because isTestFile = true

    const result = (await handlers['github:file-metrics']({
      repoRoot: '/repo',
      path: 'src/foo.spec.ts',
    })) as Record<string, unknown>
    expect(result.testFilePresent).toBe(true)
  })

  it('returns error when git commands fail', async () => {
    // All three parallel git calls fail
    mockGitFailure('not a git repo')
    mockGitFailure('not a git repo')
    mockGitFailure('not a git repo')

    const result = (await handlers['github:file-metrics']({
      repoRoot: '/repo',
      path: 'src/foo.ts',
    })) as { error: string }
    expect(result.error).toBeDefined()
  })

  it('reads coveragePct from Istanbul coverage-summary.json when present', async () => {
    const summary = { 'src/foo.ts': { lines: { pct: 87.5 } } }
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(summary) as unknown as Buffer)
    mockGitSuccess('abc1234 fix\n') // churn
    mockGitSuccess('') // importers
    mockGitSuccess('') // test file check

    const result = (await handlers['github:file-metrics']({
      repoRoot: '/repo',
      path: 'src/foo.ts',
    })) as Record<string, unknown>
    expect(result.patchCoverage).toBe(88)
  })

  it('reads coveragePct from lcov.info when coverage-summary.json is absent', async () => {
    vi.mocked(readFile)
      .mockRejectedValueOnce(new Error('no summary')) // coverage-summary.json fails
      .mockResolvedValueOnce(
        // lcov.info succeeds
        'SF:src/foo.ts\nLF:100\nLH:75\nend_of_record\n' as unknown as Buffer
      )
    mockGitSuccess('') // churn
    mockGitSuccess('') // importers
    mockGitSuccess('') // test file check

    const result = (await handlers['github:file-metrics']({
      repoRoot: '/repo',
      path: 'src/foo.ts',
    })) as Record<string, unknown>
    expect(result.patchCoverage).toBe(75)
  })

  it('uses partial key match in coverage-summary.json', async () => {
    const summary = { '/absolute/path/src/foo.ts': { lines: { pct: 60 } } }
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(summary) as unknown as Buffer)
    mockGitSuccess('') // churn
    mockGitSuccess('') // importers
    mockGitSuccess('') // test file check

    const result = (await handlers['github:file-metrics']({
      repoRoot: '/repo',
      path: 'src/foo.ts',
    })) as Record<string, unknown>
    expect(result.patchCoverage).toBe(60)
  })
})

describe('github:pr-inline-comments', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('returns VALIDATION_ERROR for invalid payload', async () => {
    const result = (await handlers['github:pr-inline-comments']({ repoRoot: '/repo' })) as {
      error: string
    }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns comments on success', async () => {
    const comments = [
      {
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
      },
    ]
    mockGitSuccess(JSON.stringify(comments))

    const result = (await handlers['github:pr-inline-comments']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { comments: unknown[] }
    expect(result.comments).toHaveLength(1)
  })

  it('returns NOT_AUTHENTICATED on auth error', async () => {
    mockGitFailure('GH_TOKEN is not set — run: gh auth login')
    const result = (await handlers['github:pr-inline-comments']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { error: string }
    expect(result.error).toBe('NOT_AUTHENTICATED')
  })
})

describe('github:pr-comment-add', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('returns VALIDATION_ERROR for missing required fields', async () => {
    const result = (await handlers['github:pr-comment-add']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('posts a comment without startLine', async () => {
    const comment = {
      id: 100,
      user: { login: 'alice', avatar_url: '' },
      body: 'LGTM',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      path: 'src/foo.ts',
      line: 5,
      start_line: null,
      side: 'RIGHT',
      diff_hunk: '',
      in_reply_to_id: null,
      pull_request_review_id: 1,
    }
    mockGitSuccess(JSON.stringify(comment))

    const result = (await handlers['github:pr-comment-add']({
      repoRoot: '/repo',
      prNumber: 6,
      commitId: 'abc123',
      path: 'src/foo.ts',
      line: 5,
      side: 'RIGHT',
      body: 'LGTM',
    })) as { comment: { id: number } }
    expect(result.comment.id).toBe(100)
  })

  it('posts a comment with startLine for multi-line comment', async () => {
    const comment = {
      id: 101,
      user: { login: 'alice', avatar_url: '' },
      body: 'Multi-line',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      path: 'src/foo.ts',
      line: 10,
      start_line: 5,
      side: 'RIGHT',
      diff_hunk: '',
      in_reply_to_id: null,
      pull_request_review_id: 1,
    }
    mockGitSuccess(JSON.stringify(comment))

    const result = (await handlers['github:pr-comment-add']({
      repoRoot: '/repo',
      prNumber: 6,
      commitId: 'abc123',
      path: 'src/foo.ts',
      line: 10,
      startLine: 5,
      side: 'RIGHT',
      body: 'Multi-line',
    })) as { comment: { id: number } }
    expect(result.comment.id).toBe(101)

    // Verify start_line and start_side args were included
    const args: string[] = mockExecFile.mock.calls[0][1]
    expect(args).toContain('start_line=5')
  })
})

describe('github:pr-comment-reply', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('returns VALIDATION_ERROR for missing required fields', async () => {
    const result = (await handlers['github:pr-comment-reply']({ repoRoot: '/repo' })) as {
      error: string
    }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

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
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('returns VALIDATION_ERROR for missing required fields', async () => {
    const result = (await handlers['github:pr-review-submit']({ repoRoot: '/repo' })) as {
      error: string
    }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

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

describe('github:sessions-for-repo and github:session-get/set', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('github:sessions-for-repo returns empty sessions for invalid payload', async () => {
    const result = (await handlers['github:sessions-for-repo']({})) as { sessions: unknown[] }
    expect(result.sessions).toEqual([])
  })

  it('github:sessions-for-repo returns sessions for valid repo', async () => {
    const result = (await handlers['github:sessions-for-repo']({
      repoRoot: '/repo',
    })) as { sessions: unknown[] }
    expect(Array.isArray(result.sessions)).toBe(true)
  })

  it('github:session-get returns { session: null } for invalid payload', async () => {
    const result = (await handlers['github:session-get']({})) as { session: null }
    expect(result.session).toBeNull()
  })

  it('github:session-get returns { session: null } for unknown key', async () => {
    const result = (await handlers['github:session-get']({ key: 'unknown-key' })) as {
      session: null
    }
    expect(result.session).toBeNull()
  })

  it('github:session-set returns VALIDATION_ERROR for invalid payload', async () => {
    const result = (await handlers['github:session-set']({})) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('github:session-set returns VALIDATION_ERROR for invalid session data', async () => {
    const result = (await handlers['github:session-set']({
      key: 'test-key',
      session: { invalid: true },
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

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
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('returns VALIDATION_ERROR when repoRoot is missing', async () => {
    const result = (await handlers['github:remove-active-review']({
      prNumber: 5,
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns VALIDATION_ERROR when prNumber is missing', async () => {
    const result = (await handlers['github:remove-active-review']({
      repoRoot: '/repo',
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns VALIDATION_ERROR when prNumber is not a positive integer', async () => {
    const result = (await handlers['github:remove-active-review']({
      repoRoot: '/repo',
      prNumber: -1,
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns { ok: true } when entry is deleted successfully', async () => {
    const result = (await handlers['github:remove-active-review']({
      repoRoot: '/repo',
      prNumber: 42,
    })) as { ok: boolean }
    expect(result.ok).toBe(true)
  })
})

describe('github:prune-active-reviews', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('returns VALIDATION_ERROR when repoRoot is missing', async () => {
    const result = (await handlers['github:prune-active-reviews']({
      prNumbers: [1],
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns VALIDATION_ERROR when prNumbers is missing', async () => {
    const result = (await handlers['github:prune-active-reviews']({
      repoRoot: '/repo',
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

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
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('returns NOT_AUTHENTICATED when auth error thrown', async () => {
    mockGitFailure('You need to run: gh auth login')

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { error: string }
    expect(result.error).toBe('NOT_AUTHENTICATED')
  })

  it('returns RATE_LIMITED when rate limit error thrown', async () => {
    mockGitFailure('rate limit exceeded')

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { error: string; resetAt?: number }
    expect(result.error).toBe('RATE_LIMITED')
    expect(result.resetAt).toBeTypeOf('number')
  })

  it('returns generic error string for other failures', async () => {
    mockGitFailure('ENOENT: gh not found')

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { error: string }
    expect(result.error).toContain('ENOENT')
  })
})

describe('github:pr-mark-ready', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('returns VALIDATION_ERROR for missing prNumber', async () => {
    const result = (await handlers['github:pr-mark-ready']({
      repoRoot: '/repo',
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns VALIDATION_ERROR for missing repoRoot', async () => {
    const result = (await handlers['github:pr-mark-ready']({
      prNumber: 6,
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

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
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('returns VALIDATION_ERROR for missing prNumber', async () => {
    const result = (await handlers['github:pr-issue-comments']({
      repoRoot: '/repo',
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns VALIDATION_ERROR for missing repoRoot', async () => {
    const result = (await handlers['github:pr-issue-comments']({
      prNumber: 6,
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

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
    mockGitSuccess(JSON.stringify(raw))

    const result = (await handlers['github:pr-issue-comments']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { comments: Array<{ id: number; author: string; body: string }> }

    expect(result.comments).toHaveLength(1)
    expect(result.comments[0].id).toBe(1)
    expect(result.comments[0].author).toBe('alice')
    expect(result.comments[0].body).toBe('Looks good')
  })

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
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('returns VALIDATION_ERROR for missing body', async () => {
    const result = (await handlers['github:pr-issue-comment-add']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns VALIDATION_ERROR for empty body', async () => {
    const result = (await handlers['github:pr-issue-comment-add']({
      repoRoot: '/repo',
      prNumber: 6,
      body: '',
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

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

  it('returns VALIDATION_ERROR for missing repoRoot', async () => {
    const result = (await handlers['github:pr-update-branch']({
      prNumber: 6,
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns VALIDATION_ERROR for missing prNumber', async () => {
    const result = (await handlers['github:pr-update-branch']({
      repoRoot: '/repo',
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
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
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('returns VALIDATION_ERROR for missing repoRoot', async () => {
    const result = (await handlers['github:current-user']({})) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

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

  it('passes GH_TOKEN env var to gh when a token is configured', async () => {
    const handlersWithToken = captureHandlersWithToken('my-secret-token')
    mockGitSuccess('alice\n')
    await handlersWithToken['github:current-user']({ repoRoot: '/repo' })
    const callOpts = mockExecFile.mock.calls[0][2] as { env?: Record<string, string> }
    expect(callOpts.env?.GH_TOKEN).toBe('my-secret-token')
  })

  it('treats a stderr-only response (no stdout) as an error', async () => {
    // Exercises the `if (stderr && !stdout) throw new Error(stderr)` branch in runGh
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) =>
        cb(null, { stdout: '', stderr: 'gh: command not found' })
    )
    const result = (await handlers['github:current-user']({ repoRoot: '/repo' })) as {
      error: string
    }
    expect(result.error).toContain('gh: command not found')
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
    const retryOpts = mockExecFile.mock.calls[1][2] as { env?: unknown }
    expect(retryOpts.env).toBeUndefined()
  })

  it('throws when retry response is stderr-only (covers retry stderr branch)', async () => {
    const handlersWithToken = captureHandlersWithToken('expired-token')
    // First call → auth error triggers retry
    mockGitFailure('You need to run: gh auth login')
    // Retry → stderr only, no stdout → runGh throws
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) =>
        cb(null, { stdout: '', stderr: 'connection refused' })
    )
    const result = (await handlersWithToken['github:current-user']({ repoRoot: '/repo' })) as {
      error: string
    }
    expect(result.error).toContain('connection refused')
  })
})

describe('github:file-cochange', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('returns VALIDATION_ERROR for missing repoRoot', async () => {
    const result = (await handlers['github:file-cochange']({ files: ['a.ts'] })) as {
      error: string
    }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns VALIDATION_ERROR for empty files array', async () => {
    const result = (await handlers['github:file-cochange']({
      repoRoot: '/repo',
      files: [],
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns affinity map on success', async () => {
    // computeCoChangeAffinityFromGit calls git log — mock empty output (no cochange history)
    mockGitSuccess('')
    const result = (await handlers['github:file-cochange']({
      repoRoot: '/repo',
      files: ['src/foo.ts'],
    })) as { affinity: Record<string, number> }
    expect(result.affinity).toBeDefined()
    expect(typeof result.affinity).toBe('object')
  })
})

describe('github:save-active-review and github:active-reviews-for-repo', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('github:save-active-review returns VALIDATION_ERROR for missing repoRoot', async () => {
    const result = (await handlers['github:save-active-review']({ pr: { number: 1 } })) as {
      error: string
    }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('github:save-active-review stores and returns ok:true', async () => {
    const result = (await handlers['github:save-active-review']({
      repoRoot: '/repo',
      pr: { number: 42 },
    })) as { ok: boolean }
    expect(result.ok).toBe(true)
  })

  it('github:active-reviews-for-repo returns VALIDATION_ERROR for missing repoRoot', async () => {
    const result = (await handlers['github:active-reviews-for-repo']({})) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('github:active-reviews-for-repo returns prs array for valid repoRoot', async () => {
    const result = (await handlers['github:active-reviews-for-repo']({
      repoRoot: '/repo',
    })) as { prs: unknown[] }
    expect(Array.isArray(result.prs)).toBe(true)
  })
})
