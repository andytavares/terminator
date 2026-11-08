import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, screen, cleanup, act, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import React from 'react'
import { useNotesStore } from '../../src/stores/notes.store'
import { useFilterStore } from '../../src/stores/filter.store'
import type { NoteListItem } from '../../src/db/types'

const mockInvoke = vi.fn()
beforeEach(() => {
  mockInvoke.mockResolvedValue({ data: [] })
  vi.stubGlobal('electronAPI', { extensionBridge: { invoke: mockInvoke } })
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

async function openEditDialog(user: UserEvent): Promise<HTMLElement> {
  render(<NoteList />)
  await user.pointer({ keys: '[MouseRight]', target: screen.getByText('First Note') })
  await user.click(screen.getByText('Edit title & tags'))
  return screen.getByRole('dialog', { name: 'Edit note' })
}

async function openTagFilter(user: UserEvent): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'Tags' }))
  return screen.getByRole('group', { name: 'Filter by tag' })
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

  it('says whether the archived section is open', async () => {
    const user = userEvent.setup()
    render(<NoteList />)
    const toggle = screen.getByRole('button', { name: /Archived \(1\)/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await user.click(toggle)
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
  it('shows the empty state when there are no notes', () => {
    render(<NoteList />)
    expect(screen.getByRole('heading', { name: 'No notes yet' })).toBeDefined()
    expect(screen.getByText(/Capture your first note/i)).toBeDefined()
    expect(screen.getByText(/Tip:/i)).toBeDefined()
  })

  it('opens the composer when New note is chosen in the empty state', async () => {
    const user = userEvent.setup()
    useNotesStore.setState({ showQuickCreate: false })
    render(<NoteList />)
    await user.click(screen.getByRole('button', { name: /^New note/ }))
    expect(useNotesStore.getState().showQuickCreate).toBe(true)
  })
}

function noteListSelectingTests() {
  it('selects the note that is clicked', async () => {
    const user = userEvent.setup()
    useNotesStore.setState({ notes: [note1], selectedNoteId: null, archivedVisible: false })
    render(<NoteList />)
    await user.click(screen.getByText('First Note'))
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
    mockInvoke.mockReset().mockResolvedValue({ data: [] })
    useNotesStore.setState({
      notes: [note1, note2],
      folders: [],
      selectedNoteId: null,
      archivedVisible: false,
    })
    useFilterStore.setState({ searchQuery: '', activeTagIds: [], includeArchived: false })
  })

  describe('search input', noteListSearchBarSearchInputTests)
}

function noteListSearchBarSearchInputTests() {
  it('typing in search bar updates filter.store searchQuery', async () => {
    const user = userEvent.setup()
    render(<NoteList />)
    await user.type(screen.getByPlaceholderText(/search/i), 'hello')
    expect(useFilterStore.getState().searchQuery).toBe('hello')
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
  describe('closing a context menu', noteListContextMenuClosingTests)
}

function noteListTagFilterDropdownListingTagsTests() {
  it('opens dropdown and shows tag names on button click', async () => {
    const user = userEvent.setup()
    render(<NoteList />)
    const dropdown = await openTagFilter(user)
    expect(within(dropdown).getByRole('button', { name: /work/ }).textContent).toBe('#work1')
    expect(within(dropdown).getByRole('button', { name: /infra/ }).textContent).toBe('#infra1')
  })
}

function noteListTagFilterDropdownAddingTagTests() {
  it('clicking a tag in the dropdown shows only the notes with that tag', async () => {
    const user = userEvent.setup()
    render(<NoteList />)
    const dropdown = await openTagFilter(user)
    await user.click(within(dropdown).getByRole('button', { name: /infra/ }))
    expect(screen.queryByText('First Note')).toBeNull()
    expect(screen.getByText('Infra Note').textContent).toBe('Infra Note')
  })
}

function noteListTagFilterDropdownRemovingTagTests() {
  it('clicking the same tag again shows every note again', async () => {
    const user = userEvent.setup()
    render(<NoteList />)
    const dropdown = await openTagFilter(user)
    await user.click(within(dropdown).getByRole('button', { name: /infra/ }))
    await user.click(within(dropdown).getByRole('button', { name: /infra/ }))
    expect(useFilterStore.getState().activeTagIds).toEqual([])
    expect(screen.getByText('First Note').textContent).toBe('First Note')
  })
}

function noteListTagFilterDropdownClosingTests() {
  it('closes the dropdown on Escape', async () => {
    const user = userEvent.setup()
    render(<NoteList />)
    await openTagFilter(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Filter by tag' })).toBeNull()
  })

  it('keeps the dropdown open for a click inside it', async () => {
    const user = userEvent.setup()
    render(<NoteList />)
    const dropdown = await openTagFilter(user)
    await user.click(dropdown)
    expect(screen.getByRole('group', { name: 'Filter by tag' })).toBeTruthy()
  })

  it('closes the dropdown on a click outside it', async () => {
    const user = userEvent.setup()
    render(<NoteList />)
    await openTagFilter(user)
    await user.click(document.body)
    expect(screen.queryByRole('group', { name: 'Filter by tag' })).toBeNull()
  })
}

function noteListContextMenuClosingTests() {
  it('closes a note context menu on Escape', async () => {
    const user = userEvent.setup()
    render(<NoteList />)
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('First Note') })
    expect(document.querySelector('.notepad-context-menu')).not.toBeNull()
    await user.keyboard('{Escape}')
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
  it('is a modal dialog named for what it edits, with the title field focused', async () => {
    const dialog = await openEditDialog(userEvent.setup())
    expect(dialog.tagName).toBe('DIALOG')
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Title'))
  })

  it('saves the new title when Enter is pressed in the title field', async () => {
    const user = userEvent.setup()
    await openEditDialog(user)
    const title = screen.getByPlaceholderText('Title')
    expect(document.activeElement).toBe(title)
    await user.clear(title)
    await user.type(title, 'Renamed{Enter}')
    expect(mockInvoke).toHaveBeenCalledWith(
      'terminator.notepad:notes.autosave',
      expect.objectContaining({ id: 'n1', title: 'Renamed', tags: ['work'], titleSetByHand: true })
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })
}

function noteListEditDialogTitleDerivingTests() {
  it('leaves the title deriving from the body when only the tags change', async () => {
    const user = userEvent.setup()
    await openEditDialog(user)
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Title'))
    await user.keyboard('{Enter}')
    expect(mockInvoke).toHaveBeenCalledWith(
      'terminator.notepad:notes.autosave',
      expect.objectContaining({ id: 'n1', title: 'First Note', titleSetByHand: false })
    )
  })
}

function noteListEditDialogKeyboardTests() {
  it('closes on Escape without saving', async () => {
    const user = userEvent.setup()
    await openEditDialog(user)
    await user.keyboard('{Escape}')
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
