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
})
