import { describe, it, expect, afterEach, vi } from 'vitest'

// tests/setup.ts sets GIT_TRACE2_EVENT=0 so the operator's trace2 target (git-ai's daemon) does
// not write into a spec's repository after git returns, which fails its teardown with ENOTEMPTY.

describe('the environment specs run real git in', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('drops the GIT_ variables a caller set, and keeps trace2 off', async () => {
    vi.stubEnv('GIT_DIR', '/somewhere/else/.git')
    vi.resetModules()

    const { GIT_FREE_ENV } = await import('./support/git-repo')

    expect(GIT_FREE_ENV.GIT_DIR).toBeUndefined()
    expect(GIT_FREE_ENV.GIT_TRACE2_EVENT).toBe('0')
  })
})
