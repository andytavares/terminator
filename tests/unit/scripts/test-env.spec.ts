import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { GIT_CONFIG_FIXTURE, testEnvironment } from '../../../scripts/test-env.mjs'

const REPO_ROOT = resolve(__dirname, '../../..')
const SEALED = { home: '/tmp/home-of-the-run', tmpdir: '/tmp/temp-of-the-run' }

describe('the environment every test process runs in (ADR 123)', () => {
  it('is built from fixed values, never from the developer environment', () => {
    const env = testEnvironment(SEALED, {
      HOME: '/Users/someone',
      SSH_AUTH_SOCK: '/agent',
      CLAUDE_CODE_SSE_PORT: '1',
      TZ: 'Asia/Tokyo',
    })
    expect(env.HOME).toBe('/tmp/home-of-the-run')
    expect(env.TMPDIR).toBe('/tmp/temp-of-the-run')
    expect(env.TZ).toBe('UTC')
    expect(env.LANG).toBe('en_US.UTF-8')
    expect(env.CI).toBe('1')
    expect(env).not.toHaveProperty('SSH_AUTH_SOCK')
    expect(env).not.toHaveProperty('CLAUDE_CODE_SSE_PORT')
  })

  it('puts the stub directories first on a PATH of system directories and this Node', () => {
    const env = testEnvironment(
      { ...SEALED, stubs: ['/stubs'] },
      { PATH: '/opt/homebrew/bin:/usr/bin' }
    )
    const path = env.PATH.split(':')
    expect(path[0]).toBe('/stubs')
    expect(path).not.toContain('/opt/homebrew/bin')
    expect(path).toEqual(
      expect.arrayContaining(['/usr/bin', '/bin', resolve(process.execPath, '..')])
    )
  })
})

describe('what a test process keeps of its surroundings', () => {
  it("keeps the developer's git config out: git reads the fixture only", () => {
    const env = testEnvironment(SEALED, {})
    expect(env.GIT_CONFIG_GLOBAL).toBe(GIT_CONFIG_FIXTURE)
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1')
    const name = execFileSync('git', ['config', '--global', '--get', 'user.name'], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
    })
    expect(name.trim()).toBe('Terminator Test')
  })

  it('keeps what a run needs to find its own tools: Electron override and the CI runner variables', () => {
    const env = testEnvironment(SEALED, {
      ELECTRON_OVERRIDE_DIST_PATH: '/e',
      GITHUB_ACTIONS: 'true',
      RUNNER_OS: 'macOS',
    })
    expect(env.ELECTRON_OVERRIDE_DIST_PATH).toBe('/e')
    expect(env.GITHUB_ACTIONS).toBe('true')
  })
})
