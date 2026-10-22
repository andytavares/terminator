import { describe, it, expect } from 'vitest'
import { sealEnvironment } from '../../support/seal-environment'

describe('sealEnvironment', () => {
  describe('the function', sealEnvironmentTests)
  describe('a worker', workerTests)
})

function sealEnvironmentTests() {
  it('deletes what the developer exported and assigns the sealed values', () => {
    const env: NodeJS.ProcessEnv = {
      HOME: '/Users/someone',
      SSH_AUTH_SOCK: '/agent',
      TZ: 'Asia/Tokyo',
    }
    sealEnvironment({ HOME: '/sealed', TZ: 'UTC' }, env)
    expect(env).toEqual({ HOME: '/sealed', TZ: 'UTC' })
  })

  it('keeps the variables vitest reads while it runs a file', () => {
    const env: NodeJS.ProcessEnv = {
      VITEST_POOL_ID: '3',
      VITEST_WORKER_ID: '3',
      TEST: 'true',
      EDITOR: 'vi',
    }
    sealEnvironment({ HOME: '/sealed' }, env)
    expect(env).toEqual({
      VITEST_POOL_ID: '3',
      VITEST_WORKER_ID: '3',
      TEST: 'true',
      HOME: '/sealed',
    })
  })
}

function workerTests() {
  it('is what every spec runs in: UTC, the fixed git config, a home of the run', () => {
    expect(process.env.TZ).toBe('UTC')
    expect(process.env.LC_ALL).toBe('en_US.UTF-8')
    expect(process.env.GIT_CONFIG_GLOBAL).toMatch(/tests\/fixtures\/git\/gitconfig$/)
    expect(process.env.HOME).toContain('terminator-vitest-home-')
    expect(process.env.XDG_CONFIG_HOME).toBe(`${process.env.HOME}/.config`)
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(0)
  })
}
