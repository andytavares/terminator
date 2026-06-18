import { describe, it, expect, beforeEach } from 'vitest'
import { useNotesStore } from '../../../src/stores/notes.store'
import type { NoteListItem } from '../../../src/db/types'

const mockNote: NoteListItem = {
  id: 'n1',
  title: 'Test',
  updatedAt: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  archivedAt: null,
  tags: [],
  bodyPreview: '',
}

describe('notes.store', () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: [], selectedNoteId: null, archivedVisible: false })
  })

  it('starts with empty notes and no selection', () => {
    const { notes, selectedNoteId } = useNotesStore.getState()
    expect(notes).toEqual([])
    expect(selectedNoteId).toBeNull()
  })

  it('setNotes replaces the list', () => {
    useNotesStore.getState().setNotes([mockNote])
    expect(useNotesStore.getState().notes).toHaveLength(1)
    expect(useNotesStore.getState().notes[0].id).toBe('n1')
  })

  it('setNotes with empty array clears list', () => {
    useNotesStore.getState().setNotes([mockNote])
    useNotesStore.getState().setNotes([])
    expect(useNotesStore.getState().notes).toHaveLength(0)
  })

  it('setSelected sets the selected note id', () => {
    useNotesStore.getState().setSelected('n1')
    expect(useNotesStore.getState().selectedNoteId).toBe('n1')
  })

  it('setSelected accepts null to deselect', () => {
    useNotesStore.getState().setSelected('n1')
    useNotesStore.getState().setSelected(null)
    expect(useNotesStore.getState().selectedNoteId).toBeNull()
  })

  it('toggleArchivedVisible flips the flag', () => {
    expect(useNotesStore.getState().archivedVisible).toBe(false)
    useNotesStore.getState().toggleArchivedVisible()
    expect(useNotesStore.getState().archivedVisible).toBe(true)
    useNotesStore.getState().toggleArchivedVisible()
    expect(useNotesStore.getState().archivedVisible).toBe(false)
  })
})
