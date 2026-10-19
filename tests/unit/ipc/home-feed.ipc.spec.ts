import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fullFeed } from '../home/home-feed.fixtures'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())
const sent = vi.hoisted(() => [] as Array<[string, unknown]>)

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))
vi.mock('../../../src/main/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('../../../src/main/safe-send', () => ({
  sendToWindow: (_win: unknown, channel: string, data: unknown) => sent.push([channel, data]),
}))

async function setup() {
  vi.resetModules()
  handlers.clear()
  sent.length = 0
  const feed = await import('../../../src/main/home/home-feed')
  const ipc = await import('../../../src/main/ipc/home-feed.ipc')
  ipc.registerHomeFeedHandlers(() => ({}) as never)
  return feed
}

const call = (channel: string, payload?: unknown) => handlers.get(channel)!({}, payload)

beforeEach(() => vi.clearAllMocks())

describe('home feed channels', () => {
  it('home:feed-get answers the merged feed', async () => {
    const feed = await setup()
    feed.publishFeed('git-integration', fullFeed())
    const result = (await call('home:feed-get')) as { data: { asks: Array<{ source: string }> } }
    expect(result.data.asks[0].source).toBe('git-integration')
  })

  it('home:feed-action runs the extension handler', async () => {
    const feed = await setup()
    const handler = vi.fn().mockResolvedValue(undefined)
    feed.setActionHandler('git-integration', handler)
    const result = await call('home:feed-action', {
      source: 'git-integration',
      itemId: 'ask-1',
      actionId: 'approve',
    })
    expect(handler).toHaveBeenCalledWith('ask-1', 'approve')
    expect(result).toEqual({ data: true })
  })
})

describe('home:feed-action failures', () => {
  it('home:feed-action answers an error when nothing handles it', async () => {
    await setup()
    const result = await call('home:feed-action', { source: 'ghost', itemId: 'i', actionId: 'a' })
    expect(result).toMatchObject({ error: 'failed', message: expect.stringContaining('ghost') })
  })

  it('home:feed-action refuses a malformed payload', async () => {
    await setup()
    expect(await call('home:feed-action', { source: 1 })).toMatchObject({
      error: 'VALIDATION_ERROR',
    })
  })

  it('pushes home:feed-changed with the merged feed on every change', async () => {
    const feed = await setup()
    feed.publishFeed('git-integration', fullFeed())
    expect(sent.map(([channel]) => channel)).toEqual(['home:feed-changed'])
    expect((sent[0][1] as { asks: unknown[] }).asks).toHaveLength(1)
  })
})
