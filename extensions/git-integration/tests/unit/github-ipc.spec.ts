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
