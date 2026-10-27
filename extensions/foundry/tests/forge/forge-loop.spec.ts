/**
 * The Forge's own loop, through `activate`: an architect turn, the follow-ups
 * it earns, the red team's rounds, and the moment the order is ready to hand
 * off. Agents answer by writing the one file each is allowed to write.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import * as path from 'node:path'

import { activateFoundry, deactivate, settleFoundryWork } from '../helpers/foundry-activation.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { createOrderStore } from '../../src/order/store.js'
import { orderStoreAt } from '../../src/state/live-index.js'
import type { WorkOrder } from '../../src/order/schema.js'
import {
  fakeHost,
  seededRepository,
  temporaryDirectory,
  toastsShown,
  untilToastShown,
} from '../helpers/foundry-host.js'
import {
  convergeOrder,
  readyDraft,
  redTeamRegression,
  scriptedTurns,
  type TurnScript,
} from '../helpers/forge-turns.js'
import { ledgerActions, untilLedgerHas } from '../helpers/order-ledger.js'
import { theRunner } from '../helpers/supervision-mocks.js'
import { eventually } from '../../../../tests/support/eventually'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))

let dataDir = ''
let repo = ''
let host: FoundryHost

/** What each role writes on its turn; a role with no entry writes nothing. */
let writes: TurnScript['writes'] = {}

beforeAll(async () => {
  const parent = temporaryDirectory('fdry-forge-loop')
  vi.stubEnv('HOME', path.join(parent, 'home'))
  host = fakeHost(() => dataDir)
  await activateFoundry(host)
})

// Each test's proofs and runs end before the next test, or the spec's folder, goes.
afterEach(settleFoundryWork)

afterAll(async () => {
  await deactivate()
  vi.unstubAllEnvs()
})

beforeEach(async () => {
  const parent = temporaryDirectory('fdry-forge-order')
  dataDir = path.join(parent, 'records')
  repo = await seededRepository(parent)
  writes = {}
  host.showToast.mockClear()
  theRunner.start.mockReset()
  theRunner.start.mockImplementation(scriptedTurns(() => ({ dataDir, writes })) as never)
})

/** Converges `order`, and the architect's first turn is what starts. */
async function convergeFromTheArchitect(order: WorkOrder): Promise<void> {
  const started = await convergeOrder(host, dataDir, order)
  expect(started.error).toBeUndefined()
  expect(started.converging).toBe('architect-1')
}

describe('a redraft the red team finds nothing in', () => {
  it('is reviewed once and then waits for the operator to hand it off', async () => {
    writes = { architect: () => ({ note: 'tightened' }), 'red-team': () => ({ redTeam: [] }) }
    await convergeFromTheArchitect(readyDraft(repo))
    await untilToastShown(host, 'Make it red is ready to hand off.')
    const entries = await createOrderStore(dataDir).entries('WO-1')
    expect(entries.find((e) => e.action === 'review.round')?.reason).toBe(
      'round 1: 0 blocking, 0 notes'
    )
  })
})

describe('starting an architect turn', () => {
  it('writes a drafting intake with a deadline on the order', async () => {
    // Held, so the answer cannot settle the turn before the order is read.
    let release = (): void => undefined
    const held = new Promise<void>((resolve) => (release = resolve))
    theRunner.start.mockImplementation(
      scriptedTurns(() => ({
        dataDir,
        writes: { architect: () => ({ note: 'tightened' }) },
        heldTurn: { phase: 'architect', release: held },
      })) as never
    )
    await convergeFromTheArchitect(readyDraft(repo))
    const order = await createOrderStore(dataDir).load('WO-1')
    expect(order?.intake?.state).toBe('drafting')
    expect(order?.intake?.deadline).not.toBeNull()
    release()
    await untilLedgerHas(dataDir, 'order.redrafted')
  })
})

describe('a small one-lane plan', () => {
  it('skips the red team, says why, and is ready to hand off', async () => {
    writes = { architect: () => ({ note: 'tightened' }) }
    await convergeFromTheArchitect(
      readyDraft(repo, {
        risk: { grade: 'P3', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
      })
    )
    await untilLedgerHas(dataDir, 'review.skipped')
    expect(theRunner.start.mock.calls.map((c) => (c[0] as { phase: string }).phase)).toEqual([
      'architect',
    ])
  })
})

describe('a blocking finding', () => {
  it('goes back to the architect as one fix turn, and the fixed plan is handed off', async () => {
    writes = {
      architect: (turn) =>
        turn === 1
          ? { note: 'tightened' }
          : { note: 'fixed', resolveFindings: [{ id: 'RT-red-team-1', how: 'kept icons blue' }] },
      'red-team': () => ({ redTeam: [redTeamRegression('icons turn red too')] }),
    }
    await convergeFromTheArchitect(readyDraft(repo))
    await untilToastShown(host, 'Make it red is ready to hand off.')
    const entries = await createOrderStore(dataDir).entries('WO-1')
    expect(entries.filter((e) => e.action === 'converge.started').map((e) => e.reason)).toEqual([
      'tighten the plan',
      'red team round 1 fix',
    ])
  })

  it('still standing after every round is put in front of the operator', async () => {
    writes = {
      architect: () => ({ note: 'tried' }),
      'red-team': (round) => ({ redTeam: [redTeamRegression(`still broken, round ${round}`)] }),
    }
    await convergeFromTheArchitect(readyDraft(repo))
    await untilLedgerHas(dataDir, 'review.exhausted')
    expect(toastsShown(host)).toContainEqual(
      expect.stringContaining('after 3 rounds — it needs you.')
    )
  })
})

describe('a red team that writes nothing', () => {
  it('is refused on the record and the loop stops there', async () => {
    writes = { architect: () => ({ note: 'tightened' }) }
    await convergeFromTheArchitect(readyDraft(repo))
    await untilLedgerHas(dataDir, 'red-team.refused')
    expect(toastsShown(host)).toEqual([])
  })
})

describe('a proposal the architect wrote in the wrong shape', () => {
  it('goes back to the architect on its own, and after the last retry the operator is told', async () => {
    writes = { architect: () => ({ acceptance: 'not a list' }) }
    await convergeFromTheArchitect(readyDraft(repo))
    await untilToastShown(
      host,
      "Make it red: the architect's plan was refused and nothing changed."
    )
    const actions = await ledgerActions(dataDir)
    expect(actions.filter((a) => a === 'converge.refused').length).toBeGreaterThanOrEqual(3)
    expect(actions).toContain('converge.followed_up')
  })
})

describe('a plan still failing its checks', () => {
  it('is sent back to the architect to close them without asking anyone, a bounded number of times', async () => {
    writes = { architect: () => ({ note: 'tightened' }) }
    // No blast radius: a check the architect is asked to close on its own.
    await convergeFromTheArchitect(
      readyDraft(repo, { risk: { grade: 'P2', triggers: [], blastRadius: [], criticalPaths: [] } })
    )
    await eventually(async () =>
      expect((await ledgerActions(dataDir)).filter((a) => a === 'order.redrafted')).toHaveLength(3)
    )
    expect((await ledgerActions(dataDir)).filter((a) => a === 'converge.followed_up')).toHaveLength(
      2
    )
    expect(toastsShown(host)).toEqual([])
  })
})

describe('an order the operator holds', () => {
  it('keeps the redraft but starts nothing, and picks the loop up when released', async () => {
    writes = { architect: () => ({ note: 'tightened' }), 'red-team': () => ({ redTeam: [] }) }
    await orderStoreAt(dataDir).save(readyDraft(repo))
    await host.call('foundry:order.hold', { id: 'WO-1', held: true })
    await convergeFromTheArchitect(readyDraft(repo))
    await untilLedgerHas(dataDir, 'order.redrafted')
    expect(theRunner.start).toHaveBeenCalledTimes(1)

    await host.call('foundry:order.hold', { id: 'WO-1', held: false })
    await untilToastShown(host, 'Make it red is ready to hand off.')
  })
})

describe('the very first draft', () => {
  it('has the scout read the repository beside the architect, and keeps what it found', async () => {
    writes = {
      architect: () => ({ note: 'first draft' }),
      scout: () => ({ findings: { entryPoints: ['src/colours.ts'] } }),
      'red-team': () => ({ redTeam: [] }),
    }
    await convergeFromTheArchitect(
      readyDraft(repo, { context: { ...readyDraft(repo).context, entryPoints: [] } })
    )
    await untilLedgerHas(dataDir, 'scout.collected')
    const entries = await createOrderStore(dataDir).entries('WO-1')
    expect(entries.find((e) => e.action === 'scout.collected')?.reason).toBe('found 1 entry point')
    // The loop goes on to the red team and the hand-off. Waited for here, or
    // it finishes during the next test, which shares the host, and writes its
    // red team's round into that test's records.
    await untilToastShown(host, 'Make it red is ready to hand off.')
  })
})

describe('an architect turn that cannot start', () => {
  it('says why when the repository cannot be checked out', async () => {
    const draft = readyDraft(repo)
    const gone = { ...draft.context.repos[0], path: path.join(dataDir, 'gone') }
    await orderStoreAt(dataDir).save({ ...draft, context: { ...draft.context, repos: [gone] } })
    const started = (await host.call('foundry:order.converge', { id: 'WO-1', message: 'go' })) as {
      error?: string
    }
    expect(started.error).toBeDefined()
    expect(theRunner.start).not.toHaveBeenCalled()
    expect(await ledgerActions(dataDir)).toContain('converge.refused')
  })

  it('says why when the terminal could not be opened', async () => {
    theRunner.start.mockRejectedValue(new Error('no terminal could be opened'))
    await orderStoreAt(dataDir).save(readyDraft(repo))
    const started = (await host.call('foundry:order.converge', { id: 'WO-1', message: 'go' })) as {
      error?: string
    }
    expect(started.error).toBe('no terminal could be opened')
  })
})

interface AskingInput {
  onRegistered: (run: { sessionId: string; transcriptFrom: number }) => void
  onPending: (pending: Record<string, unknown>) => void
  onResolved: (requestId: string) => void
  onAutoDenied: (tool: string, reason: string) => void
}

/** An architect whose turn is refused an edit and then asks the operator a question; `answered` is
 * handed the runner's resolve once the turn starts. */
function askingArchitect(answered: (resolve: (requestId: string) => void) => void) {
  return async (input: AskingInput) => {
    input.onRegistered({ sessionId: 'architect-1', transcriptFrom: 0 })
    input.onAutoDenied('Edit', 'the architect proposes; it does not edit')
    input.onPending({
      sessionId: 'architect-1',
      requestId: 'ask-1',
      toolName: 'AskUserQuestion',
      summary: 'Which shade of red?',
      detail: null,
      at: Date.now(),
    })
    answered(input.onResolved)
    return {
      sessionId: 'architect-1',
      transcriptFrom: 0,
      terminalSessionId: 't',
      transcriptPath: '/none',
    }
  }
}

describe('a turn that has started', () => {
  it("tells the surfaces about a turn's conversation once, though its start is reported twice", async () => {
    theRunner.start.mockImplementation(askingArchitect(() => undefined) as never)
    await orderStoreAt(dataDir).save(readyDraft(repo))
    host.broadcast.mockClear()
    await host.call('foundry:order.converge', { id: 'WO-1', message: 'go' })
    await eventually(async () =>
      expect((await createOrderStore(dataDir).load('WO-1'))?.provenance.forgeSession).toBe(
        'architect-1'
      )
    )
    const announced = host.broadcast.mock.calls.filter(
      ([, change]) => change.kind === 'live' && change.orderId === 'WO-1'
    )
    expect(announced).toHaveLength(1)
  })
})

describe('a question the architect asks', () => {
  it('waits on the console for the operator, and is gone once answered', async () => {
    let answer: (requestId: string) => void = () => undefined
    theRunner.start.mockImplementation(
      askingArchitect((resolve) => {
        answer = resolve
      }) as never
    )
    await orderStoreAt(dataDir).save(readyDraft(repo))
    await host.call('foundry:order.converge', { id: 'WO-1', message: 'go' })

    const listed = (await host.call('foundry:permissions-list')) as {
      pending: Array<{ requestId: string; summary: string }>
    }
    expect(listed.pending).toEqual([
      expect.objectContaining({ requestId: 'ask-1', summary: 'Which shade of red?' }),
    ])
    const feed = (await host.call('foundry:feed-list')) as { entries: Array<{ summary: string }> }
    expect(feed.entries.map((entry) => entry.summary)).toContain(
      'refused Edit: the architect proposes; it does not edit'
    )
    answer('ask-1')
    expect(await host.call('foundry:permissions-list')).toEqual({ pending: [] })
    // The session goes onto the order in a save nobody awaits. Waiting for it
    // keeps that save from landing after the spec file's records are removed.
    await eventually(async () =>
      expect((await createOrderStore(dataDir).load('WO-1'))?.provenance.forgeSession).toBe(
        'architect-1'
      )
    )
  })
})
