import { create } from 'zustand'
import type { MergedHomeFeed } from '../../shared/schemas/home-feed.schema'

// The renderer's mirror of what extensions have published for Home (ADR 117).

/** Whether the extension ran an action, and why not when it did not. */
export type ActionResult = { ok: true } | { ok: false; message: string }

interface HomeFeedState extends MergedHomeFeed {
  load: () => Promise<void>
  subscribe: () => () => void
  runAction: (source: string, itemId: string, actionId: string) => Promise<ActionResult>
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
    if (result === undefined) return { ok: false, message: 'Home is not ready yet.' }
    return 'data' in result ? { ok: true } : { ok: false, message: result.message }
  },
}))
