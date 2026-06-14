import { create } from 'zustand'
import type { DailyLog, IndexedTask, KanbanLane } from '../vault/types'
import { useVaultNavStore } from './vault-nav.store'

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
  loadToday: () => Promise<void>
  loadDate: (date: string) => Promise<void>
  refreshInboxCount: () => Promise<void>
  loadSomeday: () => Promise<void>
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

  loadToday: async () => {
    set({ isLoading: true, error: null })
    try {
      const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:get-today')
      if (result && typeof result === 'object' && 'error' in result) {
        set({ error: (result as { error: string }).error, isLoading: false })
        return
      }
      const res = result as DailyLog & { rolledOver?: number; rolledOverIds?: string[] }
      const d = new Date()
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      useVaultNavStore.getState().setViewingDate(today)
      set((s) => ({
        todayLog: res,
        isLoading: false,
        lastRolledOver: res.rolledOver ?? 0,
        rolledOverTaskIds: res.rolledOverIds ?? [],
        calendarRefreshKey: s.calendarRefreshKey + 1,
      }))
    } catch (err) {
      set({ error: String(err), isLoading: false })
    }
  },

  loadDate: async (date: string) => {
    set({ isLoading: true, error: null })
    try {
      const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:get-daily', {
        date,
      })
      if (result && typeof result === 'object' && 'error' in result) {
        set({ error: (result as { error: string }).error, isLoading: false })
        return
      }
      const res = result as DailyLog
      useVaultNavStore.getState().setViewingDate(date)
      set((s) => ({
        todayLog: res,
        isLoading: false,
        rolledOverTaskIds: [],
        calendarRefreshKey: s.calendarRefreshKey + 1,
      }))
    } catch (err) {
      set({ error: String(err), isLoading: false })
    }
  },

  refreshInboxCount: async () => {
    try {
      const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:get-inbox')
      if (result && typeof result === 'object' && 'tasks' in result) {
        const { tasks } = result as { tasks: { status: string }[] }
        set({ inboxCount: tasks.length })
      }
    } catch {
      // non-critical
    }
  },

  loadSomeday: async () => {
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'task-vault:vault:list-someday'
      )
      if (result && typeof result === 'object' && 'tasks' in result) {
        set({ somedayTasks: (result as { tasks: IndexedTask[] }).tasks })
      }
    } catch {
      // non-critical
    }
  },
}))
