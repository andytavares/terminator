import { create } from 'zustand'

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
  selectedContexts: string[]
  setSelectedContexts: (ctxs: string[]) => void
  toggleContext: (ctx: string) => void
}

export const useVaultFilterStore = create<VaultFilterStore>((set, get) => ({
  selectedContexts: loadSelectedContexts(),

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
