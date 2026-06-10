import { create } from 'zustand'

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

interface VaultFilterStore {
  viewMode: ViewMode
  selectedContexts: string[]
  setViewMode: (mode: ViewMode) => void
  setSelectedContexts: (ctxs: string[]) => void
  toggleContext: (ctx: string) => void
}

export const useVaultFilterStore = create<VaultFilterStore>((set, get) => ({
  viewMode: (localStorage.getItem(KANBAN_MODE_KEY) as ViewMode | null) ?? 'list',
  selectedContexts: loadSelectedContexts(),

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
    get().setSelectedContexts(next)
  },
}))
