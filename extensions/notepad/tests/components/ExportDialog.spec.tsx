import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { useNotesStore } from '../../src/stores/notes.store'
import type { NoteListItem } from '../../src/db/types'

const mockInvoke = vi.fn()
const mockRecord = vi.fn()
const mockSettings = vi.fn().mockResolvedValue({ values: {} })
Object.defineProperty(window, 'electronAPI', {
  value: {
    extensionBridge: { invoke: mockInvoke },
    extension: { getSettingsValues: mockSettings },
    usage: { record: mockRecord },
  },
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
  sortOrder: 0,
  folderId: null,
}

describe('ExportDialog', exportDialogTests)
describe('ExportDialog settings', exportDialogSettingsTests)

function exportDialogTests() {
  beforeEach(() => {
    mockInvoke.mockClear()
    mockRecord.mockClear()
    useNotesStore.setState({
      notes: [],
      selectedNoteId: null,
      archivedVisible: false,
      showQuickCreate: false,
    })
  })

  describe('picking a folder', exportDialogPickingFolderTests)
  describe('scope', exportDialogScopeTests)
  describe('options', exportDialogOptionsTests)
  describe('comment format', exportDialogCommentFormatTests)
  describe('export button', exportDialogExportButtonTests)
  describe('running', exportDialogRunningTests)
}

function exportDialogPickingFolderTests() {
  it('Choose… asks export.pickFolder for a folder and shows the picked path', async () => {
    mockInvoke.mockResolvedValueOnce({ data: '/Users/test/notes' })
    const user = userEvent.setup()
    render(<ExportDialog onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /choose folder|choose…/i }))
    expect(await screen.findByDisplayValue('/Users/test/notes')).toBeTruthy()
    expect(mockInvoke).toHaveBeenCalledWith('terminator.notepad:export.pickFolder', {})
  })
}

function exportDialogScopeTests() {
  it.each([
    { notes: [], label: 'All notes (0)' },
    { notes: [dummyNote], label: 'All notes (1)' },
  ])('labels the all-notes scope tab $label from the store', ({ notes, label }) => {
    useNotesStore.setState({ notes })
    render(<ExportDialog onClose={vi.fn()} />)
    expect(screen.getByText(label)).toBeTruthy()
  })

  it('shows "Selected (1)" tab when noteId prop is provided', () => {
    render(<ExportDialog onClose={vi.fn()} noteId="n1" />)
    expect(screen.getByText('Selected (1)')).toBeDefined()
  })

  it('does not show "Selected (1)" tab without noteId prop', () => {
    render(<ExportDialog onClose={vi.fn()} />)
    expect(screen.queryByText('Selected (1)')).toBeNull()
  })
}

function exportDialogOptionsTests() {
  it.each([
    { label: 'Include YAML frontmatter', payload: { includeFrontmatter: false } },
    { label: 'Overwrite existing by id', payload: { overwriteById: false } },
    { label: 'Include diagrams', payload: { includeDiagrams: false } },
  ])('turning off $label sends $payload to export.run', async ({ label, payload }) => {
    const user = userEvent.setup()
    mockInvoke.mockResolvedValueOnce({ data: { exported: 0 } })
    render(<ExportDialog onClose={vi.fn()} />)
    await user.click(screen.getByRole('switch', { name: label }))
    await user.click(screen.getByRole('button', { name: 'Export 0 notes' }))
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        'terminator.notepad:export.run',
        expect.objectContaining(payload)
      )
    )
  })
}

function exportDialogCommentFormatTests() {
  it('sends the comment format picked in the Export comments control to export.run', async () => {
    const user = userEvent.setup()
    mockInvoke.mockResolvedValueOnce({ data: { exported: 0 } })
    render(<ExportDialog onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Both' }))
    await user.click(screen.getByRole('button', { name: 'Export 0 notes' }))
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        'terminator.notepad:export.run',
        expect.objectContaining({ commentFormat: 'both' })
      )
    )
  })
}

function exportDialogExportButtonTests() {
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

  it('cancel button calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ExportDialog onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onClose).toHaveBeenCalled()
  })
}

function exportDialogRunningTests() {
  it('counts a finished export as one use of the export feature', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { exported: 1 } })
    const user = userEvent.setup()
    render(<ExportDialog onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Export 0 notes' }))
    await waitFor(() => expect(mockRecord).toHaveBeenCalledWith('export'))
  })

  it('Export button calls export.run IPC', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { exported: 1 } })
    const user = userEvent.setup()
    render(<ExportDialog onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Export 0 notes' }))
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'terminator.notepad:export.run',
        expect.objectContaining({ folder: '~/Documents/Terminator Notes', scope: 'all' })
      )
    })
  })
}

function exportDialogSettingsTests() {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue({ data: { exported: 1, diagrams: 0 } })
    useNotesStore.setState({ notes: [dummyNote], diagrams: [] })
  })
  describe('chosen in Settings', exportDialogSettingsChosenTests)
  describe('unusable in Settings', exportDialogSettingsUnusableTests)
}

function exportDialogSettingsChosenTests() {
  it('starts on the comment format and folder chosen in Settings', async () => {
    mockSettings.mockResolvedValueOnce({
      values: {
        'terminator.notepad.commentExportFormat': 'inline',
        'terminator.notepad.exportPath': '/tmp/my-notes',
      },
    })
    render(<ExportDialog onClose={vi.fn()} />)

    await screen.findByDisplayValue('/tmp/my-notes')
    expect(screen.getByRole('button', { name: 'Inline HTML' }).className).toContain('--active')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export 1 note' }))
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        'terminator.notepad:export.run',
        expect.objectContaining({ folder: '/tmp/my-notes', commentFormat: 'inline' })
      )
    )
  })
}

function exportDialogSettingsUnusableTests() {
  it('keeps the Sidecar JSON default when Settings holds an unknown comment format', async () => {
    mockSettings.mockResolvedValueOnce({
      values: {
        'terminator.notepad.commentExportFormat': 'carrier pigeon',
        'terminator.notepad.exportPath': '/tmp/my-notes',
      },
    })
    render(<ExportDialog onClose={vi.fn()} />)

    // The folder shows once the settings are applied, so the format below was read too.
    await screen.findByDisplayValue('/tmp/my-notes')
    expect(screen.getByRole('button', { name: 'Sidecar JSON' }).className).toContain('--active')
  })

  it('keeps the default folder when Settings holds a blank export path', async () => {
    mockSettings.mockResolvedValueOnce({
      values: {
        'terminator.notepad.commentExportFormat': 'inline',
        'terminator.notepad.exportPath': '   ',
      },
    })
    render(<ExportDialog onClose={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Inline HTML' }).className).toContain('--active')
    )
    expect(screen.getByLabelText<HTMLInputElement>('Destination folder').value).toBe(
      '~/Documents/Terminator Notes'
    )
  })
}
