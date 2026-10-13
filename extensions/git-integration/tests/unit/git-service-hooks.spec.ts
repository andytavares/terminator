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

const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))
) as NodeJS.ProcessEnv

const gitIn = (repo: string, args: string[]) =>
  execFileSync('git', args, { cwd: repo, env, encoding: 'utf-8' }).trim()

/** An executable hook `name` running `script`, in `dir` of `repo` (.git/hooks unless given). */
function installHook(repo: string, hook: { name: string; script: string; dir?: string }): void {
  const dir = join(repo, hook.dir ?? '.git/hooks')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, hook.name), hook.script)
  chmodSync(join(dir, hook.name), 0o755)
}

/** A new repository with a.txt staged and nothing committed. */
function repoWithStagedFile(): string {
  const repo = mkdtempSync(join(tmpdir(), 'commit-hooks-'))
  gitIn(repo, ['init', '-q', '-b', 'main'])
  gitIn(repo, ['config', 'user.email', 'e@x.dev'])
  gitIn(repo, ['config', 'user.name', 'E'])
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  gitIn(repo, ['add', 'a.txt'])
  return repo
}

describe('commitChanges with a plain git hook', () => {
  let repo: string
  const git = (...args: string[]) => gitIn(repo, args)
  const hook = (name: string, script: string, dir?: string) =>
    installHook(repo, { name, script, dir })

  beforeEach(() => {
    bindRealShell(env)
    repo = repoWithStagedFile()
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
})

describe('commitChanges with a plain git hook — and a failure of git itself', () => {
  let repo: string
  const hook = (name: string, script: string) => installHook(repo, { name, script })

  beforeEach(() => {
    bindRealShell(env)
    repo = repoWithStagedFile()
  })

  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it("does not blame a hook for git's own failure", async () => {
    hook('pre-commit', '#!/bin/sh\nexit 0\n')
    writeFileSync(join(repo, '.git/index.lock'), '')

    const result = await commitChanges(repo, 'add a')

    expect(result).toMatchObject({ isHookFailure: false })
    expect((result as { error: string }).error).toContain('fatal:')
  })
})
