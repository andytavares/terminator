import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'electronAPI', {
  value: { extensionBridge: { invoke: mockInvoke } },
  writable: true,
  configurable: true,
})

// ExportDialog does not exist yet — tests will fail at import
import { ExportDialog } from '../../src/components/ExportDialog'

describe('ExportDialog', () => {
  beforeEach(() => {
    mockInvoke.mockClear()
  })

  it('renders a folder picker button', () => {
    render(<ExportDialog onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /choose folder|pick folder|browse/i })).toBeTruthy()
  })

  it('Export button is disabled when no folder is selected', () => {
    render(<ExportDialog onClose={vi.fn()} />)
    const exportBtn = screen.getByRole('button', { name: /^export$/i })
    expect((exportBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('folder picker button calls export.pickFolder IPC', async () => {
    mockInvoke.mockResolvedValueOnce({ data: '/Users/test/notes' })
    render(<ExportDialog onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /choose folder|pick folder|browse/i }))
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('terminator.notepad:export.pickFolder', {})
    })
  })

  it('shows folder path after picking', async () => {
    mockInvoke.mockResolvedValueOnce({ data: '/Users/test/notes' })
    render(<ExportDialog onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /choose folder|pick folder|browse/i }))
    await waitFor(() => {
      expect(screen.getByText(/\/Users\/test\/notes/)).toBeTruthy()
    })
  })

  it('renders scope radio options (All Notes, Current Note, By Tag)', () => {
    render(<ExportDialog onClose={vi.fn()} />)
    expect(screen.getByText(/all notes/i)).toBeTruthy()
    expect(screen.getByText(/current note/i)).toBeTruthy()
    expect(screen.getByText(/by tag/i)).toBeTruthy()
  })

  it('Export button enabled after folder is selected', async () => {
    mockInvoke.mockResolvedValueOnce({ data: '/Users/test/notes' })
    render(<ExportDialog onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /choose folder|pick folder|browse/i }))
    await waitFor(() => {
      const exportBtn = screen.getByRole('button', { name: /^export$/i })
      expect((exportBtn as HTMLButtonElement).disabled).toBe(false)
    })
  })

  it('cancel button calls onClose', () => {
    const onClose = vi.fn()
    render(<ExportDialog onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
