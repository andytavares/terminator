import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { makeTempDir } from '../support/temp-dir'

let dir = ''

function useRemovedDir(): void {
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** A repository with one commit, cloned beside it in `dir`. Returns the clone. */
function clonedRepository(): string {
  git(dir, 'init', '-q', '-b', 'main', 'origin')
  git(
    join(dir, 'origin'),
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'b'
  )
  git(dir, 'clone', '-q', 'origin', 'clone')
  return join(dir, 'clone')
}

/** This process's environment without GIT_* variables, the trace2 one aside. */
function scrubbedGitEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') || k === 'GIT_TRACE2_EVENT')
  ) as NodeJS.ProcessEnv
}

// `git fetch` starts `git maintenance run --auto --detach`, which keeps writing
// into the repository after the command returns. A spec's afterEach then
// deletes the directory under it and fails with ENOTEMPTY — only on a busy
// machine, which is how it read as a flake. tests/setup.ts turns it off, for
// specs that scrub GIT_* from git's environment too.
describe('git run by the test suite', () => {
  useRemovedDir()

  it('never starts background maintenance on fetch', () => {
    dir = makeTempDir('git-test-env-')
    const clone = clonedRepository()
    const commit = execFileSync(
      'sh',
      ['-c', 'GIT_TRACE=1 git -c user.name=t -c user.email=t@t commit -q --allow-empty -m c 2>&1'],
      { cwd: clone, env: scrubbedGitEnv(), encoding: 'utf-8' }
    )
    expect(commit).not.toMatch(/maintenance run --auto/)
    const trace = execFileSync('sh', ['-c', 'GIT_TRACE=1 git fetch -q origin 2>&1'], {
      cwd: clone,
      encoding: 'utf-8',
    })
    expect(trace).toContain('fetch')
    expect(trace).not.toMatch(/maintenance run --auto/)
  })
})

describe('git run by the test suite — after a commit', () => {
  useRemovedDir()

  it('leaves nothing writing into .git after a commit returns', async () => {
    dir = makeTempDir('git-test-env-')
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'c'],
      { cwd: dir }
    )
    const files = (): string[] =>
      readdirSync(join(dir, '.git'), { recursive: true }).map(String).sort()
    const before = files()
    await new Promise((settle) => setTimeout(settle, 1500))
    expect(files()).toEqual(before)
  })
})
