import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, createEvent, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { installNotepadBridge, listItem, eventually } from './helpers/note-surface'
import type { DiagramListItem, Folder, NoteListItem } from '../../src/db/types'

let bridge: ReturnType<typeof installNotepadBridge>

import { NoteList } from '../../src/components/NoteList'
import { useNotesStore } from '../../src/stores/notes.store'
import { useFilterStore } from '../../src/stores/filter.store'

function noteItem(id: string, title: string, extra: Partial<NoteListItem> = {}): NoteListItem {
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
  bridge = installNotepadBridge()
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

function rowTitled(title: string): HTMLElement {
  return screen.getByText(title).closest('button')!
}

async function openRowMenu(user: UserEvent, row: Element): Promise<void> {
  await user.pointer({ keys: '[MouseRight]', target: row })
}

const RELOAD = 'terminator.notepad:folders.list'

describe('NoteList ordering', () => {
  it('lists notes and diagrams together by sort order, then most recently updated', () => {
    useNotesStore.setState({
      notes: [
        noteItem('n1', 'Old', { sortOrder: 1 }),
        noteItem('n2', 'New', { updatedAt: '2026-03-01' }),
      ],
      diagrams: [diagram('d1', 'Flow', { sortOrder: 0, updatedAt: '2026-02-01' })],
    })
    render(<NoteList />)
    const isRowTitle = (_: string, element: Element | null) =>
      /^(New|Flow|Old)$/.test(element?.textContent ?? '')
    const titles = screen.getAllByText(isRowTitle).map((el) => el.textContent)
    expect(titles).toEqual(['New', 'Flow', 'Old'])
  })
})

describe('NoteList opening', () => {
  it('selects a diagram on click', async () => {
    const user = userEvent.setup()
    useNotesStore.setState({ diagrams: [diagram('d1', 'Flow')] })
    render(<NoteList />)
    await user.click(rowTitled('Flow'))
    expect(useNotesStore.getState().selectedDiagramId).toBe('d1')
  })

  it.each([
    { title: 'Plan', channel: 'terminator.notepad:notes.openWindow', id: 'n1' },
    { title: 'Flow', channel: 'terminator.notepad:diagrams.openWindow', id: 'd1' },
  ])('opens $title in a window on double-click', async ({ title, channel, id }) => {
    const user = userEvent.setup()
    useNotesStore.setState({ notes: [noteItem('n1', 'Plan')], diagrams: [diagram('d1', 'Flow')] })
    render(<NoteList />)
    await user.dblClick(rowTitled(title))
    expect(bridge.calls(channel)).toEqual([{ id }])
  })
})

describe('NoteList filtering', () => {
  it('shows the notes text search finds, and diagrams whose title matches', async () => {
    bridge.responses['terminator.notepad:search.query'] = {
      data: [{ ...noteItem('n2', 'Found'), snippet: '' }],
    }
    useNotesStore.setState({
      notes: [noteItem('n1', 'Plan'), noteItem('n2', 'Found')],
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
    useNotesStore.setState({ notes: [noteItem('n1', 'Plan', { tags: ['work'] })] })
    useFilterStore.setState({ searchQuery: 'zzz', activeTagIds: ['local:work'] })
    render(<NoteList />)
    await eventually(() =>
      expect(screen.getByText(/No results/).textContent).toBe('No results for #work matching "zzz"')
    )
  })
})

describe('NoteList folders', noteListFoldersTests)
describe('NoteList item context menu', noteListItemContextMenuTests)

type DragKind = 'dragStart' | 'dragOver' | 'drop'

/** jsdom has no DragEvent; this one carries a pointer position and a DataTransfer. */
class TestDragEvent extends MouseEvent {
  dataTransfer = { effectAllowed: '', dropEffect: '' }
}

function drag(kind: DragKind, target: Element, clientY = 0) {
  const event = createEvent[kind](target, { clientY, bubbles: true, cancelable: true })
  fireEvent(target, event)
}

beforeEach(() => {
  vi.stubGlobal('DragEvent', TestDragEvent)
})

describe('NoteList drag and drop', noteListDragDropTests)

function noteListFoldersTests() {
  beforeEach(() => {
    useNotesStore.setState({
      notes: [noteItem('n1', 'Loose'), noteItem('n2', 'Filed', { folderId: 'f1' })],
      folders: [folder('f1', 'Work'), folder('f2', 'Home')],
    })
  })

  describe('sections', noteListFoldersSectionsTests)
  describe('renaming and deleting', noteListFoldersRenamingDeletingTests)
}

function noteListFoldersSectionsTests() {
  it('groups items under their folder, and collapses a folder', async () => {
    const user = userEvent.setup()
    render(<NoteList />)
    const work = screen.getByRole('group', { name: 'Work' })
    expect(within(work).getByText('Filed')).toBeDefined()
    expect(screen.getByText('Empty')).toBeTruthy()
    await user.click(screen.getByLabelText('Collapse Work'))
    expect(screen.queryByText('Filed')).toBeNull()
    expect(screen.getByLabelText('Expand Work')).toBeTruthy()
  })
}

function noteListFoldersRenamingDeletingTests() {
  it('renames a folder from its context menu', async () => {
    const user = userEvent.setup()
    render(<NoteList />)
    await openRowMenu(user, screen.getByRole('button', { name: 'Collapse Work' }))
    await user.click(screen.getByText('Rename'))
    const input = screen.getByDisplayValue('Work')
    await user.clear(input)
    await user.type(input, 'Office{Enter}')
    await eventually(() => expect(bridge.calls(RELOAD).length).toBeGreaterThan(0))
    expect(bridge.calls('terminator.notepad:folders.rename')).toContainEqual({
      id: 'f1',
      name: 'Office',
    })
  })

  it('deletes a folder once confirmed', async () => {
    const user = userEvent.setup()
    render(<NoteList />)
    await openRowMenu(user, screen.getByRole('button', { name: 'Collapse Home' }))
    await user.click(screen.getByText('Delete folder'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:folders.delete')).toEqual([{ id: 'f2' }])
    )
  })
}

function noteListItemContextMenuTests() {
  describe('archiving', noteListItemContextMenuArchivingTests)
  describe('restoring', noteListItemContextMenuRestoringTests)
  describe('deleting', noteListItemContextMenuDeletingTests)
  describe('moving', noteListItemContextMenuMovingTests)
}

function noteListItemContextMenuArchivingTests() {
  it.each([
    { title: 'Plan', channel: 'terminator.notepad:notes.archive', id: 'n1' },
    { title: 'Flow', channel: 'terminator.notepad:diagrams.archive', id: 'd1' },
  ])('archives $title from its context menu', async ({ title, channel, id }) => {
    const user = userEvent.setup()
    useNotesStore.setState({ notes: [noteItem('n1', 'Plan')], diagrams: [diagram('d1', 'Flow')] })
    render(<NoteList />)
    await openRowMenu(user, rowTitled(title))
    await user.click(screen.getByText('Archive'))
    await eventually(() => expect(bridge.calls(channel)).toEqual([{ id }]))
  })
}

function selectArchivedNote(): void {
  useNotesStore.setState({
    notes: [noteItem('n1', 'Old', { archivedAt: '2026-01-01' })],
    selectedNoteId: 'n1',
  })
}

function noteListItemContextMenuRestoringTests() {
  beforeEach(selectArchivedNote)

  it('restores an archived note from its context menu', async () => {
    const user = userEvent.setup()
    render(<NoteList />)
    await user.click(screen.getByRole('button', { name: /Archived/ }))
    await openRowMenu(user, rowTitled('Old'))
    await user.click(screen.getByText('Unarchive'))
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:notes.restore')).toEqual([{ id: 'n1' }])
    )
  })
}

function noteListItemContextMenuDeletingTests() {
  beforeEach(selectArchivedNote)

  it('permanently deletes an archived note once confirmed, and clears the selection', async () => {
    const user = userEvent.setup()
    // happy-dom has no window.confirm to spy on, so the test provides one.
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    )
    render(<NoteList />)
    await user.click(screen.getByRole('button', { name: /Archived/ }))
    await openRowMenu(user, rowTitled('Old'))
    await user.click(screen.getByText('Delete'))
    await eventually(() => expect(useNotesStore.getState().selectedNoteId).toBeNull())
    expect(bridge.calls('terminator.notepad:notes.hardDelete')).toEqual([{ id: 'n1' }])
  })
}

function noteListItemContextMenuMovingTests() {
  beforeEach(() => {
    useNotesStore.setState({
      notes: [noteItem('n1', 'Plan'), noteItem('n2', 'Filed', { folderId: 'f1' })],
      folders: [folder('f1', 'Work')],
    })
  })

  it('moves an item into a folder', async () => {
    const user = userEvent.setup()
    render(<NoteList />)
    await openRowMenu(user, rowTitled('Plan'))
    await user.click(screen.getByText('Move to Work'))
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:folders.move')).toEqual([
        { items: [{ id: 'n1', type: 'note' }], folderId: 'f1' },
      ])
    )
  })

  it('takes an item out of its folder', async () => {
    const user = userEvent.setup()
    render(<NoteList />)
    await openRowMenu(user, rowTitled('Filed'))
    await user.click(screen.getByText('Remove from folder'))
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:folders.move')).toEqual([
        { items: [{ id: 'n2', type: 'note' }], folderId: null },
      ])
    )
  })
}

function noteListDragDropTests() {
  beforeEach(() => {
    useNotesStore.setState({
      notes: [
        noteItem('n1', 'First', { sortOrder: 0 }),
        noteItem('n2', 'Second', { sortOrder: 1 }),
        noteItem('n3', 'Filed', { folderId: 'f1' }),
      ],
      diagrams: [diagram('d1', 'Flow', { sortOrder: 2 })],
      folders: [folder('f1', 'Work')],
    })
  })

  describe('reordering', noteListDragDropReorderingTests)
  describe('dropping among a folder', noteListDragDropDroppingAmongFolderTests)
  describe('dropping on a header', noteListDragDropDroppingHeaderTests)
  describe('out of folders', noteListDragDropOutFoldersTests)
}

function noteListDragDropReorderingTests() {
  it('reorders by dropping one item before another', async () => {
    render(<NoteList />)
    drag('dragStart', rowTitled('Flow'))
    drag('dragOver', rowTitled('First'), -1)
    drag('drop', rowTitled('First'))
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
}

function noteListDragDropDroppingAmongFolderTests() {
  it('moves an item into the folder it is dropped among', async () => {
    render(<NoteList />)
    drag('dragStart', rowTitled('First'))
    drag('dragOver', rowTitled('Filed'), 10)
    drag('drop', rowTitled('Filed'))
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
}

function noteListDragDropDroppingHeaderTests() {
  it('moves an item into a folder dropped on its header', async () => {
    render(<NoteList />)
    const header = within(screen.getByRole('group', { name: 'Work' })).getByTestId(
      'notepad-folder-header'
    )
    drag('dragStart', rowTitled('Second'))
    drag('dragOver', header)
    expect(header.className).toContain('notepad-folder-header--drop-target')
    drag('drop', header)
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:folders.move')).toEqual([
        { items: [{ id: 'n2', type: 'note' }], folderId: 'f1' },
      ])
    )
  })
}

function noteListDragDropOutFoldersTests() {
  it('takes an item out of its folder when dropped on the list itself', async () => {
    render(<NoteList />)
    const list = screen.getByTestId('notepad-note-list-drop-zone')
    drag('dragStart', rowTitled('Filed'))
    drag('dragOver', list)
    drag('drop', list)
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:folders.move')).toEqual([
        { items: [{ id: 'n3', type: 'note' }], folderId: null },
      ])
    )
  })
}
