import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { GIT_CONFIG_FIXTURE, testEnvironment } from '../../../scripts/test-env.mjs'

const REPO_ROOT = resolve(__dirname, '../../..')
const SEALED = { home: '/tmp/home-of-the-run', tmpdir: '/tmp/temp-of-the-run' }

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
})
