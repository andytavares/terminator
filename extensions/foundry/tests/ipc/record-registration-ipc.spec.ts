/**
 * The record's channels as `activate` wires them: the checks already in force
 * come from the workspace's own rule sources, and the time a removal is
 * stamped with is the time it happened.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import * as path from 'node:path'

import { fakeHost, temporaryDirectory } from '../helpers/foundry-host.js'
import { activateFoundry, deactivate, settleFoundryWork } from '../helpers/foundry-activation.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/draft.js'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))

let dataDir = ''
let host: FoundryHost

beforeAll(async () => {
  const outer = temporaryDirectory('fdry-record-reg')
  vi.stubEnv('HOME', path.join(outer, 'home'))
  host = fakeHost(() => dataDir)
  await activateFoundry(host)
})

// Each test's proofs and runs end before the next test, or the spec's folder, goes.
afterEach(settleFoundryWork)

afterAll(async () => {
  await deactivate()
  vi.unstubAllEnvs()
})

/** Three rejections of the same thing in one order, in a records folder of its own. */
beforeEach(async () => {
  dataDir = path.join(temporaryDirectory('fdry-record-reg-order'), 'records')
  const store = createOrderStore(dataDir)
  await store.save(
    draftOrder({
      id: 'WO-1',
      title: 'WO-1',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/app'],
      now: '2026-09-06T10:00:00.000Z',
    })
  )
  for (const n of [1, 2, 3]) {
    await store.record({
      at: `2026-09-0${n}T10:00:00.000Z`,
      orderId: 'WO-1',
      actor: 'operator',
      action: 'review.rejected',
      subject: `U-${n}`,
      reason: 'the timeout is hardcoded rather than read from configuration',
      evidence: [],
    })
  }
})

type Proposed = { proposals: { id: string }[] }

/** Asks for suggestions, and accepts the one the rejections make. */
async function acceptTheSuggestion(): Promise<string> {
  const asked = (await host.call('foundry:rules.propose', {})) as Proposed
  expect(asked.proposals).toHaveLength(1)
  const id = asked.proposals[0].id
  expect(await host.call('foundry:rules.decide', { proposalId: id, accept: true })).toMatchObject({
    accepted: true,
  })
  return id
}

describe('the checks already in force', () => {
  it('are read from the records, so an accepted suggestion is not suggested again', async () => {
    await acceptTheSuggestion()
    const again = (await host.call('foundry:rules.propose', {})) as Proposed
    expect(again.proposals).toEqual([])
  })
})

describe('removing an accepted check', () => {
  it('is stamped with the time it happened', async () => {
    const id = await acceptTheSuggestion()
    const before = new Date().toISOString()
    const removed = (await host.call('foundry:rules.remove', { ruleId: id })) as { at: string }
    expect(removed.at >= before).toBe(true)
    expect(removed.at <= new Date().toISOString()).toBe(true)
  })
})
