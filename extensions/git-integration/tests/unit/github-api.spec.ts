// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockInvoke = vi.fn().mockResolvedValue({})

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke: mockInvoke },
  }
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('githubAPI bridge', () => {
  it('listOpenPrs calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.listOpenPrs('/repo', { cursor: 'abc', search: 'foo', includeClosedPrs: true })
    expect(mockInvoke).toHaveBeenCalledWith(
      'github:list-open-prs',
      expect.objectContaining({ repoRoot: '/repo' })
    )
  })

  it('prReviewDetail calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.prReviewDetail('/repo', 42)
    expect(mockInvoke).toHaveBeenCalledWith('github:pr-review-detail', {
      repoRoot: '/repo',
      prNumber: 42,
    })
  })

  it('prFileDiff calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.prFileDiff('/repo', 42, 'src/foo.ts')
    expect(mockInvoke).toHaveBeenCalledWith('github:pr-file-diff', {
      repoRoot: '/repo',
      prNumber: 42,
      path: 'src/foo.ts',
    })
  })

  it('fileMetrics calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.fileMetrics('/repo', 'src/bar.ts')
    expect(mockInvoke).toHaveBeenCalledWith('github:file-metrics', {
      repoRoot: '/repo',
      path: 'src/bar.ts',
    })
  })

  it('prInlineComments calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.prInlineComments('/repo', 7)
    expect(mockInvoke).toHaveBeenCalledWith('github:pr-inline-comments', {
      repoRoot: '/repo',
      prNumber: 7,
    })
  })

  it('prCommentAdd calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    const payload = { body: 'LGTM', prNumber: 1 }
    await githubAPI.prCommentAdd(payload)
    expect(mockInvoke).toHaveBeenCalledWith('github:pr-comment-add', payload)
  })

  it('prCommentReply calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    const payload = { body: 'reply', threadId: 'x' }
    await githubAPI.prCommentReply(payload)
    expect(mockInvoke).toHaveBeenCalledWith('github:pr-comment-reply', payload)
  })

  it('prReviewSubmit calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    const payload = { verdict: 'approve' }
    await githubAPI.prReviewSubmit(payload)
    expect(mockInvoke).toHaveBeenCalledWith('github:pr-review-submit', payload)
  })

  it('sessionGet calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.sessionGet('my-key')
    expect(mockInvoke).toHaveBeenCalledWith('github:session-get', { key: 'my-key' })
  })

  it('sessionSet calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.sessionSet('my-key', { token: 'abc' })
    expect(mockInvoke).toHaveBeenCalledWith('github:session-set', {
      key: 'my-key',
      session: { token: 'abc' },
    })
  })

  it('sessionsForRepo calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.sessionsForRepo('/repo')
    expect(mockInvoke).toHaveBeenCalledWith('github:sessions-for-repo', { repoRoot: '/repo' })
  })

  it('saveActiveReview calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    const pr = { number: 1 }
    await githubAPI.saveActiveReview('/repo', pr)
    expect(mockInvoke).toHaveBeenCalledWith('github:save-active-review', { repoRoot: '/repo', pr })
  })

  it('activeReviewsForRepo calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.activeReviewsForRepo('/repo')
    expect(mockInvoke).toHaveBeenCalledWith('github:active-reviews-for-repo', { repoRoot: '/repo' })
  })
})
