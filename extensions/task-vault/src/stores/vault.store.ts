import { create } from 'zustand'
import type { DailyLog } from '../vault/types'

export type VaultView = 'daily' | 'inbox' | 'projects' | 'areas' | 'archive' | 'review'

interface VaultStore {
  vaultPath: string
  todayLog: DailyLog | null
  inboxCount: number
  activeView: VaultView
  isLoading: boolean
  error: string | null
  loadToday: () => Promise<void>
  setView: (view: VaultView) => void
  refreshInboxCount: () => Promise<void>
  setVaultPath: (p: string) => void
}

export const useVaultStore = create<VaultStore>((set, _get) => ({
  vaultPath: '',
  todayLog: null,
  inboxCount: 0,
  activeView: 'daily',
  isLoading: false,
  error: null,

  setVaultPath: (p: string) => set({ vaultPath: p }),

  setView: (view: VaultView) => set({ activeView: view }),

  loadToday: async () => {
    set({ isLoading: true, error: null })
    try {
      const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:get-today')
      if (result && typeof result === 'object' && 'error' in result) {
        set({ error: (result as { error: string }).error, isLoading: false })
        return
      }
      set({ todayLog: result as DailyLog, isLoading: false })
    } catch (err) {
      set({ error: String(err), isLoading: false })
    }
  },

  refreshInboxCount: async () => {
    try {
      const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:get-today')
      if (result && typeof result === 'object' && 'tasks' in result) {
        const log = result as DailyLog
        set({ inboxCount: log.tasks.filter((t) => t.status === 'open').length })
      }
    } catch {
      // non-critical
    }
  },
}))
