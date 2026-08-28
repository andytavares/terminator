import { create } from 'zustand'
import type { ChangeStats } from '../../shared/schemas/git.schema'

/**
 * How long a cached answer stays good. The sidebar re-renders on every session
 * state change; without a window here that would be one `git diff` spawn per
 * branch per render.
 */
export const CHANGE_STATS_TTL_MS = 15_000

export interface ChangeStatsEntry {
  stats: ChangeStats | null
  /** Epoch ms, supplied by the caller — this store holds no clock. */
  fetchedAt: number
  state: 'loading' | 'ready' | 'error'
}

interface ChangeStatsState {
  entries: Map<string, ChangeStatsEntry>
  statsFor: (branchId: string) => ChangeStatsEntry | undefined
  /**
   * Requests statistics for a branch unless a fresh answer is already cached.
   * Returns void deliberately: render calls this, and render must never await
   * git. A branch with no entry simply draws no statistics.
   */
  ensure: (branchId: string, cwd: string, now: number) => void
  invalidate: (branchId: string) => void
  invalidateAll: () => void
}

/**
 * Branches with a request in flight. Held outside the store because it is not
 * view state — it exists only to stop three rows of the same branch firing
 * three identical spawns in one render pass.
 */
const inFlight = new Set<string>()

export const useChangeStatsStore = create<ChangeStatsState>((set, get) => ({
  entries: new Map(),

  statsFor: (branchId) => get().entries.get(branchId),

  ensure: (branchId, cwd, now) => {
    const existing = get().entries.get(branchId)
    // An error is cached like a success, so a repo git cannot read is retried
    // on the same schedule as one it can rather than on every render.
    if (existing && now - existing.fetchedAt <= CHANGE_STATS_TTL_MS) return
    if (inFlight.has(branchId)) return

    inFlight.add(branchId)
    const settle = (entry: ChangeStatsEntry): void => {
      inFlight.delete(branchId)
      set((s) => {
        const entries = new Map(s.entries)
        entries.set(branchId, entry)
        return { entries }
      })
    }

    // The API is absent in the remote renderer and before preload attaches.
    // Treat that as "statistics unavailable", never as a crash — the row is
    // supposed to survive git being unreachable.
    const api = window.electronAPI?.git
    if (!api?.changeStats) {
      settle({ stats: null, fetchedAt: now, state: 'error' })
      return
    }

    void api
      .changeStats(cwd)
      .then((result) => {
        if ('error' in result) {
          settle({ stats: null, fetchedAt: now, state: 'error' })
          return
        }
        settle({ stats: result, fetchedAt: now, state: 'ready' })
      })
      .catch(() => settle({ stats: null, fetchedAt: now, state: 'error' }))
  },

  invalidate: (branchId) => {
    inFlight.delete(branchId)
    set((s) => {
      if (!s.entries.has(branchId)) return s
      const entries = new Map(s.entries)
      entries.delete(branchId)
      return { entries }
    })
  },

  invalidateAll: () => {
    inFlight.clear()
    set({ entries: new Map() })
  },
}))
