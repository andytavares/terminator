import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'

const CREATED = { data: { id: 'n1', title: 'Test', createdAt: '2026-01-01T00:00:00Z' } }
const mockInvoke = vi.fn()
const mockRecord = vi.fn()

beforeEach(() => {
  mockInvoke.mockResolvedValue(CREATED)
  vi.stubGlobal('electronAPI', {
    extensionBridge: { invoke: mockInvoke },
    extension: { getSettingsValues: vi.fn().mockResolvedValue({ values: {} }) },
    usage: { record: mockRecord },
  })
})

import { QuickCreateOverlay } from '../../src/components/QuickCreateOverlay'
import { useNotesStore } from '../../src/stores/notes.store'

afterEach(() => {
  cleanup()
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

  it('Esc key closes the overlay via store', async () => {
    const user = userEvent.setup()
    useNotesStore.setState({ showQuickCreate: true })
    render(<QuickCreateOverlay />)
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Title'))
    await user.keyboard('{Escape}')
    expect(useNotesStore.getState().showQuickCreate).toBe(false)
  })

  it('Cancel button closes the overlay via store', async () => {
    const user = userEvent.setup()
    useNotesStore.setState({ showQuickCreate: true })
    render(<QuickCreateOverlay />)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(useNotesStore.getState().showQuickCreate).toBe(false)
  })
})

describe('QuickCreateOverlay focus', () => {
  afterEach(() => vi.useRealTimers())

  it('puts focus in the title as it opens', () => {
    useNotesStore.setState({ showQuickCreate: true })
    render(<QuickCreateOverlay />)
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Title'))
  })

  // A late focus() would take the keyboard back from whatever the user went to since,
  // such as the app's Quick actions opened over the overlay.
  it('never takes focus back after something else has it', () => {
    vi.useFakeTimers()
    useNotesStore.setState({ showQuickCreate: true })
    render(<QuickCreateOverlay />)
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)
    elsewhere.focus()
    vi.advanceTimersByTime(1000)
    expect(document.activeElement).toBe(elsewhere)
    elsewhere.remove()
  })
})

describe('QuickCreateOverlay kind', () => {
  it('offers what to create as one choice, Note first', () => {
    useNotesStore.setState({ showQuickCreate: true })
    render(<QuickCreateOverlay />)
    expect(screen.getByRole('radiogroup', { name: 'Create' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Note' }).getAttribute('aria-checked')).toBe('true')
  })

  it('moves to the next kind with the arrow keys, and drops the note body for it', async () => {
    const user = userEvent.setup()
    useNotesStore.setState({ showQuickCreate: true })
    const { container } = render(<QuickCreateOverlay />)
    const note = screen.getByRole('radio', { name: 'Note' })
    await user.click(note)
    expect(document.activeElement).toBe(note)
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Diagram' }).getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('.notepad-quick-create__body')).toBeNull()
  })
})

async function openWithKind(user: UserEvent, kind: 'Note' | 'Diagram' | 'Folder') {
  useNotesStore.setState({ showQuickCreate: true })
  render(<QuickCreateOverlay />)
  await user.click(screen.getByRole('radio', { name: kind }))
}

function invokedWith(channel: string) {
  return mockInvoke.mock.calls.filter(([ch]) => ch === channel).map(([, payload]) => payload)
}

describe('QuickCreateOverlay saving a note', () => {
  it('creates the note with the typed title and a tag still in the input, then closes', async () => {
    const user = userEvent.setup()
    await openWithKind(user, 'Note')
    await user.type(screen.getByPlaceholderText(/title/i), 'Plan')
    await user.type(screen.getByPlaceholderText('# add tag…'), 'Big Idea')
    await user.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(useNotesStore.getState().showQuickCreate).toBe(false))
    expect(invokedWith('terminator.notepad:notes.create')).toEqual([
      { title: 'Plan', body: '', tags: ['big-idea'] },
    ])
    expect(invokedWith('terminator.notepad:notes.list')).toEqual([{ includeArchived: true }])
    expect(mockRecord).toHaveBeenCalledWith('note-create')
  })

  it('stays open and can save again when creating fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockInvoke.mockRejectedValueOnce(new Error('disk full'))
    const user = userEvent.setup()
    await openWithKind(user, 'Note')
    await user.type(screen.getByPlaceholderText(/title/i), 'Plan{Enter}')
    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(useNotesStore.getState().showQuickCreate).toBe(true)
    const save = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    error.mockRestore()
  })
})

describe('QuickCreateOverlay usage', () => {
  it('does not count Enter in an empty tag input', async () => {
    const user = userEvent.setup()
    await openWithKind(user, 'Note')
    await user.type(screen.getByPlaceholderText('# add tag…'), '{Enter}')
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('counts a tag added with Enter', async () => {
    const user = userEvent.setup()
    await openWithKind(user, 'Note')
    await user.type(screen.getByPlaceholderText('# add tag…'), 'idea{Enter}')
    expect(mockRecord).toHaveBeenCalledWith('tag')
  })
})

describe('QuickCreateOverlay saving a diagram', () => {
  it('creates an untitled diagram, refreshes the list and selects it', async () => {
    const user = userEvent.setup()
    mockInvoke.mockImplementation(async (channel: string) =>
      channel === 'terminator.notepad:diagrams.list' ? { data: [] } : { data: { id: 'd1' } }
    )
    await openWithKind(user, 'Diagram')
    await user.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(useNotesStore.getState().showQuickCreate).toBe(false))
    expect(invokedWith('terminator.notepad:diagrams.create')).toEqual([
      { title: 'Untitled diagram', tags: [] },
    ])
    expect(useNotesStore.getState().selectedDiagramId).toBe('d1')
    expect(mockRecord).toHaveBeenCalledWith('diagram-create')
  })
})

describe('QuickCreateOverlay saving a folder', () => {
  it('creates a named folder with its name trimmed, then closes', async () => {
    const user = userEvent.setup()
    mockInvoke.mockResolvedValue({ data: [] })
    await openWithKind(user, 'Folder')
    await user.type(screen.getByPlaceholderText(/title/i), '  Work  ')
    await user.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(useNotesStore.getState().showQuickCreate).toBe(false))
    expect(invokedWith('terminator.notepad:folders.create')).toEqual([{ name: 'Work' }])
    expect(invokedWith('terminator.notepad:folders.list')).toEqual([{}])
  })

  it('creates nothing and stays open for a folder without a name', async () => {
    const user = userEvent.setup()
    await openWithKind(user, 'Folder')
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(invokedWith('terminator.notepad:folders.create')).toEqual([])
    expect(useNotesStore.getState().showQuickCreate).toBe(true)
  })
})
