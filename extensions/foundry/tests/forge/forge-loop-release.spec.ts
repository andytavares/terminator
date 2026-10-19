/**
 * Holding the Forge's loop and letting it go, through `activate`: a red team
 * round that finishes while the order is held continues nowhere, and letting
 * go picks the loop up where it would have gone — the hand-off, a fix turn, or
 * a follow-up on a plan still failing its checks. Also an order released once
 * before whose restart is refused, and a review that asks to see the fix.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import * as path from 'node:path'

import {
  fakeHost,
  seededRepository,
  temporaryDirectory,
  toastsShown,
  untilToastShown,
} from '../helpers/foundry-host.js'
import { activateFoundry, deactivate } from '../helpers/foundry-activation.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { writeBaseline } from '../../src/line/baseline.js'
import { provenBaseline } from '../helpers/environment.js'
import { orderStoreAt } from '../../src/state/live-index.js'
import type { WorkOrder } from '../../src/order/schema.js'
import {
  convergeOrder,
  readyDraft,
  redTeamRegression,
  scriptedTurns,
  type ForgeTurnInput,
  type TurnScript,
} from '../helpers/forge-turns.js'
import { orderLedger, untilLedgerHas } from '../helpers/order-ledger.js'
import { theRunner } from '../helpers/supervision-mocks.js'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))
vi.mock('../../src/runtime/control-server.js', () => import('../helpers/supervision-mocks.js'))

vi.setConfig({ testTimeout: 20_000 })

let dataDir = ''
let repo = ''
let host: FoundryHost
/** What each role writes on its turn; a role with no entry writes nothing. */
let writes: TurnScript['writes'] = {}
/** A turn of this role does not end until the test lets it. */
let heldTurn: TurnScript['heldTurn'] = null

beforeAll(async () => {
  const parent = temporaryDirectory('fdry-forge-release')
  vi.stubEnv('HOME', path.join(parent, 'home'))
  host = fakeHost(() => dataDir)
  await activateFoundry(host)
})

afterAll(() => {
  deactivate()
  vi.unstubAllEnvs()
})

beforeEach(async () => {
  const parent = temporaryDirectory('fdry-forge-release-order')
  dataDir = path.join(parent, 'records')
  repo = await seededRepository(parent)
  writes = {}
  heldTurn = null
  host.showToast.mockClear()
  theRunner.stop.mockReset().mockReturnValue(true)
  theRunner.terminalFor.mockReset().mockReturnValue(null)
  theRunner.start
    .mockReset()
    .mockImplementation(scriptedTurns(() => ({ dataDir, writes, heldTurn })) as never)
})

const READY = 'Make it red is ready to hand off.'

/** Until the run the order restarted has failed or halted. */
async function untilTheRunEnds(): Promise<void> {
  const ends = ['run.failed', 'run.halted']
  await vi.waitFor(
    async () =>
      expect((await orderLedger(dataDir)).some((entry) => ends.includes(entry.action))).toBe(true),
    { timeout: 10_000, interval: 50 }
  )
}

/** The first turn the ledger records after the operator let go. */
async function firstTurnAfterRelease() {
  const all = await orderLedger(dataDir)
  const released = all.findIndex((entry) => entry.action === 'review.released')
  const turn = all.slice(released).find((entry) => entry.action.startsWith('converge.'))
  return turn === undefined ? undefined : { action: turn.action, reason: turn.reason }
}

const setOrderHeld = (held: boolean) => host.call('foundry:order.hold', { id: 'WO-1', held })

/** Converges, and holds the order while the red team's first round is still running. */
async function heldDuringTheRedTeam(order: WorkOrder): Promise<void> {
  let letItFinish = (): void => undefined
  heldTurn = { phase: 'red-team', release: new Promise((resolve) => (letItFinish = resolve)) }
  await convergeOrder(host, dataDir, order)
  await vi.waitFor(() =>
    expect(theRunner.start.mock.calls.map((c) => (c[0] as ForgeTurnInput).phase)).toContain(
      'red-team'
    )
  )
  await setOrderHeld(true)
  letItFinish()
  await untilLedgerHas(dataDir, 'review.round')
}

describe('a clean round that finishes while the order is held', () => {
  it('waits, and is handed off once the operator lets go', async () => {
    writes = { architect: () => ({ note: 'tightened' }), 'red-team': () => ({ redTeam: [] }) }
    await heldDuringTheRedTeam(readyDraft(repo))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(toastsShown(host)).not.toContain(READY)
    await setOrderHeld(false)
    await untilToastShown(host, READY)
    expect(theRunner.start).toHaveBeenCalledTimes(2)
  })
})

describe('a round that asks to see the fix, finishing while held', () => {
  it('records the ask, and on letting go sends the finding back as the next fix turn', async () => {
    writes = {
      architect: (turn) =>
        turn === 1
          ? { note: 'tightened' }
          : { note: 'fixed', resolveFindings: [{ id: 'RT-red-team-1', how: 'kept icons blue' }] },
      'red-team': (round) =>
        round === 1
          ? { redTeam: [redTeamRegression('icons turn red too')], anotherPass: true }
          : { redTeam: [] },
    }
    await heldDuringTheRedTeam(readyDraft(repo))
    await untilLedgerHas(dataDir, 'review.another_pass', 'round 1 asked to review the fix')
    await setOrderHeld(false)
    await untilLedgerHas(dataDir, 'converge.started', 'red team round 1 fix')
    await untilToastShown(host, READY)
  })
})

/** A turn's terminal outlives the proposal it wrote: it is still open when the follow-up starts,
 * until something ends it for a reason. */
function terminalsStayOpen(): void {
  const ended = new Set<string>()
  theRunner.stop.mockImplementation((id: unknown, reason?: unknown) => {
    if (reason !== undefined) ended.add(id as string)
    return true
  })
  theRunner.terminalFor.mockImplementation((id: unknown) =>
    ended.has(id as string) ? null : { terminalSessionId: 't', projectId: 'p' }
  )
}

describe('a plan still failing its checks when the operator lets go', () => {
  it('gets a follow-up, and the next one ends the open turn before it', async () => {
    writes = { architect: () => ({ note: 'tightened' }) }
    terminalsStayOpen()
    // A unit that satisfies nothing: a gap the architect is asked to close on its own.
    // Saved before anything reads it: the records are read once, then pushed to.
    const gap = readyDraft(repo)
    const units = gap.plan.units.map((unit) => ({ ...unit, satisfies: [] }))
    await orderStoreAt(dataDir).save({ ...gap, plan: { ...gap.plan, units } })
    await setOrderHeld(true)
    await host.call('foundry:order.converge', { id: 'WO-1', message: 'tighten the plan' })
    await untilLedgerHas(dataDir, 'order.redrafted')
    await setOrderHeld(false)
    await untilLedgerHas(dataDir, 'converge.followed_up')
    expect(await firstTurnAfterRelease()).toEqual({
      action: 'converge.followed_up',
      reason: 'closing the failing checks on its own',
    })
    // The follow-up that turn earns resumes the conversation, so the turn's
    // terminal, still open, is ended first.
    await vi.waitFor(() =>
      expect(theRunner.stop).toHaveBeenCalledWith('architect-2', 'continuing in a follow-up turn')
    )
    await vi.waitFor(
      async () =>
        expect(
          (await orderLedger(dataDir)).filter((e) => e.action === 'order.redrafted')
        ).toHaveLength(3),
      { timeout: 10_000, interval: 50 }
    )
  })
})

describe('letting go of an order with nothing to pick up', () => {
  it('starts nothing for an order that is no longer a draft', async () => {
    await orderStoreAt(dataDir).save({ ...readyDraft(repo), status: 'agreed' })
    await setOrderHeld(true)
    await setOrderHeld(false)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(theRunner.start).not.toHaveBeenCalled()
  })

  it('starts nothing over a turn that is still running', async () => {
    writes = { architect: () => ({ note: 'tightened' }), 'red-team': () => ({ redTeam: [] }) }
    let letItFinish = (): void => undefined
    heldTurn = { phase: 'architect', release: new Promise((resolve) => (letItFinish = resolve)) }
    await convergeOrder(host, dataDir, readyDraft(repo))
    await setOrderHeld(true)
    await setOrderHeld(false)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(theRunner.start).toHaveBeenCalledTimes(1)
    letItFinish()
    await untilToastShown(host, READY)
  })
})

/** An order the operator handed off and answered a gate on before it came back to the Forge. */
async function releasedBefore(): Promise<void> {
  const store = orderStoreAt(dataDir)
  await store.save(readyDraft(repo))
  await writeBaseline(dataDir, 'WO-1', provenBaseline())
  for (const action of ['order.agreed', 'run.started', 'gate.decided']) {
    await store.record({
      at: '2026-10-12T10:05:00.000Z',
      orderId: 'WO-1',
      actor: 'operator',
      action,
      subject: 'WO-1',
      reason: '',
      evidence: [],
    })
  }
}

describe('an order released once before, passing every check again', () => {
  it('says why on the record and to the operator when its restart is refused', async () => {
    writes = { architect: () => ({ note: 'tightened' }), 'red-team': () => ({ redTeam: [] }) }
    await releasedBefore()
    await convergeOrder(
      host,
      dataDir,
      readyDraft(repo, { recipe: 'no-such-shape', recipeOverriddenBy: 'operator' })
    )
    await untilLedgerHas(dataDir, 'run.refused')
    expect(toastsShown(host)).toContainEqual(
      expect.stringMatching(/^Make it red did not restart: .*no-such-shape/)
    )
  })

  it('restarts in the shape the operator chose, as their choice', async () => {
    writes = { architect: () => ({ note: 'tightened' }), 'red-team': () => ({ redTeam: [] }) }
    await releasedBefore()
    await convergeOrder(
      host,
      dataDir,
      readyDraft(repo, { recipe: 'direct', recipeOverriddenBy: 'operator' })
    )
    await untilToastShown(host, 'Make it red was amended and is running again.')
    const started = (await orderLedger(dataDir))
      .filter((entry) => entry.action === 'run.started')
      .at(-1)
    expect(started?.reason).toMatch(/^chosen by the operator/)
    // The run goes on, halting at the builder's empty turn or failing at the push
    // this repository has no remote for; waited for so nothing it writes lands
    // after the spec's records are gone.
    await untilTheRunEnds()
  })
})
