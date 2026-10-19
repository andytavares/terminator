import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fullFeed } from '../../home/home-feed.fixtures'

const homeFeed = {
  get: vi.fn(),
  action: vi.fn(),
  onChanged: vi.fn(),
}
Object.defineProperty(globalThis, 'window', {
  value: { electronAPI: { homeFeed } },
  writable: true,
})

import { useHomeFeedStore } from '../../../../src/renderer/stores/home-feed.store'

const merged = () => {
  const feed = fullFeed()
  return {
    asks: feed.asks.map((x) => ({ ...x, source: 'git-integration' })),
    facets: feed.facets.map((x) => ({ ...x, source: 'git-integration' })),
    measures: feed.measures.map((x) => ({ ...x, source: 'git-integration' })),
    focus: feed.focus!.map((x) => ({ ...x, source: 'git-integration' })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useHomeFeedStore.setState({ asks: [], facets: [], measures: [], focus: [] })
})

describe('useHomeFeedStore', () => {
  it('loads the merged feed', async () => {
    homeFeed.get.mockResolvedValue({ data: merged() })
    await useHomeFeedStore.getState().load()
    expect(useHomeFeedStore.getState().asks[0].source).toBe('git-integration')
    expect(useHomeFeedStore.getState().focus).toHaveLength(1)
  })

  it('keeps the last feed when the load fails', async () => {
    useHomeFeedStore.setState(merged())
    homeFeed.get.mockRejectedValue(new Error('gone'))
    await useHomeFeedStore.getState().load()
    expect(useHomeFeedStore.getState().asks).toHaveLength(1)
  })
})

describe('useHomeFeedStore pushes and actions', () => {
  it('applies a push', () => {
    let push: (feed: ReturnType<typeof merged>) => void = () => {}
    homeFeed.onChanged.mockImplementation((handler) => {
      push = handler
      return () => {}
    })
    useHomeFeedStore.getState().subscribe()
    push(merged())
    expect(useHomeFeedStore.getState().measures[0].id).toBe('shipped')
  })

  it('sends an action to main with its source and reports whether it ran, and why not', async () => {
    homeFeed.action.mockResolvedValue({ data: true })
    expect(
      await useHomeFeedStore.getState().runAction('git-integration', 'ask-1', 'approve')
    ).toEqual({ ok: true })
    expect(homeFeed.action).toHaveBeenCalledWith({
      source: 'git-integration',
      itemId: 'ask-1',
      actionId: 'approve',
    })
    homeFeed.action.mockResolvedValue({ error: 'failed', message: 'no handler' })
    expect(await useHomeFeedStore.getState().runAction('x', 'i', 'a')).toEqual({
      ok: false,
      message: 'no handler',
    })
  })
})
