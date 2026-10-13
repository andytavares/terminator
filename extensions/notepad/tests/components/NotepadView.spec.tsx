import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import {
  installBridge,
  listItem,
  comment,
  editorView,
  eventually,
  typeAtEnd,
} from './helpers/note-surface'

vi.mock('../../src/components/NoteList', () => ({
  NoteList: () => <div data-testid="note-list" />,
}))
vi.mock('../../src/components/DiagramView', () => ({
  DiagramView: ({ diagramId }: { diagramId: string }) => <div>diagram {diagramId}</div>,
}))

vi.setConfig({ testTimeout: 30_000 })

const bridge = installBridge()

import { NotepadView } from '../../src/components/NotepadView'
import { useNotesStore } from '../../src/stores/notes.store'
import { useEditorStore } from '../../src/stores/editor.store'
import { useCommentsStore } from '../../src/stores/comments.store'
import { NOTES_CHANGED_CHANNEL } from '../../src/editor/noteSync'

const BODY = '# Plan\nhello world'

beforeEach(() => {
  for (const key of Object.keys(bridge.responses)) delete bridge.responses[key]
  bridge.invoke.mockClear()
  useNotesStore.setState({
    notes: [],
    diagrams: [],
    selectedNoteId: null,
    selectedDiagramId: null,
    bodyCache: {},
  })
  useEditorStore.setState({ bodyDraft: '', isDirty: false, saveStatus: 'idle', previewMode: true })
  useCommentsStore.setState({ comments: [] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** Opens the panel on note n1, answering its lists, body and comments. */
async function openNote(comments = [comment('c1', 'hello', [7, 12])]) {
  bridge.responses['terminator.notepad:notes.list'] = { data: [listItem('n1', 'Plan', ['work'])] }
  bridge.responses['terminator.notepad:notes.get'] = { data: { body: BODY } }
  bridge.responses['terminator.notepad:comments.list'] = { data: comments }
  useNotesStore.setState({ notes: [listItem('n1', 'Plan', ['work'])], selectedNoteId: 'n1' })
  render(<NotepadView />)
  await eventually(() => expect(editorView().state.doc.toString()).toBe(BODY))
}

describe('NotepadView loading', () => {
  it('loads the note, diagram and folder lists, and offers to start when there are none', async () => {
    render(<NotepadView />)
    expect(screen.getByText('No notes yet')).toBeTruthy()
    await eventually(() => expect(bridge.calls('terminator.notepad:folders.list')).toHaveLength(1))
    expect(bridge.calls('terminator.notepad:notes.list')).toEqual([{ includeArchived: true }])
    expect(bridge.calls('terminator.notepad:diagrams.list')).toEqual([{ includeArchived: true }])
  })

  it('opens the selected note with its comments', async () => {
    await openNote()
    expect(bridge.calls('terminator.notepad:comments.list')).toEqual([
      { noteId: 'n1', includeResolved: true },
    ])
    expect(useCommentsStore.getState().comments.map((c) => c.id)).toEqual(['c1'])
    expect(useNotesStore.getState().bodyCache.n1).toBe(BODY)
  })

  it('shows the diagram canvas in place of the editor when a diagram is selected', () => {
    useNotesStore.setState({ notes: [listItem('n1', 'Plan')], selectedDiagramId: 'd1' })
    render(<NotepadView />)
    expect(screen.getByText('diagram d1')).toBeTruthy()
  })
})

describe('NotepadView re-anchoring comments on load', () => {
  it('moves a comment to where its quote now is, and orphans one whose quote is gone', async () => {
    await openNote([comment('c1', 'hello', [0, 5]), comment('c2', 'vanished', [0, 8])])
    const byId = new Map(useCommentsStore.getState().comments.map((c) => [c.id, c]))
    expect(byId.get('c1')).toMatchObject({ startOffset: 7, endOffset: 12, status: 'open' })
    expect(byId.get('c2')?.status).toBe('orphaned')
    await eventually(
      () =>
        expect(bridge.calls('terminator.notepad:comments.markOrphaned')).toEqual([{ id: 'c2' }]),
      8000
    )
    expect(bridge.calls('terminator.notepad:comments.updateAnchor')).toEqual([
      { id: 'c1', startOffset: 7, endOffset: 12 },
    ])
  })
})

describe('NotepadView saving', () => {
  it('autosaves an edit with a title taken from the first heading', async () => {
    await openNote()
    act(() => typeAtEnd('!'))
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:notes.autosave')).toEqual([
        {
          id: 'n1',
          title: 'Plan',
          body: `${BODY}!`,
          tags: ['work'],
          originId: expect.any(String),
        },
      ])
    )
    await eventually(() => expect(screen.getByText('Saved')).toBeTruthy())
    expect(useNotesStore.getState().bodyCache.n1).toBe(`${BODY}!`)
  })

  it('saves an unsaved edit at once when another note is selected', async () => {
    await openNote()
    act(() => typeAtEnd(' more'))
    expect(screen.getByText('Unsaved')).toBeTruthy()
    act(() => useNotesStore.getState().setSelected('n2'))
    expect(bridge.calls('terminator.notepad:notes.autosave')).toEqual([
      expect.objectContaining({ id: 'n1', title: 'Plan', body: `${BODY} more` }),
    ])
    expect(useNotesStore.getState().bodyCache.n1).toBe(`${BODY} more`)
  })
})

describe('NotepadView changes from another surface', () => {
  it('adopts a body another window saved for the open note', async () => {
    await openNote()
    act(() =>
      bridge.push(NOTES_CHANGED_CHANNEL, {
        id: 'n1',
        title: 'New',
        body: '# New\nfrom the window',
        tags: [],
        updatedAt: '2026-02-01T00:00:00Z',
        originId: 'another-window',
      })
    )
    expect(editorView().state.doc.toString()).toBe('# New\nfrom the window')
    expect(useNotesStore.getState().notes[0].title).toBe('New')
  })

  it('toggles the comment margin with Cmd+Alt+M', async () => {
    await openNote()
    const margin = document.querySelector<HTMLElement>('.notepad-view__comments')!
    expect(margin.hidden).toBe(false)
    fireEvent.keyDown(document, { metaKey: true, altKey: true, code: 'KeyM' })
    expect(margin.hidden).toBe(true)
  })
})
