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
}

const note2: NoteListItem = {
  id: 'n2',
  title: 'Second Note',
  bodyPreview: 'Preview of second note',
  updatedAt: '2026-01-03T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  archivedAt: null,
  tags: [],
}

describe('NoteList', () => {
  beforeEach(() => {
    cleanup()
    mockInvoke.mockClear()
    useNotesStore.setState({ notes: [], selectedNoteId: null, archivedVisible: false })
    useFilterStore.setState({ searchQuery: '', activeTagId: null, includeArchived: false })
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

  it('renders body preview text', () => {
    useNotesStore.setState({ notes: [note1], selectedNoteId: null, archivedVisible: false })
    render(<NoteList />)
    expect(screen.getByText(/preview of first note/i)).toBeDefined()
  })
})

describe('NoteList search bar', () => {
  beforeEach(() => {
    cleanup()
    mockInvoke.mockClear()
    useNotesStore.setState({ notes: [note1, note2], selectedNoteId: null, archivedVisible: false })
    useFilterStore.setState({ searchQuery: '', activeTagId: null, includeArchived: false })
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

  it('includes archived toggle flips filter.store includeArchived', () => {
    render(<NoteList />)
    const toggle = screen.getByRole('button', { name: /include archived/i })
    fireEvent.click(toggle)
    expect(useFilterStore.getState().includeArchived).toBe(true)
  })
})

describe('NoteList tag sidebar', () => {
  const note3: NoteListItem = {
    id: 'n3',
    title: 'Infra Note',
    bodyPreview: '',
    updatedAt: '2026-01-04T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    archivedAt: null,
    tags: ['infra'],
  }

  beforeEach(() => {
    cleanup()
    mockInvoke.mockClear()
    useNotesStore.setState({ notes: [note1, note3], selectedNoteId: null, archivedVisible: false })
    useFilterStore.setState({ searchQuery: '', activeTagId: null, includeArchived: false })
  })

  it('renders unique tag names from notes', () => {
    render(<NoteList />)
    expect(screen.getByText('work')).toBeDefined()
    expect(screen.getByText('infra')).toBeDefined()
  })

  it('clicking a tag sets filter.store activeTagId for that tag', async () => {
    mockInvoke.mockResolvedValueOnce({ data: [{ id: 'tag-infra', name: 'infra', noteCount: 1 }] })
    render(<NoteList />)
    const tagBtn = screen.getByText('infra')
    await act(async () => {
      fireEvent.click(tagBtn)
    })
    expect(useFilterStore.getState().activeTagId).toBeTruthy()
  })
})
