/**
 * Signals and the record, through `activate`: the sensor tick that reads the
 * product back once a minute, and the checks the operator accepted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { fakeHost, temporaryDirectory } from '../helpers/foundry-host.js'
import { activateFoundry, deactivate } from '../helpers/foundry-activation.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { createOrderStore } from '../../src/order/store.js'
import { eventually } from '../../../../tests/support/eventually'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))

let dataDir = ''
let host: FoundryHost

// Each test activates Foundry afresh: the fake clock only lasts one test (tests/setup.ts), and the
// interval the sensors tick on is made at activation.
beforeEach(async () => {
  const parent = temporaryDirectory('fdry-sensors')
  vi.stubEnv('HOME', path.join(parent, 'home'))
  dataDir = temporaryDirectory('fdry-sensors-records')
  host = fakeHost(() => dataDir)
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  vi.mocked(host.issues.listMine).mockReset().mockResolvedValue({ issues: [], failures: [] })
  await activateFoundry(host)
})

afterEach(async () => {
  await deactivate()
})

type Signals = { signals: Array<{ id: string; title: string; sensorId: string }> }

async function signals(): Promise<Signals['signals']> {
  return ((await host.call('foundry:signals.list')) as Signals).signals
}

describe('a minute after a sensor was enabled', () => {
  describe('assigned issues', assignedIssuesTests)
  describe('failing workflows', failingWorkflowsTests)
  describe('announcing signals', announcingSignalsTests)
})

function assignedIssuesTests() {
  it('collects the operator’s assigned issues as signals', async () => {
    vi.mocked(host.issues.listMine).mockResolvedValue({
      issues: [{ key: 'ENG-7', title: 'Login is slow', url: 'https://linear.app/ENG-7' }],
      failures: [],
    } as never)
    await host.call('foundry:sensors.set', {
      id: 'tracker-query',
      enabled: true,
      repoPath: '/repos/app',
    })

    await vi.advanceTimersByTimeAsync(60_000)
    await eventually(async () =>
      expect((await signals()).map((s) => s.title)).toEqual(['Login is slow'])
    )
  })
}

function announcingSignalsTests() {
  it('announces signals when a tick saves one and when one is dismissed', async () => {
    vi.mocked(host.issues.listMine).mockResolvedValue({
      issues: [{ key: 'ENG-7', title: 'Login is slow', url: 'https://linear.app/ENG-7' }],
      failures: [],
    } as never)
    await host.call('foundry:sensors.set', {
      id: 'tracker-query',
      enabled: true,
      repoPath: '/repos/app',
    })
    host.broadcast.mockClear()

    await vi.advanceTimersByTimeAsync(60_000)
    await eventually(async () => expect(await signals()).toHaveLength(1))
    expect(host.broadcast).toHaveBeenCalledWith('foundry:changed', { kind: 'signals', orderId: '' })

    host.broadcast.mockClear()
    await host.call('foundry:signals.dismiss', { id: (await signals())[0].id })
    expect(host.broadcast).toHaveBeenCalledWith('foundry:changed', { kind: 'signals', orderId: '' })
  })
}

function failingWorkflowsTests() {
  it('collects workflows failing on the base branch through gh, in the sensor’s repository', async () => {
    host.gh.mockImplementation(async ({ args }: { args: string[] }) => {
      const stdout =
        args[0] === 'repo'
          ? 'main\n'
          : JSON.stringify([
              {
                databaseId: 1,
                displayTitle: 'bump deps',
                headSha: 'abc',
                workflowName: 'ci',
                createdAt: '2026-10-12T09:00:00Z',
                url: 'https://github.com/o/app/actions/runs/1',
              },
            ])
      return { exitCode: 0, stdout, stderr: '', timedOut: false }
    })
    await host.call('foundry:sensors.set', {
      id: 'ci-main-red',
      enabled: true,
      repoPath: '/repos/app',
    })

    await vi.advanceTimersByTimeAsync(60_000)
    await eventually(async () =>
      expect((await signals()).map((s) => s.title)).toEqual(['ci failing on main'])
    )
    expect(host.gh).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/repos/app' }))
  })
}

describe('a signal made into work', () => {
  it('becomes a draft order for the repositories the operator chose', async () => {
    vi.mocked(host.issues.listMine).mockResolvedValue({
      issues: [{ key: 'ENG-8', title: 'Export is broken', url: 'https://linear.app/ENG-8' }],
      failures: [],
    } as never)
    await host.call('foundry:sensors.set', { id: 'tracker-query', repoPath: '/repos/app' })
    await host.call('foundry:sensors.run-now', { id: 'tracker-query' })
    const [signal] = await signals()

    await host.call('foundry:signals.promote', { id: signal.id, repoPaths: ['/repos/app'] })
    const orders = await createOrderStore(dataDir).list()
    expect(orders.map((order) => [order.title, order.status])).toEqual([
      ['Export is broken', 'draft'],
    ])
  })
})

describe('the checks in force', () => {
  it('are the ones the operator accepted into the records location, and not the built-ins', async () => {
    fs.mkdirSync(path.join(dataDir, 'rules'), { recursive: true })
    fs.writeFileSync(
      path.join(dataDir, 'rules', 'no-blue.yaml'),
      [
        'schemaVersion: 1',
        'id: no-blue',
        'scope: universal',
        'rung: L3',
        'asserts: >',
        '  Text is never blue.',
        'appliesWhen: always',
        'origin: ledger',
        '',
      ].join('\n')
    )
    const inForce = (await host.call('foundry:rules.inForce')) as {
      rules: Array<{ id: string; rung: string; asserts: string }>
    }
    expect(inForce.rules).toEqual([
      expect.objectContaining({
        id: 'no-blue',
        rung: 'data-root',
        asserts: 'Text is never blue.\n',
      }),
    ])
  })
})
