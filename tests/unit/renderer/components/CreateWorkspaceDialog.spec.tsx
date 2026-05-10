import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { CreateWorkspaceDialog } from '../../../../src/renderer/components/sidebar/CreateWorkspaceDialog'

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))

const mockCreateWorkspace = vi.fn()
const mockCreateProject = vi.fn()
const mockOpenDirectory = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateWorkspace.mockResolvedValue({ workspace: { id: 'ws-new', name: 'New' } })
  mockCreateProject.mockResolvedValue({ project: { id: 'proj-new' } })
  mockOpenDirectory.mockResolvedValue({ filePath: '/selected/path' })
  ;(globalThis as any).electronAPI = {
    dialog: { openDirectory: mockOpenDirectory },
    git: { isRepo: vi.fn().mockResolvedValue({ isRepo: false }) },
  }
  vi.mocked(useWorkspaceStore).mockReturnValue({
    workspaces: [],
    createWorkspace: mockCreateWorkspace,
    createProject: mockCreateProject,
  } as any)
})

afterEach(() => {
  delete (globalThis as any).electronAPI
})

describe('CreateWorkspaceDialog', () => {
  it('renders dialog with title and form fields', () => {
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    expect(screen.getByText('Create Workspace')).toBeTruthy()
    expect(screen.getByPlaceholderText('My Workspace')).toBeTruthy()
    expect(screen.getByText('Create')).toBeTruthy()
    expect(screen.getByText('Cancel')).toBeTruthy()
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<CreateWorkspaceDialog onClose={onClose} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows validation error when name is empty on blur', () => {
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    const nameInput = screen.getByPlaceholderText('My Workspace')
    fireEvent.blur(nameInput)
    expect(screen.getByText('Name is required')).toBeTruthy()
  })

  it('shows duplicate name error', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [{ id: 'ws-1', name: 'Existing' }],
      createWorkspace: mockCreateWorkspace,
      createProject: mockCreateProject,
    } as any)
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    const nameInput = screen.getByPlaceholderText('My Workspace')
    fireEvent.change(nameInput, { target: { value: 'existing' } })
    fireEvent.blur(nameInput)
    expect(screen.getByText('A workspace with this name already exists')).toBeTruthy()
  })

  it('calls createWorkspace on submit with valid name', async () => {
    const onClose = vi.fn()
    render(<CreateWorkspaceDialog onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('My Workspace'), { target: { value: 'My WS' } })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() => expect(mockCreateWorkspace).toHaveBeenCalled())
  })

  it('renders color swatches', () => {
    const { container } = render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    const swatches = container.querySelectorAll('.dialog__color-swatch')
    expect(swatches.length).toBeGreaterThan(0)
  })

  it('renders folder path input', () => {
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    expect(screen.getByPlaceholderText('/path/to/folder')).toBeTruthy()
  })

  it('does not submit with empty name', async () => {
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Create'))
    await new Promise((r) => setTimeout(r, 10))
    expect(mockCreateWorkspace).not.toHaveBeenCalled()
  })
})
