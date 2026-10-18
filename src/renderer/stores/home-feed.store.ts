import { create } from 'zustand'
import type { MergedHomeFeed } from '../../shared/schemas/home-feed.schema'

// The renderer's mirror of what extensions have published for Home (ADR 117).

interface HomeFeedState extends MergedHomeFeed {
  load: () => Promise<void>
  subscribe: () => () => void
  /** Resolves false when the extension could not run the action. */
  runAction: (source: string, itemId: string, actionId: string) => Promise<boolean>
}

function api(): Partial<Window['electronAPI']['homeFeed']> {
  return window.electronAPI?.homeFeed ?? {}
}

export const useHomeFeedStore = create<HomeFeedState>((set) => ({
  asks: [],
  facets: [],
  measures: [],
  focus: [],
  load: async () => {
    try {
      const result = await api().get?.()
      if (result !== undefined) set(result.data)
    } catch {
      // Keep the last known feed rather than blanking Home.
    }
  },
  subscribe: () => {
    const on = api().onChanged
    if (typeof on !== 'function') return () => {}
    return on((feed) => set(feed))
  },
  runAction: async (source, itemId, actionId) => {
    const result = await api().action?.({ source, itemId, actionId })
    return result !== undefined && 'data' in result
  },
}))
