import { create } from 'zustand'

type SaveStatus = 'idle' | 'saving' | 'saved'

interface EditorState {
  activeNoteId: string | null
  bodyDraft: string
  isDirty: boolean
  saveStatus: SaveStatus
  previewMode: boolean
  setActiveNote: (id: string, body: string) => void
  markDirty: (body: string) => void
  markSaving: () => void
  markSaved: () => void
  togglePreviewMode: () => void
}

export const useEditorStore = create<EditorState>((set) => ({
  activeNoteId: null,
  bodyDraft: '',
  isDirty: false,
  saveStatus: 'idle',
  previewMode: true,
  setActiveNote: (id, body) =>
    set({ activeNoteId: id, bodyDraft: body, isDirty: false, saveStatus: 'idle' }),
  markDirty: (body) => set({ bodyDraft: body, isDirty: true }),
  markSaving: () => set({ saveStatus: 'saving' }),
  markSaved: () => set({ saveStatus: 'saved', isDirty: false }),
  togglePreviewMode: () => set((s) => ({ previewMode: !s.previewMode })),
}))
