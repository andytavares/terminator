import { create } from 'zustand'
import { useEffect } from 'react'
import { useWorkThreads } from './useWorkThreads'
import { latestResumableThread } from '../../home/work-threads'
import { deskGroups, filterThreads, visibleThreadKeys, type DeskGroupBy } from './desk-groups'
import { useDeskFilter } from './desk-filter'

interface DeskSelectionState {
  /** The row the keyboard is on. */
  selectedThreadKey: string | null
  /** The work thread whose drawer is open. */
  openThreadKey: string | null
  groupBy: DeskGroupBy
  /** Quick actions asked to resume; Home opens the thread holding the latest conversation. */
  resumeRequested: boolean
  /** Ids of collapsible groups the operator opened; Parked starts closed. */
  expandedGroupIds: string[]
  select: (key: string | null) => void
  openThread: (key: string) => void
  closeThread: () => void
  requestResume: () => void
  setGroupBy: (groupBy: DeskGroupBy) => void
  toggleGroup: (id: string) => void
}

export const useDeskSelection = create<DeskSelectionState>((set) => ({
  selectedThreadKey: null,
  openThreadKey: null,
  groupBy: 'move',
  resumeRequested: false,
  expandedGroupIds: [],
  select: (key) => set({ selectedThreadKey: key }),
  openThread: (key) => set({ selectedThreadKey: key, openThreadKey: key }),
  closeThread: () => set({ openThreadKey: null }),
  requestResume: () => set({ resumeRequested: true }),
  setGroupBy: (groupBy) => set({ groupBy }),
  toggleGroup: (id) =>
    set((s) => ({
      expandedGroupIds: s.expandedGroupIds.includes(id)
        ? s.expandedGroupIds.filter((open) => open !== id)
        : [...s.expandedGroupIds, id],
    })),
}))

/** The keys of the rows on the Desk, top to bottom, as drawn: a collapsed Parked group has none. */
export function useOrderedThreadKeys(): string[] {
  const { threads } = useWorkThreads()
  const { text, count } = useDeskFilter()
  const groupBy = useDeskSelection((s) => s.groupBy)
  const expandedGroupIds = useDeskSelection((s) => s.expandedGroupIds)
  return visibleThreadKeys(
    deskGroups(filterThreads(threads, { text, count }), groupBy),
    expandedGroupIds
  )
}

/** Opens the drawer a "Resume a conversation" quick action asked for, once Home has a thread to show. */
export function useOpenRequestedResume(): void {
  const requested = useDeskSelection((s) => s.resumeRequested)
  const { threads } = useWorkThreads()
  useEffect(() => {
    const target = requested ? latestResumableThread(threads) : undefined
    if (!target) return
    useDeskSelection.setState({ resumeRequested: false })
    useDeskSelection.getState().openThread(target.key)
  }, [requested, threads])
}
