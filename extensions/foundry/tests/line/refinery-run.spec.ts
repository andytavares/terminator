/**
 * The refinery's minute tick, through `activate`: an order's pull merges, and
 * the order queued behind it on the same files is rebased and checked again —
 * or, when it no longer rebases, put in front of the operator.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { fakeHost, realGit, temporaryDirectory, execSucceeded } from '../helpers/foundry-host.js'
import { activateFoundry, deactivate } from '../helpers/foundry-activation.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { agentsAnswer, agreedLineOrder, checks, repositoryWithRemote } from '../helpers/line-run.js'
import { createOrderStore } from '../../src/order/store.js'
import { createGateStore } from '../../src/gates/store.js'
import { writeObservedFiles } from '../../src/line/observed-files.js'
import { checkoutPath } from '../../src/line/worktree.js'
import { theRunner } from '../helpers/supervision-mocks.js'
import { ledgerActions } from '../helpers/order-ledger.js'
import { eventually } from '../../../../tests/support/eventually'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))

const pullOf = (orderId: string): string =>
  `https://github.com/owner/app/pull/${orderId.replace('WO-', '')}`

let dataDir = ''
let repo = ''
let host: FoundryHost
const merged = new Set<string>()

afterEach(async () => {
  await deactivate()
})

/** GitHub: one draft per order's branch, green checks, and merged once `merged` says so. */
function githubWithADraftPerOrder(): void {
  let run = 0
  host.gh.mockImplementation(async ({ args, cwd }: { args: string[]; cwd: string }) => {
    const verb = `${args[0]} ${args[1]}`
    if (verb === 'pr update-branch') return updateBranch(cwd, args[2])
    if (verb === 'pr list') return execSucceeded('[]')
    if (verb === 'pr create') {
      const head = args[args.indexOf('--head') + 1]
      return execSucceeded(`${pullOf(head.replace('foundry/wo-', 'WO-'))}\n`)
    }
    if (verb === 'pr checks') return execSucceeded(checks('pass', ++run))
    if (verb === 'pr view') {
      return execSucceeded(JSON.stringify({ state: merged.has(args[2]) ? 'MERGED' : 'OPEN' }))
    }
    return execSucceeded('')
  })
}

/** What `gh pr update-branch --rebase` does on GitHub, done with real git in the lane checkout. */
async function updateBranch(cwd: string, branch: string) {
  const git = (args: string[]) => realGit({ command: 'git', args, cwd })
  await git(['fetch', '-q', 'origin', 'main'])
  const rebase = await git(['rebase', 'origin/main'])
  if (rebase.exitCode !== 0) {
    await git(['rebase', '--abort'])
    return rebase
  }
  return git(['push', '-q', '--force-with-lease', 'origin', `HEAD:${branch}`])
}

async function shipBoth(): Promise<void> {
  const store = createOrderStore(dataDir)
  await store.save(agreedLineOrder(repo, { id: 'WO-1', agreedAt: '2026-10-12T10:01:00.000Z' }))
  await store.save(agreedLineOrder(repo, { id: 'WO-2', agreedAt: '2026-10-12T10:02:00.000Z' }))
  for (const id of ['WO-1', 'WO-2']) {
    await host.call('foundry:run.start', { id, recipe: 'direct' })
    await eventually(async () => expect((await store.load(id))?.status).toBe('shipped'))
  }
  // Both orders touched the same file, as the queue reads it.
  await writeObservedFiles(dataDir, 'WO-1', ['shared.css'])
  await writeObservedFiles(dataDir, 'WO-2', ['shared.css'])
}

/** WO-1's branch lands on main, the way a merged pull request does. */
async function mergeFirst(): Promise<void> {
  await realGit({ command: 'git', args: ['push', '-q', 'origin', 'foundry/wo-1:main'], cwd: repo })
  merged.add(pullOf('WO-1'))
}

// Each test activates Foundry afresh: the fake clock only lasts one test (tests/setup.ts), and the
// interval the minute ticks run on is made at activation.
beforeEach(async () => {
  const parent = temporaryDirectory('fdry-refinery-order')
  vi.stubEnv('HOME', path.join(parent, 'home'))
  host = fakeHost(() => dataDir)
  // Only the minute ticks are held; every agent and git call runs on real time.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  dataDir = path.join(parent, 'records')
  repo = await repositoryWithRemote(parent)
  merged.clear()
  theRunner.runCommand.mockReset().mockResolvedValue(0)
  agentsAnswer(theRunner, parent)
  githubWithADraftPerOrder()
  await activateFoundry(host)
})

describe('a minute after an order merged', () => {
  describe('rebasing', rebasingTests)
  describe('a failed rebase', aFailedRebaseTests)
  describe('the merged issue', theMergedIssueTests)
})

function rebasingTests() {
  it('rebases the order queued behind it on the same files and checks it again', async () => {
    await shipBoth()
    await mergeFirst()
    host.gh.mockClear()

    await vi.advanceTimersByTimeAsync(60_000)
    await eventually(async () =>
      expect(await ledgerActions(dataDir, 'WO-2')).toContain('refinery.rebased')
    )
    expect(await ledgerActions(dataDir, 'WO-1')).toContain('refinery.merged')
    // The rebased branch is the one on the remote, and CI was asked about it again.
    await eventually(() =>
      expect(host.gh).toHaveBeenCalledWith(
        expect.objectContaining({ args: expect.arrayContaining(['checks', pullOf('WO-2')]) })
      )
    )
    await realGit({ command: 'git', args: ['fetch', '-q', 'origin'], cwd: repo })
    const carriesTheMerge = await realGit({
      command: 'git',
      args: ['cat-file', '-e', 'origin/foundry/wo-2:wo-1.css'],
      cwd: repo,
    })
    expect(carriesTheMerge.exitCode).toBe(0)
  })
}

function aFailedRebaseTests() {
  it('puts an order that no longer rebases in front of the operator', async () => {
    await shipBoth()
    // main moves under WO-2's own file with different contents.
    const clash = path.join(checkoutPath(dataDir, agreedLineOrder(repo, { id: 'WO-1' }), 'app'))
    fs.writeFileSync(path.join(clash, 'wo-2.css'), 'a { color: blue }\n')
    await realGit({ command: 'git', args: ['add', '-A'], cwd: clash })
    await realGit({ command: 'git', args: ['commit', '-q', '-m', 'blue'], cwd: clash })
    await mergeFirst()

    await vi.advanceTimersByTimeAsync(60_000)
    await eventually(async () =>
      expect(await ledgerActions(dataDir, 'WO-2')).toContain('refinery.conflict')
    )
    const gates = await createGateStore(dataDir).list()
    expect(gates.find((gate) => gate.rule === 'refinery.conflict')).toMatchObject({
      orderId: 'WO-2',
      evidence: [],
    })
  })
}

function theMergedIssueTests() {
  it('moves the merged order’s issue to done', async () => {
    vi.mocked(host.issues.supportsTransitions).mockReturnValue(true)
    try {
      const store = createOrderStore(dataDir)
      await store.save(
        agreedLineOrder(repo, {
          id: 'WO-1',
          source: { kind: 'tracker', tracker: 'linear', key: 'ENG-1', url: null },
          writeBack: ['status'],
        })
      )
      await host.call('foundry:run.start', { id: 'WO-1', recipe: 'direct' })
      await eventually(async () => expect((await store.load('WO-1'))?.status).toBe('shipped'))
      vi.mocked(host.issues.transition).mockClear()
      await mergeFirst()

      await vi.advanceTimersByTimeAsync(60_000)
      await eventually(() =>
        expect(host.issues.transition).toHaveBeenCalledWith('linear', 'ENG-1', 'done', undefined)
      )
    } finally {
      vi.mocked(host.issues.supportsTransitions).mockReturnValue(false)
    }
  })
}
