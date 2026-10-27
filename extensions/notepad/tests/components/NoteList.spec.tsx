import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react'
import React from 'react'
import { useNotesStore } from '../../src/stores/notes.store'
import { useFilterStore } from '../../src/stores/filter.store'
import type { NoteListItem } from '../../src/db/types'

const mockInvoke = vi.fn().mockResolvedValue({ data: [] })
Object.defineProperty(window, 'electronAPI', {
  value: { extensionBridge: { invoke: mockInvoke } },
  writable: true,
  configurable: true,
})

import { NoteList } from '../../src/components/NoteList'

const note1: NoteListItem = {
  id: 'n1',
  title: 'First Note',
  bodyPreview: 'Preview of first note',
  updatedAt: '2026-01-02T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  archivedAt: null,
  tags: ['work'],
  sortOrder: 0,
  folderId: null,
}

const note2: NoteListItem = {
  id: 'n2',
  title: 'Second Note',
  bodyPreview: 'Preview of second note',
  updatedAt: '2026-01-03T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  archivedAt: null,
  tags: [],
  sortOrder: 1,
  folderId: null,
}

describe('NoteList', noteListTests)
describe('NoteList search bar', noteListSearchBarTests)

const note3: NoteListItem = {
  id: 'n3',
  title: 'Infra Note',
  bodyPreview: '',
  updatedAt: '2026-01-04T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  archivedAt: null,
  tags: ['infra'],
  sortOrder: 2,
  folderId: null,
}

describe('NoteList tag filter dropdown', noteListTagFilterDropdownTests)

function openEditDialog(): HTMLElement {
  render(<NoteList />)
  fireEvent.contextMenu(screen.getByText('First Note'))
  fireEvent.click(screen.getByText('Edit title & tags'))
  return screen.getByRole('dialog', { name: 'Edit note' })
}

describe('NoteList edit dialog', noteListEditDialogTests)
describe('NoteList drag to reorder', noteListDragToReorderTests)

describe('NoteList archived section', () => {
  beforeEach(() => {
    cleanup()
    const archived = { ...note2, archivedAt: '2026-01-04T00:00:00Z' }
    useNotesStore.setState({
      notes: [note1, archived],
      folders: [],
      selectedNoteId: null,
      archivedVisible: false,
    })
    useFilterStore.setState({ searchQuery: '', activeTagIds: [], includeArchived: false })
  })

  it('says whether the archived section is open', () => {
    render(<NoteList />)
    const toggle = screen.getByRole('button', { name: /Archived \(1\)/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })
})

function noteListTests() {
  beforeEach(() => {
    cleanup()
    mockInvoke.mockClear()
    useNotesStore.setState({ notes: [], folders: [], selectedNoteId: null, archivedVisible: false })
    useFilterStore.setState({ searchQuery: '', activeTagIds: [], includeArchived: false })
  })

  describe('rendering', noteListRenderingTests)
  describe('selecting', noteListSelectingTests)
}

function noteListRenderingTests() {
  it('shows EmptyState when there are no notes', () => {
    render(<NoteList />)
    expect(screen.getByText(/no notes/i)).toBeDefined()
  })

  it('renders note titles', () => {
    useNotesStore.setState({ notes: [note1, note2], selectedNoteId: null, archivedVisible: false })
    render(<NoteList />)
    expect(screen.getByText('First Note')).toBeDefined()
    expect(screen.getByText('Second Note')).toBeDefined()
  })
}

function noteListSelectingTests() {
  it('calls setSelected when a note is clicked', () => {
    useNotesStore.setState({ notes: [note1], selectedNoteId: null, archivedVisible: false })
    render(<NoteList />)
    fireEvent.click(screen.getByText('First Note'))
    expect(useNotesStore.getState().selectedNoteId).toBe('n1')
  })

  it('renders inline tags in meta-line', () => {
    useNotesStore.setState({ notes: [note1], selectedNoteId: null, archivedVisible: false })
    render(<NoteList />)
    expect(screen.getByText(/#work/)).toBeDefined()
  })
}

function noteListSearchBarTests() {
  beforeEach(() => {
    cleanup()
    mockInvoke.mockClear()
    useNotesStore.setState({
      notes: [note1, note2],
      folders: [],
      selectedNoteId: null,
      archivedVisible: false,
    })
    useFilterStore.setState({ searchQuery: '', activeTagIds: [], includeArchived: false })
  })

  describe('search input', noteListSearchBarSearchInputTests)
  describe('archived notes', noteListSearchBarArchivedNotesTests)
}

function noteListSearchBarSearchInputTests() {
  it('renders a search input', () => {
    render(<NoteList />)
    expect(screen.getByPlaceholderText(/search/i)).toBeDefined()
  })

  it('typing in search bar updates filter.store searchQuery', async () => {
    render(<NoteList />)
    const input = screen.getByPlaceholderText(/search/i)
    fireEvent.change(input, { target: { value: 'hello' } })
    expect(useFilterStore.getState().searchQuery).toBe('hello')
  })
}

function noteListSearchBarArchivedNotesTests() {
  it('archived notes appear in a collapsible section', () => {
    const archivedNote: NoteListItem = {
      ...note1,
      id: 'n3',
      title: 'Archived Note',
      archivedAt: '2026-01-01T00:00:00Z',
    }
    useNotesStore.setState({
      notes: [note1, archivedNote],
      selectedNoteId: null,
      archivedVisible: false,
    })
    render(<NoteList />)
    expect(screen.getByText(/Archived \(1\)/)).toBeDefined()
  })
}

function noteListTagFilterDropdownTests() {
  beforeEach(() => {
    cleanup()
    mockInvoke.mockClear()
    useNotesStore.setState({
      notes: [note1, note3],
      folders: [],
      selectedNoteId: null,
      archivedVisible: false,
    })
    useFilterStore.setState({ searchQuery: '', activeTagIds: [], includeArchived: false })
  })

  describe('listing tags', noteListTagFilterDropdownListingTagsTests)
  describe('adding a tag', noteListTagFilterDropdownAddingTagTests)
  describe('removing a tag', noteListTagFilterDropdownRemovingTagTests)
  describe('closing', noteListTagFilterDropdownClosingTests)
}

function noteListTagFilterDropdownListingTagsTests() {
  it('renders a Tags button when notes have tags', () => {
    render(<NoteList />)
    expect(screen.getByText('Tags')).toBeDefined()
  })

  it('opens dropdown and shows tag names on button click', () => {
    render(<NoteList />)
    fireEvent.click(screen.getByText('Tags'))
    expect(screen.getAllByText('work').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('infra').length).toBeGreaterThanOrEqual(1)
  })
}

function noteListTagFilterDropdownAddingTagTests() {
  it('clicking a tag in the dropdown adds it to activeTagIds', async () => {
    render(<NoteList />)
    fireEvent.click(screen.getByText('Tags'))
    const infraOptions = screen
      .getAllByRole('button')
      .filter((b) => b.textContent?.includes('infra'))
    // The dropdown option is inside the dropdown (not the note row tag)
    const dropdownOption = infraOptions.find((b) =>
      b.className.includes('notepad-tag-filter__option')
    )
    expect(dropdownOption).toBeDefined()
    await act(async () => {
      fireEvent.click(dropdownOption!)
    })
    expect(useFilterStore.getState().activeTagIds.length).toBe(1)
  })
}

function noteListTagFilterDropdownRemovingTagTests() {
  it('clicking the same tag again removes it from activeTagIds', async () => {
    render(<NoteList />)
    fireEvent.click(screen.getByText('Tags'))
    const infraOptions = screen
      .getAllByRole('button')
      .filter((b) => b.textContent?.includes('infra'))
    const dropdownOption = infraOptions.find((b) =>
      b.className.includes('notepad-tag-filter__option')
    )
    await act(async () => {
      fireEvent.click(dropdownOption!)
    })
    await act(async () => {
      fireEvent.click(dropdownOption!)
    })
    expect(useFilterStore.getState().activeTagIds).toEqual([])
  })
}

function noteListTagFilterDropdownClosingTests() {
  it('closes the dropdown on Escape', () => {
    render(<NoteList />)
    fireEvent.click(screen.getByText('Tags'))
    expect(document.querySelector('.notepad-tag-filter__dropdown')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('.notepad-tag-filter__dropdown')).toBeNull()
  })

  it('closes the dropdown on a click outside it, and keeps it open for one inside', async () => {
    render(<NoteList />)
    fireEvent.click(screen.getByText('Tags'))
    fireEvent.click(document.querySelector('.notepad-tag-filter__dropdown')!)
    expect(document.querySelector('.notepad-tag-filter__dropdown')).not.toBeNull()
    fireEvent.click(document.body)
    expect(document.querySelector('.notepad-tag-filter__dropdown')).toBeNull()
  })

  it('closes a note context menu on Escape', () => {
    render(<NoteList />)
    fireEvent.contextMenu(screen.getByText('First Note'))
    expect(document.querySelector('.notepad-context-menu')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('.notepad-context-menu')).toBeNull()
  })
}

function noteListEditDialogTests() {
  beforeEach(() => {
    cleanup()
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue({ data: { body: 'Body' } })
    useNotesStore.setState({
      notes: [note1],
      folders: [],
      selectedNoteId: null,
      archivedVisible: false,
    })
    useFilterStore.setState({ searchQuery: '', activeTagIds: [], includeArchived: false })
  })

  describe('opening and saving', noteListEditDialogOpeningSavingTests)
  describe('a title left alone', noteListEditDialogTitleDerivingTests)
  describe('keyboard', noteListEditDialogKeyboardTests)
}

function noteListEditDialogOpeningSavingTests() {
  it('is a modal dialog named for what it edits, with the title field focused', () => {
    const dialog = openEditDialog()
    expect(dialog.tagName).toBe('DIALOG')
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Title'))
  })

  it('saves the new title when Enter is pressed in the title field', async () => {
    openEditDialog()
    const title = screen.getByPlaceholderText('Title')
    fireEvent.change(title, { target: { value: 'Renamed' } })
    await act(async () => {
      fireEvent.submit(title.closest('form')!)
    })
    expect(mockInvoke).toHaveBeenCalledWith(
      'terminator.notepad:notes.autosave',
      expect.objectContaining({ id: 'n1', title: 'Renamed', tags: ['work'], titleSetByHand: true })
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })
}

function noteListEditDialogTitleDerivingTests() {
  it('leaves the title deriving from the body when only the tags change', async () => {
    openEditDialog()
    const title = screen.getByPlaceholderText('Title')
    await act(async () => {
      fireEvent.submit(title.closest('form')!)
    })
    expect(mockInvoke).toHaveBeenCalledWith(
      'terminator.notepad:notes.autosave',
      expect.objectContaining({ id: 'n1', title: 'First Note', titleSetByHand: false })
    )
  })
}

function noteListEditDialogKeyboardTests() {
  it('closes on Escape without saving', () => {
    openEditDialog()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockInvoke).not.toHaveBeenCalledWith(
      'terminator.notepad:notes.autosave',
      expect.anything()
    )
  })
}

const draggedRow = (title: string) => screen.getByText(title).closest('button') as HTMLElement

/** Drags the first note onto the second; `over` says whether it passes over the row first. */
async function dragFirstOntoSecond(over: boolean): Promise<void> {
  const dataTransfer = { effectAllowed: '', dropEffect: '' }
  fireEvent.dragStart(draggedRow('First Note'), { dataTransfer })
  // jsdom drag events carry no pointer position, which reads as the lower half.
  if (over) fireEvent.dragOver(draggedRow('Second Note'), { dataTransfer })
  await act(async () => {
    fireEvent.drop(draggedRow('Second Note'), { dataTransfer })
  })
}

function noteListDragToReorderTests() {
  beforeEach(() => {
    cleanup()
    mockInvoke.mockClear()
    useNotesStore.setState({
      notes: [note1, note2],
      folders: [],
      selectedNoteId: null,
      archivedVisible: false,
    })
    useFilterStore.setState({ searchQuery: '', activeTagIds: [], includeArchived: false })
  })
  describe('within a group', noteListDragWithinGroupTests)
  describe('into a folder', noteListDragIntoFolderTests)
}

function noteListDragWithinGroupTests() {
  it('saves the new order when a note is dropped below another', async () => {
    render(<NoteList />)
    await dragFirstOntoSecond(true)
    expect(mockInvoke).toHaveBeenCalledWith('terminator.notepad:notes.reorder', {
      items: [
        { id: 'n2', type: 'note' },
        { id: 'n1', type: 'note' },
      ],
    })
  })

  it('saves nothing for a drop with no row under the pointer', async () => {
    render(<NoteList />)
    await dragFirstOntoSecond(false)
    expect(mockInvoke).not.toHaveBeenCalledWith(
      'terminator.notepad:notes.reorder',
      expect.anything()
    )
  })
}

function noteListDragIntoFolderTests() {
  it('moves a note dropped beside one in a folder into that folder', async () => {
    useNotesStore.setState({
      notes: [note1, { ...note2, folderId: 'f1' }],
      folders: [{ id: 'f1', name: 'Work', sortOrder: 0, createdAt: '' }],
    })
    render(<NoteList />)
    await dragFirstOntoSecond(true)
    expect(mockInvoke).toHaveBeenCalledWith('terminator.notepad:folders.move', {
      items: [{ id: 'n1', type: 'note' }],
      folderId: 'f1',
    })
    expect(mockInvoke).toHaveBeenCalledWith('terminator.notepad:notes.reorder', {
      items: [
        { id: 'n2', type: 'note' },
        { id: 'n1', type: 'note' },
      ],
    })
  })
}
