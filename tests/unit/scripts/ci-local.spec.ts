import { describe, it, expect } from 'vitest'
import { NOT_RUN_HERE, checkEnvironment } from '../../../scripts/ci-local.mjs'

describe('what ci:local leaves to CI', () => {
  it('gives a reason for everything it does not run', () => {
    for (const reason of Object.values(NOT_RUN_HERE)) expect(reason).not.toBe('')
  })
})

describe('ci:local runs each check as CI would, outside any git hook', () => {
  it('drops the GIT_ variables a pre-push hook is given, and keeps the rest', () => {
    const fromHook = {
      GIT_DIR: '/repo/.git/worktrees/branch',
      GIT_PREFIX: '',
      GIT_EXEC_PATH: '/git-core',
      GIT_TRACE2_PARENT_SID: 'sid',
      PATH: '/usr/bin',
      HOME: '/Users/someone',
    }
    expect(checkEnvironment(fromHook)).toEqual({ PATH: '/usr/bin', HOME: '/Users/someone' })
  })
})
