import { describe, it, expect, beforeEach } from 'vitest'
import { useNotesStore } from '../../../src/stores/notes.store'
import type { NoteListItem, DiagramListItem } from '../../../src/db/types'

const mockNote: NoteListItem = {
  id: 'n1',
  title: 'Test',
  updatedAt: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  archivedAt: null,
  tags: [],
  bodyPreview: '',
}

const mockDiagram: DiagramListItem = {
  id: 'd1',
  title: 'My diagram',
  updatedAt: '2026-01-02T00:00:00Z',
  createdAt: '2026-01-02T00:00:00Z',
  archivedAt: null,
  type: 'diagram',
}

describe('notes.store', () => {
  beforeEach(() => {
    useNotesStore.setState({
      notes: [],
      diagrams: [],
      folders: [],
      selectedNoteId: null,
      selectedDiagramId: null,
      archivedVisible: false,
      bodyCache: {},
      diagramCache: {},
    })
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

  it('setSelected clears selectedDiagramId', () => {
    useNotesStore.getState().setSelectedDiagram('d1')
    useNotesStore.getState().setSelected('n1')
    expect(useNotesStore.getState().selectedDiagramId).toBeNull()
    expect(useNotesStore.getState().selectedNoteId).toBe('n1')
  })

  it('setSelectedDiagram clears selectedNoteId', () => {
    useNotesStore.getState().setSelected('n1')
    useNotesStore.getState().setSelectedDiagram('d1')
    expect(useNotesStore.getState().selectedNoteId).toBeNull()
    expect(useNotesStore.getState().selectedDiagramId).toBe('d1')
  })

  it('setDiagrams replaces the diagrams list', () => {
    useNotesStore.getState().setDiagrams([mockDiagram])
    expect(useNotesStore.getState().diagrams).toHaveLength(1)
    expect(useNotesStore.getState().diagrams[0].id).toBe('d1')
  })

  it('toggleArchivedVisible flips the flag', () => {
    expect(useNotesStore.getState().archivedVisible).toBe(false)
    useNotesStore.getState().toggleArchivedVisible()
    expect(useNotesStore.getState().archivedVisible).toBe(true)
    useNotesStore.getState().toggleArchivedVisible()
    expect(useNotesStore.getState().archivedVisible).toBe(false)
  })

  it('patchNote updates matching note metadata without replacing the list', () => {
    useNotesStore.getState().setNotes([mockNote, { ...mockNote, id: 'n2', title: 'Other' }])
    useNotesStore.getState().patchNote('n1', { title: 'Updated', bodyPreview: 'preview text' })
    const notes = useNotesStore.getState().notes
    expect(notes).toHaveLength(2)
    expect(notes.find((n) => n.id === 'n1')?.title).toBe('Updated')
    expect(notes.find((n) => n.id === 'n1')?.bodyPreview).toBe('preview text')
    expect(notes.find((n) => n.id === 'n2')?.title).toBe('Other')
  })

  it('patchNote is a no-op for unknown id', () => {
    useNotesStore.getState().setNotes([mockNote])
    useNotesStore.getState().patchNote('unknown', { title: 'X' })
    expect(useNotesStore.getState().notes[0].title).toBe('Test')
  })

  it('patchDiagram updates matching diagram metadata without replacing the list', () => {
    useNotesStore.getState().setDiagrams([mockDiagram, { ...mockDiagram, id: 'd2', title: 'D2' }])
    useNotesStore
      .getState()
      .patchDiagram('d1', { title: 'Renamed', updatedAt: '2026-06-30T00:00:00Z' })
    const diagrams = useNotesStore.getState().diagrams
    expect(diagrams.find((d) => d.id === 'd1')?.title).toBe('Renamed')
    expect(diagrams.find((d) => d.id === 'd1')?.updatedAt).toBe('2026-06-30T00:00:00Z')
    expect(diagrams.find((d) => d.id === 'd2')?.title).toBe('D2')
  })

  it('setBodyCache stores and returns body by note id', () => {
    useNotesStore.getState().setBodyCache('n1', 'hello world')
    expect(useNotesStore.getState().bodyCache['n1']).toBe('hello world')
  })

  it('setBodyCache is additive (does not clear other entries)', () => {
    useNotesStore.getState().setBodyCache('n1', 'body 1')
    useNotesStore.getState().setBodyCache('n2', 'body 2')
    expect(useNotesStore.getState().bodyCache['n1']).toBe('body 1')
    expect(useNotesStore.getState().bodyCache['n2']).toBe('body 2')
  })

  it('setDiagramCache stores scene JSON by diagram id', () => {
    useNotesStore.getState().setDiagramCache('d1', '{"elements":[]}')
    expect(useNotesStore.getState().diagramCache['d1']).toBe('{"elements":[]}')
  })

  it('bodyCache and diagramCache start empty', () => {
    expect(useNotesStore.getState().bodyCache).toEqual({})
    expect(useNotesStore.getState().diagramCache).toEqual({})
  })
})
