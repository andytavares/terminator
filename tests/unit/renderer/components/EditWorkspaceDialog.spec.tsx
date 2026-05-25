import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { EditWorkspaceDialog } from '../../../../src/renderer/components/sidebar/EditWorkspaceDialog'
import type { Workspace } from '../../../../src/shared/types/index'

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))

const mockUpdateWorkspace = vi.fn()
const mockOpenDirectory = vi.fn()

const ws: Workspace = {
  id: 'ws-1',
  name: 'My Work',
  folderPath: '/home/work',
  color: '#4A90E2',
  tags: ['tag1'],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdateWorkspace.mockReturnValue({ workspace: ws })
  mockOpenDirectory.mockResolvedValue({ filePath: '/new/path' })
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    dialog: { openDirectory: mockOpenDirectory },
  }
  vi.mocked(useWorkspaceStore).mockReturnValue({
    workspaces: [ws],
    updateWorkspace: mockUpdateWorkspace,
  } as unknown as ReturnType<typeof useWorkspaceStore>)
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('EditWorkspaceDialog', () => {
  it('renders with workspace name pre-filled', () => {
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('My Work')).toBeTruthy()
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<EditWorkspaceDialog workspace={ws} onClose={onClose} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows Name is required when name is cleared', () => {
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    const nameInput = screen.getByDisplayValue('My Work')
    fireEvent.change(nameInput, { target: { value: '' } })
    fireEvent.blur(nameInput)
    expect(screen.getByText('Name is required')).toBeTruthy()
  })

  it('calls updateWorkspace on valid submit', async () => {
    const onClose = vi.fn()
    render(<EditWorkspaceDialog workspace={ws} onClose={onClose} />)
    fireEvent.change(screen.getByDisplayValue('My Work'), { target: { value: 'New Name' } })
    fireEvent.click(screen.getByText('Save'))
    await vi.waitFor(() => expect(mockUpdateWorkspace).toHaveBeenCalled())
  })

  it('renders color swatches', () => {
    const { container } = render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    const swatches = container.querySelectorAll('.dialog__color-swatch')
    expect(swatches.length).toBeGreaterThan(0)
  })

  it('renders folder path field', () => {
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('/home/work')).toBeTruthy()
  })

  it('calls openDirectory when Browse is clicked and updates folder path', async () => {
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Browse'))
    await vi.waitFor(() => expect(screen.getByDisplayValue('/new/path')).toBeTruthy())
    expect(mockOpenDirectory).toHaveBeenCalled()
  })

  it('does not update folder path when Browse is cancelled', async () => {
    mockOpenDirectory.mockResolvedValue({ cancelled: true })
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Browse'))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByDisplayValue('/home/work')).toBeTruthy()
  })

  it('updates folder path input when typed', () => {
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    const folderInput = screen.getByDisplayValue('/home/work')
    fireEvent.change(folderInput, { target: { value: '/changed/path' } })
    expect(screen.getByDisplayValue('/changed/path')).toBeTruthy()
  })

  it('selects a color swatch on click', () => {
    const { container } = render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    const swatches = container.querySelectorAll('.dialog__color-swatch')
    fireEvent.click(swatches[1])
    expect(swatches[1].classList.contains('dialog__color-swatch--selected')).toBe(true)
  })

  it('updates tags input when typed', () => {
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    const tagsInput = screen.getByDisplayValue('tag1')
    fireEvent.change(tagsInput, { target: { value: 'tag1, tag2' } })
    expect(screen.getByDisplayValue('tag1, tag2')).toBeTruthy()
  })

  it('clears nameError when name input changes', () => {
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    const nameInput = screen.getByDisplayValue('My Work')
    fireEvent.change(nameInput, { target: { value: '' } })
    fireEvent.blur(nameInput)
    expect(screen.getByText('Name is required')).toBeTruthy()
    fireEvent.change(nameInput, { target: { value: 'Fixed' } })
    expect(screen.queryByText('Name is required')).toBeNull()
  })

  it('shows error when duplicate name on blur', () => {
    const otherWs = { ...ws, id: 'ws-2', name: 'Other' }
    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [ws, otherWs],
      updateWorkspace: mockUpdateWorkspace,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    const nameInput = screen.getByDisplayValue('My Work')
    fireEvent.change(nameInput, { target: { value: 'Other' } })
    fireEvent.blur(nameInput)
    expect(screen.getByText('A workspace with this name already exists')).toBeTruthy()
  })

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn()
    render(<EditWorkspaceDialog workspace={ws} onClose={onClose} />)
    fireEvent.click(screen.getByText('Edit Workspace').closest('.dialog-overlay')!)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes after successful save', async () => {
    const onClose = vi.fn()
    mockUpdateWorkspace.mockResolvedValue({ workspace: ws })
    render(<EditWorkspaceDialog workspace={ws} onClose={onClose} />)
    fireEvent.click(screen.getByText('Save'))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
