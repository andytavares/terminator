import { describe, it, expect, vi, beforeEach } from 'vitest'

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
import { bindWorkspaceRoots } from '../../../extensions/git-integration/src/ipc/repo-root'
import { bindShell } from '../../../extensions/git-integration/src/shell/run-git'
import {
  execOverPromisedStub,
  githubOverPromisedStub,
} from '../../../extensions/git-integration/tests/unit/support/shell'
import { channelRegistry } from '../../../extensions/git-integration/tests/unit/support/channels'
import { reviewQueuePr } from '../../../extensions/git-integration/tests/unit/support/review-queue-pr'

type Handler = (payload: unknown) => Promise<unknown>
let registry = channelRegistry()

/** A promisified execFile: every command the handlers run. */
const promisedExecFile =
  vi.fn<(...args: unknown[]) => Promise<{ stdout: string; stderr: string }>>()

function customMock() {
  return promisedExecFile
}

function mockResolve(stdout: string) {
  customMock().mockResolvedValue({ stdout, stderr: '' })
}

function mockReject(message: string) {
  customMock().mockRejectedValue(new Error(message))
}

beforeEach(() => {
  vi.clearAllMocks()
  registry = channelRegistry()
  Object.keys(storeData).forEach((k) => delete storeData[k])
  const stub = (...args: unknown[]) => customMock()(...args)
  bindShell({ exec: execOverPromisedStub(stub) })
  bindWorkspaceRoots(() => ['/repo', '/other'])
  registerGithubHandlers(registry.register, {
    github: githubOverPromisedStub(stub),
    getToken: () => '',
    noCheckoutCwd: '/user-data',
  })
})

// ─── Helper: get registered handler ───────────────────────────────────────────

function getHandler(channel: string): Handler {
  return (payload) => registry.invoke(channel, payload)
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
})

describe('github:list-open-prs — search', () => {
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

// ─── github:pr-inline-comments ────────────────────────────────────────────────

describe('github:pr-inline-comments', () => {
  it('returns RATE_LIMITED on rate limit error', async () => {
    mockReject('API rate limit exceeded')
    const result = (await getHandler('github:pr-inline-comments')({
      repoRoot: '/repo',
      prNumber: 42,
    })) as { error: string }
    expect(result.error).toBe('RATE_LIMITED')
  })
})

describe('github:pr-inline-comments — top-level comments', () => {
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
})

describe('github:pr-inline-comments — replies', () => {
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

// ─── github:pr-comment-reply ──────────────────────────────────────────────────

describe('github:pr-comment-reply', () => {
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
})

describe('github:pr-comment-reply — success', () => {
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

const OWNER_REPO_MOCK = JSON.stringify({ owner: { login: 'test-owner' }, name: 'test-repo' })

describe('github:pr-review-submit', () => {
  it('returns reviewId on success', async () => {
    customMock()
      .mockResolvedValueOnce({ stdout: OWNER_REPO_MOCK, stderr: '' })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ id: 9999 }), stderr: '' })
    const result = (await getHandler('github:pr-review-submit')({
      repoRoot: '/repo',
      prNumber: 42,
      event: 'APPROVE',
      body: 'LGTM!',
    })) as { reviewId: number }
    expect(result.reviewId).toBe(9999)
  })

  it('accepts all valid event types', async () => {
    // Owner and name are looked up once per registration and then cached.
    customMock().mockResolvedValueOnce({ stdout: OWNER_REPO_MOCK, stderr: '' })
    for (const event of ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] as const) {
      customMock().mockResolvedValueOnce({ stdout: JSON.stringify({ id: 1 }), stderr: '' })
      const result = (await getHandler('github:pr-review-submit')({
        repoRoot: '/repo',
        prNumber: 42,
        event,
        body: '',
      })) as { reviewId: number }
      expect(result.reviewId).toBe(1)
    }
  })
})

describe('github:pr-review-submit — failure', () => {
  it('returns error string on gh failure', async () => {
    customMock().mockRejectedValueOnce(new Error('forbidden'))
    const result = (await getHandler('github:pr-review-submit')({
      repoRoot: '/repo',
      prNumber: 42,
      event: 'APPROVE',
      body: '',
    })) as { error: string }
    expect(result.error).toContain('forbidden')
  })
})

// ─── github:sessions-for-repo ────────────────────────────────────────────────

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

describe('github:sessions-for-repo', () => {
  it('returns empty sessions when no keys match repoRoot', async () => {
    storeData['/other:::42:::abc'] = validSession
    const result = (await getHandler('github:sessions-for-repo')({ repoRoot: '/repo' })) as {
      sessions: unknown[]
    }
    expect(result.sessions).toHaveLength(0)
  })

  it('returns sessions whose keys start with repoRoot:::', async () => {
    storeData['/repo:::42:::abc1234'] = validSession
    storeData['/other:::1:::xyz'] = validSession
    const result = (await getHandler('github:sessions-for-repo')({ repoRoot: '/repo' })) as {
      sessions: unknown[]
    }
    expect(result.sessions).toHaveLength(1)
  })

  it('skips entries that fail schema validation', async () => {
    storeData['/repo:::bad:::data'] = { invalid: true }
    const result = (await getHandler('github:sessions-for-repo')({ repoRoot: '/repo' })) as {
      sessions: unknown[]
    }
    expect(result.sessions).toHaveLength(0)
  })
})

// ─── github:session-get ───────────────────────────────────────────────────────

describe('github:session-get', () => {
  it('returns session null when key not in store', async () => {
    const result = (await getHandler('github:session-get')({ key: 'nonexistent' })) as {
      session: null
    }
    expect(result.session).toBeNull()
  })

  it('returns stored session when key exists and data is valid', async () => {
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
    const result = (await getHandler('github:session-get')({ key: '/repo:::42:::abc1234' })) as {
      session: unknown
    }
    expect(result.session).toMatchObject({ prNumber: 42, repoRoot: '/repo' })
  })
})

describe('github:session-get — invalid data', () => {
  it('returns session null when stored data fails schema validation', async () => {
    storeData['bad-key'] = { invalid: true }
    const result = (await getHandler('github:session-get')({ key: 'bad-key' })) as { session: null }
    expect(result.session).toBeNull()
  })
})

// ─── github:session-set ───────────────────────────────────────────────────────

describe('github:session-set', () => {
  it('stores valid session and returns ok', async () => {
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
    const result = (await getHandler('github:session-set')({ key: 'my-key', session })) as {
      ok: boolean
    }
    expect(result.ok).toBe(true)
    expect(storeData['my-key']).toMatchObject({ prNumber: 42 })
  })
})

// ─── github:save-active-review ────────────────────────────────────────────────

// ─── github:active-reviews-for-repo ──────────────────────────────────────────

describe('github:active-reviews-for-repo', () => {
  it('returns empty array when no active reviews saved', async () => {
    const result = (await getHandler('github:active-reviews-for-repo')({
      repoRoot: '/repo',
    })) as { prs: unknown[] }
    expect(result.prs).toEqual([])
  })

  it('returns saved PRs for repo and excludes other repos', async () => {
    await getHandler('github:save-active-review')({ repoRoot: '/repo', pr: reviewQueuePr(42) })
    await getHandler('github:save-active-review')({ repoRoot: '/other', pr: reviewQueuePr(99) })
    const result = (await getHandler('github:active-reviews-for-repo')({
      repoRoot: '/repo',
    })) as { prs: unknown[] }
    expect(result.prs).toHaveLength(1)
    expect((result.prs[0] as { number: number }).number).toBe(42)
  })
})
