import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import {
  installNotepadBridge,
  listItem,
  anchoredComment,
  mountedEditorView,
  eventually,
  typeAtEnd,
  storeSettings,
} from './helpers/note-surface'

vi.mock('../../src/components/NoteList', () => ({
  NoteList: () => <div data-testid="note-list" />,
}))
vi.mock('../../src/components/DiagramView', () => ({
  DiagramView: ({ diagramId }: { diagramId: string }) => <div>diagram {diagramId}</div>,
}))

const bridge = installNotepadBridge()

import { NotepadView } from '../../src/components/NotepadView'
import { useNotesStore } from '../../src/stores/notes.store'
import { useEditorStore } from '../../src/stores/editor.store'
import { useCommentsStore } from '../../src/stores/comments.store'
import { NOTES_CHANGED_CHANNEL } from '../../src/editor/noteSync'
import { useNotepadSettingsStore } from '../../src/stores/settings.store'
import { notepadSettingsFrom } from '../../src/notepad-settings'

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
async function openNote(comments = [anchoredComment('c1', 'hello', [7, 12])]) {
  bridge.responses['terminator.notepad:notes.list'] = { data: [listItem('n1', 'Plan', ['work'])] }
  bridge.responses['terminator.notepad:notes.get'] = { data: { body: BODY } }
  bridge.responses['terminator.notepad:comments.list'] = { data: comments }
  useNotesStore.setState({ notes: [listItem('n1', 'Plan', ['work'])], selectedNoteId: 'n1' })
  render(<NotepadView />)
  await eventually(() => expect(mountedEditorView().state.doc.toString()).toBe(BODY))
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

describe('NotepadView opening a note', () => {
  // An editor mounted before the body arrives is thrown away when it does: what
  // was typed into it is lost, and anything holding its DOM holds a dead node.
  it('mounts the editor only once the opened note has loaded', async () => {
    let answerBody: (value: unknown) => void = () => {}
    bridge.responses['terminator.notepad:notes.list'] = { data: [listItem('n1', 'Plan')] }
    bridge.responses['terminator.notepad:notes.get'] = new Promise((r) => (answerBody = r))
    useNotesStore.setState({ notes: [listItem('n1', 'Plan')], selectedNoteId: 'n1' })
    render(<NotepadView />)
    await eventually(() => expect(bridge.calls('terminator.notepad:notes.get')).toHaveLength(1))
    await act(async () => undefined)
    expect(document.querySelector('.cm-editor')).toBeNull()

    await act(async () => answerBody({ data: { body: BODY } }))
    await eventually(() => expect(mountedEditorView().state.doc.toString()).toBe(BODY))
  })
})

describe('NotepadView re-anchoring comments on load', () => {
  it('moves a comment to where its quote now is, and orphans one whose quote is gone', async () => {
    await openNote([
      anchoredComment('c1', 'hello', [0, 5]),
      anchoredComment('c2', 'vanished', [0, 8]),
    ])
    const byId = new Map(useCommentsStore.getState().comments.map((c) => [c.id, c]))
    expect(byId.get('c1')).toMatchObject({ startOffset: 7, endOffset: 12, status: 'open' })
    expect(byId.get('c2')?.status).toBe('orphaned')
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:comments.markOrphaned')).toEqual([{ id: 'c2' }])
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
    expect(mountedEditorView().state.doc.toString()).toBe('# New\nfrom the window')
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

describe('NotepadView with Notepad settings changed', () => {
  beforeEach(() => useNotepadSettingsStore.setState(notepadSettingsFrom({})))
  afterEach(() => {
    vi.useRealTimers()
    storeSettings({})
  })

  it('waits the configured autosave delay before saving an edit', async () => {
    storeSettings({ 'terminator.notepad.autosaveMs': 2000 })
    await openNote()
    await eventually(() => expect(useNotepadSettingsStore.getState().autosaveMs).toBe(2000))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    act(() => typeAtEnd('!'))
    await vi.advanceTimersByTimeAsync(1200)
    expect(bridge.calls('terminator.notepad:notes.autosave')).toEqual([])
    await vi.advanceTimersByTimeAsync(800)
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:notes.autosave')).toHaveLength(1)
    )
  })

  it('draws the editor at the configured font size', async () => {
    storeSettings({ 'terminator.notepad.editorFontSize': 20 })
    await openNote()
    const editor = document.querySelector<HTMLElement>('.notepad-editor-cm')!
    await eventually(() =>
      expect(editor.style.getPropertyValue('--notepad-editor-font-size')).toBe('20px')
    )
  })
})

const viewMode = (name: string) => screen.getByRole('radio', { name })
const editor = () => mountedEditorView()

describe('NotepadView toolbar view modes', () => {
  it('offers Live, Source and Read as one choice, starting on Live', async () => {
    await openNote()
    expect(viewMode('Live').getAttribute('aria-checked')).toBe('true')
    expect(viewMode('Source').getAttribute('aria-checked')).toBe('false')
    expect(viewMode('Read').getAttribute('aria-checked')).toBe('false')
    expect(editor().state.readOnly).toBe(false)
  })

  it('Read makes the rendered note read-only; Source shows editable markdown', async () => {
    await openNote()
    fireEvent.click(viewMode('Read'))
    await eventually(() => expect(editor().state.readOnly).toBe(true))
    expect(useEditorStore.getState().previewMode).toBe(true)

    fireEvent.click(viewMode('Source'))
    await eventually(() => expect(editor().state.readOnly).toBe(false))
    expect(useEditorStore.getState().previewMode).toBe(false)
    expect(viewMode('Source').getAttribute('aria-checked')).toBe('true')
  })

  it('Read from Source renders the note rather than reading raw markdown', async () => {
    useEditorStore.setState({ previewMode: false })
    await openNote()
    fireEvent.click(viewMode('Read'))
    await eventually(() => expect(editor().state.readOnly).toBe(true))
    expect(useEditorStore.getState().previewMode).toBe(true)
  })
})

describe('NotepadView toolbar panel buttons', () => {
  it('the rail holds the outline above the comments', async () => {
    await openNote()
    const rail = document.querySelector('.notepad-view__rail')!
    expect([...rail.children].map((panel) => panel.className)).toEqual([
      'notepad-outline',
      'notepad-view__comments',
    ])
  })

  it('outline and comments are pressed toggles that hide and show their panels', async () => {
    await openNote()
    const outline = screen.getByRole('button', { name: 'Outline' })
    const comments = screen.getByRole('button', { name: 'Comments' })
    expect(outline.getAttribute('aria-pressed')).toBe('true')
    expect(comments.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(outline)
    fireEvent.click(comments)
    expect(outline.getAttribute('aria-pressed')).toBe('false')
    expect(comments.getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector('.notepad-outline')).toBeNull()
    expect(document.querySelector<HTMLElement>('.notepad-view__comments')?.hidden).toBe(true)
  })
})
