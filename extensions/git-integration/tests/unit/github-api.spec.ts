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

  it('prFileContent calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.prFileContent('/repo', 42, 'src/foo.ts', 'abc123')
    expect(mockInvoke).toHaveBeenCalledWith('github:pr-file-content', {
      repoRoot: '/repo',
      prNumber: 42,
      path: 'src/foo.ts',
      ref: 'abc123',
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

  it('removeActiveReview calls correct channel with repoRoot and prNumber', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.removeActiveReview('/repo', 42)
    expect(mockInvoke).toHaveBeenCalledWith('github:remove-active-review', {
      repoRoot: '/repo',
      prNumber: 42,
    })
  })

  it('pruneActiveReviews calls correct channel with repoRoot and prNumbers', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.pruneActiveReviews('/repo', [1, 2, 3])
    expect(mockInvoke).toHaveBeenCalledWith('github:prune-active-reviews', {
      repoRoot: '/repo',
      prNumbers: [1, 2, 3],
    })
  })

  it('prMarkReady calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.prMarkReady('/repo', 42)
    expect(mockInvoke).toHaveBeenCalledWith('github:pr-mark-ready', {
      repoRoot: '/repo',
      prNumber: 42,
    })
  })

  it('prIssueComments calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.prIssueComments('/repo', 42)
    expect(mockInvoke).toHaveBeenCalledWith('github:pr-issue-comments', {
      repoRoot: '/repo',
      prNumber: 42,
    })
  })

  it('prIssueCommentAdd calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.prIssueCommentAdd({ repoRoot: '/repo', prNumber: 42, body: 'hello' })
    expect(mockInvoke).toHaveBeenCalledWith('github:pr-issue-comment-add', {
      repoRoot: '/repo',
      prNumber: 42,
      body: 'hello',
    })
  })

  it('prUpdateBranch calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.prUpdateBranch('/repo', 42)
    expect(mockInvoke).toHaveBeenCalledWith('github:pr-update-branch', {
      repoRoot: '/repo',
      prNumber: 42,
    })
  })

  it('fileCoChange calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    const files = ['src/a.ts', 'src/b.ts']
    await githubAPI.fileCoChange('/repo', files)
    expect(mockInvoke).toHaveBeenCalledWith('github:file-cochange', {
      repoRoot: '/repo',
      files,
    })
  })

  it('review revamp channels send the payloads their handlers validate', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.dashboardSearch()
    await githubAPI.fileViewedSet('/repo', 211, 'scripts/e2e-shard.ts', true)
    await githubAPI.prCompare('/repo', 'aaa111', 'bbb222')
    await githubAPI.cloneRepo('andytavares/terminator', '/Users/me/src')
    await githubAPI.reviewSettings()
    await githubAPI.accessibleRepos()
    await githubAPI.accessibleRepos(true)
    await githubAPI.setReviewRepos(['acme/widgets'])
    await githubAPI.testsForBlock({ repoRoot: '/repo', headSHA: 'h', path: 'a.ts', code: 'x' })
    expect(mockInvoke.mock.calls).toEqual([
      ['github:dashboard-search', {}],
      [
        'github:file-viewed-set',
        { repoRoot: '/repo', prNumber: 211, path: 'scripts/e2e-shard.ts', viewed: true },
      ],
      ['github:pr-compare', { repoRoot: '/repo', fromSha: 'aaa111', toSha: 'bbb222' }],
      ['github:clone-repo', { repo: 'andytavares/terminator', folder: '/Users/me/src' }],
      ['github:review-settings', {}],
      ['github:accessible-repos', {}],
      ['github:accessible-repos', { refresh: true }],
      ['github:review-repos-set', { repos: ['acme/widgets'] }],
      ['github:tests-for-block', { repoRoot: '/repo', headSHA: 'h', path: 'a.ts', code: 'x' }],
    ])
  })

  it('batch channels send the payloads their handlers validate', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.filesMetrics('/repo', ['a.ts', 'b.ts'])
    await githubAPI.filesViewedSet('/repo', 211, 'PR_node1', ['a.ts'], true)
    await githubAPI.prFileDiff('/repo', 211, 'a.ts', { baseRef: 'main', headSHA: 'abc' })
    await githubAPI.fileViewedSet('/repo', 211, 'a.ts', true, 'PR_node1')
    expect(mockInvoke.mock.calls).toEqual([
      ['github:files-metrics', { repoRoot: '/repo', paths: ['a.ts', 'b.ts'] }],
      [
        'github:files-viewed-set',
        { repoRoot: '/repo', prNumber: 211, nodeId: 'PR_node1', paths: ['a.ts'], viewed: true },
      ],
      [
        'github:pr-file-diff',
        { repoRoot: '/repo', prNumber: 211, path: 'a.ts', baseRef: 'main', headSHA: 'abc' },
      ],
      [
        'github:file-viewed-set',
        { repoRoot: '/repo', prNumber: 211, path: 'a.ts', viewed: true, nodeId: 'PR_node1' },
      ],
    ])
  })

  it('leaves nodeId out of a batch viewed mark when the PR has none', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.filesViewedSet('/repo', 211, undefined, ['a.ts'], false)
    expect(mockInvoke.mock.calls).toEqual([
      [
        'github:files-viewed-set',
        { repoRoot: '/repo', prNumber: 211, paths: ['a.ts'], viewed: false },
      ],
    ])
  })
})
