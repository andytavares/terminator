/**
 * Holding the Forge's loop and letting it go, through `activate`: a red team
 * round that finishes while the order is held continues nowhere, and letting
 * go picks the loop up where it would have gone — the hand-off, a fix turn, or
 * a follow-up on a plan still failing its checks. Also an order released once
 * before whose restart is refused, and a review that asks to see the fix.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { builderUnit, testCriterion } from '../helpers/order-parts.js'
import { fakeHost, seededRepository, temporaryDirectory } from '../helpers/foundry-host.js'
import { activateFoundry, deactivate } from '../helpers/foundry-activation.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/draft.js'
import { orderDir } from '../../src/data-root.js'
import { rungOutputPath } from '../../src/line/rung-output.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { theRunner } from '../helpers/supervision-mocks.js'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))
vi.mock('../../src/runtime/control-server.js', () => import('../helpers/supervision-mocks.js'))

vi.setConfig({ testTimeout: 20_000 })

type Phase = 'architect' | 'red-team' | 'scout'

let dataDir = ''
let repo = ''
let host: FoundryHost
/** What each role writes on its turn; a role with no entry writes nothing. */
let writes: Partial<Record<Phase, (turn: number) => unknown>> = {}
/** A turn of this role does not end until the test lets it. */
let heldTurn: { phase: Phase; release: Promise<void> } | null = null

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
  theRunner.start.mockReset().mockImplementation(scriptedTurns() as never)
})

interface TurnInput {
  phase: Phase
  onRegistered: (run: { sessionId: string; transcriptFrom: number }) => void
  onTurnEnd: () => void
  onEnd: (exitCode: number | null) => void
}

/** The one file a turn of `phase` may write: the architect's proposal, or a rung's output. */
function answerPath(phase: Phase, turn: number): string {
  const order = orderDir(dataDir, 'WO-1')
  if (phase === 'architect') return path.join(order, 'proposal.json')
  return rungOutputPath(order, phase === 'scout' ? 'forge-scout' : `review-${turn}`)
}

/** Ends a turn: its answer is in, and a turn that wrote nothing is over when its session ends. */
function endTurn(input: TurnInput, wrote: boolean): void {
  input.onTurnEnd()
  if (!wrote) input.onEnd(0)
}

/** Agents that write what `writes` says for their role and turn, then end the turn. */
function scriptedTurns() {
  const turns = new Map<string, number>()
  return async (input: TurnInput) => {
    const turn = (turns.get(input.phase) ?? 0) + 1
    turns.set(input.phase, turn)
    const sessionId = `${input.phase}-${turn}`
    const written = writes[input.phase]?.(turn)
    if (written !== undefined) {
      const target = answerPath(input.phase, turn)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, JSON.stringify(written))
    }
    input.onRegistered({ sessionId, transcriptFrom: 0 })
    const wait = heldTurn?.phase === input.phase ? heldTurn.release : Promise.resolve()
    void wait.then(() => setTimeout(() => endTurn(input, written !== undefined), 0))
    return { sessionId, transcriptFrom: 0, terminalSessionId: 't', transcriptPath: '/none' }
  }
}

/** A draft that passes every check but the red team's, unless `over` says otherwise. */
function readyDraft(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Make it red',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [repo],
    now: '2026-10-12T10:00:00.000Z',
  })
  const unit = builderUnit('U-1', { title: 'red text', satisfies: ['AC-1'], touches: ['src/a.ts'] })
  return {
    ...base,
    intent: { problem: 'text is blue', outcome: 'text is red', nonGoals: ['icons'] },
    context: { ...base.context, entryPoints: ['src/theme.ts'] },
    risk: { grade: 'P2', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    acceptance: [testCriterion('AC-1', { statement: 'all text renders red' })],
    plan: { ...base.plan, units: [unit] },
    ...over,
  } as WorkOrder
}

const finding = (text: string) => ({ severity: 'high', category: 'regression', text })
const said = (): string[] => host.showToast.mock.calls.map((call) => call[1] as string)
const READY = 'Make it red is ready to hand off.'

async function entries() {
  return createOrderStore(dataDir).entries('WO-1')
}

async function untilLedgerHas(action: string, reason?: string): Promise<void> {
  await vi.waitFor(
    async () =>
      expect(await entries()).toContainEqual(
        expect.objectContaining(reason === undefined ? { action } : { action, reason })
      ),
    { timeout: 10_000, interval: 50 }
  )
}

/** Until the run the order restarted has failed or halted. */
async function untilTheRunEnds(): Promise<void> {
  const ends = ['run.failed', 'run.halted']
  await vi.waitFor(
    async () => expect((await entries()).some((entry) => ends.includes(entry.action))).toBe(true),
    { timeout: 10_000, interval: 50 }
  )
}

async function converge(order: WorkOrder): Promise<void> {
  await createOrderStore(dataDir).save(order)
  await host.call('foundry:order.converge', { id: 'WO-1', message: 'tighten the plan' })
}

/** The first turn the ledger records after the operator let go. */
async function firstTurnAfterRelease() {
  const all = await entries()
  const released = all.findIndex((entry) => entry.action === 'review.released')
  const turn = all.slice(released).find((entry) => entry.action.startsWith('converge.'))
  return turn === undefined ? undefined : { action: turn.action, reason: turn.reason }
}

const hold = (held: boolean) => host.call('foundry:order.hold', { id: 'WO-1', held })

/** Converges, and holds the order while the red team's first round is still running. */
async function heldDuringTheRedTeam(order: WorkOrder): Promise<void> {
  let letItFinish = (): void => undefined
  heldTurn = { phase: 'red-team', release: new Promise((resolve) => (letItFinish = resolve)) }
  await converge(order)
  await vi.waitFor(() =>
    expect(theRunner.start.mock.calls.map((c) => (c[0] as TurnInput).phase)).toContain('red-team')
  )
  await hold(true)
  letItFinish()
  await untilLedgerHas('review.round')
}

describe('a clean round that finishes while the order is held', () => {
  it('waits, and is handed off once the operator lets go', async () => {
    writes = { architect: () => ({ note: 'tightened' }), 'red-team': () => ({ redTeam: [] }) }
    await heldDuringTheRedTeam(readyDraft())
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(said()).not.toContain(READY)
    await hold(false)
    await vi.waitFor(() => expect(said()).toContain(READY), { timeout: 10_000 })
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
          ? { redTeam: [finding('icons turn red too')], anotherPass: true }
          : { redTeam: [] },
    }
    await heldDuringTheRedTeam(readyDraft())
    await untilLedgerHas('review.another_pass', 'round 1 asked to review the fix')
    await hold(false)
    await untilLedgerHas('converge.started', 'red team round 1 fix')
    await vi.waitFor(() => expect(said()).toContain(READY), { timeout: 10_000 })
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
    const gap = readyDraft()
    const units = gap.plan.units.map((unit) => ({ ...unit, satisfies: [] }))
    await createOrderStore(dataDir).save({ ...gap, plan: { ...gap.plan, units } })
    await hold(true)
    await host.call('foundry:order.converge', { id: 'WO-1', message: 'tighten the plan' })
    await untilLedgerHas('order.redrafted')
    await hold(false)
    await untilLedgerHas('converge.followed_up')
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
        expect((await entries()).filter((e) => e.action === 'order.redrafted')).toHaveLength(3),
      { timeout: 10_000, interval: 50 }
    )
  })
})

describe('letting go of an order with nothing to pick up', () => {
  it('starts nothing for an order that is no longer a draft', async () => {
    await createOrderStore(dataDir).save({ ...readyDraft(), status: 'agreed' })
    await hold(true)
    await hold(false)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(theRunner.start).not.toHaveBeenCalled()
  })

  it('starts nothing over a turn that is still running', async () => {
    writes = { architect: () => ({ note: 'tightened' }), 'red-team': () => ({ redTeam: [] }) }
    let letItFinish = (): void => undefined
    heldTurn = { phase: 'architect', release: new Promise((resolve) => (letItFinish = resolve)) }
    await converge(readyDraft())
    await hold(true)
    await hold(false)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(theRunner.start).toHaveBeenCalledTimes(1)
    letItFinish()
    await vi.waitFor(() => expect(said()).toContain(READY), { timeout: 10_000 })
  })
})

/** An order the operator handed off and answered a gate on before it came back to the Forge. */
async function releasedBefore(): Promise<void> {
  const store = createOrderStore(dataDir)
  await store.save(readyDraft())
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
    await converge(readyDraft({ recipe: 'no-such-shape', recipeOverriddenBy: 'operator' }))
    await untilLedgerHas('run.refused')
    expect(said()).toContainEqual(
      expect.stringMatching(/^Make it red did not restart: .*no-such-shape/)
    )
  })

  it('restarts in the shape the operator chose, as their choice', async () => {
    writes = { architect: () => ({ note: 'tightened' }), 'red-team': () => ({ redTeam: [] }) }
    await releasedBefore()
    await converge(readyDraft({ recipe: 'direct', recipeOverriddenBy: 'operator' }))
    await vi.waitFor(
      () => expect(said()).toContain('Make it red was amended and is running again.'),
      {
        timeout: 10_000,
      }
    )
    const started = (await entries()).filter((entry) => entry.action === 'run.started').at(-1)
    expect(started?.reason).toMatch(/^chosen by the operator/)
    // The run goes on, halting at the builder's empty turn or failing at the push
    // this repository has no remote for; waited for so nothing it writes lands
    // after the spec's records are gone.
    await untilTheRunEnds()
  })
})
