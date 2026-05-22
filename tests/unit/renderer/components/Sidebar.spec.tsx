import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { Sidebar } from '../../../../src/renderer/components/sidebar/Sidebar'

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))

vi.mock('../../../../src/renderer/components/sidebar/WorkspaceItem', () => ({
  WorkspaceItem: ({ workspace }: { workspace: { name: string } }) => (
    <div data-testid="workspace-item">{workspace.name}</div>
  ),
}))

vi.mock('../../../../src/renderer/components/sidebar/CreateWorkspaceDialog', () => ({
  CreateWorkspaceDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="create-ws-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))

const mockGetSidebarItems = vi.fn()

beforeEach(() => {
  mockGetSidebarItems.mockResolvedValue({ items: [] })
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    extension: { getSidebarItems: mockGetSidebarItems },
  }
  vi.mocked(useWorkspaceStore).mockReturnValue({ workspaces: [] } as unknown as ReturnType<
    typeof useWorkspaceStore
  >)
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('Sidebar', () => {
  it('renders workspaces section', () => {
    render(<Sidebar />)
    expect(screen.getByText('Workspaces')).toBeTruthy()
  })

  it('renders workspace items', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [
        { id: 'ws-1', name: 'Work' },
        { id: 'ws-2', name: 'Personal' },
      ],
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<Sidebar />)
    expect(screen.getByText('Work')).toBeTruthy()
    expect(screen.getByText('Personal')).toBeTruthy()
  })

  it('renders extension sidebar items when loaded', async () => {
    mockGetSidebarItems.mockResolvedValue({
      items: [{ id: 'ext-1', label: 'Git Panel', tooltip: 'Show git' }],
    })
    render(<Sidebar />)
    await waitFor(() => expect(screen.queryByText('Git Panel')).toBeTruthy())
  })

  it('toggles collapsed state when toggle button is clicked', () => {
    render(<Sidebar />)
    const toggle = screen.getByTitle('Collapse sidebar')
    fireEvent.click(toggle)
    expect(screen.getByTitle('Expand sidebar')).toBeTruthy()
  })

  it('hides Create Workspace button when collapsed', () => {
    render(<Sidebar />)
    expect(screen.getByText('+ Create Workspace')).toBeTruthy()
    fireEvent.click(screen.getByTitle('Collapse sidebar'))
    expect(screen.queryByText('+ Create Workspace')).toBeNull()
  })

  it('opens CreateWorkspaceDialog when Create button is clicked', () => {
    render(<Sidebar />)
    fireEvent.click(screen.getByText('+ Create Workspace'))
    expect(screen.getByTestId('create-ws-dialog')).toBeTruthy()
  })

  it('closes CreateWorkspaceDialog when onClose is called', () => {
    render(<Sidebar />)
    fireEvent.click(screen.getByText('+ Create Workspace'))
    expect(screen.getByTestId('create-ws-dialog')).toBeTruthy()
    fireEvent.click(screen.getByText('Close'))
    expect(screen.queryByTestId('create-ws-dialog')).toBeNull()
  })

  it('hides extension items when sidebar is collapsed', async () => {
    mockGetSidebarItems.mockResolvedValue({
      items: [{ id: 'ext-1', label: 'Git Panel', tooltip: 'Show git' }],
    })
    render(<Sidebar />)
    await waitFor(() => screen.getByText('Git Panel'))
    fireEvent.click(screen.getByTitle('Collapse sidebar'))
    expect(screen.queryByText('Git Panel')).toBeNull()
  })
})
