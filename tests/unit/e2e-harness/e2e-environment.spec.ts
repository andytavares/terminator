import { describe, expect, it } from 'vitest'
import { sealedAppEnvironment } from '../../e2e/e2e-environment'
import { e2eWorkerCount } from '../../e2e/worker-count'

const sealed = sealedAppEnvironment({ home: '/run/home-1', tmpdir: '/run/tmp-1' })

describe('the environment an e2e app launches in', () => {
  it('has the run’s own HOME and TMPDIR, never the developer’s', () => {
    expect(sealed.HOME).toBe('/run/home-1')
    expect(sealed.TMPDIR).toBe('/run/tmp-1')
  })

  it('marks the run as a test, in the background, with the readiness channel on', () => {
    expect(sealed).toMatchObject({
      NODE_ENV: 'test',
      TERMINATOR_RUN_IN_BACKGROUND: '1',
      TERMINATOR_E2E: '1',
      SHELL: '/bin/zsh',
    })
    expect(sealed.ZDOTDIR).toMatch(/fixtures\/zdotdir$/)
  })

  it('puts the stubs first on PATH and names no developer directory', () => {
    const [first] = sealed.PATH.split(':')
    expect(first).toMatch(/fixtures\/bin$/)
    expect(sealed.PATH).not.toContain('/opt/homebrew')
    expect(sealed.PATH).not.toContain('.local/bin')
  })
})

describe('the allowlist of the sealed environment', () => {
  it('does not copy a variable the allowlist does not name', () => {
    const polluted = sealedAppEnvironment(
      { home: '/h', tmpdir: '/t' },
      { GH_TOKEN: 'secret', SSH_AUTH_SOCK: '/agent', XDG_CONFIG_HOME: '/dev', USER: 'dev' }
    )
    expect(polluted).not.toHaveProperty('GH_TOKEN')
    expect(polluted).not.toHaveProperty('SSH_AUTH_SOCK')
    expect(polluted).not.toHaveProperty('XDG_CONFIG_HOME')
    expect(polluted.USER).toBe('dev')
  })
})

describe('how many copies of the app run at once', () => {
  it('is one third of the cores, never fewer than one', () => {
    expect([1, 2, 3, 4, 8, 12].map(e2eWorkerCount)).toEqual([1, 1, 1, 1, 2, 4])
  })
})
