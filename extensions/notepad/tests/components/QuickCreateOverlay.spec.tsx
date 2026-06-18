import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/react'

const mockInvoke = vi.fn().mockResolvedValue({
  data: { id: 'n1', title: 'Test', createdAt: '2026-01-01T00:00:00Z' },
})

Object.defineProperty(window, 'electronAPI', {
  value: {
    extensionBridge: { invoke: mockInvoke },
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
