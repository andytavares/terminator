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

describe('NoteList', () => {
  beforeEach(() => {
    cleanup()
    mockInvoke.mockClear()
    useNotesStore.setState({ notes: [], selectedNoteId: null, archivedVisible: false })
    useFilterStore.setState({ searchQuery: '', activeTagIds: [], includeArchived: false })
  })

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
})

describe('NoteList search bar', () => {
  beforeEach(() => {
    cleanup()
    mockInvoke.mockClear()
    useNotesStore.setState({ notes: [note1, note2], selectedNoteId: null, archivedVisible: false })
    useFilterStore.setState({ searchQuery: '', activeTagIds: [], includeArchived: false })
  })

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
})

describe('NoteList tag filter dropdown', () => {
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

  beforeEach(() => {
    cleanup()
    mockInvoke.mockClear()
    useNotesStore.setState({ notes: [note1, note3], selectedNoteId: null, archivedVisible: false })
    useFilterStore.setState({ searchQuery: '', activeTagIds: [], includeArchived: false })
  })

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
})
