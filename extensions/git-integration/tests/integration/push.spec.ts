import { describe, it, expect, beforeEach } from 'vitest'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { pushBranch } from '../../src/git/git-service.js'
import { bindRealShell } from '../unit/support/shell'
import { GIT_FREE_ENV } from '../unit/support/git-repo'
import { makeTempDir } from '../../../../tests/support/temp-dir'

// No signing and no hooks from the developer's own git config: a signer made each commit slow.
const git = (cwd: string, args: string[]) =>
  execFileSync(
    'git',
    [
      '-c',
      'commit.gpgSign=false',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'user.name=E2E',
      ...args,
    ],
    { cwd, env: { ...GIT_FREE_ENV, EMAIL: 'e2e@example.com' }, encoding: 'utf-8' }
  ).trim()

/** A checkout of `main` with one commit its bare origin does not have yet. */
function checkoutAheadOfOrigin(): { checkout: string; origin: string } {
  const dir = makeTempDir('push-real-')
  const origin = join(dir, 'origin.git')
  const checkout = join(dir, 'checkout')
  git(dir, ['init', '-q', '--bare', '-b', 'main', origin])
  git(dir, ['init', '-q', '-b', 'main', checkout])
  git(checkout, ['remote', 'add', 'origin', origin])
  git(checkout, ['commit', '-q', '--allow-empty', '-m', 'root'])
  git(checkout, ['push', '-q', '-u', 'origin', 'main'])
  git(checkout, ['commit', '-q', '--allow-empty', '-m', 'second'])
  return { checkout, origin }
}

describe('pushBranch against real git', () => {
  beforeEach(() => {
    bindRealShell(GIT_FREE_ENV)
  })

  it("puts the checkout's new commit on origin, and names the branch and the remote", async () => {
    const { checkout, origin } = checkoutAheadOfOrigin()

    const result = await pushBranch(checkout)

    expect(result).toEqual({ success: true, branch: 'main', remote: 'origin' })
    expect(git(origin, ['rev-parse', 'main'])).toBe(git(checkout, ['rev-parse', 'HEAD']))
  })
})
