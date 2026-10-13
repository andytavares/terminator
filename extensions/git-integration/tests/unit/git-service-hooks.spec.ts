import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { commitChanges } from '../../src/git/git-service'
import { bindRealShell } from './support/shell'

// A hook git runs for `git commit` and `--no-verify` skips (pre-commit,
// commit-msg) aborts the commit by exiting non-zero, and git adds nothing of
// its own to what the hook printed (https://git-scm.com/docs/githooks#_pre_commit).
// These run real git against real hooks.

describe('commitChanges with a plain git hook', () => {
  let repo: string
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))
  ) as NodeJS.ProcessEnv
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, env, encoding: 'utf-8' }).trim()

  function hook(name: string, script: string, dir = '.git/hooks'): void {
    mkdirSync(join(repo, dir), { recursive: true })
    writeFileSync(join(repo, dir, name), script)
    chmodSync(join(repo, dir, name), 0o755)
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'commit-hooks-'))
    bindRealShell(env)
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'e@x.dev')
    git('config', 'user.name', 'E')
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    git('add', 'a.txt')
  })

  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it('reports a failing pre-commit hook as a hook failure, with what it printed', async () => {
    hook('pre-commit', '#!/bin/sh\necho "lint: a.txt has a problem"\nexit 1\n')

    const result = await commitChanges(repo, 'add a')

    expect(result).toEqual({
      error: 'HOOK_FAILED',
      hookOutput: 'lint: a.txt has a problem',
      isHookFailure: true,
    })
    expect(git('rev-list', '--all')).toBe('')
  })

  it('finds a commit-msg hook under core.hooksPath', async () => {
    git('config', 'core.hooksPath', '.githooks')
    hook('commit-msg', '#!/bin/sh\necho "subject too short" >&2\nexit 1\n', '.githooks')

    const result = await commitChanges(repo, 'x')

    expect(result).toMatchObject({ error: 'HOOK_FAILED', isHookFailure: true })
  })

  it("does not blame a hook for git's own failure", async () => {
    hook('pre-commit', '#!/bin/sh\nexit 0\n')
    writeFileSync(join(repo, '.git/index.lock'), '')

    const result = await commitChanges(repo, 'add a')

    expect(result).toMatchObject({ isHookFailure: false })
    expect((result as { error: string }).error).toContain('fatal:')
  })
})
