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

import { readyDraft } from '../helpers/forge-turns.js'
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

describe('a supervision runtime that could not start', () => {
  describe('saying so', sayingSoTests)
  describe('refusals', supervisionUnavailableRefusalsTests)
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

function supervisionUnavailableRefusalsTests() {
  it('refuses an architect turn and says why', async () => {
    await createOrderStore(dataDir).save(readyDraft(repo))
    const started = (await host.call('foundry:order.converge', { id: 'WO-1', message: 'go' })) as {
      error?: string
    }
    expect(started.error).toBe('The supervision runtime is not running, so intake cannot start.')
  })

  it('records the red team as refused when a released order would be reviewed', async () => {
    await createOrderStore(dataDir).save(readyDraft(repo))
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
