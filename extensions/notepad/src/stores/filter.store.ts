import { create } from 'zustand'

interface FilterState {
  searchQuery: string
  activeTagIds: string[]
  includeArchived: boolean
  setQuery: (q: string) => void
  toggleTag: (id: string) => void
  clearTags: () => void
  toggleArchived: () => void
}

export const useFilterStore = create<FilterState>((set) => ({
  searchQuery: '',
  activeTagIds: [],
  includeArchived: false,
  setQuery: (searchQuery) => set({ searchQuery }),
  toggleTag: (id) =>
    set((s) => ({
      activeTagIds: s.activeTagIds.includes(id)
        ? s.activeTagIds.filter((t) => t !== id)
        : [...s.activeTagIds, id],
    })),
  clearTags: () => set({ activeTagIds: [] }),
  toggleArchived: () => set((s) => ({ includeArchived: !s.includeArchived })),
}))
