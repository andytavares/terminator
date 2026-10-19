import { create } from 'zustand'
import { readStoredJson, writeStoredJson } from './local-storage'
import { FOCUS_LIMIT, localDateKey, type FocusItem } from './focus'

export const FOCUS_KEY = 'terminator.home.focus'
const KEPT_DAYS = 7

interface Persisted {
  days: Record<string, FocusItem[]>
  lastLeftHomeAt: number | null
}

interface FocusState extends Persisted {
  /** Picks an item for today; a fourth, or one already picked, is ignored. */
  pickFocus: (item: Omit<FocusItem, 'doneByHand'>) => void
  removeFocus: (id: string) => void
  toggleDone: (id: string) => void
  /** Remembers when the operator last looked at Home, for "Since you left". */
  markLeftHome: (now: number) => void
}

function newestDays(days: Persisted['days']): Persisted['days'] {
  const kept = Object.keys(days).sort().slice(-KEPT_DAYS)
  return Object.fromEntries(kept.map((day) => [day, days[day]]))
}

function persist(state: Persisted): Persisted {
  writeStoredJson(FOCUS_KEY, { days: state.days, lastLeftHomeAt: state.lastLeftHomeAt })
  return state
}

/** Applies `change` to today's items and persists the result. */
function updateToday(state: Persisted, change: (items: FocusItem[]) => FocusItem[]): Persisted {
  const today = localDateKey(Date.now())
  const days = newestDays({ ...state.days, [today]: change(state.days[today] ?? []) })
  return persist({ ...state, days })
}

export const useFocusStore = create<FocusState>((set) => ({
  ...readStoredJson<Persisted>(FOCUS_KEY, { days: {}, lastLeftHomeAt: null }),
  pickFocus: (item) =>
    set((s) =>
      updateToday(s, (items) =>
        items.length >= FOCUS_LIMIT || items.some((i) => i.id === item.id)
          ? items
          : [...items, { ...item, doneByHand: false }]
      )
    ),
  removeFocus: (id) => set((s) => updateToday(s, (items) => items.filter((i) => i.id !== id))),
  toggleDone: (id) =>
    set((s) =>
      updateToday(s, (items) =>
        items.map((i) => (i.id === id ? { ...i, doneByHand: !i.doneByHand } : i))
      )
    ),
  markLeftHome: (now) => set((s) => persist({ ...s, lastLeftHomeAt: now })),
}))
