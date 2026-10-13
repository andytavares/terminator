/**
 * An agreed order run to its tail through `activate`: real checkouts of a real
 * repository with a real remote, agents that answer the way the supervised
 * runner does, and `gh` answering as GitHub would.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { activateFoundry, fakeHost, temporaryDirectory } from '../helpers/foundry-host.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { agentsAnswer, agreedOrder, checks, repositoryWithRemote } from '../helpers/line-run.js'
import { createOrderStore } from '../../src/order/store.js'
import { createGateStore } from '../../src/gates/store.js'
import { checkoutPath } from '../../src/line/worktree.js'
import { readGraph } from '../../src/state/live-index.js'
import type { WorkOrder } from '../../src/order/schema.js'

// These cases drive real git and give each step up to 20 s (the vi.waitFor
// calls below); the 5 s default case timeout cut them off first on a busy machine.
vi.setConfig({ testTimeout: 45_000 })

const runner = vi.hoisted(() => ({ current: null as unknown }))

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
  const { deactivate } = await import('../../src/index.ts')
  deactivate()
  vi.unstubAllEnvs()
})

/** GitHub with no pull request open yet, reporting `checksFor()` for the draft. */
function githubAnswers(checksFor: () => string): void {
  host.gh.mockImplementation(async ({ args }: { args: string[] }) => {
    const answer = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', timedOut: false })
    const verb = `${args[0]} ${args[1]}`
    if (verb === 'pr list') return answer('[]')
    if (verb === 'pr create') return answer(`${PULL}\n`)
    if (verb === 'pr checks') return answer(checksFor())
    return answer('')
  })
}

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  return agreedOrder(repo, over)
}

async function ledger(): Promise<string[]> {
  return (await createOrderStore(dataDir).entries('WO-1')).map((entry) => entry.action)
}

async function started(saved: WorkOrder, recipe = 'direct'): Promise<void> {
  await createOrderStore(dataDir).save(saved)
  expect(await host.call('foundry:run.start', { id: saved.id, recipe })).toMatchObject({
    started: true,
  })
}

async function shipped(): Promise<void> {
  await vi.waitFor(
    async () => expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('shipped'),
    { timeout: 20_000, interval: 100 }
  )
}

async function gateFor(rule: string): Promise<string> {
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

describe('an agreed order whose checks pass', () => {
  it('opens a draft, watches CI to green, asks whether it is ready, and is shipped', async () => {
    githubAnswers(() => checks('pass'))
    await started(order())
    await shipped()
    expect(await ledger()).toEqual(expect.arrayContaining(['run.complete', 'ship.draft_opened']))
    expect(await gateFor('ready-for-review')).toBeTruthy()
  })
})

describe('an order taken from a tracker issue', () => {
  it('moves the issue to in progress when work starts and to in review when the draft opens', async () => {
    githubAnswers(() => checks('pass'))
    vi.mocked(host.issues.supportsTransitions).mockReturnValue(true)
    vi.mocked(host.issues.transition).mockClear()
    await started(
      order({
        source: { kind: 'tracker', tracker: 'linear', key: 'ENG-1', url: null },
        writeBack: ['status'],
      })
    )
    await shipped()
    expect(vi.mocked(host.issues.transition).mock.calls.map((call) => call[2])).toEqual([
      'started',
      'in_review',
    ])
  })
})

describe('an order whose CI goes red', () => {
  it('sends the failure back to the builder and ships once the fix is green', async () => {
    let round = 0
    githubAnswers(() => (++round === 1 ? checks('fail', 11) : checks('pass', 12)))
    await started(order())
    await shipped()
    const builders = theRunner.start.mock.calls.filter(
      (call) => (call[0] as unknown as { phase: string }).phase === 'builder'
    )
    expect(builders.length).toBe(2)
  })
})

/**
 * Build, then ship, with one automatic CI round: the least a recipe can be
 * and still open a draft whose CI is watched. Kept in the records location,
 * the rung that wins over the built-ins.
 */
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
    githubAnswers(() => checks('pass'))
    await started(order())
    await shipped()
    const decided = await host.call('foundry:inbox.decide', {
      gateId: await gateFor('ready-for-review'),
      option: 'mark_ready',
    })
    expect(decided).toMatchObject({ ok: true })
    expect(host.gh).toHaveBeenCalledWith(expect.objectContaining({ args: ['pr', 'ready', PULL] }))
  })
}

function redCiSentBackTests() {
  it('runs one more CI round on the open drafts when red CI is sent back, and asks again once it is green', async () => {
    // Every step and every automatic round before the question is a whole
    // round of agents over real git, and none of them is what this asks about.
    // On the built-in recipe, with its inspector, scribe and two automatic
    // rounds, this ran past five seconds under load.
    const recipe = buildAndShip()
    // A fresh failing run for every pushed fix, the way CI reports one.
    let run = 20
    githubAnswers(() => checks('fail', ++run))
    await started(order(), recipe)
    await vi.waitFor(async () => expect(await gateFor('ci.red')).toBeTruthy(), {
      timeout: 20_000,
      interval: 100,
    })

    githubAnswers(() => checks('pass', 99))
    await host.call('foundry:inbox.decide', {
      gateId: await gateFor('ci.red'),
      option: 'send_back',
    })
    await vi.waitFor(async () => expect(await gateFor('ready-for-review')).toBeTruthy(), {
      timeout: 20_000,
      interval: 100,
    })
  })
}

describe('an order whose check keeps failing', () => {
  it('does not ship, and says on the ledger why not', async () => {
    githubAnswers(() => '[]')
    theRunner.runCommand.mockResolvedValue(1)
    await started(order())
    await vi.waitFor(
      async () => expect(await ledger()).toEqual(expect.arrayContaining(['run.halted'])),
      { timeout: 20_000, interval: 100 }
    )
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('running')
    await expect(gateFor('ready-for-review')).rejects.toThrow()
  })
})

async function halted(): Promise<void> {
  githubAnswers(() => '[]')
  theRunner.runCommand.mockResolvedValue(1)
  await started(order())
  await vi.waitFor(
    async () => expect(await ledger()).toEqual(expect.arrayContaining(['run.halted'])),
    { timeout: 20_000, interval: 100 }
  )
}

describe('the run’s own channels', () => {
  describe('agent transcripts', agentTranscriptsTests)
  describe('starting over and stopping', startingOverAndStoppingTests)
})

function agentTranscriptsTests() {
  it('show what each agent has been doing, from its transcript', async () => {
    await halted()
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
    await halted()
    const reset = (await host.call('foundry:run.reset', { id: 'WO-1' })) as {
      ok: boolean
      removed: string[]
    }
    expect(reset.ok).toBe(true)
    expect(reset.removed.length).toBeGreaterThan(0)
    expect(fs.existsSync(checkoutPath(dataDir, order(), 'app'))).toBe(false)
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('agreed')
    expect(await ledger()).toContain('run.reset')
  })

  it('stop the whole order', async () => {
    await halted()
    expect(await host.call('foundry:run.stop', { id: 'WO-1' })).toEqual({ ok: true })
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('cancelled')
    expect(await ledger()).toContain('run.stopped')
  })

  it('refuse to start over an order that does not exist', async () => {
    expect(await host.call('foundry:run.reset', { id: 'WO-9' })).toEqual({
      error: 'No order WO-9.',
    })
  })
}
