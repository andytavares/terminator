import { create } from 'zustand'

/** What the main area shows: the registry's active tabs, and the branch and terminal behind them. */
export interface NavigationEntry {
  globalTabId: string | null
  workspaceTabId: string | null
  projectTabId: string | null
  projectId: string | null
  sessionId: string | null
}

/** What reopening a closed terminal needs. Scrollback is not kept. */
interface ClosedTab {
  projectId: string
  cwd: string
  title: string
}

const MAX_ENTRIES = 50
const MAX_CLOSED_TABS = 10

interface NavigationState {
  entries: NavigationEntry[]
  /** The entry on screen; back and forward move it. */
  cursor: number
  closedTabs: ClosedTab[]
  /** Adds what is now shown, unless it is the entry already current. */
  record: (entry: NavigationEntry) => void
  /** Moves the cursor by `delta` and returns the entry there; null at either end. */
  step: (delta: -1 | 1) => NavigationEntry | null
  rememberClosed: (tab: ClosedTab) => void
  takeClosed: () => ClosedTab | undefined
}

const sameEntry = (a: NavigationEntry | undefined, b: NavigationEntry): boolean =>
  a !== undefined &&
  a.globalTabId === b.globalTabId &&
  a.workspaceTabId === b.workspaceTabId &&
  a.projectTabId === b.projectTabId &&
  a.projectId === b.projectId &&
  a.sessionId === b.sessionId

export const useNavigationStore = create<NavigationState>((set, get) => ({
  entries: [],
  cursor: -1,
  closedTabs: [],

  record: (entry) => {
    const { entries, cursor } = get()
    if (sameEntry(entries[cursor], entry)) return
    const kept = [...entries.slice(0, cursor + 1), entry].slice(-MAX_ENTRIES)
    set({ entries: kept, cursor: kept.length - 1 })
  },

  step: (delta) => {
    const { entries, cursor } = get()
    const target = cursor + delta
    if (target < 0 || target >= entries.length) return null
    set({ cursor: target })
    return entries[target]
  },

  rememberClosed: (tab) =>
    set((s) => ({ closedTabs: [...s.closedTabs, tab].slice(-MAX_CLOSED_TABS) })),

  takeClosed: () => {
    const { closedTabs } = get()
    const tab = closedTabs[closedTabs.length - 1]
    if (tab) set((s) => ({ closedTabs: s.closedTabs.slice(0, -1) }))
    return tab
  },
}))
