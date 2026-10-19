import { create } from 'zustand'
import { readStoredJson, writeStoredJson } from './local-storage'
import { storedFocusOf } from './stored-shapes'
import { FOCUS_LIMIT, localDateKey, type FocusItem } from './focus'

/** @internal */
export const FOCUS_KEY = 'terminator.home.focus'
const KEPT_DAYS = 7

interface Persisted {
  days: Record<string, FocusItem[]>
  /** The local day whose Plan today band was started or skipped. */
  planDismissedOn: string | null
  /** The Plan today band stays folded until it is expanded again, across days. */
  planCollapsed: boolean
}

interface FocusState extends Persisted {
  /** Picks an item for today; a fourth, or one already picked, is ignored. */
  pickFocus: (item: Omit<FocusItem, 'doneByHand'>) => void
  removeFocus: (id: string) => void
  toggleDone: (id: string) => void
  /** Hides the Plan today band for the rest of the local day of `now`. */
  dismissPlan: (now: number) => void
  /** Folds the Plan today band to its head, or opens it again. */
  togglePlanCollapsed: () => void
}

function newestDays(days: Persisted['days']): Persisted['days'] {
  const kept = Object.keys(days).sort().slice(-KEPT_DAYS)
  return Object.fromEntries(kept.map((day) => [day, days[day]]))
}

function persist(state: Persisted): Persisted {
  writeStoredJson(FOCUS_KEY, {
    days: state.days,
    planDismissedOn: state.planDismissedOn,
    planCollapsed: state.planCollapsed,
  })
  return state
}

/** Applies `change` to today's items and persists the result. */
function updateToday(state: Persisted, change: (items: FocusItem[]) => FocusItem[]): Persisted {
  const today = localDateKey(Date.now())
  const days = newestDays({ ...state.days, [today]: change(state.days[today] ?? []) })
  return persist({ ...state, days })
}

export const useFocusStore = create<FocusState>((set) => ({
  ...readStoredJson<Persisted>(
    FOCUS_KEY,
    { days: {}, planDismissedOn: null, planCollapsed: false },
    storedFocusOf
  ),
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
  dismissPlan: (now) => set((s) => persist({ ...s, planDismissedOn: localDateKey(now) })),
  togglePlanCollapsed: () => set((s) => persist({ ...s, planCollapsed: !s.planCollapsed })),
}))
