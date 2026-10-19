import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

import { fakeHost, type FoundryHost } from '../helpers/foundry-host.js'
import {
  registerViewChannels,
  registerCommands,
  clearPendingNewOrder,
} from '../../src/ipc/ui-registration.js'
import { registerModelChannels } from '../../src/ipc/model-registration.js'

let host: FoundryHost

beforeAll(() => {
  host = fakeHost(() => '/unused')
  registerViewChannels(host.api)
  registerCommands(host.api, { create: vi.fn() })
  registerModelChannels(host.api)
})

beforeEach(() => {
  host.settings.clear()
  host.broadcast.mockClear()
  clearPendingNewOrder()
})

afterEach(() => vi.useRealTimers())

describe('which view draws the Forge', () => {
  it('is the list until the operator chooses the factory, and reads anything else as the list', async () => {
    expect(await host.call('foundry:ui.view')).toEqual({ view: 'list' })
    host.settings.set('terminator.foundry.view', 'garbage')
    expect(await host.call('foundry:ui.view')).toEqual({ view: 'list' })
  })

  it('is kept and announced when chosen', async () => {
    expect(await host.call('foundry:ui.set-view', { view: 'factory' })).toEqual({
      view: 'factory',
    })
    expect(await host.call('foundry:ui.view')).toEqual({ view: 'factory' })
    expect(host.broadcast).toHaveBeenCalledWith('foundry:ui.view-changed', { view: 'factory' })
  })

  it('flips each time the palette command runs', async () => {
    host.commands.get('toggle-view')?.()
    expect(await host.call('foundry:ui.view')).toEqual({ view: 'factory' })
    host.commands.get('toggle-view')?.()
    expect(await host.call('foundry:ui.view')).toEqual({ view: 'list' })
    expect(host.broadcast).toHaveBeenLastCalledWith('foundry:ui.view-changed', { view: 'list' })
  })
})

describe('a new work order asked for from the palette', () => {
  it('opens in a view that already exists, and waits once for a view that does not yet', async () => {
    host.commands.get('new-order')?.()
    expect(host.broadcast).toHaveBeenCalledWith('foundry:ui.open-new-order', {})
    expect(await host.call('foundry:ui.consume-pending-new-order')).toEqual({ pending: true })
    expect(await host.call('foundry:ui.consume-pending-new-order')).toEqual({ pending: false })
  })

  it('is forgotten if no view picks it up within five seconds', async () => {
    vi.useFakeTimers()
    host.commands.get('new-order')?.()
    vi.advanceTimersByTime(5_000)
    expect(await host.call('foundry:ui.consume-pending-new-order')).toEqual({ pending: false })
  })
})

describe('the models runs launch with', () => {
  it('keeps the chosen launch model and ask model where the main process reads them', async () => {
    expect(await host.call('foundry:model-set', { model: 'sonnet' })).toEqual({
      ok: true,
      selected: 'sonnet',
    })
    expect(await host.call('foundry:ask-model-set', { model: 'opus' })).toEqual({
      ok: true,
      selected: 'opus',
    })
    expect(await host.call('foundry:ask-model')).toEqual({ selected: 'opus' })
  })
})
