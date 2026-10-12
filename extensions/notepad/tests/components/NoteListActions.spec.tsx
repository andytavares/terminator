import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, createEvent } from '@testing-library/react'
import { installBridge, listItem, eventually } from './helpers/note-surface'
import type { DiagramListItem, Folder, NoteListItem } from '../../src/db/types'

vi.setConfig({ testTimeout: 30_000 })

const bridge = installBridge()

import { NoteList } from '../../src/components/NoteList'
import { useNotesStore } from '../../src/stores/notes.store'
import { useFilterStore } from '../../src/stores/filter.store'

function note(id: string, title: string, extra: Partial<NoteListItem> = {}): NoteListItem {
  return { ...listItem(id, title), ...extra }
}

function diagram(id: string, title: string, extra: Partial<DiagramListItem> = {}): DiagramListItem {
  return {
    id,
    title,
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    archivedAt: null,
    type: 'diagram',
    sortOrder: 0,
    folderId: null,
    ...extra,
  }
}

function folder(id: string, name: string): Folder {
  return { id, name, sortOrder: 0, createdAt: '2026-01-01T00:00:00Z' }
}

beforeEach(() => {
  for (const key of Object.keys(bridge.responses)) delete bridge.responses[key]
  bridge.invoke.mockClear()
  useNotesStore.setState({
    notes: [],
    diagrams: [],
    folders: [],
    selectedNoteId: null,
    selectedDiagramId: null,
  })
  useFilterStore.setState({ searchQuery: '', activeTagIds: [] })
})

afterEach(cleanup)

function row(title: string): HTMLElement {
  return screen.getByText(title).closest('button')!
}

function openMenu(title: string) {
  fireEvent.contextMenu(row(title))
}

const RELOAD = 'terminator.notepad:folders.list'

describe('NoteList ordering and opening', () => {
  it('lists notes and diagrams together by sort order, then most recently updated', () => {
    useNotesStore.setState({
      notes: [note('n1', 'Old', { sortOrder: 1 }), note('n2', 'New', { updatedAt: '2026-03-01' })],
      diagrams: [diagram('d1', 'Flow', { sortOrder: 0, updatedAt: '2026-02-01' })],
    })
    render(<NoteList />)
    const titles = [...document.querySelectorAll('.notepad-note-row__title')].map(
      (el) => el.textContent
    )
    expect(titles).toEqual(['New', 'Flow', 'Old'])
  })

  it('selects a diagram on click and opens either kind in a window on double-click', () => {
    useNotesStore.setState({ notes: [note('n1', 'Plan')], diagrams: [diagram('d1', 'Flow')] })
    render(<NoteList />)
    fireEvent.click(row('Flow'))
    expect(useNotesStore.getState().selectedDiagramId).toBe('d1')
    fireEvent.doubleClick(row('Flow'))
    fireEvent.doubleClick(row('Plan'))
    expect(bridge.calls('terminator.notepad:diagrams.openWindow')).toEqual([{ id: 'd1' }])
    expect(bridge.calls('terminator.notepad:notes.openWindow')).toEqual([{ id: 'n1' }])
  })
})

describe('NoteList filtering', () => {
  it('shows the notes text search finds, and diagrams whose title matches', async () => {
    bridge.responses['terminator.notepad:search.query'] = {
      data: [{ ...note('n2', 'Found'), snippet: '' }],
    }
    useNotesStore.setState({
      notes: [note('n1', 'Plan'), note('n2', 'Found')],
      diagrams: [diagram('d1', 'Flow'), diagram('d2', 'Other')],
    })
    useFilterStore.setState({ searchQuery: 'fl' })
    render(<NoteList />)
    await eventually(() => expect(screen.queryByText('Plan')).toBeNull())
    expect(screen.getByText('Found')).toBeTruthy()
    expect(screen.getByText('Flow')).toBeTruthy()
    expect(screen.queryByText('Other')).toBeNull()
    expect(bridge.calls('terminator.notepad:search.query')).toEqual([
      { query: 'fl', includeArchived: true },
    ])
  })

  it('says what matched nothing', async () => {
    bridge.responses['terminator.notepad:search.query'] = { data: [] }
    useNotesStore.setState({ notes: [note('n1', 'Plan', { tags: ['work'] })] })
    useFilterStore.setState({ searchQuery: 'zzz', activeTagIds: ['local:work'] })
    render(<NoteList />)
    await eventually(() =>
      expect(screen.getByText(/No results/).textContent).toBe('No results for #work matching "zzz"')
    )
  })
})

describe('NoteList folders', () => {
  beforeEach(() => {
    useNotesStore.setState({
      notes: [note('n1', 'Loose'), note('n2', 'Filed', { folderId: 'f1' })],
      folders: [folder('f1', 'Work'), folder('f2', 'Home')],
    })
  })

  it('groups items under their folder, and collapses a folder', () => {
    render(<NoteList />)
    const work = screen.getByText('Work').closest('.notepad-folder-section')!
    expect(work.textContent).toContain('Filed')
    expect(screen.getByText('Empty')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Collapse Work'))
    expect(screen.queryByText('Filed')).toBeNull()
    expect(screen.getByLabelText('Expand Work')).toBeTruthy()
  })

  it('renames a folder from its context menu', async () => {
    render(<NoteList />)
    fireEvent.contextMenu(screen.getByText('Work').closest('.notepad-folder-header')!)
    fireEvent.click(screen.getByText('Rename'))
    const input = screen.getByDisplayValue('Work')
    fireEvent.change(input, { target: { value: 'Office' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await eventually(() => expect(bridge.calls(RELOAD).length).toBeGreaterThan(0))
    expect(bridge.calls('terminator.notepad:folders.rename')).toContainEqual({
      id: 'f1',
      name: 'Office',
    })
  })

  it('deletes a folder once confirmed', async () => {
    render(<NoteList />)
    fireEvent.contextMenu(screen.getByText('Home').closest('.notepad-folder-header')!)
    fireEvent.click(screen.getByText('Delete folder'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:folders.delete')).toEqual([{ id: 'f2' }])
    )
  })
})

describe('NoteList item context menu', () => {
  it('archives a note and a diagram', async () => {
    useNotesStore.setState({ notes: [note('n1', 'Plan')], diagrams: [diagram('d1', 'Flow')] })
    render(<NoteList />)
    openMenu('Plan')
    fireEvent.click(screen.getByText('Archive'))
    openMenu('Flow')
    fireEvent.click(screen.getByText('Archive'))
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:diagrams.archive')).toEqual([{ id: 'd1' }])
    )
    expect(bridge.calls('terminator.notepad:notes.archive')).toEqual([{ id: 'n1' }])
  })

  it('restores, and permanently deletes once confirmed, an archived note', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    useNotesStore.setState({
      notes: [note('n1', 'Old', { archivedAt: '2026-01-01' })],
      selectedNoteId: 'n1',
    })
    render(<NoteList />)
    fireEvent.click(screen.getByRole('button', { name: /Archived/ }))
    openMenu('Old')
    fireEvent.click(screen.getByText('Unarchive'))
    openMenu('Old')
    fireEvent.click(screen.getByText('Delete'))
    await eventually(() => expect(useNotesStore.getState().selectedNoteId).toBeNull())
    expect(bridge.calls('terminator.notepad:notes.hardDelete')).toEqual([{ id: 'n1' }])
    expect(bridge.calls('terminator.notepad:notes.restore')).toEqual([{ id: 'n1' }])
    confirm.mockRestore()
  })

  it('moves an item into a folder and back out', async () => {
    useNotesStore.setState({
      notes: [note('n1', 'Plan'), note('n2', 'Filed', { folderId: 'f1' })],
      folders: [folder('f1', 'Work')],
    })
    render(<NoteList />)
    openMenu('Plan')
    fireEvent.click(screen.getByText('Move to Work'))
    openMenu('Filed')
    fireEvent.click(screen.getByText('Remove from folder'))
    await eventually(() => expect(bridge.calls('terminator.notepad:folders.move')).toHaveLength(2))
    expect(bridge.calls('terminator.notepad:folders.move')).toEqual([
      { items: [{ id: 'n1', type: 'note' }], folderId: 'f1' },
      { items: [{ id: 'n2', type: 'note' }], folderId: null },
    ])
  })
})

type DragKind = 'dragStart' | 'dragOver' | 'drop'

/**
 * jsdom has no DragEvent, so drag events would be plain Events without a
 * pointer position or a DataTransfer. This one carries both.
 */
class TestDragEvent extends MouseEvent {
  dataTransfer = { effectAllowed: '', dropEffect: '' }
}

function drag(kind: DragKind, target: Element, clientY = 0) {
  const event = createEvent[kind](target, { clientY, bubbles: true, cancelable: true })
  fireEvent(target, event)
}

beforeEach(() => {
  Object.defineProperty(window, 'DragEvent', { value: TestDragEvent, configurable: true })
})

describe('NoteList drag and drop', () => {
  beforeEach(() => {
    useNotesStore.setState({
      notes: [
        note('n1', 'First', { sortOrder: 0 }),
        note('n2', 'Second', { sortOrder: 1 }),
        note('n3', 'Filed', { folderId: 'f1' }),
      ],
      diagrams: [diagram('d1', 'Flow', { sortOrder: 2 })],
      folders: [folder('f1', 'Work')],
    })
  })

  it('reorders by dropping one item before another', async () => {
    render(<NoteList />)
    drag('dragStart', row('Flow'))
    drag('dragOver', row('First'), -1)
    drag('drop', row('First'))
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:notes.reorder')).toEqual([
        {
          items: [
            { id: 'd1', type: 'diagram' },
            { id: 'n1', type: 'note' },
            { id: 'n2', type: 'note' },
          ],
        },
      ])
    )
    expect(bridge.calls('terminator.notepad:folders.move')).toEqual([])
  })

  it('moves an item into the folder it is dropped among', async () => {
    render(<NoteList />)
    drag('dragStart', row('First'))
    drag('dragOver', row('Filed'), 10)
    drag('drop', row('Filed'))
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:folders.move')).toEqual([
        { items: [{ id: 'n1', type: 'note' }], folderId: 'f1' },
      ])
    )
    expect(bridge.calls('terminator.notepad:notes.reorder')).toEqual([
      {
        items: [
          { id: 'n3', type: 'note' },
          { id: 'n1', type: 'note' },
        ],
      },
    ])
  })

  it('moves an item into a folder dropped on its header', async () => {
    render(<NoteList />)
    const header = screen.getByText('Work').closest('.notepad-folder-header')!
    drag('dragStart', row('Second'))
    drag('dragOver', header)
    expect(header.className).toContain('notepad-folder-header--drop-target')
    drag('drop', header)
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:folders.move')).toEqual([
        { items: [{ id: 'n2', type: 'note' }], folderId: 'f1' },
      ])
    )
  })

  it('takes an item out of its folder when dropped on the list itself', async () => {
    render(<NoteList />)
    const list = document.querySelector('.notepad-note-list__notes')!
    drag('dragStart', row('Filed'))
    drag('dragOver', list)
    drag('drop', list)
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:folders.move')).toEqual([
        { items: [{ id: 'n3', type: 'note' }], folderId: null },
      ])
    )
  })
})
