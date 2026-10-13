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
    await githubAPI.listOpenPrs('/repo', { cursor: 'abc', search: 'foo' })
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
})

describe('githubAPI bridge — prFileDiff calls correct channel', () => {
  it('prFileDiff calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.prFileDiff({ repoRoot: '/repo', prNumber: 42, path: 'src/foo.ts' })
    expect(mockInvoke).toHaveBeenCalledWith('github:pr-file-diff', {
      repoRoot: '/repo',
      prNumber: 42,
      path: 'src/foo.ts',
    })
  })

  it('prFileContent calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.prFileContent({
      repoRoot: '/repo',
      prNumber: 42,
      path: 'src/foo.ts',
      ref: 'abc123',
    })
    expect(mockInvoke).toHaveBeenCalledWith('github:pr-file-content', {
      repoRoot: '/repo',
      prNumber: 42,
      path: 'src/foo.ts',
      ref: 'abc123',
    })
  })
})

describe('githubAPI bridge — prInlineComments calls correct channel', () => {
  it('prInlineComments calls correct channel', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.prInlineComments('/repo', 7)
    expect(mockInvoke).toHaveBeenCalledWith('github:pr-inline-comments', {
      repoRoot: '/repo',
      prNumber: 7,
    })
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
})

describe('githubAPI bridge — sessionGet calls correct channel', () => {
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
})

describe('githubAPI bridge — saveActiveReview calls correct channel', () => {
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
})

describe('githubAPI bridge — pruneActiveReviews calls correct channel with repoRoot and prNumbers', () => {
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
})

describe('githubAPI bridge — prIssueCommentAdd calls correct channel', () => {
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
})

type Api = (typeof import('../../src/api/github'))['githubAPI']
type BridgeCall = [(api: Api) => Promise<unknown>, [string, unknown]]

const REVAMP_CALLS: BridgeCall[] = [
  [(api) => api.dashboardSearch(), ['github:dashboard-search', {}]],
  [
    (api) =>
      api.fileViewedSet({
        repoRoot: '/repo',
        prNumber: 211,
        path: 'scripts/e2e-shard.ts',
        viewed: true,
      }),
    [
      'github:file-viewed-set',
      { repoRoot: '/repo', prNumber: 211, path: 'scripts/e2e-shard.ts', viewed: true },
    ],
  ],
  [
    (api) => api.prCompare('/repo', 'aaa111', 'bbb222'),
    ['github:pr-compare', { repoRoot: '/repo', fromSha: 'aaa111', toSha: 'bbb222' }],
  ],
  [
    (api) => api.cloneRepo('andytavares/terminator', '/Users/me/src'),
    ['github:clone-repo', { repo: 'andytavares/terminator', folder: '/Users/me/src' }],
  ],
  [(api) => api.reviewSettings(), ['github:review-settings', {}]],
  [(api) => api.accessibleRepos(), ['github:accessible-repos', {}]],
  [(api) => api.accessibleRepos(true), ['github:accessible-repos', { refresh: true }]],
  [
    (api) => api.setReviewRepos(['acme/widgets']),
    ['github:review-repos-set', { repos: ['acme/widgets'] }],
  ],
  [
    (api) => api.testsForBlock({ repoRoot: '/repo', headSHA: 'h', path: 'a.ts', code: 'x' }),
    ['github:tests-for-block', { repoRoot: '/repo', headSHA: 'h', path: 'a.ts', code: 'x' }],
  ],
]

const BATCH_CALLS: BridgeCall[] = [
  [
    (api) => api.filesMetrics('/repo', ['a.ts', 'b.ts']),
    ['github:files-metrics', { repoRoot: '/repo', paths: ['a.ts', 'b.ts'] }],
  ],
  [
    (api) =>
      api.filesViewedSet({
        repoRoot: '/repo',
        prNumber: 211,
        nodeId: 'PR_node1',
        paths: ['a.ts'],
        viewed: true,
      }),
    [
      'github:files-viewed-set',
      { repoRoot: '/repo', prNumber: 211, nodeId: 'PR_node1', paths: ['a.ts'], viewed: true },
    ],
  ],
  [
    (api) =>
      api.prFileDiff({
        repoRoot: '/repo',
        prNumber: 211,
        path: 'a.ts',
        ...{ baseRef: 'main', headSHA: 'abc' },
      }),
    [
      'github:pr-file-diff',
      { repoRoot: '/repo', prNumber: 211, path: 'a.ts', baseRef: 'main', headSHA: 'abc' },
    ],
  ],
  [
    (api) =>
      api.fileViewedSet({
        repoRoot: '/repo',
        prNumber: 211,
        path: 'a.ts',
        viewed: true,
        nodeId: 'PR_node1',
      }),
    [
      'github:file-viewed-set',
      { repoRoot: '/repo', prNumber: 211, path: 'a.ts', viewed: true, nodeId: 'PR_node1' },
    ],
  ],
]

/** Makes each call in order, then checks the bridge saw exactly the expected channel and payload. */
async function expectBridgeCalls(calls: BridgeCall[]) {
  const { githubAPI } = await import('../../src/api/github')
  for (const [call] of calls) await call(githubAPI)
  expect(mockInvoke.mock.calls).toEqual(calls.map(([, expected]) => expected))
}

describe('githubAPI bridge — review revamp channels send the payloads their handlers validate', () => {
  it('review revamp channels send the payloads their handlers validate', async () => {
    await expectBridgeCalls(REVAMP_CALLS)
  })
})

describe('githubAPI bridge — batch channels send the payloads their handlers validate', () => {
  it('batch channels send the payloads their handlers validate', async () => {
    await expectBridgeCalls(BATCH_CALLS)
  })
})

describe('githubAPI bridge — leaves nodeId out of a batch viewed mark when the PR has none', () => {
  it('leaves nodeId out of a batch viewed mark when the PR has none', async () => {
    const { githubAPI } = await import('../../src/api/github')
    await githubAPI.filesViewedSet({
      repoRoot: '/repo',
      prNumber: 211,
      paths: ['a.ts'],
      viewed: false,
    })
    expect(mockInvoke.mock.calls).toEqual([
      [
        'github:files-viewed-set',
        { repoRoot: '/repo', prNumber: 211, paths: ['a.ts'], viewed: false },
      ],
    ])
  })
})
