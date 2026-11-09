/**
 * Hand-off is the operator's. A clean red-team round used to agree the order
 * and start the Line on its own; the operator found work already building
 * that they had not released. A run starts from the channel the Forge's Hand
 * off button calls, or again for an order the operator already released that
 * a defect sent back (tests/forge/release-again.spec.ts).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import * as path from 'node:path'

import {
  fakeHost,
  seededRepository,
  temporaryDirectory,
  toastsShown,
  type FoundryHost,
} from '../helpers/foundry-host.js'
import { activateFoundry, deactivate, settleFoundryWork } from '../helpers/foundry-activation.js'
import { convergeOrder, readyDraft, scriptedTurns } from '../helpers/forge-turns.js'
import { ledgerActions, untilLedgerHas } from '../helpers/order-ledger.js'
import { theRunner } from '../helpers/supervision-mocks.js'
import { executingOrders } from '../../src/line/run-control.js'
import { settleBackground } from '../../src/background.js'
import { eventually } from '../../../../packages/test-support/src/eventually'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))

let dataDir = ''
let host: FoundryHost

beforeAll(async () => {
  const parent = temporaryDirectory('fdry-hand-off')
  vi.stubEnv('HOME', path.join(parent, 'home'))
  host = fakeHost(() => dataDir)
  await activateFoundry(host)
})

afterEach(settleFoundryWork)

afterAll(async () => {
  await deactivate()
  vi.unstubAllEnvs()
})

const writes = { architect: () => ({ note: 'tightened' }), 'red-team': () => ({ redTeam: [] }) }

/** WO-1 converged in a fresh repository, through a red-team round that found nothing. */
async function cleanRound(): Promise<void> {
  const parent = temporaryDirectory('fdry-hand-off-order')
  dataDir = path.join(parent, 'records')
  const repo = await seededRepository(parent)
  await convergeOrder(host, dataDir, readyDraft(repo))
  await untilLedgerHas(dataDir, 'review.round')
  await settleBackground()
}

/** Until the run has halted or failed and its executor has returned, so it writes nothing later. */
async function untilTheRunEnds(): Promise<void> {
  await eventually(async () => {
    expect(await ledgerActions(dataDir)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^run\.(failed|halted)$/)])
    )
    expect(executingOrders.has('WO-1')).toBe(false)
  })
}

beforeEach(() => {
  host.showToast.mockClear()
  theRunner.start
    .mockReset()
    .mockImplementation(scriptedTurns(() => ({ dataDir, writes })) as never)
})

describe('hand-off', () => {
  it('leaves a never-released order unagreed and unstarted after a clean red-team round', async () => {
    await cleanRound()
    const actions = await ledgerActions(dataDir)
    expect(actions).not.toContain('order.agreed')
    expect(actions).not.toContain('run.started')
    expect(toastsShown(host)).toContain('Make it red is ready to hand off.')
  })

  it('starts the run once when the operator hands the order off', async () => {
    await cleanRound()
    await host.call('foundry:order.compile', { id: 'WO-1', commit: true })
    await host.call('foundry:run.start', { id: 'WO-1' })
    expect((await ledgerActions(dataDir)).filter((action) => action === 'run.started')).toEqual([
      'run.started',
    ])
    await untilTheRunEnds()
  })
})
