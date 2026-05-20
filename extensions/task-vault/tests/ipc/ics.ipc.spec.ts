import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs/promises'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn() }
})

const { mockHandle, mockRemoveHandler } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockRemoveHandler: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, removeHandler: mockRemoveHandler },
}))

import { registerIcsIpcHandlers, setVaultPath } from '../../src/ipc/ics.ipc'

const VAULT = '/vault'
const now = new Date()
const futureEvent = {
  uid: 'evt1',
  summary: 'Meeting',
  start: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  end: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000 + 3600000).toISOString(),
  allDay: false,
}
const cacheData = JSON.stringify([
  {
    url: 'https://example.com/feed.ics',
    events: [futureEvent],
    fetchedAt: now.toISOString(),
    fetchError: null,
  },
])

beforeEach(() => {
  vi.clearAllMocks()
  setVaultPath(VAULT)
  vi.mocked(fs.readFile).mockResolvedValue(cacheData as unknown as Buffer)
})

function getHandler(channel: string) {
  let handler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
  vi.mocked(mockHandle).mockImplementation((ch, fn) => {
    if (ch === channel) handler = fn as typeof handler
  })
  const dispose = registerIcsIpcHandlers()
  if (!handler) throw new Error(`Handler for ${channel} not registered`)
  return { handler, dispose }
}

describe('task-vault:ics:get-events', () => {
  it('registers the handler', () => {
    registerIcsIpcHandlers()
    const channels = vi.mocked(mockHandle).mock.calls.map((c) => c[0])
    expect(channels).toContain('task-vault:ics:get-events')
  })

  it('returns events from cache when fresh', async () => {
    const { handler } = getHandler('task-vault:ics:get-events')
    const result = (await handler({}, {})) as { events: unknown[]; isFeedConfigured: boolean }
    expect(result.isFeedConfigured).toBe(true)
    expect(result.events).toHaveLength(1)
  })

  it('returns empty when no cache', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('No cache'))
    const { handler } = getHandler('task-vault:ics:get-events')
    const result = (await handler({}, {})) as { events: unknown[]; isFeedConfigured: boolean }
    expect(result.isFeedConfigured).toBe(false)
    expect(result.events).toEqual([])
  })

  it('returns isStale when cache is old', async () => {
    const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
    const staleCache = JSON.stringify([
      {
        url: 'https://example.com/feed.ics',
        events: [futureEvent],
        fetchedAt: oldDate.toISOString(),
        fetchError: null,
      },
    ])
    vi.mocked(fs.readFile).mockResolvedValue(staleCache as unknown as Buffer)
    const { handler } = getHandler('task-vault:ics:get-events')
    const result = (await handler({}, {})) as { isStale: boolean }
    expect(result.isStale).toBe(true)
  })

  it('dispose removes handler', () => {
    const { dispose } = getHandler('task-vault:ics:get-events')
    dispose()
    expect(vi.mocked(mockRemoveHandler)).toHaveBeenCalledWith('task-vault:ics:get-events')
  })
})
