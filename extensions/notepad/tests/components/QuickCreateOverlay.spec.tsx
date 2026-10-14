import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup, waitFor } from '@testing-library/react'

const mockInvoke = vi.fn().mockResolvedValue({
  data: { id: 'n1', title: 'Test', createdAt: '2026-01-01T00:00:00Z' },
})

Object.defineProperty(window, 'electronAPI', {
  value: {
    extensionBridge: { invoke: mockInvoke },
    extension: { getSettingsValues: vi.fn().mockResolvedValue({ values: {} }) },
  },
  writable: true,
  configurable: true,
})

import { QuickCreateOverlay } from '../../src/components/QuickCreateOverlay'
import { useNotesStore } from '../../src/stores/notes.store'

afterEach(() => {
  cleanup()
  mockInvoke.mockClear()
  useNotesStore.setState({ showQuickCreate: false })
})

describe('QuickCreateOverlay', () => {
  it('renders title input and editor container', () => {
    useNotesStore.setState({ showQuickCreate: true })
    const { container } = render(<QuickCreateOverlay />)
    expect(screen.getByPlaceholderText(/title/i)).toBeTruthy()
    // Body is now a CodeMirror editor (NoteEditor), not a textarea
    expect(container.querySelector('.notepad-quick-create__body')).toBeTruthy()
  })

  it('Esc key closes the overlay via store', () => {
    useNotesStore.setState({ showQuickCreate: true })
    render(<QuickCreateOverlay />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useNotesStore.getState().showQuickCreate).toBe(false)
  })

  it('renders a Save button', () => {
    useNotesStore.setState({ showQuickCreate: true })
    render(<QuickCreateOverlay />)
    expect(screen.getByRole('button', { name: /save/i })).toBeTruthy()
  })

  it('Cancel button closes the overlay via store', () => {
    useNotesStore.setState({ showQuickCreate: true })
    render(<QuickCreateOverlay />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(useNotesStore.getState().showQuickCreate).toBe(false)
  })
})

describe('QuickCreateOverlay kind', () => {
  it('offers what to create as one choice, Note first', () => {
    useNotesStore.setState({ showQuickCreate: true })
    render(<QuickCreateOverlay />)
    expect(screen.getByRole('radiogroup', { name: 'Create' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Note' }).getAttribute('aria-checked')).toBe('true')
  })

  it('moves to the next kind with the arrow keys, and drops the note body for it', () => {
    useNotesStore.setState({ showQuickCreate: true })
    const { container } = render(<QuickCreateOverlay />)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Note' }), { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: 'Diagram' }).getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('.notepad-quick-create__body')).toBeNull()
  })
})

function openWithKind(kind: 'Note' | 'Diagram' | 'Folder') {
  useNotesStore.setState({ showQuickCreate: true })
  render(<QuickCreateOverlay />)
  fireEvent.click(screen.getByRole('radio', { name: kind }))
}

function typeTitle(title: string) {
  fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: title } })
}

function invokedWith(channel: string) {
  return mockInvoke.mock.calls.filter(([ch]) => ch === channel).map(([, payload]) => payload)
}

describe('QuickCreateOverlay saving a note', () => {
  it('creates the note with the typed title and a tag still in the input, then closes', async () => {
    openWithKind('Note')
    typeTitle('Plan')
    fireEvent.change(screen.getByPlaceholderText('# add tag…'), { target: { value: 'Big Idea' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(useNotesStore.getState().showQuickCreate).toBe(false))
    expect(invokedWith('terminator.notepad:notes.create')).toEqual([
      { title: 'Plan', body: '', tags: ['big-idea'] },
    ])
    expect(invokedWith('terminator.notepad:notes.list')).toEqual([{ includeArchived: true }])
  })

  it('stays open and can save again when creating fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockInvoke.mockRejectedValueOnce(new Error('disk full'))
    openWithKind('Note')
    typeTitle('Plan')
    fireEvent.keyDown(screen.getByPlaceholderText(/title/i), { key: 'Enter' })
    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(useNotesStore.getState().showQuickCreate).toBe(true)
    const save = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    error.mockRestore()
  })
})

describe('QuickCreateOverlay saving a diagram or folder', () => {
  it('creates an untitled diagram, refreshes the list and selects it', async () => {
    mockInvoke.mockImplementation(async (channel: string) =>
      channel === 'terminator.notepad:diagrams.list' ? { data: [] } : { data: { id: 'd1' } }
    )
    openWithKind('Diagram')
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(useNotesStore.getState().showQuickCreate).toBe(false))
    expect(invokedWith('terminator.notepad:diagrams.create')).toEqual([
      { title: 'Untitled diagram', tags: [] },
    ])
    expect(useNotesStore.getState().selectedDiagramId).toBe('d1')
  })

  it('creates a named folder, and does nothing for a folder without a name', async () => {
    mockInvoke.mockResolvedValue({ data: [] })
    openWithKind('Folder')
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(invokedWith('terminator.notepad:folders.create')).toEqual([])
    typeTitle('  Work  ')
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(useNotesStore.getState().showQuickCreate).toBe(false))
    expect(invokedWith('terminator.notepad:folders.create')).toEqual([{ name: 'Work' }])
    expect(invokedWith('terminator.notepad:folders.list')).toEqual([{}])
  })
})
