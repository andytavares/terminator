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
    store = {}
  },
}))
vi.mock('fs/promises', () => ({ readFile: vi.fn().mockRejectedValue(new Error('no file')) }))

// ── import after mocks ────────────────────────────────────────────────────────

import { registerGithubHandlers } from '../../src/ipc/github.ipc'

// ── helpers ───────────────────────────────────────────────────────────────────

type Handler = (payload: unknown) => Promise<unknown>
type ExecCallback = (err: Error | null, result?: { stdout: string; stderr: string }) => void

function captureHandlers(): Record<string, Handler> {
  const handlers: Record<string, Handler> = {}
  registerGithubHandlers((channel, handler) => {
    handlers[channel] = handler as Handler
  })
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

const PR_FILES = { files: [] }

describe('github:pr-review-detail', () => {
  let handlers: Record<string, Handler>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = captureHandlers()
  })

  it('returns a pr object on success with no status checks', async () => {
    mockGitSuccess(JSON.stringify(PR_META))
    mockGitSuccess(JSON.stringify(PR_FILES))

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: Record<string, unknown> }

    expect(result.pr.number).toBe(6)
    expect(result.pr.title).toBe('Add feature')
    expect(result.pr.statusChecks).toEqual([])
    expect(result.pr.ciStatus).toBe('none')
  })

  it('maps SUCCESS conclusion to pass state', async () => {
    const meta = {
      ...PR_META,
      statusCheckRollup: [{ name: 'ci / build', conclusion: 'SUCCESS', url: 'https://ci/1' }],
    }
    mockGitSuccess(JSON.stringify(meta))
    mockGitSuccess(JSON.stringify(PR_FILES))

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { statusChecks: Array<{ name: string; state: string; url?: string }> } }

    expect(result.pr.statusChecks).toHaveLength(1)
    expect(result.pr.statusChecks[0].state).toBe('pass')
    expect(result.pr.statusChecks[0].url).toBe('https://ci/1')
  })

  it('maps FAILURE conclusion to fail state', async () => {
    const meta = {
      ...PR_META,
      statusCheckRollup: [{ name: 'lint', conclusion: 'FAILURE' }],
    }
    mockGitSuccess(JSON.stringify(meta))
    mockGitSuccess(JSON.stringify(PR_FILES))

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { statusChecks: Array<{ state: string }> } }

    expect(result.pr.statusChecks[0].state).toBe('fail')
  })

  it('maps TIMED_OUT and ACTION_REQUIRED conclusions to fail', async () => {
    for (const conclusion of ['TIMED_OUT', 'ACTION_REQUIRED', 'ERROR']) {
      const meta = {
        ...PR_META,
        statusCheckRollup: [{ name: 'check', conclusion }],
      }
      mockGitSuccess(JSON.stringify(meta))
      mockGitSuccess(JSON.stringify(PR_FILES))

      const result = (await handlers['github:pr-review-detail']({
        repoRoot: '/repo',
        prNumber: 6,
      })) as { pr: { statusChecks: Array<{ state: string }> } }

      expect(result.pr.statusChecks[0].state).toBe('fail')
    }
  })

  it('maps IN_PROGRESS and QUEUED to pending state', async () => {
    for (const conclusion of ['IN_PROGRESS', 'QUEUED', 'PENDING', 'WAITING']) {
      const meta = {
        ...PR_META,
        statusCheckRollup: [{ name: 'check', conclusion }],
      }
      mockGitSuccess(JSON.stringify(meta))
      mockGitSuccess(JSON.stringify(PR_FILES))

      const result = (await handlers['github:pr-review-detail']({
        repoRoot: '/repo',
        prNumber: 6,
      })) as { pr: { statusChecks: Array<{ state: string }> } }

      expect(result.pr.statusChecks[0].state).toBe('pending')
    }
  })

  it('maps SKIPPED, NEUTRAL, CANCELLED to skipped state', async () => {
    for (const conclusion of ['SKIPPED', 'NEUTRAL', 'CANCELLED']) {
      const meta = {
        ...PR_META,
        statusCheckRollup: [{ name: 'check', conclusion }],
      }
      mockGitSuccess(JSON.stringify(meta))
      mockGitSuccess(JSON.stringify(PR_FILES))

      const result = (await handlers['github:pr-review-detail']({
        repoRoot: '/repo',
        prNumber: 6,
      })) as { pr: { statusChecks: Array<{ state: string }> } }

      expect(result.pr.statusChecks[0].state).toBe('skipped')
    }
  })

  it('maps unknown conclusion string to unknown state', async () => {
    const meta = {
      ...PR_META,
      statusCheckRollup: [{ name: 'check', conclusion: 'SOMETHING_NEW' }],
    }
    mockGitSuccess(JSON.stringify(meta))
    mockGitSuccess(JSON.stringify(PR_FILES))

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { statusChecks: Array<{ state: string }> } }

    expect(result.pr.statusChecks[0].state).toBe('unknown')
  })

  it('uses state field when conclusion is absent (StatusContext)', async () => {
    const meta = {
      ...PR_META,
      statusCheckRollup: [{ context: 'legacy/check', state: 'SUCCESS' }],
    }
    mockGitSuccess(JSON.stringify(meta))
    mockGitSuccess(JSON.stringify(PR_FILES))

    const result = (await handlers['github:pr-review-detail']({
      repoRoot: '/repo',
      prNumber: 6,
    })) as { pr: { statusChecks: Array<{ name: string; state: string }> } }

    expect(result.pr.statusChecks[0].name).toBe('legacy/check')
    expect(result.pr.statusChecks[0].state).toBe('pass')
  })

  it('preserves multiple checks with mixed states', async () => {
    const meta = {
      ...PR_META,
      statusCheckRollup: [
        { name: 'build', conclusion: 'SUCCESS' },
        { name: 'lint', conclusion: 'FAILURE' },
        { name: 'deploy', conclusion: 'IN_PROGRESS' },
      ],
    }
    mockGitSuccess(JSON.stringify(meta))
    mockGitSuccess(JSON.stringify(PR_FILES))

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
})
