/**
 * The refinery's minute tick, through `activate`: an order's pull merges, and
 * the order queued behind it on the same files is rebased and checked again —
 * or, when it no longer rebases, put in front of the operator.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { activateFoundry, fakeHost, realGit, temporaryDirectory } from '../helpers/foundry-host.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { agentsAnswer, agreedOrder, checks, repositoryWithRemote } from '../helpers/line-run.js'
import { createOrderStore } from '../../src/order/store.js'
import { createGateStore } from '../../src/gates/store.js'
import { writeObservedFiles } from '../../src/line/observed-files.js'
import { checkoutPath } from '../../src/line/worktree.js'

const userData = vi.hoisted(() => ({ path: '' }))
const runner = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('electron', () => ({ app: { getPath: () => userData.path } }))
vi.mock('../../src/runtime/supervised-runner.js', () => ({
  createSupervisedRunner: () => runner.current,
}))
vi.mock('../../src/runtime/control-server.js', async () => {
  const { quietControlServer } = await import('../helpers/foundry-host.js')
  return { createControlServer: async () => quietControlServer() }
})

const { fakeRunner } = await import('../helpers/foundry-host.js')
const theRunner = fakeRunner()
runner.current = theRunner

const pullOf = (orderId: string): string =>
  `https://github.com/owner/app/pull/${orderId.replace('WO-', '')}`

let dataDir = ''
let repo = ''
let host: FoundryHost
const merged = new Set<string>()

beforeAll(async () => {
  const parent = temporaryDirectory('fdry-refinery')
  userData.path = path.join(parent, 'user-data')
  vi.stubEnv('HOME', path.join(parent, 'home'))
  host = fakeHost(() => dataDir)
  // Only the minute ticks are held; every agent and git call runs on real time.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  await activateFoundry(host)
})

afterAll(async () => {
  const { deactivate } = await import('../../src/index.ts')
  deactivate()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

/** GitHub: one draft per order's branch, green checks, and merged once `merged` says so. */
function githubAnswers(): void {
  let run = 0
  host.gh.mockImplementation(async ({ args }: { args: string[] }) => {
    const answer = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', timedOut: false })
    const verb = `${args[0]} ${args[1]}`
    if (verb === 'pr list') return answer('[]')
    if (verb === 'pr create') {
      const head = args[args.indexOf('--head') + 1]
      return answer(`${pullOf(head.replace('foundry/wo-', 'WO-'))}\n`)
    }
    if (verb === 'pr checks') return answer(checks('pass', ++run))
    if (verb === 'pr view') {
      return answer(JSON.stringify({ state: merged.has(args[2]) ? 'MERGED' : 'OPEN' }))
    }
    return answer('')
  })
}

async function shipBoth(): Promise<void> {
  const store = createOrderStore(dataDir)
  await store.save(agreedOrder(repo, { id: 'WO-1', agreedAt: '2026-10-12T10:01:00.000Z' }))
  await store.save(agreedOrder(repo, { id: 'WO-2', agreedAt: '2026-10-12T10:02:00.000Z' }))
  for (const id of ['WO-1', 'WO-2']) {
    await host.call('foundry:run.start', { id, recipe: 'direct' })
    await vi.waitFor(async () => expect((await store.load(id))?.status).toBe('shipped'), {
      timeout: 20_000,
      interval: 100,
    })
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

async function ledgerOf(id: string): Promise<string[]> {
  return (await createOrderStore(dataDir).entries(id)).map((entry) => entry.action)
}

beforeEach(async () => {
  const parent = temporaryDirectory('fdry-refinery-order')
  dataDir = path.join(parent, 'records')
  repo = await repositoryWithRemote(parent)
  merged.clear()
  theRunner.runCommand.mockReset().mockResolvedValue(0)
  agentsAnswer(theRunner, parent)
  githubAnswers()
})

describe('a minute after an order merged', () => {
  it('rebases the order queued behind it on the same files and checks it again', async () => {
    await shipBoth()
    await mergeFirst()
    host.gh.mockClear()

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(async () => expect(await ledgerOf('WO-2')).toContain('refinery.rebased'), {
      timeout: 20_000,
      interval: 100,
    })
    expect(await ledgerOf('WO-1')).toContain('refinery.merged')
    // The rebased branch is the one on the remote, and CI was asked about it again.
    await vi.waitFor(() =>
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

  it('puts an order that no longer rebases in front of the operator', async () => {
    await shipBoth()
    // main moves under WO-2's own file with different contents.
    const clash = path.join(checkoutPath(dataDir, agreedOrder(repo, { id: 'WO-1' }), 'app'))
    fs.writeFileSync(path.join(clash, 'wo-2.css'), 'a { color: blue }\n')
    await realGit({ command: 'git', args: ['add', '-A'], cwd: clash })
    await realGit({ command: 'git', args: ['commit', '-q', '-m', 'blue'], cwd: clash })
    await mergeFirst()

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(async () => expect(await ledgerOf('WO-2')).toContain('refinery.conflict'), {
      timeout: 20_000,
      interval: 100,
    })
    const gates = await createGateStore(dataDir).list()
    expect(gates.find((gate) => gate.rule === 'refinery.conflict')).toMatchObject({
      orderId: 'WO-2',
      evidence: [{ kind: 'diff', path: 'wo-2.css' }],
    })
  })

  it('moves the merged order’s issue to done', async () => {
    vi.mocked(host.issues.supportsTransitions).mockReturnValue(true)
    try {
      const store = createOrderStore(dataDir)
      await store.save(
        agreedOrder(repo, {
          id: 'WO-1',
          source: { kind: 'tracker', tracker: 'linear', key: 'ENG-1', url: null },
          writeBack: ['status'],
        })
      )
      await host.call('foundry:run.start', { id: 'WO-1', recipe: 'direct' })
      await vi.waitFor(async () => expect((await store.load('WO-1'))?.status).toBe('shipped'), {
        timeout: 20_000,
        interval: 100,
      })
      vi.mocked(host.issues.transition).mockClear()
      await mergeFirst()

      await vi.advanceTimersByTimeAsync(60_000)
      await vi.waitFor(() =>
        expect(host.issues.transition).toHaveBeenCalledWith('linear', 'ENG-1', 'done', undefined)
      )
    } finally {
      vi.mocked(host.issues.supportsTransitions).mockReturnValue(false)
    }
  })
})
