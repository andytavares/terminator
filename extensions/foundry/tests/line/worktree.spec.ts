import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs'
import {
  ensureCheckout,
  ensureCheckouts,
  ensureBaselineCheckout,
  removeBaseCheckout,
  removeCheckout,
  provisionDependencies,
  unlinkBorrowedDependencies,
  branchFor,
  checkoutPath,
  CheckoutFailedError,
} from '../../src/line/worktree.js'
import type { CheckoutDeps, Checkout } from '../../src/line/worktree.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { makeTempDir } from '../../../../tests/support/temp-dir'
import { calls, order } from '../helpers/checkout-order.js'
import { eventually } from '../../../../tests/support/eventually'

// Somewhere for a lane's work to happen, cut from the lane's own repository
// and living under the data root — never inside the repository, which is the
// one thing Foundry does not write into.

const ROOT = '/data/.foundry'

function deps(over: Partial<CheckoutDeps> = {}): CheckoutDeps & { exec: ReturnType<typeof vi.fn> } {
  const exec = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }))
  return { exec: exec as never, root: ROOT, ...over } as CheckoutDeps & {
    exec: ReturnType<typeof vi.fn>
  }
}

beforeEach(() => vi.clearAllMocks())

describe('where a checkout goes', () => {
  it('is under the data root, never inside the repository', () => {
    const where = checkoutPath(ROOT, order(), 'app')
    expect(where.startsWith(ROOT)).toBe(true)
    expect(where.includes('/repos/app')).toBe(false)
  })

  it('keeps each order own worktrees apart', () => {
    expect(checkoutPath(ROOT, order(), 'app')).not.toBe(
      checkoutPath(ROOT, order({ id: 'WO-2' }), 'app')
    )
  })

  it('keeps each lane repository apart within one order', () => {
    expect(checkoutPath(ROOT, order(), 'app')).not.toBe(checkoutPath(ROOT, order(), 'sdk'))
  })
})

describe('which branch a lane works on', () => {
  describe('tracker names', trackerNamesTests)
  describe('fallbacks', worktreeFallbacksTests)
})

function trackerNamesTests() {
  it("takes the tracker's own suggested name when the order carries one", () => {
    const seeded = order()
    const withBranch: WorkOrder = {
      ...seeded,
      plan: {
        ...seeded.plan,
        lanes: [{ ...seeded.plan.lanes[0], branch: 'andrew/tav-42-refuse-expired' }],
      },
    }
    expect(branchFor(withBranch, 1)).toBe('andrew/tav-42-refuse-expired')
  })

  it("prefers the ticket's branch on the source over the lane's", () => {
    const seeded = order()
    const withSource: WorkOrder = {
      ...seeded,
      source: { ...seeded.source, branch: 'andrew/tav-15-ticket' },
      plan: { ...seeded.plan, lanes: [{ ...seeded.plan.lanes[0], branch: '' }] },
    }
    expect(branchFor(withSource, 1)).toBe('andrew/tav-15-ticket')
  })
}

function worktreeFallbacksTests() {
  it('falls back to the repository own head branch', () => {
    const seeded = order()
    const withHead: WorkOrder = {
      ...seeded,
      context: {
        ...seeded.context,
        repos: [{ ...seeded.context.repos[0], headBranch: 'feat/from-the-plan' }],
      },
    }
    expect(branchFor(withHead, 1)).toBe('feat/from-the-plan')
  })

  it('derives one from the order id when nothing named it', () => {
    expect(branchFor(order(), 1)).toBe('foundry/wo-1')
  })
}

describe('preparing a checkout', () => {
  describe('adding', worktreeAddingTests)
  describe('reusing', worktreeReusingTests)
  describe('reusing through a symlink', worktreeSymlinkTests)
  describe('failures', worktreeFailuresTests)
  describe('concurrent callers', concurrentCallersTests)
  describe('retrying', worktreeRetryingTests)
})

function twoLanes(): WorkOrder {
  const base = order()
  return {
    ...base,
    context: {
      ...base.context,
      repos: [
        { name: 'proto', path: '/repos/proto', lane: 1, baseBranch: 'main', headBranch: '' },
        { name: 'cli', path: '/repos/cli', lane: 2, baseBranch: 'main', headBranch: '' },
      ],
    },
    plan: {
      ...base.plan,
      lanes: [
        { ord: 1, repo: 'proto', branch: '', role: null, blocks: [], blockedBy: [] },
        { ord: 2, repo: 'cli', branch: '', role: null, blocks: [], blockedBy: [] },
      ],
    },
  }
}

/** A mock exec where no branch exists yet, as for a lane about to be cut. */
function depsWithoutBranch(): ReturnType<typeof deps> {
  const exec = vi.fn(async (options: { args: string[] }) => ({
    exitCode: options.args[0] === 'rev-parse' ? 1 : 0,
    stdout: '',
    stderr: '',
    timedOut: false,
  }))
  return deps({ exec: exec as never })
}

function worktreeAddingTests() {
  it('adds a locked worktree on a new branch cut from the base', async () => {
    const d = depsWithoutBranch()
    const checkout = await ensureCheckout(order(), 1, d)

    const add = calls(d.exec).find((c) => c.args[1] === 'add')
    expect(add?.cwd).toBe('/repos/app')
    expect(add?.args).toEqual([
      'worktree',
      'add',
      '--lock',
      '-b',
      'foundry/wo-1',
      path.join(ROOT, 'orders', 'WO-1', 'worktrees', 'app'),
      'main',
    ])
    expect(checkout.created).toBe(true)
  })

  it('puts a worktree on a branch that exists without resetting it', async () => {
    const d = deps()
    await ensureCheckout(order(), 1, d)
    const add = calls(d.exec).find((c) => c.args[1] === 'add')
    expect(add?.args).toEqual([
      'worktree',
      'add',
      '--lock',
      path.join(ROOT, 'orders', 'WO-1', 'worktrees', 'app'),
      'foundry/wo-1',
    ])
  })
}

function worktreeReusingTests() {
  it('reuses the worktree git already has, rather than adding a second', async () => {
    const root = tmpDir('foundry-reuse-')
    const target = path.join(root, 'orders', 'WO-1', 'worktrees', 'app')
    fs.mkdirSync(target, { recursive: true })
    const exec = vi.fn(async (options: { args: string[] }) =>
      options.args[1] === 'list'
        ? { exitCode: 0, stdout: `worktree ${target}\nHEAD abc\n`, stderr: '', timedOut: false }
        : { exitCode: 0, stdout: '', stderr: '', timedOut: false }
    )
    const d = deps({ exec: exec as never, root })
    const checkout = await ensureCheckout(order(), 1, d)

    expect(checkout.created).toBe(false)
    expect(calls(exec).some((c) => c.args[1] === 'add')).toBe(false)
  })

  it('asks git rather than the filesystem, so a stray directory is not mistaken for one', async () => {
    const d = deps()
    await ensureCheckout(order(), 1, d)
    expect(calls(d.exec)[0].args).toEqual(['worktree', 'list', '--porcelain'])
  })
}

function worktreeSymlinkTests() {
  it('reuses it when the data root is reached through a symlink, which git lists resolved', async () => {
    const real = tmpDir('foundry-reuse-real-')
    const root = path.join(tmpDir('foundry-reuse-link-'), 'root')
    fs.symlinkSync(real, root)
    const target = path.join(root, 'orders', 'WO-1', 'worktrees', 'app')
    fs.mkdirSync(target, { recursive: true })
    const listedAs = fs.realpathSync(target)
    const exec = vi.fn(async (options: { args: string[] }) =>
      options.args[1] === 'list'
        ? { exitCode: 0, stdout: `worktree ${listedAs}\nHEAD abc\n`, stderr: '', timedOut: false }
        : { exitCode: 0, stdout: '', stderr: '', timedOut: false }
    )
    const checkout = await ensureCheckout(order(), 1, deps({ exec: exec as never, root }))

    expect(checkout.created).toBe(false)
    expect(calls(exec).some((c) => c.args[1] === 'add')).toBe(false)
  })
}

function worktreeFailuresTests() {
  it('says which repository failed, and why', async () => {
    const exec = vi.fn(async (options: { args: string[] }) =>
      options.args[1] === 'add'
        ? { exitCode: 1, stdout: '', stderr: 'fatal: invalid reference: main', timedOut: false }
        : { exitCode: 0, stdout: '', stderr: '', timedOut: false }
    )
    await expect(ensureCheckout(order(), 1, deps({ exec: exec as never }))).rejects.toBeInstanceOf(
      CheckoutFailedError
    )
    await expect(ensureCheckout(order(), 1, deps({ exec: exec as never }))).rejects.toThrow(
      /invalid reference/
    )
  })

  it('refuses a lane the order does not have', async () => {
    await expect(ensureCheckout(order(), 9, deps())).rejects.toThrow(/no such lane/)
  })
}

/** What git prints when a second `worktree add` races the first for the same branch. */
const CANNOT_LOCK = {
  exitCode: 128,
  stdout: '',
  stderr: 'fatal: cannot lock ref: reference already exists',
  timedOut: false,
}

/** Git as it behaves when two callers add one worktree at once: a second add fails to lock. */
function gitAddingSlowly(target: string, addFinishes: Promise<void>) {
  let added = false
  let adding = false
  return vi.fn(async (options: { args: string[] }) => {
    if (options.args[1] === 'list') {
      const stdout = added ? `worktree ${target}\nHEAD abc\n` : ''
      return { exitCode: 0, stdout, stderr: '', timedOut: false }
    }
    if (options.args[1] === 'add') {
      if (adding || added) return CANNOT_LOCK
      adding = true
      await addFinishes
      added = true
    }
    return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
  })
}

function concurrentCallersTests() {
  it('gives two callers asking at once the same checkout, not a second add', async () => {
    // The scout and the architect's first turn both prepare lane 1 as an order
    // starts. Real git lists no worktree to either, then fails the second add
    // with "cannot lock ref … reference already exists".
    const target = path.join(ROOT, 'orders', 'WO-1', 'worktrees', 'app')
    let finishAdding = (): void => undefined
    const addFinishes = new Promise<void>((resolve) => (finishAdding = resolve))
    const exec = gitAddingSlowly(target, addFinishes)
    const d = deps({ exec: exec as never })

    const asking = Promise.all([ensureCheckout(order(), 1, d), ensureCheckout(order(), 1, d)])
    // Both are asking while the one add is still running; only then does it finish.
    await eventually(() =>
      expect(calls(exec).filter((c) => c.args[1] === 'add').length).toBeGreaterThanOrEqual(1)
    )
    finishAdding()
    const [a, b] = await asking

    expect(a.path).toBe(target)
    expect(b.path).toBe(target)
    expect(calls(exec).filter((c) => c.args[1] === 'add')).toHaveLength(1)
  })
}

function worktreeRetryingTests() {
  it('tries again after a failed attempt rather than repeating its error', async () => {
    let failNext = true
    const exec = vi.fn(async (options: { args: string[] }) => {
      if (options.args[1] === 'add' && failNext) {
        failNext = false
        return { exitCode: 1, stdout: '', stderr: 'fatal: transient', timedOut: false }
      }
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
    })
    const d = deps({ exec: exec as never })

    await expect(ensureCheckout(order(), 1, d)).rejects.toThrow(/transient/)
    await expect(ensureCheckout(order(), 1, d)).resolves.toMatchObject({ created: true })
  })
}

describe('preparing every lane', () => {
  describe('every lane', worktreeEveryLaneTests)
})

function worktreeEveryLaneTests() {
  it('prepares all of them, in lane order', async () => {
    const d = deps()
    const checkouts = await ensureCheckouts(twoLanes(), d)
    expect([...checkouts.keys()]).toEqual([1, 2])
    expect(
      calls(d.exec)
        .filter((c) => c.args[1] === 'add')
        .map((c) => c.cwd)
    ).toEqual(['/repos/proto', '/repos/cli'])
  })

  it('prepares them all before any agent starts, so a failure costs no agent time', async () => {
    const exec = vi.fn(async (options: { args: string[]; cwd: string }) =>
      options.args[1] === 'add' && options.cwd === '/repos/cli'
        ? { exitCode: 1, stdout: '', stderr: 'no such remote branch', timedOut: false }
        : { exitCode: 0, stdout: '', stderr: '', timedOut: false }
    )
    await expect(ensureCheckouts(twoLanes(), deps({ exec: exec as never }))).rejects.toThrow(/cli/)
  })

  it('costs a single-lane order one checkout', async () => {
    const d = deps()
    expect((await ensureCheckouts(order(), d)).size).toBe(1)
  })
}

describe('taking one away', () => {
  it('removes the worktree from the repository it was cut from', async () => {
    const d = deps()
    const checkout = await ensureCheckout(order(), 1, d)
    d.exec.mockClear()

    expect(await removeCheckout(checkout, d)).toBe(true)
    expect(calls(d.exec).map((c) => c.args)).toEqual([
      ['worktree', 'unlock', checkout.path],
      ['worktree', 'remove', '--force', checkout.path],
    ])
    expect(calls(d.exec)[1].cwd).toBe('/repos/app')
  })

  it('reports a refusal rather than throwing at a caller that is cleaning up', async () => {
    const checkout = await ensureCheckout(order(), 1, deps())
    const exec = vi.fn(async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'not a working tree',
      timedOut: false,
    }))
    await expect(removeCheckout(checkout, deps({ exec: exec as never }))).resolves.toBe(false)
  })
})

const scratch: string[] = []
function tmpDir(prefix: string): string {
  const dir = makeTempDir(prefix)
  scratch.push(dir)
  return dir
}
function lsFilesAnd(...manifests: string[]) {
  return vi.fn(async (options: { args: string[] }) => {
    if (options.args[0] === 'ls-files')
      return {
        exitCode: 0,
        stdout: manifests.length === 0 ? '' : manifests.join('\0') + '\0',
        stderr: '',
        timedOut: false,
      }
    if (options.args[0] === 'check-ignore')
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
    return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
  })
}

describe('provisioning dependencies', () => {
  afterEach(() => {
    while (scratch.length > 0) {
      const dir = scratch.pop()
      if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  describe('linking', linkingTests)
  describe('unlinking', unlinkingTests)
  describe('nothing to link', nothingToLinkTests)
  describe('check-ignore', checkIgnoreTests)
  describe('reused checkouts', reusedCheckoutsTests)
  describe('git unable to list', gitUnableToListTests)
  describe('odd checkouts', oddCheckoutsTests)
  describe('the share list', shareListTests)
  describe('the share list edges', shareListEdgeTests)
  describe('the share list ignored', shareIgnoreTests)
  describe('the share list taken back', shareTakeBackTests)
})

/** git refusing every command, as in a directory that is no longer a repository. */
const refusingGit = vi.fn(async () => ({
  exitCode: 128,
  stdout: '',
  stderr: 'fatal: not a git repository',
  timedOut: false,
}))

function gitUnableToListTests() {
  it('lends nothing when git cannot list the manifests', async () => {
    const origin = tmpDir('foundry-origin-')
    const wt = tmpDir('foundry-wt-')
    fs.mkdirSync(path.join(origin, 'node_modules'))
    const checkout = lending(origin, wt, 'node_modules')

    const linked = await provisionDependencies(checkout, deps({ exec: refusingGit as never }))

    expect(linked).toEqual([])
    expect(fs.existsSync(path.join(wt, 'node_modules'))).toBe(false)
  })

  it('takes nothing back when git cannot list the manifests', async () => {
    const origin = tmpDir('foundry-origin-')
    const wt = tmpDir('foundry-wt-')
    fs.mkdirSync(path.join(origin, 'node_modules'))
    fs.symlinkSync(path.join(origin, 'node_modules'), path.join(wt, 'node_modules'), 'dir')
    const checkout = lending(origin, wt, 'node_modules')

    const unlinked = await unlinkBorrowedDependencies(
      checkout,
      deps({ exec: refusingGit as never })
    )

    expect(unlinked).toEqual([])
    expect(fs.lstatSync(path.join(wt, 'node_modules')).isSymbolicLink()).toBe(true)
  })
}

function oddCheckoutsTests() {
  it('lends nothing into a package directory the checkout does not have', async () => {
    const origin = tmpDir('foundry-origin-')
    const wt = tmpDir('foundry-wt-')
    fs.mkdirSync(path.join(origin, 'packages', 'gone', 'node_modules'), { recursive: true })
    const exec = lsFilesAnd('packages/gone/package.json')
    const checkout = lending(origin, wt, 'node_modules')

    const linked = await provisionDependencies(checkout, deps({ exec: exec as never }))

    expect(linked).toEqual([])
  })

  it('never throws at a caller when git itself throws', async () => {
    const exec = vi.fn(async () => {
      throw new Error('spawn git ENOENT')
    })
    const checkout: Checkout = {
      repo: 'app',
      origin: '/o',
      path: '/w',
      branch: 'b',
      created: true,
      share: ['node_modules'],
    }

    await expect(provisionDependencies(checkout, deps({ exec: exec as never }))).resolves.toEqual(
      []
    )
    await expect(
      unlinkBorrowedDependencies(checkout, deps({ exec: exec as never }))
    ).resolves.toEqual([])
  })
}

/** A fresh checkout in `wt` of the repository at `origin`, whose order shares `share`. */
function lending(origin: string, wt: string, ...share: string[]): Checkout {
  return { repo: 'app', origin, path: wt, branch: 'b', created: true, share }
}

function shareListTests() {
  it('lends the shared folder where git ignores it, and nothing named node_modules', async () => {
    const origin = tmpDir('foundry-origin-')
    const wt = tmpDir('foundry-wt-')
    fs.mkdirSync(path.join(origin, 'vendor'))
    fs.mkdirSync(path.join(origin, 'node_modules'))
    const exec = lsFilesAnd('package.json')

    const linked = await provisionDependencies(
      lending(origin, wt, 'vendor'),
      deps({ exec: exec as never })
    )

    expect(linked).toEqual(['vendor'])
    expect(fs.lstatSync(path.join(wt, 'vendor')).isSymbolicLink()).toBe(true)
    expect(fs.existsSync(path.join(wt, 'node_modules'))).toBe(false)
  })

  it('lends the shared folder beside every tracked directory that has it in the origin', async () => {
    const origin = tmpDir('foundry-origin-')
    const wt = tmpDir('foundry-wt-')
    fs.mkdirSync(path.join(origin, 'services', 'api', 'vendor'), { recursive: true })
    fs.mkdirSync(path.join(wt, 'services', 'api'), { recursive: true })
    const exec = lsFilesAnd('services/api/main.go', 'README.md')

    const linked = await provisionDependencies(
      lending(origin, wt, 'vendor'),
      deps({ exec: exec as never })
    )

    expect(linked).toEqual(['services/api/vendor'])
  })
}

function shareIgnoreTests() {
  it('removes the link where git does not ignore the shared folder', async () => {
    const origin = tmpDir('foundry-origin-')
    const wt = tmpDir('foundry-wt-')
    fs.mkdirSync(path.join(origin, 'vendor'))
    const exec = vi.fn(async (options: { args: string[] }) => ({
      exitCode: options.args[0] === 'check-ignore' ? 1 : 0,
      stdout: options.args[0] === 'ls-files' ? 'go.mod\0' : '',
      stderr: '',
      timedOut: false,
    }))

    const linked = await provisionDependencies(
      lending(origin, wt, 'vendor'),
      deps({ exec: exec as never })
    )

    expect(linked).toEqual([])
    expect(fs.existsSync(path.join(wt, 'vendor'))).toBe(false)
  })
}

function shareListEdgeTests() {
  it('lends nothing when the share list is empty', async () => {
    const origin = tmpDir('foundry-origin-')
    const wt = tmpDir('foundry-wt-')
    fs.mkdirSync(path.join(origin, 'node_modules'))
    fs.mkdirSync(path.join(origin, 'vendor'))

    const linked = await provisionDependencies(
      lending(origin, wt),
      deps({ exec: lsFilesAnd('package.json') as never })
    )

    expect(linked).toEqual([])
    expect(fs.readdirSync(wt)).toEqual([])
  })
}

function shareTakeBackTests() {
  it('takes back only the links of the shared folders', async () => {
    const origin = tmpDir('foundry-origin-')
    const wt = tmpDir('foundry-wt-')
    fs.mkdirSync(path.join(origin, 'vendor'))
    fs.mkdirSync(path.join(origin, 'node_modules'))
    fs.symlinkSync(path.join(origin, 'vendor'), path.join(wt, 'vendor'), 'dir')
    fs.symlinkSync(path.join(origin, 'node_modules'), path.join(wt, 'node_modules'), 'dir')

    const unlinked = await unlinkBorrowedDependencies(
      lending(origin, wt, 'vendor'),
      deps({ exec: lsFilesAnd('package.json') as never })
    )

    expect(unlinked).toEqual(['vendor'])
    expect(fs.existsSync(path.join(wt, 'node_modules'))).toBe(true)
  })

  it('hands the order share list to the checkout it cuts', async () => {
    const base = order()
    const shared: WorkOrder = {
      ...base,
      context: { ...base.context, environment: { ...base.context.environment, share: ['vendor'] } },
    }
    expect((await ensureCheckout(shared, 1, deps())).share).toEqual(['vendor'])
    expect((await ensureBaselineCheckout(shared, 1, deps())).share).toEqual(['vendor'])
  })
}

const baseTarget = path.join(ROOT, 'orders', 'WO-1', 'worktrees', 'app@baseline')

function linkingTests() {
  it('links the origin root node_modules into the worktree', async () => {
    const origin = tmpDir('foundry-origin-')
    const wt = tmpDir('foundry-wt-')
    fs.mkdirSync(path.join(origin, 'node_modules'))
    const exec = lsFilesAnd('package.json')
    const checkout = lending(origin, wt, 'node_modules')

    const linked = await provisionDependencies(checkout, deps({ exec: exec as never }))

    expect(linked).toEqual(['node_modules'])
    expect(fs.lstatSync(path.join(wt, 'node_modules')).isSymbolicLink()).toBe(true)
  })

  it("links a nested workspace package's node_modules", async () => {
    const origin = tmpDir('foundry-origin-')
    const wt = tmpDir('foundry-wt-')
    fs.mkdirSync(path.join(origin, 'packages', 'foo', 'node_modules'), { recursive: true })
    fs.mkdirSync(path.join(wt, 'packages', 'foo'), { recursive: true })
    const exec = lsFilesAnd('packages/foo/package.json')
    const checkout = lending(origin, wt, 'node_modules')

    const linked = await provisionDependencies(checkout, deps({ exec: exec as never }))

    expect(linked).toEqual(['packages/foo/node_modules'])
    expect(fs.lstatSync(path.join(wt, 'packages', 'foo', 'node_modules')).isSymbolicLink()).toBe(
      true
    )
  })
}

function unlinkingTests() {
  // A reinstall into a borrowed node_modules would write through the link
  // into the origin's install, so the link goes first and only the link.
  it('unlinks borrowed node_modules and leaves the origin and real installs alone', async () => {
    const origin = tmpDir('foundry-origin-')
    const wt = tmpDir('foundry-wt-')
    fs.mkdirSync(path.join(origin, 'node_modules', 'left-pad'), { recursive: true })
    fs.mkdirSync(path.join(wt, 'packages', 'foo', 'node_modules'), { recursive: true })
    fs.symlinkSync(path.join(origin, 'node_modules'), path.join(wt, 'node_modules'), 'dir')
    const exec = lsFilesAnd('package.json', 'packages/foo/package.json')
    const checkout = lending(origin, wt, 'node_modules')

    const unlinked = await unlinkBorrowedDependencies(checkout, deps({ exec: exec as never }))

    expect(unlinked).toEqual(['node_modules'])
    expect(fs.existsSync(path.join(wt, 'node_modules'))).toBe(false)
    expect(fs.existsSync(path.join(origin, 'node_modules', 'left-pad'))).toBe(true)
    expect(fs.existsSync(path.join(wt, 'packages', 'foo', 'node_modules'))).toBe(true)
  })
}

function nothingToLinkTests() {
  it('does not link when the origin has no node_modules', async () => {
    const origin = tmpDir('foundry-origin-')
    const wt = tmpDir('foundry-wt-')
    const exec = lsFilesAnd('package.json')
    const checkout = lending(origin, wt, 'node_modules')

    const linked = await provisionDependencies(checkout, deps({ exec: exec as never }))

    expect(linked).toEqual([])
    expect(fs.existsSync(path.join(wt, 'node_modules'))).toBe(false)
  })

  it('does not overwrite an existing worktree node_modules', async () => {
    const origin = tmpDir('foundry-origin-')
    const wt = tmpDir('foundry-wt-')
    fs.mkdirSync(path.join(origin, 'node_modules'))
    fs.mkdirSync(path.join(wt, 'node_modules'))
    const exec = lsFilesAnd('package.json')
    const checkout = lending(origin, wt, 'node_modules')

    const linked = await provisionDependencies(checkout, deps({ exec: exec as never }))

    expect(linked).toEqual([])
    expect(fs.lstatSync(path.join(wt, 'node_modules')).isSymbolicLink()).toBe(false)
  })
}

function checkIgnoreTests() {
  it('removes the link when git check-ignore says the path is not ignored', async () => {
    const origin = tmpDir('foundry-origin-')
    const wt = tmpDir('foundry-wt-')
    fs.mkdirSync(path.join(origin, 'node_modules'))
    const exec = vi.fn(async (options: { args: string[] }) => {
      if (options.args[0] === 'ls-files')
        return { exitCode: 0, stdout: 'package.json\0', stderr: '', timedOut: false }
      if (options.args[0] === 'check-ignore')
        return { exitCode: 1, stdout: '', stderr: '', timedOut: false }
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
    })
    const checkout = lending(origin, wt, 'node_modules')

    const linked = await provisionDependencies(checkout, deps({ exec: exec as never }))

    expect(linked).toEqual([])
    expect(fs.existsSync(path.join(wt, 'node_modules'))).toBe(false)
  })
}

function reusedCheckoutsTests() {
  it('provisions a reused checkout as well as a freshly created one', async () => {
    const origin = tmpDir('foundry-origin-')
    const root = tmpDir('foundry-root-')
    fs.mkdirSync(path.join(origin, 'node_modules'))

    const base = order()
    const ord: WorkOrder = {
      ...base,
      context: {
        ...base.context,
        repos: [{ ...base.context.repos[0], path: origin }],
        environment: { ...base.context.environment, share: ['node_modules'] },
      },
    }
    const target = checkoutPath(root, ord, 'app')
    fs.mkdirSync(target, { recursive: true })

    const exec = vi.fn(async (options: { args: string[] }) => {
      if (options.args[0] === 'worktree' && options.args[1] === 'list')
        return { exitCode: 0, stdout: `worktree ${target}\n`, stderr: '', timedOut: false }
      if (options.args[0] === 'ls-files')
        return { exitCode: 0, stdout: 'package.json\0', stderr: '', timedOut: false }
      if (options.args[0] === 'check-ignore')
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
    })

    const checkout = await ensureCheckout(ord, 1, deps({ exec: exec as never, root }))

    expect(checkout.created).toBe(false)
    expect(fs.lstatSync(path.join(target, 'node_modules')).isSymbolicLink()).toBe(true)
  })
}

describe('a checkout of the base branch', () => {
  describe('adding and reusing', addingAndReusingTests)
  describe('base failures', baseFailuresTests)
  describe('removing it', removingItTests)
})

function addingAndReusingTests() {
  it('adds a detached worktree of the base beside the lane checkout', async () => {
    const d = deps()
    const checkout = await ensureBaselineCheckout(order(), 1, d)

    expect(calls(d.exec).find((c) => c.args[1] === 'add')).toMatchObject({
      cwd: '/repos/app',
      args: ['worktree', 'add', '--lock', '--detach', baseTarget, 'main'],
    })
    expect(checkout).toMatchObject({ path: baseTarget, branch: 'main', created: true })
    expect(checkout.path).not.toBe(checkoutPath(ROOT, order(), 'app'))
  })

  it('reuses the one git already has', async () => {
    const root = tmpDir('foundry-reuse-base-')
    const existing = `${checkoutPath(root, order(), 'app')}@baseline`
    fs.mkdirSync(existing, { recursive: true })
    const exec = vi.fn(async (options: { args: string[] }) => ({
      exitCode: 0,
      stdout: options.args[1] === 'list' ? `worktree ${existing}\nHEAD abc\n` : '',
      stderr: '',
      timedOut: false,
    }))
    const checkout = await ensureBaselineCheckout(order(), 1, deps({ exec: exec as never, root }))

    expect(checkout.created).toBe(false)
    expect(calls(exec).some((c) => c.args[1] === 'add')).toBe(false)
  })
}

function baseFailuresTests() {
  it('says which repository failed, and why', async () => {
    const exec = vi.fn(async (options: { args: string[] }) => ({
      exitCode: options.args[1] === 'add' ? 128 : 0,
      stdout: '',
      stderr: options.args[1] === 'add' ? 'invalid reference: main' : '',
      timedOut: false,
    }))
    await expect(ensureBaselineCheckout(order(), 1, deps({ exec: exec as never }))).rejects.toThrow(
      /app.*invalid reference: main/
    )
  })

  it('refuses a lane the order does not have', async () => {
    await expect(ensureBaselineCheckout(order(), 9, deps())).rejects.toBeInstanceOf(
      CheckoutFailedError
    )
  })
}

function removingItTests() {
  it('unlocks and removes it, never prunes, and never throws at a caller that is cleaning up', async () => {
    const d = deps()
    const checkout = await ensureBaselineCheckout(order(), 1, d)
    d.exec.mockClear()

    await removeBaseCheckout(checkout, d)
    expect(calls(d.exec).map((c) => c.args)).toEqual([
      ['worktree', 'unlock', baseTarget],
      ['worktree', 'remove', '--force', baseTarget],
    ])

    const failing = deps({
      exec: vi.fn(async () => {
        throw new Error('git is gone')
      }) as never,
    })
    await expect(removeBaseCheckout(checkout, failing)).resolves.toBeUndefined()
  })
}
