import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

import { fakeHost, type FoundryHost } from '../helpers/foundry-host.js'
import {
  registerViewChannels,
  registerCommands,
  clearPendingNewOrder,
} from '../../src/ipc/ui-registration.js'
import { settleBackground } from '../../src/background.js'
import { registerModelChannels } from '../../src/ipc/model-registration.js'

let host: FoundryHost
const create = vi.fn()

beforeAll(() => {
  host = fakeHost(() => '/unused')
  registerViewChannels(host.api)
  registerCommands(host.api, { create })
  registerModelChannels(host.api)
})

beforeEach(() => {
  host.settings.clear()
  host.broadcast.mockClear()
  vi.mocked(host.api.window.showSelf).mockClear()
  clearPendingNewOrder()
  create.mockReset()
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

  it('flips each time the palette command runs, bringing Foundry forward', async () => {
    host.commands.get('toggle-view')?.()
    expect(await host.call('foundry:ui.view')).toEqual({ view: 'factory' })
    expect(host.api.window.showSelf).toHaveBeenCalledWith('main')
    host.commands.get('toggle-view')?.()
    expect(await host.call('foundry:ui.view')).toEqual({ view: 'list' })
    expect(host.broadcast).toHaveBeenLastCalledWith('foundry:ui.view-changed', { view: 'list' })
  })
})

describe('a new work order asked for from the palette', () => {
  it('opens in a view that already exists, and waits once for a view that does not yet', async () => {
    host.commands.get('new-order')?.()
    expect(host.broadcast).toHaveBeenCalledWith('foundry:ui.open-new-order', {})
    expect(await host.call('foundry:ui.consume-pending-new-order')).toEqual({
      pending: { kind: 'new' },
    })
    expect(await host.call('foundry:ui.consume-pending-new-order')).toEqual({ pending: null })
  })

  it('is forgotten if no view picks it up within five seconds', async () => {
    vi.useFakeTimers()
    host.commands.get('new-order')?.()
    vi.advanceTimersByTime(5_000)
    expect(await host.call('foundry:ui.consume-pending-new-order')).toEqual({ pending: null })
  })
})

describe('an order opened from Start work or Home before the view exists', () => {
  const start = (args: unknown) => host.commands.get('start-order')?.({}, args)

  it('leaves the order for the view to read on mount, from a ticket', async () => {
    create.mockResolvedValue({ order: { id: 'WO-7' } })
    start({ tracker: 'linear', key: 'TAV-1', repoRoot: '/repo' })
    await settleBackground()
    expect(host.broadcast).toHaveBeenCalledWith('foundry:ui.open-order', { orderId: 'WO-7' })
    expect(await host.call('foundry:ui.consume-pending-new-order')).toEqual({
      pending: { kind: 'order', orderId: 'WO-7' },
    })
  })

  it('creates a typed order from a prompt and opens it', async () => {
    create.mockResolvedValue({ order: { id: 'WO-8' } })
    start({ prompt: 'fix the build', repoRoot: '/repo' })
    await settleBackground()
    expect(host.broadcast).toHaveBeenCalledWith('foundry:ui.open-order', { orderId: 'WO-8' })
    expect(create).toHaveBeenCalledWith({
      source: { kind: 'typed', text: 'fix the build' },
      repoPaths: ['/repo'],
    })
  })
})

describe('Home Open on an order before the view exists', () => {
  it('is left for the view, and forgotten after five seconds', async () => {
    vi.useFakeTimers()
    host.commands.get('show-order')?.({}, { orderId: 'WO-9' })
    vi.advanceTimersByTime(5_000)
    expect(await host.call('foundry:ui.consume-pending-new-order')).toEqual({ pending: null })
    host.commands.get('show-order')?.({}, { orderId: 'WO-9' })
    expect(await host.call('foundry:ui.consume-pending-new-order')).toEqual({
      pending: { kind: 'order', orderId: 'WO-9' },
    })
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
