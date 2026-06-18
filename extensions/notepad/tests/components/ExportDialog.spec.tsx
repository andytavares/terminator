import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { useNotesStore } from '../../src/stores/notes.store'
import type { NoteListItem } from '../../src/db/types'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'electronAPI', {
  value: { extensionBridge: { invoke: mockInvoke } },
  writable: true,
  configurable: true,
})

import { ExportDialog } from '../../src/components/ExportDialog'

const dummyNote: NoteListItem = {
  id: 'n1',
  title: 'Note 1',
  updatedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  archivedAt: null,
  tags: [],
  bodyPreview: '',
}

describe('ExportDialog', () => {
  beforeEach(() => {
    mockInvoke.mockClear()
    useNotesStore.setState({
      notes: [],
      selectedNoteId: null,
      archivedVisible: false,
      showQuickCreate: false,
    })
  })

  it('renders title "Export to markdown"', () => {
    render(<ExportDialog onClose={vi.fn()} />)
    expect(screen.getByText('Export to markdown')).toBeDefined()
  })

  it('renders folder input with default value', () => {
    render(<ExportDialog onClose={vi.fn()} />)
    const input = screen.getByDisplayValue('~/Documents/Terminator Notes')
    expect(input).toBeDefined()
  })

  it('renders a Choose… button', () => {
    render(<ExportDialog onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /choose folder|choose…/i })).toBeTruthy()
  })

  it('folder Choose… button calls export.pickFolder IPC', async () => {
    mockInvoke.mockResolvedValueOnce({ data: '/Users/test/notes' })
    render(<ExportDialog onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /choose folder|choose…/i }))
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('terminator.notepad:export.pickFolder', {})
    })
  })

  it('updates folder input after picking', async () => {
    mockInvoke.mockResolvedValueOnce({ data: '/Users/test/notes' })
    render(<ExportDialog onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /choose folder|choose…/i }))
    await waitFor(() => {
      expect(screen.getByDisplayValue('/Users/test/notes')).toBeDefined()
    })
  })

  it('renders scope tab "All notes (0)" when no notes in store', () => {
    render(<ExportDialog onClose={vi.fn()} />)
    expect(screen.getByText('All notes (0)')).toBeDefined()
  })

  it('renders scope tab with correct count when notes exist', () => {
    useNotesStore.setState({
      notes: [dummyNote],
      selectedNoteId: null,
      archivedVisible: false,
      showQuickCreate: false,
    })
    render(<ExportDialog onClose={vi.fn()} />)
    expect(screen.getByText('All notes (1)')).toBeDefined()
  })

  it('shows "Selected (1)" tab when noteId prop is provided', () => {
    render(<ExportDialog onClose={vi.fn()} noteId="n1" />)
    expect(screen.getByText('Selected (1)')).toBeDefined()
  })

  it('does not show "Selected (1)" tab without noteId prop', () => {
    render(<ExportDialog onClose={vi.fn()} />)
    expect(screen.queryByText('Selected (1)')).toBeNull()
  })

  it('renders YAML frontmatter toggle', () => {
    render(<ExportDialog onClose={vi.fn()} />)
    expect(screen.getByText(/Include YAML frontmatter/)).toBeDefined()
  })

  it('renders Export comments segmented control', () => {
    render(<ExportDialog onClose={vi.fn()} />)
    expect(screen.getByText('Sidecar JSON')).toBeDefined()
    expect(screen.getByText('Inline HTML')).toBeDefined()
    expect(screen.getByText('Both')).toBeDefined()
  })

  it('renders Overwrite existing toggle', () => {
    render(<ExportDialog onClose={vi.fn()} />)
    expect(screen.getByText(/Overwrite existing by id/)).toBeDefined()
  })

  it('Export button shows note count from store', () => {
    useNotesStore.setState({
      notes: [dummyNote, dummyNote],
      selectedNoteId: null,
      archivedVisible: false,
      showQuickCreate: false,
    })
    render(<ExportDialog onClose={vi.fn()} />)
    expect(screen.getByText('Export 2 notes')).toBeDefined()
  })

  it('cancel button calls onClose', () => {
    const onClose = vi.fn()
    render(<ExportDialog onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('Export button calls export.run IPC', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { exported: 1 } })
    render(<ExportDialog onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Export 0 notes'))
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'terminator.notepad:export.run',
        expect.objectContaining({ folder: '~/Documents/Terminator Notes', scope: 'all' })
      )
    })
  })
})
