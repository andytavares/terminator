import { create } from 'zustand'
import type { NoteListItem } from '../db/types'

interface NotesState {
  notes: NoteListItem[]
  selectedNoteId: string | null
  archivedVisible: boolean
  showQuickCreate: boolean
  showSearch: boolean
  setNotes: (notes: NoteListItem[]) => void
  setSelected: (id: string | null) => void
  toggleArchivedVisible: () => void
  setShowQuickCreate: (val: boolean) => void
  setShowSearch: (val: boolean) => void
}

export const useNotesStore = create<NotesState>((set) => ({
  notes: [],
  selectedNoteId: null,
  archivedVisible: false,
  showQuickCreate: false,
  showSearch: false,
  setNotes: (notes) => set({ notes }),
  setSelected: (id) => set({ selectedNoteId: id }),
  toggleArchivedVisible: () => set((s) => ({ archivedVisible: !s.archivedVisible })),
  setShowQuickCreate: (val) => set({ showQuickCreate: val }),
  setShowSearch: (val) => set({ showSearch: val }),
}))
