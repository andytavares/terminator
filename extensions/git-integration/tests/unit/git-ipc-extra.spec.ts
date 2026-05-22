/**
 * Additional coverage for extensions/git-integration/src/ipc/git.ipc.ts
 * Covers the uncovered lines: 50-51 (git:stage error), 62-63 (git:unstage validation),
 * 74-75 (git:unstage error), and 96-110 (git:push handler).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }))

vi.mock('child_process', () => ({
  execFile: mockExecFile,
}))

vi.mock('../../src/git/git-service', () => ({
  getStatus: vi.fn(),
  getDiff: vi.fn(),
  stageFiles: vi.fn(),
  unstageFiles: vi.fn(),
  commitChanges: vi.fn(),
}))

import * as gitService from '../../src/git/git-service'
import { registerGitExtensionHandlers } from '../../src/ipc/git.ipc'

// ── helpers ───────────────────────────────────────────────────────────────────

type Handler = (payload: unknown) => Promise<unknown>
type ExecCallback = (err: Error | null, result?: { stdout: string; stderr: string }) => void

function buildRegistry(): {
  register: (channel: string, handler: Handler) => void
  getHandler: (channel: string) => Handler
} {
  const handlers = new Map<string, Handler>()
  return {
    register: (channel, handler) => handlers.set(channel, handler as Handler),
    getHandler: (channel) => {
      const h = handlers.get(channel)
      if (!h) throw new Error(`Handler for "${channel}" not registered`)
      return h
    },
  }
}

function mockExecSuccess(stdout: string) {
  mockExecFile.mockImplementationOnce(
    (_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) =>
      cb(null, { stdout, stderr: '' })
  )
}

function mockExecError(message: string) {
  mockExecFile.mockImplementationOnce(
    (_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) => cb(new Error(message))
  )
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('git:stage — error path (line 50-51)', () => {
  let getHandler: (channel: string) => Handler

  beforeEach(() => {
    vi.clearAllMocks()
    const registry = buildRegistry()
    registerGitExtensionHandlers(registry.register)
    getHandler = registry.getHandler
  })

  it('returns error when stageFiles throws', async () => {
    vi.mocked(gitService.stageFiles).mockRejectedValue(new Error('permission denied'))
    const result = (await getHandler('git:stage')({
      repoRoot: '/repo',
      paths: ['src/main.ts'],
    })) as { error: string }
    expect(result.error).toContain('permission denied')
  })
})

describe('git:unstage — validation error (line 62-63) and error path (line 74-75)', () => {
  let getHandler: (channel: string) => Handler

  beforeEach(() => {
    vi.clearAllMocks()
    const registry = buildRegistry()
    registerGitExtensionHandlers(registry.register)
    getHandler = registry.getHandler
  })

  it('returns VALIDATION_ERROR for missing repoRoot', async () => {
    const result = (await getHandler('git:unstage')({ paths: ['src/main.ts'] })) as {
      error: string
    }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns VALIDATION_ERROR for empty paths array', async () => {
    const result = (await getHandler('git:unstage')({
      repoRoot: '/repo',
      paths: [],
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns error when unstageFiles throws', async () => {
    vi.mocked(gitService.unstageFiles).mockRejectedValue(new Error('index locked'))
    const result = (await getHandler('git:unstage')({
      repoRoot: '/repo',
      paths: ['src/main.ts'],
    })) as { error: string }
    expect(result.error).toContain('index locked')
  })

  it('returns success when unstageFiles succeeds', async () => {
    vi.mocked(gitService.unstageFiles).mockResolvedValue(undefined)
    const result = await getHandler('git:unstage')({ repoRoot: '/repo', paths: ['src/foo.ts'] })
    expect(result).toMatchObject({ success: true })
  })
})

describe('git:push handler (lines 96-110)', () => {
  let getHandler: (channel: string) => Handler

  beforeEach(() => {
    vi.clearAllMocks()
    const registry = buildRegistry()
    registerGitExtensionHandlers(registry.register)
    getHandler = registry.getHandler
  })

  it('returns VALIDATION_ERROR for missing repoRoot', async () => {
    const result = (await getHandler('git:push')({})) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns success when git push succeeds', async () => {
    mockExecSuccess('')
    const result = await getHandler('git:push')({ repoRoot: '/repo' })
    expect(result).toMatchObject({ success: true })
  })

  it('returns NO_UPSTREAM error when branch has no upstream', async () => {
    mockExecError('error: The current branch has no upstream branch')
    const result = (await getHandler('git:push')({ repoRoot: '/repo' })) as { error: string }
    expect(result.error).toBe('NO_UPSTREAM')
  })

  it('returns REJECTED error when push is rejected', async () => {
    mockExecError('! [rejected] main -> main (fetch first)')
    const result = (await getHandler('git:push')({ repoRoot: '/repo' })) as { error: string }
    expect(result.error).toBe('REJECTED')
  })

  it('returns the error message string for other push errors', async () => {
    mockExecError('network unreachable')
    const result = (await getHandler('git:push')({ repoRoot: '/repo' })) as { error: string }
    expect(result.error).toContain('network unreachable')
  })
})

describe('git:pr-status and git:pr-create stubs', () => {
  let getHandler: (channel: string) => Handler

  beforeEach(() => {
    vi.clearAllMocks()
    const registry = buildRegistry()
    registerGitExtensionHandlers(registry.register)
    getHandler = registry.getHandler
  })

  it('git:pr-status returns { pr: null }', async () => {
    const result = await getHandler('git:pr-status')({})
    expect(result).toEqual({ pr: null })
  })

  it('git:pr-create returns NOT_IMPLEMENTED', async () => {
    const result = (await getHandler('git:pr-create')({})) as { error: string }
    expect(result.error).toBe('NOT_IMPLEMENTED')
  })
})
