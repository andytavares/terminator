import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { ProjectItem } from '../../../../src/renderer/components/sidebar/ProjectItem'

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))

const mockSetActive = vi.fn()
const mockDeleteProject = vi.fn()

const baseProject = { id: 'proj-1', name: 'My Project', workspaceId: 'ws-1' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useWorkspaceStore).mockReturnValue({
    activeProjectId: null,
    setActiveProject: mockSetActive,
    deleteProject: mockDeleteProject,
  } as any)
})

describe('ProjectItem', () => {
  it('renders project name', () => {
    render(<ProjectItem project={baseProject as any} />)
    expect(screen.getByText('My Project')).toBeTruthy()
  })

  it('applies active class when project is active', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      activeProjectId: 'proj-1',
      setActiveProject: mockSetActive,
      deleteProject: mockDeleteProject,
    } as any)
    const { container } = render(<ProjectItem project={baseProject as any} />)
    expect(container.querySelector('.project-item--active')).toBeTruthy()
  })

  it('calls setActiveProject when clicked', () => {
    render(<ProjectItem project={baseProject as any} />)
    fireEvent.click(screen.getByText('My Project'))
    expect(mockSetActive).toHaveBeenCalledWith('proj-1')
  })

  it('shows context menu on right-click', () => {
    render(<ProjectItem project={baseProject as any} />)
    fireEvent.contextMenu(screen.getByText('My Project'))
    expect(screen.getByText('Remove')).toBeTruthy()
  })

  it('shows ConfirmDialog when Remove is clicked', () => {
    render(<ProjectItem project={baseProject as any} />)
    fireEvent.contextMenu(screen.getByText('My Project'))
    fireEvent.click(screen.getByText('Remove'))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('calls deleteProject when ConfirmDialog is confirmed', () => {
    render(<ProjectItem project={baseProject as any} />)
    fireEvent.contextMenu(screen.getByText('My Project'))
    fireEvent.click(screen.getByText('Remove'))
    fireEvent.click(screen.getByText('Remove', { selector: 'button.dialog__btn-primary' }))
    expect(mockDeleteProject).toHaveBeenCalledWith('proj-1')
  })

  it('does not delete when ConfirmDialog is cancelled', () => {
    render(<ProjectItem project={baseProject as any} />)
    fireEvent.contextMenu(screen.getByText('My Project'))
    fireEvent.click(screen.getByText('Remove'))
    fireEvent.click(screen.getByText('Cancel'))
    expect(mockDeleteProject).not.toHaveBeenCalled()
  })

  it('closes context menu when clicking elsewhere', () => {
    render(<ProjectItem project={baseProject as any} />)
    fireEvent.contextMenu(screen.getByText('My Project'))
    expect(screen.getByText('Remove')).toBeTruthy()
    fireEvent.click(document)
    expect(screen.queryByText('Remove')).toBeNull()
  })
})
