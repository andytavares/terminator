import { describe, it, expect, afterEach } from 'vitest'
import { rmSync } from 'node:fs'
import { forgetGitHookEnvironment } from '../../support/git-hook-env'
import e2eGlobalSetup from '../../e2e/global-setup'

const HOOK_VARIABLES = [
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_WORK_TREE',
  'GIT_PREFIX',
  'GIT_COMMON_DIR',
]

describe('specs run from inside a git hook', () => {
  afterEach(() => {
    for (const name of HOOK_VARIABLES) delete process.env[name]
    const root = process.env.TERMINATOR_E2E_RUN_ROOT
    if (root) rmSync(root, { recursive: true, force: true })
    delete process.env.TERMINATOR_E2E_RUN_ROOT
  })

  it('forgets the repository a hook points git at, and keeps the rest', () => {
    const env: NodeJS.ProcessEnv = { GIT_DIR: '/repo/.git', GIT_INDEX_FILE: 'index', PATH: '/bin' }
    forgetGitHookEnvironment(env)
    expect(env).toEqual({ PATH: '/bin' })
  })

  it('e2e global setup forgets it before any worker or app starts', () => {
    for (const name of HOOK_VARIABLES) process.env[name] = '/repo/.git/worktrees/branch'
    e2eGlobalSetup(partialConfig())
    expect(HOOK_VARIABLES.filter((name) => name in process.env)).toEqual([])
  })
})

function partialConfig(): Parameters<typeof e2eGlobalSetup>[0] {
  return {} as Parameters<typeof e2eGlobalSetup>[0]
}
