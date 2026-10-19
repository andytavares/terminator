import { create } from 'zustand'
import { readStoredJson, writeStoredJson } from '../../home/local-storage'

export const PARKED_THREADS_KEY = 'terminator.home.parked-threads'

interface ParkedThreadsState {
  /** Work keys the operator parked by hand; the Desk lists them under Parked. */
  keys: string[]
  park: (key: string) => void
  unpark: (key: string) => void
}

function rememberParked(keys: string[]): string[] {
  writeStoredJson(PARKED_THREADS_KEY, keys)
  return keys
}

export const useParkedThreads = create<ParkedThreadsState>((set) => ({
  keys: readStoredJson<string[]>(PARKED_THREADS_KEY, []),
  park: (key) =>
    set((s) => ({ keys: s.keys.includes(key) ? s.keys : rememberParked([...s.keys, key]) })),
  unpark: (key) => set((s) => ({ keys: rememberParked(s.keys.filter((k) => k !== key)) })),
}))
