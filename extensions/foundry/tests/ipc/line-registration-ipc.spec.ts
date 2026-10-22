/**
 * Two things `activate` joins up for a run that the executor specs never
 * reach: which handed-back agents the observation offers a terminal for, and
 * starting over an order its run left nothing behind for.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { fakeHost, temporaryDirectory } from '../helpers/foundry-host.js'
import { activateFoundry, deactivate } from '../helpers/foundry-activation.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { agentNode } from '../helpers/run-nodes.js'
import { createOrderStore } from '../../src/order/store.js'
import { orderStoreAt } from '../../src/state/live-index.js'
import { draftOrder } from '../../src/order/draft.js'
import { strandedAgents } from '../../src/runtime/runtime-state.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { theRunner } from '../helpers/supervision-mocks.js'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))
vi.mock('../../src/runtime/control-server.js', () => import('../helpers/supervision-mocks.js'))

const AT = '2026-09-06T10:00:00.000Z'

let dataDir = ''
let host: FoundryHost

beforeAll(async () => {
  const outer = temporaryDirectory('fdry-line-reg')
  vi.stubEnv('HOME', path.join(outer, 'home'))
  host = fakeHost(() => dataDir)
  host.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
  await activateFoundry(host)
})

afterAll(async () => {
  await deactivate()
  vi.unstubAllEnvs()
})

beforeEach(() => {
  dataDir = path.join(temporaryDirectory('fdry-line-reg-order'), 'records')
})

afterEach(() => {
  host.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
  strandedAgents.clear()
  theRunner.terminalFor.mockReset().mockReturnValue(null)
})

async function saveTypedOrder(over: Partial<WorkOrder>): Promise<void> {
  await orderStoreAt(dataDir).save({
    ...draftOrder({
      id: 'WO-1',
      title: 'Make the thing work',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/a'],
      now: AT,
    }),
    ...over,
  })
}

describe('agents handed back to their terminals', () => {
  it('are offered for this order only, and only while their terminal is open', async () => {
    await saveTypedOrder({ status: 'running', recipe: 'direct' })
    const graph = {
      orderId: 'WO-1',
      recipe: 'direct',
      nodes: [agentNode('build', { state: 'running', sessionId: 's-open', startedAt: AT })],
    }
    fs.writeFileSync(path.join(dataDir, 'orders', 'WO-1', 'run-graph.json'), JSON.stringify(graph))
    theRunner.terminalFor.mockImplementation((sessionId: unknown) =>
      sessionId === 's-closed' ? null : { terminalSessionId: 't-1', projectId: 'p-1' }
    )
    strandedAgents.set('s-open', { orderId: 'WO-1', sessionId: 's-open', at: 1 })
    strandedAgents.set('s-closed', { orderId: 'WO-1', sessionId: 's-closed', at: 2 })
    strandedAgents.set('s-other', { orderId: 'WO-2', sessionId: 's-other', at: 3 })

    const seen = (await host.call('foundry:run.observe', { id: 'WO-1' })) as { stranded?: string[] }
    expect(seen.stranded).toEqual(['s-open'])
  })
})

describe('starting over an order its run left nothing behind for', () => {
  it('puts it back to agreed and says there was nothing to remove', async () => {
    await saveTypedOrder({ status: 'cancelled', recipe: 'direct', recipeOverriddenBy: 'operator' })
    // Git has no checkout and no branch to remove: the run never cut them.
    host.exec.mockResolvedValue({
      exitCode: 128,
      stdout: '',
      stderr: 'fatal: not a working tree',
      timedOut: false,
    })

    expect(await host.call('foundry:run.reset', { id: 'WO-1' })).toMatchObject({
      ok: true,
      removed: [],
    })
    const store = createOrderStore(dataDir)
    expect(await store.load('WO-1')).toMatchObject({
      status: 'agreed',
      recipe: null,
      recipeOverriddenBy: null,
    })
    const reset = (await store.entries('WO-1')).find((entry) => entry.action === 'run.reset')
    expect(reset?.reason).toBe('started over; there was nothing left to remove')
  })
})
