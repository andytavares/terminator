/**
 * The ways an intake turn can end other than with a proposal or a review on
 * time, through `activate`: a session that never started, a turn that ends
 * before its file is written, a session that ends with nothing, and a red team
 * round that could not start, wrote what it may not, or had no role to run.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  fakeHost,
  seededRepository,
  temporaryDirectory,
  untilToastShown,
} from '../helpers/foundry-host.js'
import { activateFoundry, deactivate } from '../helpers/foundry-activation.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { createOrderStore } from '../../src/order/store.js'
import { orderDir } from '../../src/data-root.js'
import { rungOutputPath } from '../../src/line/rung-output.js'
import { convergeOrder, readyDraft } from '../helpers/forge-turns.js'
import { ledgerActions, untilLedgerHas } from '../helpers/order-ledger.js'
import { theRunner } from '../helpers/supervision-mocks.js'
import { writeFileWithDirs } from '../helpers/files.js'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))
vi.mock('../../src/runtime/control-server.js', () => import('../helpers/supervision-mocks.js'))

vi.setConfig({ testTimeout: 20_000 })

let dataDir = ''
let repo = ''
let host: FoundryHost

beforeAll(async () => {
  const parent = temporaryDirectory('fdry-intake-ends')
  vi.stubEnv('HOME', path.join(parent, 'home'))
  host = fakeHost(() => dataDir)
  await activateFoundry(host)
})

afterAll(() => {
  deactivate()
  vi.unstubAllEnvs()
})

beforeEach(async () => {
  const parent = temporaryDirectory('fdry-intake-ends-order')
  dataDir = path.join(parent, 'records')
  repo = await seededRepository(parent)
  host.showToast.mockClear()
  theRunner.start.mockReset()
})

interface TurnInput {
  phase: 'architect' | 'red-team'
  onRegistered: (run: { sessionId: string; transcriptFrom: number }) => void
  onTurnEnd: () => void
  onEnd: (exitCode: number | null) => void
  onAutoDenied: (tool: string, reason: string) => void
}

/** What a turn hands back once it is running. */
const startedTurn = (sessionId: string) => ({
  sessionId,
  transcriptFrom: 0,
  terminalSessionId: 't',
  transcriptPath: '/none',
})

const proposalPath = (): string => path.join(orderDir(dataDir, 'WO-1'), 'proposal.json')
const reviewPath = (round: number): string =>
  rungOutputPath(orderDir(dataDir, 'WO-1'), `review-${round}`)

const REFUSED = "Make it red: the architect's plan was refused and nothing changed."

/** Until the loop has given up on the architect and told the operator. */
async function untilRefusalIsSaid(): Promise<void> {
  await untilToastShown(host, REFUSED)
}

describe('an architect whose session never started', () => {
  it('says it ended before it started, when the runner hands back no session', async () => {
    theRunner.start.mockResolvedValue(null)
    expect((await convergeOrder(host, dataDir, readyDraft(repo))).error).toBe(
      'The architect ended before it started.'
    )
    await untilLedgerHas(dataDir, 'converge.refused', 'The architect could not be started.')
    await untilRefusalIsSaid()
  })

  it('says it could not be started, when the runner fails with something not an error', async () => {
    theRunner.start.mockRejectedValue('no pty')
    expect((await convergeOrder(host, dataDir, readyDraft(repo))).error).toBe(
      'The architect could not be started.'
    )
  })
})

describe('an architect turn that ends before its proposal is written', () => {
  it('waits for the proposal its next turn writes, and takes that', async () => {
    const seen: { turn?: TurnInput } = {}
    theRunner.start.mockImplementation((async (input: TurnInput) => {
      seen.turn = input
      input.onRegistered({ sessionId: 'architect-1', transcriptFrom: 0 })
      return startedTurn('architect-1')
    }) as never)
    expect((await convergeOrder(host, dataDir, readyDraft(repo))).converging).toBe('architect-1')
    const architect = seen.turn
    if (architect === undefined) throw new Error('the architect never started')
    architect.onTurnEnd()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await ledgerActions(dataDir)).not.toContain('order.redrafted')
    writeFileWithDirs(proposalPath(), { note: 'thought about it' })
    architect.onTurnEnd()
    expect((await untilLedgerHas(dataDir, 'order.redrafted')).reason).toBe('thought about it')
  })
})

/** An architect that registers, and whose session then ends with `exitCode`, having written nothing. */
function architectEndsWith(exitCode: number | null) {
  return (async (input: TurnInput) => {
    input.onRegistered({ sessionId: 'architect-1', transcriptFrom: 0 })
    setTimeout(() => input.onEnd(exitCode), 0)
    return startedTurn('architect-1')
  }) as never
}

describe('an architect session that ends having written nothing', () => {
  it('is refused for writing no proposal when it exited', async () => {
    theRunner.start.mockImplementation(architectEndsWith(0))
    await convergeOrder(host, dataDir, readyDraft(repo))
    expect((await untilLedgerHas(dataDir, 'converge.refused')).reason).toBe(
      'the architect wrote no proposal'
    )
    await untilRefusalIsSaid()
  })

  it('is refused as never started when it has no exit code', async () => {
    theRunner.start.mockImplementation(architectEndsWith(null))
    await convergeOrder(host, dataDir, readyDraft(repo))
    expect((await untilLedgerHas(dataDir, 'converge.refused')).reason).toBe(
      'The architect could not be started.'
    )
    await untilRefusalIsSaid()
  })
})

type Turn = (input: TurnInput) => Promise<unknown>

/** An architect that writes a proposal and ends its turn; the red team as `redTeam` has it. */
function turns(redTeam: Turn) {
  return (async (input: TurnInput) => {
    if (input.phase === 'red-team') return redTeam(input)
    writeFileWithDirs(proposalPath(), { note: 'tightened' })
    input.onRegistered({ sessionId: 'architect-1', transcriptFrom: 0 })
    setTimeout(() => input.onTurnEnd(), 0)
    return startedTurn('architect-1')
  }) as never
}

/** A red team that registers, and writes `output` to its round's file before its turn ends. */
function redTeamWriting(output: unknown, before?: (input: TurnInput) => void): Turn {
  return async (input) => {
    before?.(input)
    writeFileWithDirs(reviewPath(1), output)
    input.onRegistered({ sessionId: 'red-team-1', transcriptFrom: 0 })
    setTimeout(() => input.onTurnEnd(), 0)
    return startedTurn('red-team-1')
  }
}

describe('a red team round that never started', () => {
  it('is refused as having written nothing, when the runner hands back no session', async () => {
    theRunner.start.mockImplementation(turns(async () => null))
    await convergeOrder(host, dataDir, readyDraft(repo))
    expect((await untilLedgerHas(dataDir, 'red-team.refused')).reason).toBe(
      'the red-team wrote nothing'
    )
  })

  it('is refused with the runner’s own reason, when the runner fails', async () => {
    theRunner.start.mockImplementation(
      turns(async () => {
        throw new Error('no terminal could be opened')
      })
    )
    await convergeOrder(host, dataDir, readyDraft(repo))
    expect((await untilLedgerHas(dataDir, 'red-team.refused')).reason).toBe(
      'no terminal could be opened'
    )
  })
})

describe('a red team round that writes what it may not', () => {
  it('is refused with what was wrong with it, and nothing it wrote is kept', async () => {
    theRunner.start.mockImplementation(turns(redTeamWriting({ redTeam: 'not a list' })))
    await convergeOrder(host, dataDir, readyDraft(repo))
    expect((await untilLedgerHas(dataDir, 'red-team.refused')).reason).not.toBe(
      'the red-team wrote nothing'
    )
    expect((await createOrderStore(dataDir).load('WO-1'))?.redTeam).toEqual([])
  })

  it('has a tool it was refused said on the feed', async () => {
    const refuseEdit = (input: TurnInput) =>
      input.onAutoDenied('Edit', 'the red team reads; it does not edit')
    theRunner.start.mockImplementation(turns(redTeamWriting({ redTeam: [] }, refuseEdit)))
    await convergeOrder(host, dataDir, readyDraft(repo))
    await untilLedgerHas(dataDir, 'review.round')
    const feed = (await host.call('foundry:feed-list')) as { entries: Array<{ summary: string }> }
    expect(feed.entries.map((entry) => entry.summary)).toContain(
      'refused Edit: the red team reads; it does not edit'
    )
  })
})

describe('a red team with no role to run', () => {
  it('is refused with why its role could not be read', async () => {
    fs.mkdirSync(path.join(dataDir, 'roles'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'roles', 'red-team.yaml'), 'schemaVersion: [\n')
    theRunner.start.mockImplementation(turns(redTeamWriting({ redTeam: [] })))
    await convergeOrder(host, dataDir, readyDraft(repo))
    expect((await untilLedgerHas(dataDir, 'red-team.refused')).reason).toMatch(/red-team/)
    expect(theRunner.start.mock.calls.map((call) => (call[0] as TurnInput).phase)).toEqual([
      'architect',
    ])
  })
})
