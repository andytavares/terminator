import { describe, it, expect, vi, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import {
  reattachCheckout,
  ensureCheckout,
  ensureBaselineCheckout,
  removeBaseCheckout,
  removeCheckout,
  branchFor,
  checkoutPath,
  createdBranchMarker,
} from '../../../src/line/worktree.js'
import type { CheckoutDeps } from '../../../src/line/worktree.js'
import type { WorkOrder } from '../../../src/order/schema.js'
import { makeTempDir } from '../../../../../packages/test-support/src/temp-dir'
import { calls, order } from '../../helpers/checkout-order.js'

// A lane's checkout cut from a real repository by real git.

const scratch: string[] = []
function tmpDir(prefix: string): string {
  const dir = makeTempDir(prefix)
  scratch.push(dir)
  return dir
}

afterEach(() => {
  while (scratch.length > 0) {
    const dir = scratch.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('preparing a checkout', () => {
  describe('real git', realGitTests)
  describe('real git, other starts', realGitResetTests)
  describe('real git, two orders in one repository', realGitTwoOrdersTests)
  describe('real git, re-attaching only', realGitReattachTests)
  describe('real git, a stale branch', realGitStaleBranchTests)
  describe('real git, a stale branch with its own commit', realGitStaleBranchFetchTests)
  describe('real git, safety', realGitSafetyTests)
  describe('real git, fetching the base', realGitFetchTests)
  describe('real git, branch ownership', realGitBranchOwnershipTests)
  describe('real git, fetch fallbacks', realGitFallbackTests)
})

const gitExec: CheckoutDeps['exec'] = async ({ args, cwd }) => {
  try {
    const stdout = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
    return { exitCode: 0, stdout, stderr: '', timedOut: false }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return {
      exitCode: failure.status ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
      timedOut: false,
    }
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
}

/** A real repository on `main` with one commit, and an order whose lane 1 is cut from it. */
function realRepo(): { deps: CheckoutDeps; repoPath: string; target: string; order: WorkOrder } {
  const repoPath = tmpDir('foundry-real-repo-')
  git(repoPath, 'init', '-q', '-b', 'main')
  commitOn(repoPath, 'base')
  const seeded = order()
  const real: WorkOrder = {
    ...seeded,
    context: {
      ...seeded.context,
      repos: [{ name: 'app', path: repoPath, lane: 1, baseBranch: 'main', headBranch: '' }],
    },
  }
  const root = tmpDir('foundry-real-root-')
  return {
    deps: { exec: gitExec, root },
    repoPath,
    target: checkoutPath(root, real, 'app'),
    order: real,
  }
}

function commitOn(cwd: string, message: string): string {
  git(
    cwd,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    message
  )
  return git(cwd, 'rev-parse', 'HEAD')
}

function realGitTests() {
  it('creates the checkout when only its @baseline sibling is registered', async () => {
    const { deps: real, repoPath, target, order: o } = realRepo()
    fs.mkdirSync(path.dirname(target), { recursive: true })
    git(repoPath, 'worktree', 'add', '--detach', `${target}@baseline`, 'main')

    const checkout = await ensureCheckout(o, 1, real)

    expect(checkout.created).toBe(true)
    expect(fs.statSync(target).isDirectory()).toBe(true)
  })

  it('recreates a deleted checkout and keeps the commits on its branch', async () => {
    const { deps: real, target, order: o } = realRepo()
    const first = await ensureCheckout(o, 1, real)
    const extra = commitOn(target, 'work in progress')
    fs.rmSync(target, { recursive: true, force: true })

    const again = await ensureCheckout(o, 1, real)

    expect(again.created).toBe(true)
    expect(fs.statSync(target).isDirectory()).toBe(true)
    expect(git(target, 'rev-parse', 'HEAD')).toBe(extra)
    expect(git(target, 'rev-parse', `refs/heads/${first.branch}`)).toBe(extra)
  })
}

/** A second order on the same repository as `first`, on a branch of its own. */
function secondOrder(first: WorkOrder): WorkOrder {
  return { ...first, id: 'WO-0002-abc', source: { ...first.source, branch: 'lane-two' } }
}

/** Checks out `o`'s lane 1, commits on it, deletes its folder; the commit it made. */
async function workThenDelete(o: WorkOrder, real: CheckoutDeps): Promise<string> {
  const checkout = await ensureCheckout(o, 1, real)
  const extra = commitOn(checkout.path, `work on ${o.id}`)
  fs.rmSync(checkout.path, { recursive: true, force: true })
  return extra
}

function realGitTwoOrdersTests() {
  it('recreating one deleted lane leaves the other order its commits', async () => {
    const { deps: real, order: first } = realRepo()
    const second = secondOrder(first)
    await workThenDelete(first, real)
    const secondWork = await workThenDelete(second, real)

    await ensureCheckout(first, 1, real)
    const again = await ensureCheckout(second, 1, real)

    expect(git(again.path, 'rev-parse', 'HEAD')).toBe(secondWork)
  })
}

function realGitReattachTests() {
  it('re-attaches a branch git no longer lists a worktree for, commits kept', async () => {
    const { deps: real, repoPath, order: o } = realRepo()
    const extra = await workThenDelete(o, real)
    git(repoPath, 'worktree', 'prune')

    const checkout = await reattachCheckout(o, 1, real)

    expect(git(checkout.path, 'rev-parse', 'HEAD')).toBe(extra)
  })

  it('refuses rather than cut a new branch when the lane branch is gone', async () => {
    const { deps: real, order: o } = realRepo()
    await expect(reattachCheckout(o, 1, real)).rejects.toThrow(/no longer exists/)
  })
}

/** The lane's branch, left behind by an earlier cut, while main moved on by three commits. */
function staleBranchRepo() {
  const fixture = realRepo()
  const branch = branchFor(fixture.order, 1)
  git(fixture.repoPath, 'branch', branch)
  const stale = git(fixture.repoPath, 'rev-parse', branch)
  for (const n of [1, 2, 3]) commitOn(fixture.repoPath, `main moved ${n}`)
  return { ...fixture, branch, stale, mainTip: git(fixture.repoPath, 'rev-parse', 'main') }
}

function realGitStaleBranchTests() {
  it('moves an existing branch with no commits of its own to the base when the lane is cut', async () => {
    const { deps: real, order: o, branch, mainTip } = staleBranchRepo()
    const checkout = await ensureCheckout(o, 1, real)
    expect(git(checkout.path, 'rev-parse', 'HEAD')).toBe(mainTip)
    expect(git(checkout.path, 'rev-parse', `refs/heads/${branch}`)).toBe(mainTip)
  })

  it('attaches a branch with a commit of its own unchanged', async () => {
    const { deps: real, repoPath, order: o, branch } = staleBranchRepo()
    git(repoPath, 'checkout', '-q', branch)
    const own = commitOn(repoPath, 'its own work')
    git(repoPath, 'checkout', '-q', 'main')
    const checkout = await ensureCheckout(o, 1, real)
    expect(git(checkout.path, 'rev-parse', 'HEAD')).toBe(own)
  })

  it('never moves a branch when only re-attaching', async () => {
    const { deps: real, order: o, stale } = staleBranchRepo()
    const checkout = await reattachCheckout(o, 1, real)
    expect(git(checkout.path, 'rev-parse', 'HEAD')).toBe(stale)
  })
}

/** `origin` as a bare clone of `repoPath`, so the repository has a remote to fetch from. */
function addOrigin(repoPath: string): string {
  const bare = tmpDir('foundry-origin-')
  git(bare, 'init', '-q', '--bare')
  git(repoPath, 'remote', 'add', 'origin', bare)
  git(repoPath, 'push', '-q', 'origin', 'main')
  return bare
}

/** Moves origin's main one commit ahead of the local main; that commit. */
function advanceOrigin(bare: string): string {
  const other = tmpDir('foundry-other-')
  git(other, 'clone', '-q', bare, '.')
  const tip = commitOn(other, 'upstream work')
  git(other, 'push', '-q', 'origin', 'main')
  return tip
}

function realGitSafetyTests() {
  it('locks the worktree and leaves a stale lane its registration when another is removed', async () => {
    const { deps: real, order: first } = realRepo()
    const extra = await workThenDelete(first, real)
    const baseline = await ensureBaselineCheckout(first, 1, real)

    await removeBaseCheckout(baseline, real)
    const again = await ensureCheckout(first, 1, real)

    expect(git(again.path, 'rev-parse', 'HEAD')).toBe(extra)
  })

  it('creates every worktree locked, and removes a locked one', async () => {
    const { deps: real, repoPath, target, order: o } = realRepo()
    const checkout = await ensureCheckout(o, 1, real)

    expect(git(repoPath, 'worktree', 'list', '--porcelain')).toMatch(
      new RegExp(`worktree ${target}\\n[^]*?locked`)
    )
    expect(await removeCheckout(checkout, real)).toBe(true)
    expect(fs.existsSync(target)).toBe(false)
  })
}

function realGitBranchOwnershipTests() {
  it("puts the worktree on the operator's existing branch and does not reset it", async () => {
    const { deps: real, repoPath, target, order: o } = realRepo()
    const named: WorkOrder = { ...o, source: { ...o.source, branch: 'andrew/tav-1-mine' } }
    git(repoPath, 'checkout', '-q', '-b', 'andrew/tav-1-mine')
    const mine = commitOn(repoPath, 'my own work')
    git(repoPath, 'checkout', '-q', 'main')

    const checkout = await ensureCheckout(named, 1, real)

    expect(git(target, 'rev-parse', 'HEAD')).toBe(mine)
    expect(fs.existsSync(createdBranchMarker(checkout.path))).toBe(false)
  })

  it('records that Foundry created the branch it cut, and remembers it on a resume', async () => {
    const { deps: real, order: o } = realRepo()
    const first = await ensureCheckout(o, 1, real)
    expect(fs.existsSync(createdBranchMarker(first.path))).toBe(true)
    const resumed = await ensureCheckout(o, 1, real)
    expect(fs.existsSync(createdBranchMarker(resumed.path))).toBe(true)
  })
}

function realGitFetchTests() {
  it('cuts a new lane from origin after fetching it, not from a local base that is behind', async () => {
    const { deps: real, repoPath, target, order: o } = realRepo()
    const upstream = advanceOrigin(addOrigin(repoPath))

    await ensureCheckout(o, 1, real)

    expect(git(target, 'rev-parse', 'HEAD')).toBe(upstream)
  })

  it('cuts from the local base and says so when the fetch fails', async () => {
    const { deps: real, repoPath, target, order: o } = realRepo()
    fs.rmSync(addOrigin(repoPath), { recursive: true, force: true })
    const note = vi.fn()

    await ensureCheckout(o, 1, { ...real, note })

    expect(git(target, 'rev-parse', 'HEAD')).toBe(git(repoPath, 'rev-parse', 'main'))
    expect(note).toHaveBeenCalledWith(expect.stringContaining('local main'))
  })
}

function realGitFallbackTests() {
  it('cuts from the local base and says so when there is no remote', async () => {
    const { deps: real, order: o } = realRepo()
    const note = vi.fn()
    await ensureCheckout(o, 1, { ...real, note })
    expect(note).toHaveBeenCalledWith(expect.stringContaining('local main'))
  })

  it('fetches with a timeout longer than the ten seconds the host allows by default', async () => {
    const seen: { args: string[]; timeoutMs?: number }[] = []
    const real = realRepo()
    const exec: CheckoutDeps['exec'] = (options) => {
      seen.push(options)
      return gitExec(options)
    }
    addOrigin(real.repoPath)
    await ensureCheckout(real.order, 1, { ...real.deps, exec })
    expect(seen.find((c) => c.args[0] === 'fetch')?.timeoutMs).toBeGreaterThanOrEqual(120_000)
  })
}

function realGitResetTests() {
  it('reports a checkout that is still there as not created', async () => {
    const { deps: real, order: o } = realRepo()
    await ensureCheckout(o, 1, real)
    expect((await ensureCheckout(o, 1, real)).created).toBe(false)
  })

  it('keeps a leftover branch and its commits when the order never registered a checkout', async () => {
    const { deps: real, repoPath, target, order: o } = realRepo()
    git(repoPath, 'checkout', '-q', '-b', branchFor(o, 1))
    const leftover = commitOn(repoPath, 'leftover')
    git(repoPath, 'checkout', '-q', 'main')

    const checkout = await ensureCheckout(o, 1, real)

    expect(checkout.created).toBe(true)
    expect(fs.existsSync(createdBranchMarker(checkout.path))).toBe(false)
    expect(git(target, 'rev-parse', 'HEAD')).toBe(leftover)
  })

  it('recreates a deleted base checkout detached', async () => {
    const { deps: real, order: o } = realRepo()
    const first = await ensureBaselineCheckout(o, 1, real)
    fs.rmSync(first.path, { recursive: true, force: true })

    const again = await ensureBaselineCheckout(o, 1, real)

    expect(again.created).toBe(true)
    expect(fs.statSync(again.path).isDirectory()).toBe(true)
  })
}

function realGitStaleBranchFetchTests() {
  it('does not fetch to decide about a branch with a commit of its own', async () => {
    const { deps: real, repoPath, order: o, branch } = staleBranchRepo()
    addOrigin(repoPath)
    git(repoPath, 'checkout', '-q', branch)
    commitOn(repoPath, 'its own work')
    git(repoPath, 'checkout', '-q', 'main')
    const exec = vi.fn(real.exec)
    await ensureCheckout(o, 1, { ...real, exec })
    expect(calls(exec).filter((c) => c.args[0] === 'fetch')).toEqual([])
  })
}
