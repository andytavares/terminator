/**
 * Ends a run comes to other than a draft opened ahead of its final check,
 * through `activate`: a research order ends on where its author put the
 * document, and one put outside the checkout opens no pull request; an order
 * whose change turned out riskier waits on the operator before pushing.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { fakeHost, temporaryDirectory } from '../helpers/foundry-host.js'
import { activateFoundry, deactivate } from '../helpers/foundry-activation.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { agentsAnswer, agreedOrder, repositoryWithRemote } from '../helpers/line-run.js'
import { createOrderStore } from '../../src/order/store.js'
import { readGraph } from '../../src/state/live-index.js'
import type { WorkOrder } from '../../src/order/schema.js'

// Real git, and every step given up to 20 s; see execute-run.spec.ts.
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

let dataDir = ''
let repo = ''
let host: FoundryHost

beforeAll(async () => {
  const parent = temporaryDirectory('fdry-document-run')
  vi.stubEnv('HOME', path.join(parent, 'home'))
  host = fakeHost(() => dataDir)
  await activateFoundry(host)
})

afterAll(() => {
  deactivate()
  vi.unstubAllEnvs()
})

beforeEach(async () => {
  const parent = temporaryDirectory('fdry-document-run-order')
  dataDir = path.join(parent, 'records')
  repo = await repositoryWithRemote(parent)
  theRunner.runCommand.mockReset().mockResolvedValue(0)
  host.gh.mockReset().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
  agentsAnswer(theRunner, parent)
})

/**
 * The author's turn: hands `document` back the way an author does, in its
 * step's rung output, or — given none — writes an answer into the checkout
 * and says nothing of where it is.
 */
function authorHandsBack(document: WorkOrder['document']): void {
  const answer = theRunner.start.getMockImplementation()
  theRunner.start.mockImplementation(async (...args: unknown[]) => {
    const input = args[0] as { phase: string; worktreePath: string }
    if (input.phase === 'author' && document === null) {
      fs.writeFileSync(path.join(input.worktreePath, 'answer.md'), '# The answer\n')
    } else if (input.phase === 'author') {
      const rungs = path.join(dataDir, 'orders', 'WO-1', 'rungs')
      fs.mkdirSync(rungs, { recursive: true })
      fs.writeFileSync(path.join(rungs, 'write.json'), JSON.stringify({ document, note: 'done' }))
    }
    return answer?.(...args)
  })
}

/** Starts a research order whose author hands back `document`. */
async function startResearch(document: WorkOrder['document']): Promise<void> {
  authorHandsBack(document)
  await createOrderStore(dataDir).save(agreedOrder(repo))
  expect(await host.call('foundry:run.start', { id: 'WO-1', recipe: 'research' })).toMatchObject({
    started: true,
  })
}

/** The tail's own ledger entry, once the run has reached it. */
async function tailEntry(action: string): Promise<{ reason: string }> {
  return vi.waitFor(
    async () => {
      const entries = await createOrderStore(dataDir).entries('WO-1')
      const found = entries.find((entry) => entry.action === action)
      if (found === undefined) throw new Error(`no ${action} yet`)
      return found
    },
    { timeout: 20_000, interval: 100 }
  )
}

/** The ship node, once the tail has settled it to `state`. */
async function shipSettledTo(state: string): Promise<void> {
  await vi.waitFor(
    async () => {
      const graph = await readGraph(dataDir, 'WO-1')
      expect(graph?.nodes.find((node) => node.stepId === 'ship')?.state).toBe(state)
    },
    { timeout: 20_000, interval: 100 }
  )
}

describe('a research order whose document is outside the checkout', () => {
  it('ends on where the document is, passes its ship node, and opens no pull request', async () => {
    await startResearch({ path: 'answers/why.md', location: 'outputs' })
    expect((await tailEntry('run.document_ready')).reason).toBe('outputs: answers/why.md')
    await shipSettledTo('passed')
    const prCreates = host.gh.mock.calls.filter(([call]) =>
      call.args.join(' ').includes('pr create')
    )
    expect(prCreates).toEqual([])
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).not.toBe('shipped')
  })
})

describe('a research order whose author handed nothing back', () => {
  it('fails, saying so, rather than shipping an empty change', async () => {
    await startResearch(null)
    expect((await tailEntry('run.failed')).reason).toBe('the author handed back no document')
    await shipSettledTo('waiting')
  })
})

describe('an order that turns out to alter a schema', () => {
  // A schema change grades P1 without tripping an inspection, so no draft
  // opens ahead of the final check; the decision to push is the operator's,
  // and is asked once the run is done.
  it('asks before anything is pushed, and pushes nothing yet', async () => {
    const saved = agreedOrder(repo)
    const units = saved.plan.units.map((u) => ({ ...u, touches: ['red.css', 'red.schema.ts'] }))
    await createOrderStore(dataDir).save({ ...saved, plan: { ...saved.plan, units } })
    expect(await host.call('foundry:run.start', { id: 'WO-1', recipe: 'direct' })).toMatchObject({
      started: true,
    })
    expect((await tailEntry('ship.held')).reason).toMatch(
      /^The elevated risk shipping decision is waiting on you, so nothing was pushed yet/
    )
    expect(host.gh).not.toHaveBeenCalled()
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).not.toBe('shipped')
  })
})
