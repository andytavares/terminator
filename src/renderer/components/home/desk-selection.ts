import { create } from 'zustand'
import { useEffect } from 'react'
import { useWorkThreads } from './useWorkThreads'
import { latestResumableSession, type WorkThread } from '../../home/work-threads'
import { resumeSession } from '../../terminal/start-session'
import {
  deskGroups,
  filterThreads,
  taskGroups,
  visibleThreadKeys,
  type DeskGroup,
  type DeskGroupBy,
} from './desk-groups'
import { useHomeLayout } from './home-layout'
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

/** The keys of the rows on Home, top to bottom, as drawn: a folded group has none. */
export function useOrderedThreadKeys(): string[] {
  const { threads } = useWorkThreads()
  const { text, count, taskState } = useDeskFilter()
  const groupBy = useDeskSelection((s) => s.groupBy)
  const expandedGroupIds = useDeskSelection((s) => s.expandedGroupIds)
  const grouped = useHomeLayout() === 'tasks' ? taskGroups : deskGroups
  return visibleThreadKeys(
    grouped(filterThreads(threads, { text, count, taskState }), groupBy),
    expandedGroupIds
  )
}

/** Resumes the latest ended conversation when a "Resume a conversation" quick action asks. A closed
 * session is no longer on Home (ADR 146), so it reopens straight away rather than in a drawer. */
export function useOpenRequestedResume(): void {
  const requested = useDeskSelection((s) => s.resumeRequested)
  const { allThreads } = useWorkThreads()
  useEffect(() => {
    const target = requested ? latestResumableSession(allThreads) : undefined
    if (!target) return
    useDeskSelection.setState({ resumeRequested: false })
    void resumeSession(target)
  }, [requested, allThreads])
}

/** The selected row's key, and a group's threads when they show: none while it is folded. */
export function useShownRows(group: DeskGroup): {
  selectedKey: string | null
  threads: WorkThread[]
} {
  const selectedKey = useDeskSelection((s) => s.selectedThreadKey)
  const expanded = useDeskSelection((s) => s.expandedGroupIds.includes(group.id))
  return { selectedKey, threads: group.collapsible && !expanded ? [] : group.threads }
}
