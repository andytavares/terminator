import { create } from 'zustand'

export type VaultView = 'daily' | 'inbox' | 'projects' | 'areas' | 'archive' | 'review'

interface VaultNavStore {
  activeView: VaultView
  selectedAreaName: string | null
  selectedProjectName: string | null
  pendingTaskId: string | null
  viewingDate: string | null
  showCaptureModal: boolean
  setView: (view: VaultView) => void
  setShowCaptureModal: (show: boolean) => void
  navToArea: (name: string) => void
  navToProject: (name: string) => void
  navigateToTask: (taskId: string, date?: string) => void
  clearPendingTask: () => void
}

export const useVaultNavStore = create<VaultNavStore>((set) => ({
  activeView: 'daily',
  selectedAreaName: null,
  selectedProjectName: null,
  pendingTaskId: null,
  viewingDate: null,
  showCaptureModal: false,

  setView: (view: VaultView) => set({ activeView: view }),

  setShowCaptureModal: (show: boolean) => set({ showCaptureModal: show }),

  navToArea: (name: string) =>
    set({ activeView: 'areas', selectedAreaName: name, selectedProjectName: null }),

  navToProject: (name: string) =>
    set({ activeView: 'projects', selectedProjectName: name, selectedAreaName: null }),

  navigateToTask: (taskId: string, date?: string) =>
    set({ activeView: 'daily', pendingTaskId: taskId, viewingDate: date ?? null }),

  clearPendingTask: () => set({ pendingTaskId: null }),
}))
