import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import {
  ensureCheckout,
  ensureCheckouts,
  removeCheckout,
  provisionDependencies,
  branchFor,
  checkoutPath,
  CheckoutFailedError,
} from '../../src/line/worktree.js'
import type { CheckoutDeps, Checkout } from '../../src/line/worktree.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

// Somewhere for a lane's work to happen, cut from the lane's own repository
// and living under the data root — never inside the repository, which is the
// one thing Foundry does not write into.

const ROOT = '/data/.foundry'

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/app'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return { ...base, ...over }
}

function deps(over: Partial<CheckoutDeps> = {}): CheckoutDeps & { exec: ReturnType<typeof vi.fn> } {
  const exec = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }))
  return { exec: exec as never, root: ROOT, ...over } as CheckoutDeps & {
    exec: ReturnType<typeof vi.fn>
  }
}

function calls(exec: ReturnType<typeof vi.fn>) {
  return exec.mock.calls.map((c) => c[0] as { command: string; args: string[]; cwd: string })
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
})

describe('preparing a checkout', () => {
  it('adds a worktree on a branch cut from the base', async () => {
    const d = deps()
    const checkout = await ensureCheckout(order(), 1, d)

    const add = calls(d.exec).find((c) => c.args[1] === 'add')
    expect(add?.cwd).toBe('/repos/app')
    expect(add?.args).toEqual([
      'worktree',
      'add',
      '-B',
      'foundry/wo-1',
      path.join(ROOT, 'orders', 'WO-1', 'worktrees', 'app'),
      'main',
    ])
    expect(checkout.created).toBe(true)
  })

  it('resets a branch left over from a previous attempt rather than failing', async () => {
    // `-B`, not `-b`: "already exists" would end a resumed run before it began.
    const d = deps()
    await ensureCheckout(order(), 1, d)
    expect(calls(d.exec).find((c) => c.args[1] === 'add')?.args).toContain('-B')
  })

  it('reuses the worktree git already has, rather than adding a second', async () => {
    const target = path.join(ROOT, 'orders', 'WO-1', 'worktrees', 'app')
    const exec = vi.fn(async (options: { args: string[] }) =>
      options.args[1] === 'list'
        ? { exitCode: 0, stdout: `worktree ${target}\nHEAD abc\n`, stderr: '', timedOut: false }
        : { exitCode: 0, stdout: '', stderr: '', timedOut: false }
    )
    const d = deps({ exec: exec as never })
    const checkout = await ensureCheckout(order(), 1, d)

    expect(checkout.created).toBe(false)
    expect(calls(exec).some((c) => c.args[1] === 'add')).toBe(false)
  })

  it('asks git rather than the filesystem, so a stray directory is not mistaken for one', async () => {
    const d = deps()
    await ensureCheckout(order(), 1, d)
    expect(calls(d.exec)[0].args).toEqual(['worktree', 'list', '--porcelain'])
  })

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
})

describe('preparing every lane', () => {
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
})

describe('taking one away', () => {
  it('removes the worktree from the repository it was cut from', async () => {
    const d = deps()
    const checkout = await ensureCheckout(order(), 1, d)
    d.exec.mockClear()

    expect(await removeCheckout(checkout, d)).toBe(true)
    expect(calls(d.exec)[0]).toMatchObject({
      cwd: '/repos/app',
      args: ['worktree', 'remove', '--force', checkout.path],
    })
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

describe('provisioning dependencies', () => {
  const scratch: string[] = []

  function tmpDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    scratch.push(dir)
    return dir
  }

  afterEach(() => {
    while (scratch.length > 0) {
      const dir = scratch.pop()
      if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
    }
  })

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

  it('links the origin root node_modules into the worktree', async () => {
    const origin = tmpDir('foundry-origin-')
    const wt = tmpDir('foundry-wt-')
    fs.mkdirSync(path.join(origin, 'node_modules'))
    const exec = lsFilesAnd('package.json')
    const checkout: Checkout = { repo: 'app', origin, path: wt, branch: 'b', created: true }

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
    const checkout: Checkout = { repo: 'app', origin, path: wt, branch: 'b', created: true }

    const linked = await provisionDependencies(checkout, deps({ exec: exec as never }))

    expect(linked).toEqual(['packages/foo/node_modules'])
    expect(fs.lstatSync(path.join(wt, 'packages', 'foo', 'node_modules')).isSymbolicLink()).toBe(
      true
    )
  })

  it('does not link when the origin has no node_modules', async () => {
    const origin = tmpDir('foundry-origin-')
    const wt = tmpDir('foundry-wt-')
    const exec = lsFilesAnd('package.json')
    const checkout: Checkout = { repo: 'app', origin, path: wt, branch: 'b', created: true }

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
    const checkout: Checkout = { repo: 'app', origin, path: wt, branch: 'b', created: true }

    const linked = await provisionDependencies(checkout, deps({ exec: exec as never }))

    expect(linked).toEqual([])
    expect(fs.lstatSync(path.join(wt, 'node_modules')).isSymbolicLink()).toBe(false)
  })

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
    const checkout: Checkout = { repo: 'app', origin, path: wt, branch: 'b', created: true }

    const linked = await provisionDependencies(checkout, deps({ exec: exec as never }))

    expect(linked).toEqual([])
    expect(fs.existsSync(path.join(wt, 'node_modules'))).toBe(false)
  })

  it('provisions a reused checkout as well as a freshly created one', async () => {
    const origin = tmpDir('foundry-origin-')
    const root = tmpDir('foundry-root-')
    fs.mkdirSync(path.join(origin, 'node_modules'))

    const base = order()
    const ord: WorkOrder = {
      ...base,
      context: { ...base.context, repos: [{ ...base.context.repos[0], path: origin }] },
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
})
