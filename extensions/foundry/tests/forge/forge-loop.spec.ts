/**
 * The Forge's own loop, through `activate`: an architect turn, the follow-ups
 * it earns, the red team's rounds, and the moment the order is ready to hand
 * off. Agents answer by writing the one file each is allowed to write.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { builderUnit, testCriterion } from '../helpers/order-parts.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { fakeHost, seededRepository, temporaryDirectory } from '../helpers/foundry-host.js'
import { activateFoundry, deactivate } from '../helpers/foundry-activation.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/draft.js'
import { orderDir } from '../../src/data-root.js'
import { rungOutputPath } from '../../src/line/rung-output.js'
import type { WorkOrder } from '../../src/order/schema.js'

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

vi.setConfig({ testTimeout: 20_000 })

const { fakeRunner } = await import('../helpers/foundry-host.js')
const theRunner = fakeRunner()
runner.current = theRunner

let dataDir = ''
let repo = ''
let host: FoundryHost

/** What each role writes on its turn; a role with no entry writes nothing. */
let writes: Partial<Record<'architect' | 'red-team' | 'scout', (round: number) => unknown>> = {}

beforeAll(async () => {
  const parent = temporaryDirectory('fdry-forge-loop')
  userData.path = path.join(parent, 'user-data')
  vi.stubEnv('HOME', path.join(parent, 'home'))
  host = fakeHost(() => dataDir)
  await activateFoundry(host)
})

afterAll(async () => {
  deactivate()
  vi.unstubAllEnvs()
})

beforeEach(async () => {
  const parent = temporaryDirectory('fdry-forge-order')
  dataDir = path.join(parent, 'records')
  repo = await seededRepository(parent)
  writes = {}
  host.showToast.mockClear()
  theRunner.start.mockReset()
  theRunner.start.mockImplementation(scriptedTurns() as never)
})

type Phase = 'architect' | 'red-team' | 'scout'

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

function writeAnswer(target: string, written: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, typeof written === 'string' ? written : JSON.stringify(written))
}

/** Agents that write what `writes` says for their role and turn, then end the turn. */
function scriptedTurns() {
  const turns = new Map<string, number>()
  return async (input: TurnInput) => {
    const turn = (turns.get(input.phase) ?? 0) + 1
    turns.set(input.phase, turn)
    const sessionId = `${input.phase}-${turn}`
    const written = writes[input.phase]?.(turn)
    if (written !== undefined) writeAnswer(answerPath(input.phase, turn), written)
    input.onRegistered({ sessionId, transcriptFrom: 0 })
    setTimeout(() => {
      input.onTurnEnd()
      // A turn that wrote nothing is over when its session ends.
      if (written === undefined) input.onEnd(0)
    }, 0)
    return { sessionId, transcriptFrom: 0, terminalSessionId: 't', transcriptPath: '/none' }
  }
}

/** A draft that passes every check but the red team's, worth reviewing unless `over` says not. */
function readyDraft(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Make it red',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [repo],
    now: '2026-10-12T10:00:00.000Z',
  })
  return {
    ...base,
    intent: { problem: 'text is blue', outcome: 'text is red', nonGoals: ['icons'] },
    context: { ...base.context, entryPoints: ['src/theme.ts'] },
    risk: { grade: 'P2', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    acceptance: [testCriterion('AC-1', { statement: 'all text renders red' })],
    plan: {
      ...base.plan,
      units: [
        builderUnit('U-1', { title: 'red text', satisfies: ['AC-1'], touches: ['src/theme.ts'] }),
      ],
    },
    ...over,
  } as WorkOrder
}

const finding = (text: string) => ({ severity: 'high', category: 'regression', text })

async function ledger(): Promise<string[]> {
  return (await createOrderStore(dataDir).entries('WO-1')).map((entry) => entry.action)
}

async function untilLedgerHas(action: string): Promise<void> {
  await vi.waitFor(async () => expect(await ledger()).toContain(action), {
    timeout: 10_000,
    interval: 50,
  })
}

async function converge(order: WorkOrder): Promise<void> {
  await createOrderStore(dataDir).save(order)
  const started = (await host.call('foundry:order.converge', {
    id: 'WO-1',
    message: 'tighten the plan',
  })) as { error?: string; converging?: string }
  expect(started.error).toBeUndefined()
  expect(started.converging).toBe('architect-1')
}

const said = (): string[] => host.showToast.mock.calls.map((call) => call[1] as string)

describe('a redraft the red team finds nothing in', () => {
  it('is reviewed once and then waits for the operator to hand it off', async () => {
    writes = { architect: () => ({ note: 'tightened' }), 'red-team': () => ({ redTeam: [] }) }
    await converge(readyDraft())
    await vi.waitFor(() => expect(said()).toContain('Make it red is ready to hand off.'), {
      timeout: 10_000,
    })
    const entries = await createOrderStore(dataDir).entries('WO-1')
    expect(entries.find((e) => e.action === 'review.round')?.reason).toBe(
      'round 1: 0 blocking, 0 notes'
    )
  })
})

describe('a small one-lane plan', () => {
  it('skips the red team, says why, and is ready to hand off', async () => {
    writes = { architect: () => ({ note: 'tightened' }) }
    await converge(
      readyDraft({ risk: { grade: 'P3', triggers: [], blastRadius: ['src/'], criticalPaths: [] } })
    )
    await untilLedgerHas('review.skipped')
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
      'red-team': () => ({ redTeam: [finding('icons turn red too')] }),
    }
    await converge(readyDraft())
    await vi.waitFor(() => expect(said()).toContain('Make it red is ready to hand off.'), {
      timeout: 10_000,
    })
    const entries = await createOrderStore(dataDir).entries('WO-1')
    expect(entries.filter((e) => e.action === 'converge.started').map((e) => e.reason)).toEqual([
      'tighten the plan',
      'red team round 1 fix',
    ])
  })

  it('still standing after every round is put in front of the operator', async () => {
    writes = {
      architect: () => ({ note: 'tried' }),
      'red-team': (round) => ({ redTeam: [finding(`still broken, round ${round}`)] }),
    }
    await converge(readyDraft())
    await untilLedgerHas('review.exhausted')
    expect(said()).toContainEqual(expect.stringContaining('after 3 rounds — it needs you.'))
  })
})

describe('a red team that writes nothing', () => {
  it('is refused on the record and the loop stops there', async () => {
    writes = { architect: () => ({ note: 'tightened' }) }
    await converge(readyDraft())
    await untilLedgerHas('red-team.refused')
    expect(said()).toEqual([])
  })
})

describe('a proposal the architect wrote in the wrong shape', () => {
  it('goes back to the architect on its own, and after the last retry the operator is told', async () => {
    writes = { architect: () => ({ acceptance: 'not a list' }) }
    await converge(readyDraft())
    await vi.waitFor(
      () =>
        expect(said()).toContain(
          "Make it red: the architect's plan was refused and nothing changed."
        ),
      { timeout: 10_000 }
    )
    const actions = await ledger()
    expect(actions.filter((a) => a === 'converge.refused').length).toBeGreaterThanOrEqual(3)
    expect(actions).toContain('converge.followed_up')
  })
})

describe('a plan still failing its checks', () => {
  it('is sent back to the architect to close them without asking anyone, a bounded number of times', async () => {
    writes = { architect: () => ({ note: 'tightened' }) }
    // No blast radius: a check the architect is asked to close on its own.
    await converge(
      readyDraft({ risk: { grade: 'P2', triggers: [], blastRadius: [], criticalPaths: [] } })
    )
    await vi.waitFor(
      async () => expect((await ledger()).filter((a) => a === 'order.redrafted')).toHaveLength(3),
      { timeout: 10_000, interval: 50 }
    )
    expect((await ledger()).filter((a) => a === 'converge.followed_up')).toHaveLength(2)
    expect(said()).toEqual([])
  })
})

describe('an order the operator holds', () => {
  it('keeps the redraft but starts nothing, and picks the loop up when released', async () => {
    writes = { architect: () => ({ note: 'tightened' }), 'red-team': () => ({ redTeam: [] }) }
    await createOrderStore(dataDir).save(readyDraft())
    await host.call('foundry:order.hold', { id: 'WO-1', held: true })
    await converge(readyDraft())
    await untilLedgerHas('order.redrafted')
    expect(theRunner.start).toHaveBeenCalledTimes(1)

    await host.call('foundry:order.hold', { id: 'WO-1', held: false })
    await vi.waitFor(() => expect(said()).toContain('Make it red is ready to hand off.'), {
      timeout: 10_000,
    })
  })
})

describe('the very first draft', () => {
  it('has the scout read the repository beside the architect, and keeps what it found', async () => {
    writes = {
      architect: () => ({ note: 'first draft' }),
      scout: () => ({ findings: { entryPoints: ['src/colours.ts'] } }),
      'red-team': () => ({ redTeam: [] }),
    }
    await converge(readyDraft({ context: { ...readyDraft().context, entryPoints: [] } }))
    await untilLedgerHas('scout.collected')
    const entries = await createOrderStore(dataDir).entries('WO-1')
    expect(entries.find((e) => e.action === 'scout.collected')?.reason).toBe('found 1 entry point')
    // The loop goes on to the red team and the hand-off. Waited for here, or
    // it finishes during the next test, which shares the host, and writes its
    // red team's round into that test's records.
    await vi.waitFor(() => expect(said()).toContain('Make it red is ready to hand off.'), {
      timeout: 10_000,
    })
  })
})

describe('an architect turn that cannot start', () => {
  it('says why when the repository cannot be checked out', async () => {
    const draft = readyDraft()
    const gone = { ...draft.context.repos[0], path: path.join(dataDir, 'gone') }
    await createOrderStore(dataDir).save({ ...draft, context: { ...draft.context, repos: [gone] } })
    const started = (await host.call('foundry:order.converge', { id: 'WO-1', message: 'go' })) as {
      error?: string
    }
    expect(started.error).toBeDefined()
    expect(theRunner.start).not.toHaveBeenCalled()
    expect(await ledger()).toContain('converge.refused')
  })

  it('says why when the terminal could not be opened', async () => {
    theRunner.start.mockRejectedValue(new Error('no terminal could be opened'))
    await createOrderStore(dataDir).save(readyDraft())
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

describe('a question the architect asks', () => {
  it('waits on the console for the operator, and is gone once answered', async () => {
    let answer: (requestId: string) => void = () => undefined
    theRunner.start.mockImplementation(
      askingArchitect((resolve) => {
        answer = resolve
      }) as never
    )
    await createOrderStore(dataDir).save(readyDraft())
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
    await vi.waitFor(async () =>
      expect((await createOrderStore(dataDir).load('WO-1'))?.provenance.forgeSession).toBe(
        'architect-1'
      )
    )
  })
})
