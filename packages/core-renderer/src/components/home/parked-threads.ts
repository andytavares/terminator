import { create } from 'zustand'
import { readStoredJson, writeStoredJson } from '../../home/local-storage'
import { storedParkedOf } from '../../home/stored-shapes'

/** @internal */
export const PARKED_THREADS_KEY = 'terminator.home.parked-threads'
const FORGOTTEN_AFTER_MS = 30 * 24 * 60 * 60 * 1000

interface ParkedThreadsState {
  /** Work keys the operator parked by hand; the Desk lists them under Parked. */
  keys: string[]
  /** When each key was parked. */
  parkedAt: Record<string, number>
  park: (key: string) => void
  unpark: (key: string) => void
  /** Forgets keys parked over 30 days ago whose thread is not among `liveKeys` any more. */
  forgetGone: (liveKeys: ReadonlySet<string>, now: number) => void
}

/** The state for `keys`, each with the time it was parked (now, for one not seen before). */
function remember(keys: string[], parkedAt: Record<string, number>): Partial<ParkedThreadsState> {
  const kept = Object.fromEntries(keys.map((key) => [key, parkedAt[key] ?? Date.now()]))
  writeStoredJson(PARKED_THREADS_KEY, kept)
  return { keys, parkedAt: kept }
}

const storedParked = readStoredJson<Record<string, number>>(PARKED_THREADS_KEY, {}, (value) =>
  storedParkedOf(value, Date.now())
)

export const useParkedThreads = create<ParkedThreadsState>((set) => ({
  keys: Object.keys(storedParked),
  parkedAt: storedParked,
  park: (key) => set((s) => (s.keys.includes(key) ? s : remember([...s.keys, key], s.parkedAt))),
  unpark: (key) =>
    set((s) =>
      remember(
        s.keys.filter((k) => k !== key),
        s.parkedAt
      )
    ),
  forgetGone: (liveKeys, now) =>
    set((s) => {
      const isRemembered = (key: string): boolean =>
        liveKeys.has(key) || now - (s.parkedAt[key] ?? now) < FORGOTTEN_AFTER_MS
      const keys = s.keys.filter(isRemembered)
      return keys.length === s.keys.length ? s : remember(keys, s.parkedAt)
    }),
}))
