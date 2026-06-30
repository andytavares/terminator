import { create } from 'zustand'
import type { NoteListItem, DiagramListItem, Folder } from '../db/types'

interface NotesState {
  notes: NoteListItem[]
  diagrams: DiagramListItem[]
  folders: Folder[]
  selectedNoteId: string | null
  selectedDiagramId: string | null
  archivedVisible: boolean
  showQuickCreate: boolean
  showSearch: boolean
  /** In-session body cache keyed by note ID. Populated after every autosave and DB fetch. */
  bodyCache: Record<string, string>
  /** In-session scene JSON cache keyed by diagram ID. Populated after every autosave and DB fetch. */
  diagramCache: Record<string, string>
  setNotes: (notes: NoteListItem[]) => void
  setDiagrams: (diagrams: DiagramListItem[]) => void
  setFolders: (folders: Folder[]) => void
  setSelected: (id: string | null) => void
  setSelectedDiagram: (id: string | null) => void
  toggleArchivedVisible: () => void
  setShowQuickCreate: (val: boolean) => void
  setShowSearch: (val: boolean) => void
  /** Update a single note's metadata in the list without re-fetching the full list. */
  patchNote: (
    id: string,
    patch: Partial<Pick<NoteListItem, 'title' | 'updatedAt' | 'bodyPreview' | 'tags'>>
  ) => void
  /** Update a single diagram's metadata in the list without re-fetching the full list. */
  patchDiagram: (
    id: string,
    patch: Partial<Pick<DiagramListItem, 'title' | 'updatedAt' | 'tags'>>
  ) => void
  setBodyCache: (id: string, body: string) => void
  setDiagramCache: (id: string, sceneJson: string) => void
}

export const useNotesStore = create<NotesState>((set) => ({
  notes: [],
  diagrams: [],
  folders: [],
  selectedNoteId: null,
  selectedDiagramId: null,
  archivedVisible: false,
  showQuickCreate: false,
  showSearch: false,
  bodyCache: {},
  diagramCache: {},
  setNotes: (notes) => set({ notes }),
  setDiagrams: (diagrams) => set({ diagrams }),
  setFolders: (folders) => set({ folders }),
  setSelected: (id) => set({ selectedNoteId: id, selectedDiagramId: null }),
  setSelectedDiagram: (id) => set({ selectedDiagramId: id, selectedNoteId: null }),
  toggleArchivedVisible: () => set((s) => ({ archivedVisible: !s.archivedVisible })),
  setShowQuickCreate: (val) => set({ showQuickCreate: val }),
  setShowSearch: (val) => set({ showSearch: val }),
  patchNote: (id, patch) =>
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })),
  patchDiagram: (id, patch) =>
    set((s) => ({ diagrams: s.diagrams.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
  setBodyCache: (id, body) => set((s) => ({ bodyCache: { ...s.bodyCache, [id]: body } })),
  setDiagramCache: (id, sceneJson) =>
    set((s) => ({ diagramCache: { ...s.diagramCache, [id]: sceneJson } })),
}))
