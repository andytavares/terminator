import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import {
  installNotepadBridge,
  anchoredComment,
  mountedEditorView,
  eventually,
  typeAtEnd,
  storeSettings,
  elapse,
} from './helpers/note-surface'

// The window reads its note id from the URL once, when the module loads.
vi.hoisted(() => window.history.replaceState({}, '', '/?noteId=n1'))

vi.setConfig({ testTimeout: 30_000 })

const bridge = installNotepadBridge()

import { NoteWindowView } from '../../src/components/NoteWindowView'
import { useEditorStore } from '../../src/stores/editor.store'
import { useCommentsStore } from '../../src/stores/comments.store'
import { NOTES_CHANGED_CHANNEL } from '../../src/editor/noteSync'
import { useNotepadSettingsStore } from '../../src/stores/settings.store'
import { notepadSettingsFrom } from '../../src/notepad-settings'

const BODY = '# Plan\nhello world'
const NOTE = { id: 'n1', title: 'Plan', body: BODY, tags: ['work'] }

beforeEach(() => {
  for (const key of Object.keys(bridge.responses)) delete bridge.responses[key]
  bridge.invoke.mockClear()
  useEditorStore.setState({ bodyDraft: '', isDirty: false, saveStatus: 'idle', previewMode: true })
  useCommentsStore.setState({ comments: [] })
})

afterEach(cleanup)

async function openWindow(comments = [anchoredComment('c1', 'hello', [7, 12])]) {
  bridge.responses['terminator.notepad:notes.get'] = { data: NOTE }
  bridge.responses['terminator.notepad:comments.list'] = { data: comments }
  render(<NoteWindowView />)
  await eventually(() => expect(mountedEditorView().state.doc.toString()).toBe(BODY))
}

describe('NoteWindowView loading', () => {
  it('opens the note from the URL, titled and tagged', async () => {
    await openWindow()
    expect(bridge.calls('terminator.notepad:notes.get')).toEqual([{ id: 'n1' }])
    expect(screen.getByText('#work')).toBeTruthy()
    expect(document.title).toBe('Plan')
  })

  it('says so when the note does not exist', async () => {
    bridge.responses['terminator.notepad:notes.get'] = { data: null }
    render(<NoteWindowView />)
    await eventually(() => expect(screen.getByText('Note not found')).toBeTruthy())
  })

  it('moves a comment to where its quote now is, and orphans one whose quote is gone', async () => {
    await openWindow([
      anchoredComment('c1', 'hello', [0, 5]),
      anchoredComment('c2', 'vanished', [0, 8]),
    ])
    const byId = new Map(useCommentsStore.getState().comments.map((c) => [c.id, c]))
    expect(byId.get('c1')).toMatchObject({ startOffset: 7, endOffset: 12 })
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

describe('NoteWindowView saving and syncing', () => {
  it('autosaves an edit and retitles the window from its first heading', async () => {
    await openWindow()
    act(() => typeAtEnd('\n# Later'))
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:notes.autosave')).toEqual([
        {
          id: 'n1',
          title: 'Plan',
          body: `${BODY}\n# Later`,
          tags: ['work'],
          originId: expect.any(String),
        },
      ])
    )
    await eventually(() => expect(screen.getByText('Saved')).toBeTruthy())
  })

  it('adopts a body the panel saved for this note, and ignores other notes', async () => {
    await openWindow()
    const change = { title: 'New', tags: ['x'], updatedAt: '', originId: 'the-panel' }
    act(() => bridge.push(NOTES_CHANGED_CHANNEL, { ...change, id: 'n2', body: 'other' }))
    expect(mountedEditorView().state.doc.toString()).toBe(BODY)
    act(() => bridge.push(NOTES_CHANGED_CHANNEL, { ...change, id: 'n1', body: '# New\nbody' }))
    expect(mountedEditorView().state.doc.toString()).toBe('# New\nbody')
    expect(document.title).toBe('New')
    expect(screen.getByText('#x')).toBeTruthy()
  })
})

describe('NoteWindowView with Notepad settings changed', () => {
  beforeEach(() => useNotepadSettingsStore.setState(notepadSettingsFrom({})))
  afterEach(() => storeSettings({}))

  it('waits the configured autosave delay before saving an edit', async () => {
    storeSettings({ 'terminator.notepad.autosaveMs': 2000 })
    await openWindow()
    await eventually(() => expect(useNotepadSettingsStore.getState().autosaveMs).toBe(2000))
    act(() => typeAtEnd('!'))
    await elapse(1200)
    expect(bridge.calls('terminator.notepad:notes.autosave')).toEqual([])
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:notes.autosave')).toHaveLength(1)
    )
  })
})

describe('NoteWindowView toolbar', () => {
  it('switches between the live note and its markdown source', async () => {
    await openWindow()
    const live = screen.getByRole('radio', { name: 'Live' })
    const source = screen.getByRole('radio', { name: 'Source' })
    expect(live.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(source)
    expect(source.getAttribute('aria-checked')).toBe('true')
    expect(useEditorStore.getState().previewMode).toBe(false)
  })

  it('outline is a pressed toggle that hides and shows the outline', async () => {
    await openWindow()
    const outline = screen.getByRole('button', { name: 'Outline' })
    const before = outline.getAttribute('aria-pressed')
    fireEvent.click(outline)
    expect(outline.getAttribute('aria-pressed')).toBe(before === 'true' ? 'false' : 'true')
    expect(document.querySelector('.notepad-outline') !== null).toBe(before !== 'true')
  })
})
