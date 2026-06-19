import { create } from 'zustand'

interface FilterState {
  searchQuery: string
  activeTagId: string | null
  includeArchived: boolean
  setQuery: (q: string) => void
  setTag: (id: string | null) => void
  toggleArchived: () => void
}

export const useFilterStore = create<FilterState>((set) => ({
  searchQuery: '',
  activeTagId: null,
  includeArchived: false,
  setQuery: (searchQuery) => set({ searchQuery }),
  setTag: (activeTagId) => set({ activeTagId }),
  toggleArchived: () => set((s) => ({ includeArchived: !s.includeArchived })),
}))
