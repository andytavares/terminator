import { create, type StoreApi } from 'zustand'
import type { DailyLog, IndexedTask, KanbanLane } from '../vault/types'
import { useVaultNavStore } from './vault-nav.store'
import { localDate } from '../vault/recurrence'

interface VaultDataStore {
  todayLog: DailyLog | null
  inboxCount: number
  somedayTasks: IndexedTask[]
  calendarRefreshKey: number
  tickCalendar: () => void
  kanbanLanes: KanbanLane[]
  setKanbanLanes: (lanes: KanbanLane[]) => void
  isLoading: boolean
  error: string | null
  lastRolledOver: number
  rolledOverTaskIds: string[]
  staleDaysThreshold: number
  loadToday: () => Promise<void>
  loadDate: (date: string) => Promise<void>
  refreshInboxCount: () => Promise<void>
  loadSomeday: () => Promise<void>
}

type SetState = StoreApi<VaultDataStore>['setState']

/** The error a vault channel answered with, if it answered with one. */
function errorOf(result: unknown): string | null {
  if (result && typeof result === 'object' && 'error' in result) {
    return (result as { error: string }).error
  }
  return null
}

type TodayResult = DailyLog & {
  rolledOver?: number
  rolledOverIds?: string[]
  staleDaysThreshold?: number
}

async function fetchTodayInto(set: SetState): Promise<void> {
  set({ isLoading: true, error: null })
  try {
    const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:get-today')
    const error = errorOf(result)
    if (error !== null) return set({ error, isLoading: false })
    const res = result as TodayResult
    useVaultNavStore.getState().setViewingDate(localDate())
    set((s) => ({
      todayLog: res,
      isLoading: false,
      lastRolledOver: res.rolledOver ?? 0,
      rolledOverTaskIds: res.rolledOverIds ?? [],
      staleDaysThreshold: res.staleDaysThreshold ?? s.staleDaysThreshold,
      calendarRefreshKey: s.calendarRefreshKey + 1,
    }))
  } catch (err) {
    set({ error: String(err), isLoading: false })
  }
}

async function loadDate(set: SetState, date: string): Promise<void> {
  set({ isLoading: true, error: null })
  try {
    const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:get-daily', {
      date,
    })
    const error = errorOf(result)
    if (error !== null) return set({ error, isLoading: false })
    useVaultNavStore.getState().setViewingDate(date)
    set((s) => ({
      todayLog: result as DailyLog,
      isLoading: false,
      rolledOverTaskIds: [],
      calendarRefreshKey: s.calendarRefreshKey + 1,
    }))
  } catch (err) {
    set({ error: String(err), isLoading: false })
  }
}

/** The tasks a list channel answered with; null when it answered anything else. */
async function listedTasks<T>(channel: string): Promise<T[] | null> {
  try {
    const result = await window.electronAPI.extensionBridge.invoke(channel)
    if (result && typeof result === 'object' && 'tasks' in result) {
      return (result as { tasks: T[] }).tasks
    }
  } catch {
    // non-critical
  }
  return null
}

export const useVaultDataStore = create<VaultDataStore>((set) => ({
  todayLog: null,
  inboxCount: 0,
  somedayTasks: [],
  calendarRefreshKey: 0,
  tickCalendar: () => set((s) => ({ calendarRefreshKey: s.calendarRefreshKey + 1 })),
  kanbanLanes: [],
  setKanbanLanes: (lanes: KanbanLane[]) => set({ kanbanLanes: lanes }),
  isLoading: false,
  error: null,
  lastRolledOver: 0,
  rolledOverTaskIds: [],
  staleDaysThreshold: 7,
  loadToday: () => fetchTodayInto(set),
  loadDate: (date: string) => loadDate(set, date),
  refreshInboxCount: async () => {
    const tasks = await listedTasks<{ status: string }>('task-vault:vault:get-inbox')
    if (tasks) set({ inboxCount: tasks.length })
  },
  loadSomeday: async () => {
    const tasks = await listedTasks<IndexedTask>('task-vault:vault:list-someday')
    if (tasks) set({ somedayTasks: tasks })
  },
}))
