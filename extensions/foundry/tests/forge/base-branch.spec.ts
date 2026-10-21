import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { baseBranchOfRepo } from '../../src/forge/base-branch.js'
import { seedOrder } from '../../src/forge/intake-source.js'
import { makeTempDir } from '../../../../tests/support/temp-dir'

// A repository's base branch is whatever it is on, not a name Foundry assumes:
// `master` repositories and branches cut from other branches are both ordinary.

let repo: string

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
}

function initOn(branch: string): void {
  git('init', '-q', '-b', branch)
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'first')
}

beforeEach(() => {
  repo = makeTempDir('foundry-base-branch-')
})

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

describe('baseBranchOfRepo', () => {
  it('is master in a repository whose branch is master', async () => {
    initOn('master')
    expect(await baseBranchOfRepo(repo)).toBe('master')
  })

  it('is the feature branch when the repository is on one', async () => {
    initOn('main')
    git('checkout', '-q', '-b', 'andrew/stacked-work')
    expect(await baseBranchOfRepo(repo)).toBe('andrew/stacked-work')
  })

  it('falls back to the remote default when HEAD is detached', async () => {
    initOn('trunk')
    git('update-ref', 'refs/remotes/origin/trunk', 'HEAD')
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
    git('checkout', '-q', '--detach')
    expect(await baseBranchOfRepo(repo)).toBe('trunk')
  })

  it('is main for a directory git cannot read', async () => {
    expect(await baseBranchOfRepo(repo)).toBe('main')
  })
})

describe('seedOrder', () => {
  it('gives each repository its own base branch', async () => {
    initOn('master')
    const other = makeTempDir('foundry-base-branch-other-')
    const seeded = await seedOrder(
      { kind: 'typed', text: 'x', repoPaths: [repo, other] },
      { now: () => '2026-09-06T10:00:00.000Z', newId: () => 'WO-0906-abc' }
    )
    fs.rmSync(other, { recursive: true, force: true })
    if (!('order' in seeded)) throw new Error('expected an order')
    expect(seeded.order.context.repos.map((r) => r.baseBranch)).toEqual(['master', 'main'])
  })
})
