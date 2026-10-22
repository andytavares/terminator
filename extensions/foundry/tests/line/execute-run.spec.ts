/**
 * An agreed order run to its tail through `activate`: real checkouts of a real
 * repository with a real remote, agents that answer the way the supervised
 * runner does, and `gh` answering as GitHub would.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { fakeHost, temporaryDirectory, execSucceeded } from '../helpers/foundry-host.js'
import { activateFoundry, deactivate } from '../helpers/foundry-activation.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { agentsAnswer, agreedLineOrder, checks, repositoryWithRemote } from '../helpers/line-run.js'
import { createOrderStore } from '../../src/order/store.js'
import { createGateStore } from '../../src/gates/store.js'
import { checkoutPath } from '../../src/line/worktree.js'
import { failingOnBaseOf } from '../../src/line/execute-run.js'
import type { Recipe } from '../../src/recipe/parse.js'
import { writeBaseline } from '../../src/line/baseline.js'
import type { Baseline } from '../../src/line/baseline.js'
import { orderDir } from '../../src/data-root.js'
import { partialFake } from '../../../../tests/support/fakes'
import { orderStoreAt, readGraph } from '../../src/state/live-index.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { theRunner } from '../helpers/supervision-mocks.js'
import { ledgerActions } from '../helpers/order-ledger.js'

// These cases drive real git and give each step up to 20 s (the vi.waitFor
// calls below); the 5 s default case timeout cut them off first on a busy machine.
vi.setConfig({ testTimeout: 45_000 })

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))
vi.mock('../../src/runtime/control-server.js', () => import('../helpers/supervision-mocks.js'))

const PULL = 'https://github.com/owner/app/pull/7'

let dataDir = ''
let repo = ''
let transcripts = ''
let host: FoundryHost

beforeAll(async () => {
  const parent = temporaryDirectory('fdry-execute')
  vi.stubEnv('HOME', path.join(parent, 'home'))
  host = fakeHost(() => dataDir)
  await activateFoundry(host)
})

afterAll(async () => {
  deactivate()
  vi.unstubAllEnvs()
})

/** GitHub with no pull request open yet, reporting `checksFor()` for the draft. */
function githubWithOneDraft(checksFor: () => string): void {
  host.gh.mockImplementation(async ({ args }: { args: string[] }) => {
    const verb = `${args[0]} ${args[1]}`
    if (verb === 'pr list') return execSucceeded('[]')
    if (verb === 'pr create') return execSucceeded(`${PULL}\n`)
    if (verb === 'pr checks') return execSucceeded(checksFor())
    return execSucceeded('')
  })
}

async function startOrderRun(saved: WorkOrder, recipe = 'direct'): Promise<void> {
  await orderStoreAt(dataDir).save(saved)
  expect(await host.call('foundry:run.start', { id: saved.id, recipe })).toMatchObject({
    started: true,
  })
}

async function untilShipped(): Promise<void> {
  await vi.waitFor(
    async () => expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('shipped'),
    { timeout: 20_000, interval: 100 }
  )
}

async function gateIdFor(rule: string): Promise<string> {
  const gate = (await createGateStore(dataDir).list()).find((g) => g.rule === rule)
  if (gate === undefined) throw new Error(`no ${rule} gate`)
  return gate.id
}

beforeEach(async () => {
  const parent = temporaryDirectory('fdry-execute-order')
  dataDir = path.join(parent, 'records')
  repo = await repositoryWithRemote(parent)
  theRunner.runCommand.mockReset().mockResolvedValue(0)
  theRunner.start.mockClear()
  host.gh.mockClear()
  vi.mocked(host.issues.supportsTransitions).mockReturnValue(false)
  transcripts = parent
  agentsAnswer(theRunner, parent)
})

function failingBaseline(commit: string): Baseline {
  const step = { rung: 'L0' as const, exitCode: 0, command: 'npm run lint', reason: '' }
  return {
    state: 'failing',
    startedAt: '2026-09-06T10:00:00.000Z',
    finishedAt: '2026-09-06T10:01:00.000Z',
    baseBranch: 'main',
    commit,
    steps: [
      { ...step, name: 'Lint', result: 'pass' },
      { ...step, rung: 'L1', name: 'Tests', result: 'fail', exitCode: 1 },
    ],
    logs: {},
    mended: false,
  }
}

describe('an agreed order whose checks pass', () => {
  it('opens a draft, watches CI to green, asks whether it is ready, and is shipped', async () => {
    githubWithOneDraft(() => checks('pass'))
    await startOrderRun(agreedLineOrder(repo))
    await untilShipped()
    expect(await ledgerActions(dataDir)).toEqual(
      expect.arrayContaining(['run.complete', 'ship.draft_opened'])
    )
    expect(await gateIdFor('ready-for-review')).toBeTruthy()
  })
})

function baseTip(): string {
  return execFileSync('git', ['rev-parse', 'main'], { cwd: repo, encoding: 'utf8' }).trim()
}

async function draftBodyAfterRun(recipe: string, commit: string): Promise<string> {
  githubWithOneDraft(() => checks('pass'))
  await writeBaseline(dataDir, 'WO-1', failingBaseline(commit))
  await startOrderRun(agreedLineOrder(repo), recipe)
  await untilShipped()
  return fs.readFileSync(path.join(orderDir(dataDir, 'WO-1'), 'pull-request-lane-1.md'), 'utf8')
}

describe('an order whose base branch was already failing', () => {
  it('says in the draft body which checks failed on the base before the change', async () => {
    const body = await draftBodyAfterRun('direct', baseTip())
    expect(body).toContain('- **Tests**: fails on main before this change.')
    expect(body).not.toContain('**Lint**: fails on')
  })

  it('leaves the failing tests out for a bugfix, where they are the bug', async () => {
    await writeBaseline(dataDir, 'WO-1', failingBaseline(baseTip()))
    const exec = async () => ({
      exitCode: 0,
      stdout: `${baseTip()}\n`,
      stderr: '',
      timedOut: false,
    })
    const run = { root: dataDir, order: agreedLineOrder(repo), exec }
    expect(
      await failingOnBaseOf({ ...run, recipe: partialFake<Recipe>({ id: 'direct' }) })
    ).toEqual(['Tests'])
    expect(
      await failingOnBaseOf({ ...run, recipe: partialFake<Recipe>({ id: 'bugfix' }) })
    ).toEqual([])
  })

  it('lists nothing when the base branch has moved since the baseline was taken', async () => {
    const body = await draftBodyAfterRun('direct', 'a'.repeat(40))
    expect(body).not.toContain('fails on main before this change')
  })
})

describe('an order taken from a tracker issue', () => {
  it('moves the issue to in progress when work starts and to in review when the draft opens', async () => {
    githubWithOneDraft(() => checks('pass'))
    vi.mocked(host.issues.supportsTransitions).mockReturnValue(true)
    vi.mocked(host.issues.transition).mockClear()
    await startOrderRun(
      agreedLineOrder(repo, {
        source: { kind: 'tracker', tracker: 'linear', key: 'ENG-1', url: null },
        writeBack: ['status'],
      })
    )
    await untilShipped()
    expect(vi.mocked(host.issues.transition).mock.calls.map((call) => call[2])).toEqual([
      'started',
      'in_review',
    ])
  })
})

describe('an order whose CI goes red', () => {
  it('sends the failure back to the builder and ships once the fix is green', async () => {
    let round = 0
    githubWithOneDraft(() => (++round === 1 ? checks('fail', 11) : checks('pass', 12)))
    await startOrderRun(agreedLineOrder(repo))
    await untilShipped()
    const builders = theRunner.start.mock.calls.filter(
      (call) => (call[0] as { phase: string }).phase === 'builder'
    )
    expect(builders.length).toBe(2)
  })
})

/** Build, then ship, with one automatic CI round: the least a recipe can be and still open a draft
 * whose CI is watched. Kept in the records location, the rung that wins over the built-ins. */
const BUILD_AND_SHIP = `schemaVersion: 1
id: build-and-ship
ci:
  rounds: 1
steps:
  - id: build
    kind: fanout
    over: plan.units by lane
    step: { kind: agent, role: builder }
  - id: integrate
    kind: join
    order: lane.ord
    after: [build]
  - id: ship
    kind: gate
    rule: ready-for-review
    options: [mark_ready, hold]
    defaultIfIgnored: hold
    after: [integrate]
`

function buildAndShip(): string {
  fs.mkdirSync(path.join(dataDir, 'recipes'), { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'recipes', 'build-and-ship.yaml'), BUILD_AND_SHIP)
  return 'build-and-ship'
}

describe('answering the inbox after a run shipped', () => {
  describe('marking ready', markingReadyTests)
  describe('red CI sent back', redCiSentBackTests)
})

function markingReadyTests() {
  it('marks the drafts ready for review when the operator says so', async () => {
    githubWithOneDraft(() => checks('pass'))
    await startOrderRun(agreedLineOrder(repo))
    await untilShipped()
    const decided = await host.call('foundry:inbox.decide', {
      gateId: await gateIdFor('ready-for-review'),
      option: 'mark_ready',
    })
    expect(decided).toMatchObject({ ok: true })
    expect(host.gh).toHaveBeenCalledWith(expect.objectContaining({ args: ['pr', 'ready', PULL] }))
  })
}

function redCiSentBackTests() {
  it('runs one more CI round on the open drafts when red CI is sent back, and asks again once it is green', async () => {
    // Each step and automatic round before the question is a round of agents over real git;
    // on the built-in recipe (inspector, scribe, two automatic rounds) this ran past 5 s.
    const recipe = buildAndShip()
    // A fresh failing run for every pushed fix, the way CI reports one.
    let run = 20
    githubWithOneDraft(() => checks('fail', ++run))
    await startOrderRun(agreedLineOrder(repo), recipe)
    await vi.waitFor(async () => expect(await gateIdFor('ci.red')).toBeTruthy(), {
      timeout: 20_000,
      interval: 100,
    })

    githubWithOneDraft(() => checks('pass', 99))
    await host.call('foundry:inbox.decide', {
      gateId: await gateIdFor('ci.red'),
      option: 'send_back',
    })
    await vi.waitFor(async () => expect(await gateIdFor('ready-for-review')).toBeTruthy(), {
      timeout: 20_000,
      interval: 100,
    })
  })
}

describe('an order whose check keeps failing', () => {
  it('does not ship, and says on the ledger why not', async () => {
    githubWithOneDraft(() => '[]')
    theRunner.runCommand.mockResolvedValue(1)
    await startOrderRun(agreedLineOrder(repo))
    await vi.waitFor(
      async () =>
        expect(await ledgerActions(dataDir)).toEqual(expect.arrayContaining(['run.halted'])),
      { timeout: 20_000, interval: 100 }
    )
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('running')
    await expect(gateIdFor('ready-for-review')).rejects.toThrow()
  })
})

async function untilHalted(): Promise<void> {
  githubWithOneDraft(() => '[]')
  theRunner.runCommand.mockResolvedValue(1)
  await startOrderRun(agreedLineOrder(repo))
  await vi.waitFor(
    async () =>
      expect(await ledgerActions(dataDir)).toEqual(expect.arrayContaining(['run.halted'])),
    { timeout: 20_000, interval: 100 }
  )
}

describe('the run’s own channels', () => {
  describe('agent transcripts', agentTranscriptsTests)
  describe('starting over and stopping', startingOverAndStoppingTests)
})

function agentTranscriptsTests() {
  it('show what each agent has been doing, from its transcript', async () => {
    await untilHalted()
    const graph = await readGraph(dataDir, 'WO-1')
    const builder = graph?.nodes.find((node) => node.role === 'builder')
    fs.writeFileSync(
      path.join(transcripts, `${builder?.sessionId}.jsonl`),
      `${JSON.stringify({
        type: 'assistant',
        timestamp: '2026-10-12T10:05:00.000Z',
        message: {
          content: [{ type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: 'red.css' } }],
        },
      })}\n`
    )
    const read = (await host.call('foundry:run.activity', { id: 'WO-1' })) as {
      activity: Record<string, Array<{ toolName: string; path: string | null }>>
    }
    expect(read.activity[builder?.id ?? '']).toEqual([
      expect.objectContaining({ toolName: 'Read', path: 'red.css' }),
    ])
  })
}

function startingOverAndStoppingTests() {
  it('start an order over: its checkout is gone and it can be run again from the start', async () => {
    await untilHalted()
    const reset = (await host.call('foundry:run.reset', { id: 'WO-1' })) as {
      ok: boolean
      removed: string[]
    }
    expect(reset.ok).toBe(true)
    expect(reset.removed.length).toBeGreaterThan(0)
    expect(fs.existsSync(checkoutPath(dataDir, agreedLineOrder(repo), 'app'))).toBe(false)
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('agreed')
    expect(await ledgerActions(dataDir)).toContain('run.reset')
  })

  it('stop the whole order', async () => {
    await untilHalted()
    expect(await host.call('foundry:run.stop', { id: 'WO-1' })).toEqual({ ok: true })
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('cancelled')
    expect(await ledgerActions(dataDir)).toContain('run.stopped')
  })

  it('refuse to start over an order that does not exist', async () => {
    expect(await host.call('foundry:run.reset', { id: 'WO-9' })).toEqual({
      error: 'No order WO-9.',
    })
  })
}
