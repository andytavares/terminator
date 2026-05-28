import { create } from 'zustand'
import type { DailyLog, IndexedTask } from '../vault/types'

export type VaultView = 'daily' | 'inbox' | 'projects' | 'areas' | 'archive' | 'review'
export type ViewMode = 'list' | 'kanban'

const KANBAN_MODE_KEY = 'task-vault.kanbanMode'
const CONTEXT_FILTER_KEY = 'task-vault.selectedContexts'

function loadSelectedContexts(): string[] {
  try {
    const raw = localStorage.getItem(CONTEXT_FILTER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parsed as string[]
    return []
  } catch {
    return []
  }
}

interface VaultStore {
  vaultPath: string
  todayLog: DailyLog | null
  inboxCount: number
  somedayTasks: IndexedTask[]
  loadSomeday: () => Promise<void>
  activeView: VaultView
  viewMode: ViewMode
  selectedContexts: string[]
  isLoading: boolean
  error: string | null
  showCaptureModal: boolean
  selectedAreaName: string | null
  selectedProjectName: string | null
  lastRolledOver: number
  rolledOverTaskIds: string[]
  pendingTaskId: string | null
  viewingDate: string | null
  loadToday: () => Promise<void>
  loadDate: (date: string) => Promise<void>
  setView: (view: VaultView) => void
  setViewMode: (mode: ViewMode) => void
  setSelectedContexts: (ctxs: string[]) => void
  toggleContext: (ctx: string) => void
  refreshInboxCount: () => Promise<void>
  setVaultPath: (p: string) => void
  setShowCaptureModal: (show: boolean) => void
  navToArea: (name: string) => void
  navToProject: (name: string) => void
  navigateToTask: (taskId: string) => void
  clearPendingTask: () => void
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  vaultPath: '',
  todayLog: null,
  inboxCount: 0,
  somedayTasks: [],
  activeView: 'daily',
  viewMode: (localStorage.getItem(KANBAN_MODE_KEY) as ViewMode | null) ?? 'list',
  selectedContexts: loadSelectedContexts(),
  isLoading: false,
  error: null,
  showCaptureModal: false,
  selectedAreaName: null,
  selectedProjectName: null,
  lastRolledOver: 0,
  rolledOverTaskIds: [],
  pendingTaskId: null,
  viewingDate: null,

  setVaultPath: (p: string) => set({ vaultPath: p }),

  setView: (view: VaultView) => set({ activeView: view }),

  setViewMode: (mode: ViewMode) => {
    localStorage.setItem(KANBAN_MODE_KEY, mode)
    set({ viewMode: mode })
  },

  setSelectedContexts: (ctxs: string[]) => {
    if (ctxs.length === 0) {
      localStorage.removeItem(CONTEXT_FILTER_KEY)
    } else {
      localStorage.setItem(CONTEXT_FILTER_KEY, JSON.stringify(ctxs))
    }
    set({ selectedContexts: ctxs })
  },

  toggleContext: (ctx: string) => {
    const current = get().selectedContexts
    const next = current.includes(ctx) ? current.filter((c) => c !== ctx) : [...current, ctx]
    const store = get()
    store.setSelectedContexts(next)
  },

  setShowCaptureModal: (show: boolean) => set({ showCaptureModal: show }),

  navToArea: (name: string) =>
    set({ activeView: 'areas', selectedAreaName: name, selectedProjectName: null }),

  navToProject: (name: string) =>
    set({ activeView: 'projects', selectedProjectName: name, selectedAreaName: null }),

  navigateToTask: (taskId: string) =>
    set({ activeView: 'daily', pendingTaskId: taskId, viewingDate: null }),

  clearPendingTask: () => set({ pendingTaskId: null }),

  loadToday: async () => {
    set({ isLoading: true, error: null, viewingDate: null })
    try {
      const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:get-today')
      if (result && typeof result === 'object' && 'error' in result) {
        set({ error: (result as { error: string }).error, isLoading: false })
        return
      }
      const res = result as DailyLog & { rolledOver?: number; rolledOverIds?: string[] }
      set({
        todayLog: res,
        isLoading: false,
        lastRolledOver: res.rolledOver ?? 0,
        rolledOverTaskIds: res.rolledOverIds ?? [],
      })
    } catch (err) {
      set({ error: String(err), isLoading: false })
    }
  },

  loadDate: async (date: string) => {
    set({ isLoading: true, error: null, viewingDate: date })
    try {
      const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:get-daily', {
        date,
      })
      if (result && typeof result === 'object' && 'error' in result) {
        set({ error: (result as { error: string }).error, isLoading: false })
        return
      }
      const res = result as DailyLog
      set({ todayLog: res, isLoading: false, rolledOverTaskIds: [] })
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
