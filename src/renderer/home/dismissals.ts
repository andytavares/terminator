import { create } from 'zustand'
import { readStoredJson, writeStoredJson } from './local-storage'
import type { Dismissal, Dismissals } from './desk-order'

export const DISMISSALS_KEY = 'terminator.home.dismissals'
const EXPIRES_AFTER_MS = 7 * 24 * 60 * 60 * 1000

interface DismissalsState {
  entries: Dismissals
  markDone: (id: string) => void
  snooze: (id: string, until: number, signature: string) => void
  /** How many items were marked done on the local day of `now`. */
  doneToday: (now: number) => number
}

function unexpired(entries: Dismissals, now: number): Dismissals {
  return Object.fromEntries(
    Object.entries(entries).filter(([, entry]) => now - entry.at < EXPIRES_AFTER_MS)
  )
}

function sameLocalDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

function rememberDismissal(entries: Dismissals, id: string, entry: Dismissal): Dismissals {
  const next = unexpired({ ...entries, [id]: entry }, entry.at)
  writeStoredJson(DISMISSALS_KEY, next)
  return next
}

export const useDismissalsStore = create<DismissalsState>((set, get) => ({
  entries: unexpired(readStoredJson<Dismissals>(DISMISSALS_KEY, {}), Date.now()),
  markDone: (id) =>
    set((s) => ({ entries: rememberDismissal(s.entries, id, { kind: 'done', at: Date.now() }) })),
  snooze: (id, until, signature) =>
    set((s) => ({
      entries: rememberDismissal(s.entries, id, {
        kind: 'snoozed',
        at: Date.now(),
        until,
        signature,
      }),
    })),
  doneToday: (now) =>
    Object.values(get().entries).filter((e) => e.kind === 'done' && sameLocalDay(e.at, now)).length,
}))
