import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
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

/** The variables of the sealed environment (scripts/test-env.mjs) that git needs to read the
 * fixture config; a spec that scrubs GIT_* from git's environment keeps them. */
const KEPT_GIT_VARIABLES = new Set(['GIT_TRACE2_EVENT', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'])

/** This process's environment without GIT_* variables, the sealed ones aside. */
function scrubbedGitEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') || KEPT_GIT_VARIABLES.has(k))
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

  it('starts nothing that writes into .git after a commit returns', () => {
    dir = makeTempDir('git-test-env-')
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    // A process left writing after the commit shows in the trace as a command git started.
    const trace = execFileSync(
      'sh',
      ['-c', 'GIT_TRACE=1 git -c user.name=t -c user.email=t@t commit -q --allow-empty -m c 2>&1'],
      { cwd: dir, encoding: 'utf-8' }
    )
    expect(trace).toContain('commit')
    expect(trace).not.toMatch(/maintenance run --auto|gc --auto/)
  })
})
