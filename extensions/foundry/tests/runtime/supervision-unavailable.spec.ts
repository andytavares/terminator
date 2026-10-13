/**
 * Foundry with a supervision runtime that could not start: the operator is
 * told, and nothing that needs an agent pretends to have started one.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { activate, deactivate } from '../../src/index.ts'
import * as path from 'node:path'

import { fakeHost, seededRepository, temporaryDirectory } from '../helpers/foundry-host.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/draft.js'

const userData = vi.hoisted(() => ({ path: '' }))

vi.mock('electron', () => ({ app: { getPath: () => userData.path } }))
vi.mock('../../src/runtime/control-server.js', () => ({
  createControlServer: async () => {
    throw new Error('EADDRINUSE')
  },
}))

let dataDir = ''
let repo = ''
let host: FoundryHost

beforeAll(async () => {
  const parent = temporaryDirectory('fdry-no-runtime')
  userData.path = path.join(parent, 'user-data')
  vi.stubEnv('HOME', path.join(parent, 'home'))
  dataDir = path.join(parent, 'records')
  repo = await seededRepository(parent)
  host = fakeHost(() => dataDir)
  activate(host.api)
  await vi.waitFor(() => expect(host.showToast).toHaveBeenCalled())
})

afterAll(async () => {
  deactivate()
  vi.unstubAllEnvs()
})

function readyDraft() {
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
    risk: { grade: 'P2' as const, triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    acceptance: [
      {
        id: 'AC-1',
        statement: 'all text renders red',
        priority: 'P1' as const,
        verify: { kind: 'test' as const, command: 'npm test', assert: 'exit_code == 0' },
        unverifiable: null,
      },
    ],
    plan: {
      ...base.plan,
      units: [
        {
          id: 'U-1',
          title: 'red text',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: ['src/theme.ts'],
          verify: [],
        },
      ],
    },
  }
}

describe('a supervision runtime that could not start', () => {
  describe('saying so', sayingSoTests)
  describe('refusals', refusalsTests)
})

function sayingSoTests() {
  it('is said out loud: phases would approve their own tool calls', () => {
    expect(host.showToast).toHaveBeenCalledWith(
      'error',
      'Supervision could not start — phases will run unsupervised, approving their own tool calls',
      'foundry.runtime.unavailable'
    )
  })

  it('leaves the console reading empty rather than failing', async () => {
    expect(await host.call('foundry:feed-list')).toEqual({ entries: [], mutes: [] })
    expect(await host.call('foundry:run-interrupt', { sessionId: 's' })).toEqual({ ok: false })
    expect(await host.call('foundry:run-stop', { sessionId: 's' })).toEqual({ ok: false })
    expect(await host.call('foundry:run-redirect', { sessionId: 's', message: 'x' })).toEqual({
      ok: false,
    })
  })
}

function refusalsTests() {
  it('refuses an architect turn and says why', async () => {
    await createOrderStore(dataDir).save(readyDraft())
    const started = (await host.call('foundry:order.converge', { id: 'WO-1', message: 'go' })) as {
      error?: string
    }
    expect(started.error).toBe('The supervision runtime is not running, so intake cannot start.')
  })

  it('records the red team as refused when a released order would be reviewed', async () => {
    await createOrderStore(dataDir).save(readyDraft())
    await host.call('foundry:order.hold', { id: 'WO-1', held: true })
    await host.call('foundry:order.hold', { id: 'WO-1', held: false })
    await vi.waitFor(async () => {
      const entries = await createOrderStore(dataDir).entries('WO-1')
      expect(entries.find((entry) => entry.action === 'red-team.refused')?.reason).toBe(
        'the supervision runtime is not running'
      )
    })
  })
}
