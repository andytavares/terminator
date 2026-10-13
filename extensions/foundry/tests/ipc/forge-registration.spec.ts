/**
 * The Forge's channels around an order, through `activate`: your tickets, a
 * ticket for a typed idea, an order from a tracker issue, agreeing it, and
 * deleting it outright.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { fakeHost, seededRepository, temporaryDirectory } from '../helpers/foundry-host.js'
import { activateFoundry, deactivate } from '../helpers/foundry-activation.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/draft.js'
import { orderDir } from '../../src/data-root.js'
import { priorArtFor } from '../../src/ipc/forge-registration.js'
import type { WorkOrder } from '../../src/order/schema.js'

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
let parent = ''
let host: FoundryHost

beforeAll(async () => {
  const outer = temporaryDirectory('fdry-forge-reg')
  vi.stubEnv('HOME', path.join(outer, 'home'))
  host = fakeHost(() => dataDir)
  await activateFoundry(host)
})

afterAll(async () => {
  deactivate()
  vi.unstubAllEnvs()
})

beforeEach(() => {
  parent = temporaryDirectory('fdry-forge-reg-order')
  dataDir = path.join(parent, 'records')
  for (const fn of Object.values(host.issues)) vi.mocked(fn).mockClear()
})

describe('your tickets', () => {
  describe('nothing connected', nothingConnectedTests)
  describe('own and searched', ownAndSearchedTests)
})

function nothingConnectedTests() {
  it('say nothing is connected rather than showing an empty list', async () => {
    vi.mocked(host.issues.connections).mockResolvedValueOnce([])
    expect(await host.call('foundry:issues.mine', {})).toEqual({ connected: [], issues: [] })
    expect(host.issues.listMine).not.toHaveBeenCalled()
  })
}

function ownAndSearchedTests() {
  it('are the operator’s own, or a search when a term is typed, with each tracker’s failure said', async () => {
    vi.mocked(host.issues.connections).mockResolvedValue([
      { tracker: 'linear', account: 'andrew' },
    ] as never)
    vi.mocked(host.issues.listMine).mockResolvedValueOnce({
      issues: [{ tracker: 'linear', key: 'ENG-1', title: 'Slow login', status: 'Todo' }],
      failures: [],
    } as never)
    expect(await host.call('foundry:issues.mine', {})).toEqual({
      connected: [{ tracker: 'linear', account: 'andrew' }],
      issues: [{ tracker: 'linear', key: 'ENG-1', title: 'Slow login', status: 'Todo' }],
      failures: [],
    })

    vi.mocked(host.issues.search).mockResolvedValueOnce({
      issues: [],
      failures: [{ tracker: 'jira', message: 'jira is unreachable' }],
    } as never)
    const searched = (await host.call('foundry:issues.mine', { term: '  export ' })) as {
      failures: string[]
    }
    expect(host.issues.search).toHaveBeenCalledWith('export', { limit: 50 })
    expect(searched.failures).toEqual(['jira is unreachable'])
  })

  it('answer with the tracker’s own error when it cannot be read', async () => {
    vi.mocked(host.issues.connections).mockRejectedValueOnce(new Error('token expired'))
    expect(await host.call('foundry:issues.mine', {})).toEqual({ error: 'token expired' })
  })
}

describe('a ticket for a typed idea', () => {
  it('is offered only where the tracker can create one, and filed with the idea as its text', async () => {
    expect(await host.call('foundry:ticket.offer')).toEqual({ offer: null })

    vi.mocked(host.issues.create).mockResolvedValueOnce({ key: 'ENG-9' } as never)
    expect(
      await host.call('foundry:ticket.create', { idea: 'Export is broken', teamId: 'team-1' })
    ).toEqual({ key: 'ENG-9' })
    expect(host.issues.create).toHaveBeenCalledWith(
      'linear',
      expect.objectContaining({ teamId: 'team-1', description: 'Export is broken' })
    )
  })
})

describe('an order from a tracker issue', () => {
  describe('reading the issue', readingTheIssueTests)
  describe('capabilities and unknown trackers', capabilitiesAndUnknownTrackersTests)
})

function readingTheIssueTests() {
  it('reads the issue through the application’s connection', async () => {
    const repo = await seededRepository(parent)
    vi.mocked(host.issues.get).mockResolvedValueOnce({
      key: 'ENG-3',
      title: 'Make text red',
      description: null,
      url: null,
      branchName: 'eng-3-red',
    } as never)
    const created = (await host.call('foundry:order.create', {
      source: { kind: 'tracker', tracker: 'linear', key: 'ENG-3' },
      repoPaths: [repo],
    })) as { order: WorkOrder }
    expect(host.issues.get).toHaveBeenCalledWith('linear', 'ENG-3')
    expect(created.order).toMatchObject({
      title: 'Make text red',
      source: { tracker: 'linear', key: 'ENG-3', branch: 'eng-3-red' },
    })
  })
}

function capabilitiesAndUnknownTrackersTests() {
  it('says up front when its tracker cannot move the issue, and records it', async () => {
    await createOrderStore(dataDir).save(
      draftOrder({
        id: 'WO-1',
        title: 'Make text red',
        source: { kind: 'tracker', tracker: 'jira', key: 'APP-3', url: null },
        repoPaths: ['/repos/app'],
        now: '2026-10-12T10:00:00.000Z',
      })
    )
    const states = (await host.call('foundry:order.states', { id: 'WO-1' })) as {
      capability: { transitions: string }
    }
    expect(states.capability.transitions).toBe('unsupported')
    const entries = await createOrderStore(dataDir).entries('WO-1')
    expect(entries.map((entry) => entry.action)).toEqual(['writeback.unsupported'])
  })

  it('that the tracker does not know is refused', async () => {
    const created = (await host.call('foundry:order.create', {
      source: { kind: 'tracker', tracker: 'linear', key: 'ENG-404' },
      repoPaths: ['/repos/app'],
    })) as { error?: string }
    expect(created.error).toBeDefined()
  })
}

/** A finding the operator accepted on WO-1; each use says when, about what and why. */
const ACCEPTED = {
  orderId: 'WO-1',
  actor: 'operator',
  action: 'finding.accepted',
  evidence: [],
}

describe('the record of earlier decisions', () => {
  it('names the newest decisions about the files a plan touches, and nothing else', async () => {
    const store = createOrderStore(dataDir)
    await store.save(
      draftOrder({
        id: 'WO-1',
        title: 't',
        source: { kind: 'typed', tracker: null, key: null, url: null },
        repoPaths: ['/repos/app'],
        now: '2026-10-12T10:00:00.000Z',
      })
    )
    const decided = (at: string, subject: string, reason: string) =>
      store.record({ ...ACCEPTED, at, subject, reason })
    await decided('2026-10-01T10:00:00.000Z', 'src/theme.ts', 'keep tokens')
    await decided('2026-10-05T10:00:00.000Z', 'RT-1', 'src/theme.ts stays the source of colour')
    await decided('2026-10-06T10:00:00.000Z', 'src/other.ts', 'unrelated')

    expect(await priorArtFor(dataDir, ['src/theme.ts'])).toEqual([
      '2026-10-05 operator: finding.accepted — src/theme.ts stays the source of colour',
      '2026-10-01 operator: finding.accepted — keep tokens',
    ])
  })
})

describe('deleting an order', () => {
  describe('an unknown order', anUnknownOrderTests)
  describe('deleting', forgeRegistrationDeletingTests)
})

function anUnknownOrderTests() {
  it('refuses an order that does not exist', async () => {
    expect(await host.call('foundry:order.delete', { id: 'WO-9' })).toEqual({
      error: 'No order WO-9.',
    })
  })
}

function forgeRegistrationDeletingTests() {
  it('stops its architect, removes its records, and leaves no trace on the list', async () => {
    const repo = await seededRepository(parent)
    const order = draftOrder({
      id: 'WO-1',
      title: 'Make it red',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: [repo],
      now: '2026-10-12T10:00:00.000Z',
    })
    await createOrderStore(dataDir).save(order)
    theRunner.start.mockImplementation((async (input: {
      phase: string
      onRegistered: (run: { sessionId: string; transcriptFrom: number }) => void
    }) => {
      const sessionId = `${input.phase}-1`
      input.onRegistered({ sessionId, transcriptFrom: 0 })
      return { sessionId, transcriptFrom: 0, terminalSessionId: 't', transcriptPath: '/none' }
    }) as never)
    await host.call('foundry:order.converge', { id: 'WO-1', message: 'draft it' })

    const deleted = (await host.call('foundry:order.delete', { id: 'WO-1' })) as { ok: boolean }
    expect(deleted.ok).toBe(true)
    expect(theRunner.stop).toHaveBeenCalledWith('architect-1', 'the order was deleted')
    expect(fs.existsSync(orderDir(dataDir, 'WO-1'))).toBe(false)
    const listed = (await host.call('foundry:order.list')) as { orders: unknown[] }
    expect(listed.orders).toEqual([])
  })
}
