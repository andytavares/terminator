import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { tearDownRun, deleteOrder } from '../../src/line/teardown.js'
import { orderDir } from '../../src/data-root.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

// Taking a run away again.
//
// `removeCheckout` shipped with the feature that cut worktrees, was exported,
// was tested, and was called by nothing. So every run Foundry has ever done
// left its checkout behind, registered in the target repository's
// `.git/worktrees/`, plus its branch — measured on one machine: four prunable
// registrations and four branches for a single ask, retried by hand because
// there was no way to start the same order over.
//
// Everything here is best effort and nothing throws. A teardown that stops on
// the first failure leaves a half-destroyed run, which is worse than one that
// says which parts it could not remove.

let root: string
let repo: string

interface Call {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
}

function recorder(fails: (args: readonly string[]) => boolean = () => false) {
  const calls: Call[] = []
  const exec = async (o: { command: 'git' | 'gh'; args: string[]; cwd: string }) => {
    calls.push({ command: o.command, args: o.args, cwd: o.cwd })
    return fails(o.args)
      ? { exitCode: 1, stdout: '', stderr: 'no such worktree' }
      : { exitCode: 0, stdout: '', stderr: '' }
  }
  return { calls, exec }
}

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [repo],
    now: '2026-09-09T10:00:00.000Z',
  })
  return {
    ...base,
    status: 'running',
    plan: {
      ...base.plan,
      lanes: [
        { ord: 1, repo: path.basename(repo), branch: 'wip', role: null, blocks: [], blockedBy: [] },
      ],
    },
    ...over,
  }
}

/** Everything a run leaves under the order's directory. */
function seedRunArtefacts(id = 'WO-1'): string {
  const dir = orderDir(root, id)
  fs.mkdirSync(path.join(dir, 'rungs'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'worktrees', path.basename(repo)), { recursive: true })
  fs.writeFileSync(path.join(dir, 'run-graph.json'), '{}')
  fs.writeFileSync(path.join(dir, 'gates.json'), '[]')
  fs.writeFileSync(path.join(dir, 'rungs', 'scout.json'), '{}')
  fs.writeFileSync(path.join(dir, 'order.json'), '{}')
  fs.writeFileSync(path.join(dir, 'order.md'), '# x')
  fs.writeFileSync(path.join(dir, 'ledger.jsonl'), '{"a":1}\n')
  return dir
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-teardown-'))
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-teardown-repo-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(repo, { recursive: true, force: true })
})

describe('tearDownRun', () => {
  it('removes the worktree from the repository that owns it, not from the data root', async () => {
    const { calls, exec } = recorder()
    await tearDownRun(order(), { exec, root })
    const remove = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'remove')
    expect(remove?.cwd).toBe(repo)
    expect(remove?.args).toContain('--force')
  })

  // A worktree directory removed without git being told leaves a registration
  // behind, and the next `worktree add` onto that path fails. Pruning is what
  // makes starting over actually work a second time.
  it('prunes the registration afterwards, so the path can be used again', async () => {
    const { calls, exec } = recorder()
    await tearDownRun(order(), { exec, root })
    const order_ = calls.map((c) => c.args.slice(0, 2).join(' '))
    expect(order_.indexOf('worktree prune')).toBeGreaterThan(order_.indexOf('worktree remove'))
  })

  it('deletes the branch the lane was working on', async () => {
    const { calls, exec } = recorder()
    await tearDownRun(order(), { exec, root })
    expect(calls.some((c) => c.args[0] === 'branch' && c.args.includes('wip'))).toBe(true)
  })

  it('takes every lane, not just the first', async () => {
    const second = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-teardown-repo2-'))
    const base = order()
    const two: WorkOrder = {
      ...base,
      context: {
        ...base.context,
        repos: [
          { ...base.context.repos[0], lane: 1 },
          { ...base.context.repos[0], name: path.basename(second), path: second, lane: 2 },
        ],
      },
      plan: {
        ...base.plan,
        lanes: [
          ...base.plan.lanes,
          {
            ord: 2,
            repo: path.basename(second),
            branch: 'wip-2',
            role: null,
            blocks: [],
            blockedBy: [],
          },
        ],
      },
    }
    const { calls, exec } = recorder()
    await tearDownRun(two, { exec, root })
    expect(calls.filter((c) => c.args[0] === 'worktree' && c.args[1] === 'remove')).toHaveLength(2)
    fs.rmSync(second, { recursive: true, force: true })
  })

  it('removes everything the run wrote', async () => {
    const dir = seedRunArtefacts()
    const { exec } = recorder()
    await tearDownRun(order(), { exec, root })
    expect(fs.existsSync(path.join(dir, 'run-graph.json'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'gates.json'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'rungs'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'worktrees'))).toBe(false)
  })

  // The whole point of starting over rather than starting again: the ask, the
  // criteria and the plan are the expensive part and they survive.
  it('keeps the order and its ledger, which is what makes it a restart', async () => {
    const dir = seedRunArtefacts()
    const { exec } = recorder()
    await tearDownRun(order(), { exec, root })
    expect(fs.existsSync(path.join(dir, 'order.json'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'order.md'))).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'ledger.jsonl'), 'utf8')).toBe('{"a":1}\n')
  })

  it('says what it removed, so the record is not a guess', async () => {
    seedRunArtefacts()
    const { exec } = recorder()
    const result = await tearDownRun(order(), { exec, root })
    expect(result.removed.join(' ')).toContain('wip')
    expect(result.failed).toEqual([])
  })

  // Best effort, always. A repository that has already been moved or deleted
  // must not strand the order in `running` forever.
  it('carries on past a git failure and names it rather than throwing', async () => {
    const dir = seedRunArtefacts()
    const { exec } = recorder((args) => args[0] === 'worktree' && args[1] === 'remove')
    const result = await tearDownRun(order(), { exec, root })
    expect(result.failed.join(' ')).toContain('no such worktree')
    // And the records it *could* remove are gone regardless.
    expect(fs.existsSync(path.join(dir, 'run-graph.json'))).toBe(false)
  })

  // git refuses `branch -D` for a branch that is checked out somewhere else,
  // and for one that never existed. Neither is a reason to leave the rest of
  // the run standing.
  it('names a branch git would not delete, and removes the records anyway', async () => {
    const dir = seedRunArtefacts()
    const { exec } = recorder((args) => args[0] === 'branch')
    const result = await tearDownRun(order(), { exec, root })
    expect(result.failed.join(' ')).toContain('the branch wip')
    expect(result.removed.join(' ')).toContain('the run graph')
    expect(fs.existsSync(path.join(dir, 'run-graph.json'))).toBe(false)
  })

  // The records location can be read-only — a data directory on a mounted
  // volume, or one the operator locked. The teardown says which part it could
  // not remove rather than throwing out of the IPC handler.
  it('names a record it could not remove rather than throwing', async () => {
    const dir = seedRunArtefacts()
    fs.chmodSync(dir, 0o500)
    try {
      const { exec } = recorder()
      const result = await tearDownRun(order(), { exec, root })
      expect(result.failed.join(' ')).toContain('the run graph')
    } finally {
      fs.chmodSync(dir, 0o700)
    }
  })

  it('is safe to run twice, because a stopped run is stopped again all the time', async () => {
    const { exec } = recorder()
    await tearDownRun(order(), { exec, root })
    await expect(tearDownRun(order(), { exec, root })).resolves.toBeDefined()
  })

  // A lane whose repository is not in `context.repos` — an order edited after
  // its lanes were planned. There is nothing to remove and nowhere to run git,
  // so it is skipped rather than guessed at.
  it('skips a lane whose repository the order does not carry', async () => {
    const base = order()
    const orphanLane: WorkOrder = {
      ...base,
      plan: {
        ...base.plan,
        lanes: [
          ...base.plan.lanes,
          { ord: 9, repo: 'gone', branch: 'nope', role: null, blocks: [], blockedBy: [] },
        ],
      },
    }
    const { calls, exec } = recorder()
    const result = await tearDownRun(orphanLane, { exec, root })
    expect(calls.filter((c) => c.args.includes('nope'))).toEqual([])
    expect(result.failed.join(' ')).not.toContain('nope')
  })

  it('does nothing to a repository the order does not name', async () => {
    const { calls, exec } = recorder()
    await tearDownRun(order({ plan: { ...order().plan, lanes: [] } }), { exec, root })
    expect(calls.filter((c) => c.args[0] === 'branch')).toEqual([])
  })
})

describe('deleteOrder', () => {
  it('takes the whole directory, ledger included', async () => {
    const dir = seedRunArtefacts()
    const { exec } = recorder()
    await deleteOrder(order(), { exec, root })
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('tears the run down first, so no worktree outlives its order', async () => {
    seedRunArtefacts()
    const { calls, exec } = recorder()
    await deleteOrder(order(), { exec, root })
    expect(calls.some((c) => c.args[0] === 'worktree' && c.args[1] === 'remove')).toBe(true)
    expect(calls.some((c) => c.args[0] === 'branch')).toBe(true)
  })

  it('leaves every other order alone', async () => {
    seedRunArtefacts('WO-1')
    const other = seedRunArtefacts('WO-2')
    const { exec } = recorder()
    await deleteOrder(order(), { exec, root })
    expect(fs.existsSync(other)).toBe(true)
  })

  // `orderDir` refuses an id that would resolve outside the orders directory,
  // and this is the call where that guard is load-bearing rather than tidy.
  it('refuses an id that would remove something outside the records root', async () => {
    const escaping = order({ id: '../../etc' } as Partial<WorkOrder>)
    const { exec } = recorder()
    const result = await deleteOrder(escaping, { exec, root })
    expect(result.failed.join(' ')).toContain('does not name an order')
    expect(fs.existsSync(root)).toBe(true)
  })
})
