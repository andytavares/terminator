import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process with promisify.custom so runGh/runGit work
const { execFileMock } = vi.hoisted(() => {
  const CUSTOM_SYM = Symbol.for('nodejs.util.promisify.custom')
  const mock = vi.fn()
  ;(mock as unknown as Record<symbol, ReturnType<typeof vi.fn>>)[CUSTOM_SYM] = vi.fn()
  return { execFileMock: mock }
})
vi.mock('child_process', () => ({ execFile: execFileMock }))

// Mock electron-store
const storeData: Record<string, unknown> = {}
vi.mock('electron-store', () => ({
  default: class MockStore {
    get store() {
      return storeData
    }
    get(key: string) {
      return storeData[key]
    }
    set(key: string, val: unknown) {
      storeData[key] = val
    }
  },
}))

// Mock fs/promises for coverage file reading
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('not found')),
}))

import { registerGithubHandlers } from '../../../extensions/git-integration/src/ipc/github.ipc'

type Handler = (payload: unknown) => Promise<unknown> | unknown
const handlers = new Map<string, Handler>()

function register(channel: string, handler: Handler) {
  handlers.set(channel, handler)
}

function customMock() {
  return (execFileMock as unknown as Record<symbol, ReturnType<typeof vi.fn>>)[
    Symbol.for('nodejs.util.promisify.custom')
  ]
}

function mockResolve(stdout: string) {
  customMock().mockResolvedValue({ stdout, stderr: '' })
}

function mockReject(message: string) {
  customMock().mockRejectedValue(new Error(message))
}

beforeEach(() => {
  vi.clearAllMocks()
  handlers.clear()
  Object.keys(storeData).forEach((k) => delete storeData[k])
  registerGithubHandlers(register as Parameters<typeof registerGithubHandlers>[0])
})

// ─── Helper: get registered handler ───────────────────────────────────────────

function getHandler(channel: string): Handler {
  const h = handlers.get(channel)
  if (!h) throw new Error(`No handler for ${channel}`)
  return h
}

// ─── github:list-open-prs ─────────────────────────────────────────────────────

const QUEUE_PR = {
  number: 42,
  title: 'Fix bug',
  author: { login: 'alice', avatarUrl: '' },
  createdAt: '2024-01-01T00:00:00Z',
  headRefName: 'fix/bug',
  baseRefName: 'main',
  isDraft: false,
  statusCheckRollup: [],
  files: [],
  additions: 10,
  deletions: 5,
  changedFiles: 1,
}

describe('github:list-open-prs', () => {
  it('returns VALIDATION_ERROR for missing repoRoot', async () => {
    const result = (await getHandler('github:list-open-prs')({})) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns RATE_LIMITED error on rate limit message', async () => {
    mockReject('API rate limit exceeded')
    const result = (await getHandler('github:list-open-prs')({ repoRoot: '/repo' })) as {
      error: string
    }
    expect(result.error).toBe('RATE_LIMITED')
  })

  it('returns error string for non-rate-limit gh failure', async () => {
    mockReject('network timeout')
    const result = (await getHandler('github:list-open-prs')({ repoRoot: '/repo' })) as {
      error: string
    }
    expect(result.error).toContain('network timeout')
  })

  it('returns RATE_LIMITED for "rate limit" phrasing', async () => {
    mockReject('rate limit hit')
    const result = (await getHandler('github:list-open-prs')({ repoRoot: '/repo' })) as {
      error: string
    }
    expect(result.error).toBe('RATE_LIMITED')
  })

  it('looks up a single PR by number when search is a digit string', async () => {
    mockResolve(JSON.stringify(QUEUE_PR))
    const result = (await getHandler('github:list-open-prs')({
      repoRoot: '/repo',
      search: '42',
    })) as { prs: Record<string, unknown>[]; hasMore: boolean }
    expect(result.prs).toHaveLength(1)
    expect(result.prs[0].number).toBe(42)
    expect(result.hasMore).toBe(false)
  })

  it('searches PRs by text when search is non-numeric', async () => {
    mockResolve(JSON.stringify([QUEUE_PR]))
    const result = (await getHandler('github:list-open-prs')({
      repoRoot: '/repo',
      search: 'fix bug',
    })) as { prs: Record<string, unknown>[]; hasMore: boolean }
    expect(result.prs).toHaveLength(1)
    expect(result.hasMore).toBe(false)
  })
})

// ─── github:pr-review-detail ──────────────────────────────────────────────────

describe('github:pr-review-detail', () => {
  it('returns VALIDATION_ERROR for missing prNumber', async () => {
    const result = (await getHandler('github:pr-review-detail')({ repoRoot: '/repo' })) as {
      error: string
    }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns VALIDATION_ERROR for non-integer prNumber', async () => {
    const result = (await getHandler('github:pr-review-detail')({
      repoRoot: '/repo',
      prNumber: 1.5,
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns VALIDATION_ERROR for missing repoRoot', async () => {
    const result = (await getHandler('github:pr-review-detail')({ prNumber: 42 })) as {
      error: string
    }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns RATE_LIMITED on rate limit error', async () => {
    mockReject('API rate limit exceeded')
    const result = (await getHandler('github:pr-review-detail')({
      repoRoot: '/repo',
      prNumber: 42,
    })) as { error: string }
    expect(result.error).toBe('RATE_LIMITED')
  })
})

// ─── github:pr-file-diff ─────────────────────────────────────────────────────

describe('github:pr-file-diff', () => {
  it('returns VALIDATION_ERROR for missing path', async () => {
    const result = (await getHandler('github:pr-file-diff')({
      repoRoot: '/repo',
      prNumber: 42,
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns VALIDATION_ERROR for missing repoRoot', async () => {
    const result = (await getHandler('github:pr-file-diff')({
      prNumber: 42,
      path: 'src/app.ts',
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns error string on subprocess failure', async () => {
    mockReject('git error')
    const result = (await getHandler('github:pr-file-diff')({
      repoRoot: '/repo',
      prNumber: 42,
      path: 'src/app.ts',
    })) as { error: string }
    expect(result.error).toContain('git error')
  })
})

// ─── github:file-metrics ──────────────────────────────────────────────────────

describe('github:file-metrics', () => {
  it('returns VALIDATION_ERROR for missing path', async () => {
    const result = (await getHandler('github:file-metrics')({ repoRoot: '/repo' })) as {
      error: string
    }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns VALIDATION_ERROR for empty path', async () => {
    const result = (await getHandler('github:file-metrics')({ repoRoot: '/repo', path: '' })) as {
      error: string
    }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns metrics when git commands succeed', async () => {
    // churnRaw: 3 commits; blastRaw: 2 importers; testRaw: 1 test file
    customMock()
      .mockResolvedValueOnce({ stdout: 'abc commit1\ndef commit2\nghi commit3\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'src/foo.ts\nsrc/bar.ts\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'src/app.spec.ts\n', stderr: '' })

    const result = (await getHandler('github:file-metrics')({
      repoRoot: '/repo',
      path: 'src/app.ts',
    })) as Record<string, unknown>
    expect(result.churn90d).toBe(3)
    expect(result.blastRadius).toBe(2) // importerLines excludes the file itself (src/app.ts not in importer list)
    expect(result.testFilePresent).toBe(true)
    expect(result.patchCoverage).toBeNull() // no coverage file mocked
  })
})

// ─── github:pr-inline-comments ────────────────────────────────────────────────

describe('github:pr-inline-comments', () => {
  it('returns VALIDATION_ERROR for missing prNumber', async () => {
    const result = (await getHandler('github:pr-inline-comments')({ repoRoot: '/repo' })) as {
      error: string
    }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns RATE_LIMITED on rate limit error', async () => {
    mockReject('API rate limit exceeded')
    const result = (await getHandler('github:pr-inline-comments')({
      repoRoot: '/repo',
      prNumber: 42,
    })) as { error: string }
    expect(result.error).toBe('RATE_LIMITED')
  })

  it('returns parsed comments on success', async () => {
    const rawComment = {
      id: 1,
      user: { login: 'alice', avatar_url: '' },
      body: 'LGTM',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      path: 'src/app.ts',
      line: 42,
      start_line: null,
      side: 'RIGHT',
      diff_hunk: '@@ -1,2 +1,3 @@',
      in_reply_to_id: null,
      pull_request_review_id: 99,
    }
    mockResolve(JSON.stringify([rawComment]))
    const result = (await getHandler('github:pr-inline-comments')({
      repoRoot: '/repo',
      prNumber: 42,
    })) as { comments: Record<string, unknown>[] }
    expect(result.comments).toHaveLength(1)
    expect(result.comments[0].author).toBe('alice')
    expect(result.comments[0].body).toBe('LGTM')
    expect(result.comments[0].isReply).toBe(false)
  })

  it('correctly marks replies', async () => {
    const rawReply = {
      id: 2,
      user: { login: 'bob', avatar_url: '' },
      body: 'Agreed',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      path: 'src/app.ts',
      line: 42,
      start_line: null,
      side: 'RIGHT',
      diff_hunk: '@@ -1,2 +1,3 @@',
      in_reply_to_id: 1,
      pull_request_review_id: 99,
    }
    mockResolve(JSON.stringify([rawReply]))
    const result = (await getHandler('github:pr-inline-comments')({
      repoRoot: '/repo',
      prNumber: 42,
    })) as { comments: Record<string, unknown>[] }
    expect(result.comments[0].isReply).toBe(true)
    expect(result.comments[0].parentId).toBe(1)
    expect(result.comments[0].threadId).toBe('1')
  })
})

// ─── github:pr-comment-add ────────────────────────────────────────────────────

describe('github:pr-comment-add', () => {
  it('returns VALIDATION_ERROR for missing required fields', async () => {
    const result = (await getHandler('github:pr-comment-add')({
      repoRoot: '/repo',
      prNumber: 42,
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns VALIDATION_ERROR for invalid side value', async () => {
    const result = (await getHandler('github:pr-comment-add')({
      repoRoot: '/repo',
      prNumber: 42,
      commitId: 'abc',
      path: 'src/app.ts',
      line: 10,
      side: 'BOTH',
      body: 'Nit',
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns error string on gh failure', async () => {
    mockReject('gh auth error')
    const result = (await getHandler('github:pr-comment-add')({
      repoRoot: '/repo',
      prNumber: 42,
      commitId: 'abc1234',
      path: 'src/app.ts',
      line: 10,
      side: 'RIGHT',
      body: 'Nit: rename this',
    })) as { error: string }
    expect(result.error).toContain('gh auth error')
  })

  it('includes start_line and start_side fields when startLine is provided', async () => {
    const rawComment = {
      id: 99,
      user: { login: 'bob', avatar_url: '' },
      body: 'range comment',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      path: 'src/app.ts',
      line: 15,
      start_line: 10,
      side: 'RIGHT',
      diff_hunk: '',
      in_reply_to_id: null,
      pull_request_review_id: null,
    }
    mockResolve(JSON.stringify(rawComment))
    const result = (await getHandler('github:pr-comment-add')({
      repoRoot: '/repo',
      prNumber: 42,
      commitId: 'abc1234',
      path: 'src/app.ts',
      line: 15,
      startLine: 10,
      side: 'RIGHT',
      body: 'Range nit',
    })) as { comment: Record<string, unknown> }
    expect(result.comment.startLine).toBe(10)
  })
})

// ─── github:pr-comment-reply ──────────────────────────────────────────────────

describe('github:pr-comment-reply', () => {
  it('returns VALIDATION_ERROR for missing inReplyToId', async () => {
    const result = (await getHandler('github:pr-comment-reply')({
      repoRoot: '/repo',
      prNumber: 42,
      body: 'reply',
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns error on gh failure', async () => {
    mockReject('unauthorized')
    const result = (await getHandler('github:pr-comment-reply')({
      repoRoot: '/repo',
      prNumber: 42,
      inReplyToId: 1,
      body: 'ACK',
    })) as { error: string }
    expect(result.error).toContain('unauthorized')
  })

  it('returns posted comment on success', async () => {
    const rawReply = {
      id: 7,
      user: { login: 'carol', avatar_url: '' },
      body: 'ACK',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      path: 'src/app.ts',
      line: 5,
      start_line: null,
      side: 'RIGHT',
      diff_hunk: '',
      in_reply_to_id: 1,
      pull_request_review_id: null,
    }
    mockResolve(JSON.stringify(rawReply))
    const result = (await getHandler('github:pr-comment-reply')({
      repoRoot: '/repo',
      prNumber: 42,
      inReplyToId: 1,
      body: 'ACK',
    })) as { comment: Record<string, unknown> }
    expect(result.comment.author).toBe('carol')
    expect(result.comment.isReply).toBe(true)
  })
})

// ─── github:pr-review-submit ──────────────────────────────────────────────────

describe('github:pr-review-submit', () => {
  it('returns VALIDATION_ERROR for invalid event', async () => {
    const result = (await getHandler('github:pr-review-submit')({
      repoRoot: '/repo',
      prNumber: 42,
      commitId: 'abc',
      event: 'MERGE',
      body: '',
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns reviewId on success', async () => {
    mockResolve(JSON.stringify({ id: 9999 }))
    const result = (await getHandler('github:pr-review-submit')({
      repoRoot: '/repo',
      prNumber: 42,
      commitId: 'abc1234',
      event: 'APPROVE',
      body: 'LGTM!',
    })) as { reviewId: number }
    expect(result.reviewId).toBe(9999)
  })

  it('accepts all valid event types', async () => {
    for (const event of ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] as const) {
      mockResolve(JSON.stringify({ id: 1 }))
      const result = (await getHandler('github:pr-review-submit')({
        repoRoot: '/repo',
        prNumber: 42,
        commitId: 'abc',
        event,
        body: '',
      })) as { reviewId: number }
      expect(result.reviewId).toBe(1)
    }
  })

  it('returns error string on gh failure', async () => {
    mockReject('forbidden')
    const result = (await getHandler('github:pr-review-submit')({
      repoRoot: '/repo',
      prNumber: 42,
      commitId: 'abc',
      event: 'APPROVE',
      body: '',
    })) as { error: string }
    expect(result.error).toContain('forbidden')
  })
})

// ─── github:sessions-for-repo ────────────────────────────────────────────────

describe('github:sessions-for-repo', () => {
  const validSession = {
    repoRoot: '/repo',
    prNumber: 42,
    headSHA: 'abc1234',
    currentChapterId: null,
    currentFilePath: null,
    viewedFiles: [],
    fileOrderOverrides: {},
    scrollPosition: null,
    pausedAt: null,
    lastAccessedAt: '2024-01-01T00:00:00.000Z',
  }

  it('returns empty sessions for invalid payload', () => {
    const result = getHandler('github:sessions-for-repo')({}) as { sessions: unknown[] }
    expect(result.sessions).toHaveLength(0)
  })

  it('returns empty sessions when no keys match repoRoot', () => {
    storeData['/other:::42:::abc'] = validSession
    const result = getHandler('github:sessions-for-repo')({ repoRoot: '/repo' }) as {
      sessions: unknown[]
    }
    expect(result.sessions).toHaveLength(0)
  })

  it('returns sessions whose keys start with repoRoot:::', () => {
    storeData['/repo:::42:::abc1234'] = validSession
    storeData['/other:::1:::xyz'] = validSession
    const result = getHandler('github:sessions-for-repo')({ repoRoot: '/repo' }) as {
      sessions: unknown[]
    }
    expect(result.sessions).toHaveLength(1)
  })

  it('skips entries that fail schema validation', () => {
    storeData['/repo:::bad:::data'] = { invalid: true }
    const result = getHandler('github:sessions-for-repo')({ repoRoot: '/repo' }) as {
      sessions: unknown[]
    }
    expect(result.sessions).toHaveLength(0)
  })
})

// ─── github:session-get ───────────────────────────────────────────────────────

describe('github:session-get', () => {
  it('returns session null for missing key', () => {
    const result = getHandler('github:session-get')({}) as { session: null }
    expect(result.session).toBeNull()
  })

  it('returns session null when key not in store', () => {
    const result = getHandler('github:session-get')({ key: 'nonexistent' }) as { session: null }
    expect(result.session).toBeNull()
  })

  it('returns stored session when key exists and data is valid', () => {
    const session = {
      repoRoot: '/repo',
      prNumber: 42,
      headSHA: 'abc1234',
      currentChapterId: null,
      currentFilePath: null,
      viewedFiles: [],
      fileOrderOverrides: {},
      scrollPosition: null,
      pausedAt: null,
      lastAccessedAt: '2024-01-01T00:00:00.000Z',
    }
    storeData['/repo:::42:::abc1234'] = session
    const result = getHandler('github:session-get')({ key: '/repo:::42:::abc1234' }) as {
      session: unknown
    }
    expect(result.session).toMatchObject({ prNumber: 42, repoRoot: '/repo' })
  })

  it('returns session null when stored data fails schema validation', () => {
    storeData['bad-key'] = { invalid: true }
    const result = getHandler('github:session-get')({ key: 'bad-key' }) as { session: null }
    expect(result.session).toBeNull()
  })
})

// ─── github:session-set ───────────────────────────────────────────────────────

describe('github:session-set', () => {
  it('returns VALIDATION_ERROR for missing key', () => {
    const result = getHandler('github:session-set')({ session: {} }) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns VALIDATION_ERROR for invalid session data', () => {
    const result = getHandler('github:session-set')({
      key: 'test',
      session: { invalid: true },
    }) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('stores valid session and returns ok', () => {
    const session = {
      repoRoot: '/repo',
      prNumber: 42,
      headSHA: 'abc1234',
      currentChapterId: null,
      currentFilePath: null,
      viewedFiles: [],
      fileOrderOverrides: {},
      scrollPosition: null,
      pausedAt: null,
      lastAccessedAt: '2024-01-01T00:00:00.000Z',
    }
    const result = getHandler('github:session-set')({ key: 'my-key', session }) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(storeData['my-key']).toMatchObject({ prNumber: 42 })
  })
})
