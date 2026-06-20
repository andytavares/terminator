import { create } from 'zustand'
import type { NoteListItem, DiagramListItem } from '../db/types'

interface NotesState {
  notes: NoteListItem[]
  diagrams: DiagramListItem[]
  selectedNoteId: string | null
  selectedDiagramId: string | null
  archivedVisible: boolean
  showQuickCreate: boolean
  showSearch: boolean
  setNotes: (notes: NoteListItem[]) => void
  setDiagrams: (diagrams: DiagramListItem[]) => void
  setSelected: (id: string | null) => void
  setSelectedDiagram: (id: string | null) => void
  toggleArchivedVisible: () => void
  setShowQuickCreate: (val: boolean) => void
  setShowSearch: (val: boolean) => void
}

export const useNotesStore = create<NotesState>((set) => ({
  notes: [],
  diagrams: [],
  selectedNoteId: null,
  selectedDiagramId: null,
  archivedVisible: false,
  showQuickCreate: false,
  showSearch: false,
  setNotes: (notes) => set({ notes }),
  setDiagrams: (diagrams) => set({ diagrams }),
  setSelected: (id) => set({ selectedNoteId: id, selectedDiagramId: null }),
  setSelectedDiagram: (id) => set({ selectedDiagramId: id, selectedNoteId: null }),
  toggleArchivedVisible: () => set((s) => ({ archivedVisible: !s.archivedVisible })),
  setShowQuickCreate: (val) => set({ showQuickCreate: val }),
  setShowSearch: (val) => set({ showSearch: val }),
}))
