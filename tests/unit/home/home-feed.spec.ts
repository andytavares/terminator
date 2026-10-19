import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fullFeed } from './home-feed.fixtures'

const log = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('../../../src/main/logger', () => ({ logger: { error: log.error } }))

async function load() {
  vi.resetModules()
  return import('../../../src/main/home/home-feed')
}

beforeEach(() => vi.clearAllMocks())

describe('home feed publishing', () => {
  it('starts empty', async () => {
    const feed = await load()
    expect(feed.getMergedFeed()).toEqual({ asks: [], facets: [], measures: [], focus: [] })
  })

  it('tags every item with the extension that published it', async () => {
    const feed = await load()
    feed.publishFeed('git-integration', fullFeed())
    const merged = feed.getMergedFeed()
    expect(merged.asks.map((a) => [a.id, a.source])).toEqual([['ask-1', 'git-integration']])
    expect(merged.facets[0].source).toBe('git-integration')
    expect(merged.measures[0].source).toBe('git-integration')
    expect(merged.focus[0].source).toBe('git-integration')
  })

  it('replaces what the same extension published before', async () => {
    const feed = await load()
    feed.publishFeed('git-integration', fullFeed())
    feed.publishFeed('git-integration', { ...fullFeed(), asks: [] })
    expect(feed.getMergedFeed().asks).toEqual([])
  })

  it('keeps extensions apart and merges them', async () => {
    const feed = await load()
    feed.publishFeed('a', fullFeed())
    feed.publishFeed('b', fullFeed())
    expect(feed.getMergedFeed().asks.map((x) => x.source)).toEqual(['a', 'b'])
    feed.clearFeed('a')
    expect(feed.getMergedFeed().asks.map((x) => x.source)).toEqual(['b'])
  })
})

describe('home feed validation and listeners', () => {
  it('rejects an invalid feed with a logged error naming the extension and field, keeping the old one', async () => {
    const feed = await load()
    feed.publishFeed('git-integration', fullFeed())
    const bad = { ...fullFeed(), asks: [{ ...fullFeed().asks[0], kind: 'panic' }] }
    expect(() => feed.publishFeed('git-integration', bad as never)).not.toThrow()
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('git-integration'))
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('asks.0.kind'))
    expect(feed.getMergedFeed().asks).toHaveLength(1)
  })

  it('tells listeners on every change, and not after they unsubscribe', async () => {
    const feed = await load()
    const listener = vi.fn()
    const off = feed.onFeedChange(listener)
    feed.publishFeed('a', fullFeed())
    feed.clearFeed('a')
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    feed.publishFeed('a', fullFeed())
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('home feed actions', () => {
  it('routes an action to the handler its extension registered', async () => {
    const feed = await load()
    const a = vi.fn().mockResolvedValue(undefined)
    const b = vi.fn().mockResolvedValue(undefined)
    feed.setActionHandler('a', a)
    feed.setActionHandler('b', b)
    await feed.runAction('b', 'ask-1', 'approve')
    expect(b).toHaveBeenCalledWith('ask-1', 'approve')
    expect(a).not.toHaveBeenCalled()
  })

  it('reports an action for an extension with no handler', async () => {
    const feed = await load()
    await expect(feed.runAction('ghost', 'ask-1', 'approve')).rejects.toThrow(/ghost/)
  })

  it('stops routing once the handler is disposed', async () => {
    const feed = await load()
    const dispose = feed.setActionHandler('a', vi.fn())
    dispose()
    await expect(feed.runAction('a', 'x', 'y')).rejects.toThrow(/a/)
  })
})
