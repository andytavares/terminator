// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockInvoke = vi.fn().mockResolvedValue({})
const mockOn = vi.fn().mockReturnValue(() => {})

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockResolvedValue({})
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke: mockInvoke, on: mockOn },
  }
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

const scope = {
  kind: 'file' as const,
  path: 'a.ts',
  startLine: null,
  endLine: null,
  side: null,
  chapter: null,
}

describe('reviewAgentAPI bridge', () => {
  it('start calls review-agent:start with the input', async () => {
    const { reviewAgentAPI } = await import('../../src/api/review-agent')
    await reviewAgentAPI.start({
      repoRoot: '/repo',
      prNumber: 1,
      headSHA: 'sha1',
      baseRefName: 'main',
      scope,
      request: 'review',
    })
    expect(mockInvoke).toHaveBeenCalledWith(
      'review-agent:start',
      expect.objectContaining({ repoRoot: '/repo', prNumber: 1 })
    )
  })

  it('cancel calls review-agent:cancel with the runId', async () => {
    const { reviewAgentAPI } = await import('../../src/api/review-agent')
    await reviewAgentAPI.cancel('run-1')
    expect(mockInvoke).toHaveBeenCalledWith('review-agent:cancel', { runId: 'run-1' })
  })

  it('list calls review-agent:list with repo/pr/sha', async () => {
    const { reviewAgentAPI } = await import('../../src/api/review-agent')
    await reviewAgentAPI.list('/repo', 1, 'sha1')
    expect(mockInvoke).toHaveBeenCalledWith('review-agent:list', {
      repoRoot: '/repo',
      prNumber: 1,
      headSHA: 'sha1',
    })
  })

  it('dismiss calls review-agent:dismiss with the full payload', async () => {
    const { reviewAgentAPI } = await import('../../src/api/review-agent')
    const payload = {
      repoRoot: '/repo',
      prNumber: 1,
      headSHA: 'sha1',
      runId: 'run-1',
      findingId: 'f1',
    }
    await reviewAgentAPI.dismiss(payload)
    expect(mockInvoke).toHaveBeenCalledWith('review-agent:dismiss', payload)
  })

  it('openTerminal calls review-agent:open-terminal with the runId', async () => {
    const { reviewAgentAPI } = await import('../../src/api/review-agent')
    await reviewAgentAPI.openTerminal('run-1')
    expect(mockInvoke).toHaveBeenCalledWith('review-agent:open-terminal', { runId: 'run-1' })
  })

  it('settings calls review-agent:settings', async () => {
    const { reviewAgentAPI } = await import('../../src/api/review-agent')
    await reviewAgentAPI.settings()
    expect(mockInvoke).toHaveBeenCalledWith('review-agent:settings', {})
  })

  it('onEvent subscribes to review-agent:event and forwards the payload', async () => {
    const { reviewAgentAPI } = await import('../../src/api/review-agent')
    const cb = vi.fn()
    reviewAgentAPI.onEvent(cb)
    expect(mockOn).toHaveBeenCalledWith('review-agent:event', expect.any(Function))
    const handler = mockOn.mock.calls[0][1]
    handler({ run: { id: 'run-1' } })
    expect(cb).toHaveBeenCalledWith({ run: { id: 'run-1' } })
  })
})
