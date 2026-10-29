import { describe, it, expect, vi, beforeEach } from 'vitest'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())
const store = vi.hoisted(() => ({
  recordUse: vi.fn(),
  declare: vi.fn(),
  report: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))
vi.mock('../../../src/main/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('../../../src/main/usage/usage-store', () => ({ getUsageStore: () => store }))

beforeEach(() => {
  store.recordUse.mockReset()
  store.declare.mockReset()
  store.report.mockReset()
})

async function registeredHandlers() {
  const { registerUsageHandlers } = await import('../../../src/main/ipc/usage.ipc')
  registerUsageHandlers()
  return (channel: string, payload?: unknown) => handlers.get(channel)!({}, payload)
}

describe('usage:record', () => {
  it('stores a valid use', async () => {
    const call = await registeredHandlers()
    const use = { feature: 'core.home', via: 'click' }
    expect(await call('usage:record', use)).toEqual({ data: true })
    expect(store.recordUse).toHaveBeenCalledWith(use)
  })

  it('refuses a feature id with capitals, and stores nothing', async () => {
    const call = await registeredHandlers()
    const answer = (await call('usage:record', { feature: 'Core.Home', via: 'click' })) as {
      error: string
    }
    expect(answer.error).toBe('VALIDATION_ERROR')
    expect(store.recordUse).not.toHaveBeenCalled()
  })

  it('says it failed when the store cannot write', async () => {
    store.recordUse.mockRejectedValueOnce(new Error('disk full'))
    const call = await registeredHandlers()
    expect(await call('usage:record', { feature: 'core.home', via: 'click' })).toEqual({
      error: 'failed',
      message: 'Error: disk full',
    })
  })
})

describe('usage:declare', () => {
  it('hands the features to the store', async () => {
    const call = await registeredHandlers()
    const features = [{ id: 'core.home', label: 'Home', kind: 'surface', source: 'core' }]
    expect(await call('usage:declare', { features })).toEqual({ data: true })
    expect(store.declare).toHaveBeenCalledWith(features)
  })
})

describe('usage:report', () => {
  it('answers the report for the period', async () => {
    store.report.mockResolvedValueOnce({ countingSince: null, features: [] })
    const call = await registeredHandlers()
    expect(await call('usage:report', { from: '2026-10-01' })).toEqual({
      data: { countingSince: null, features: [] },
    })
    expect(store.report).toHaveBeenCalledWith('2026-10-01')
  })

  it('refuses a period start that is not a day', async () => {
    const call = await registeredHandlers()
    const answer = (await call('usage:report', { from: 'last week' })) as { error: string }
    expect(answer.error).toBe('VALIDATION_ERROR')
  })
})
