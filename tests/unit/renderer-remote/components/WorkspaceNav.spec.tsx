import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const { mockListWorkspaces, mockListProjects } = vi.hoisted(() => ({
  mockListWorkspaces: vi.fn(),
  mockListProjects: vi.fn(),
}))

vi.mock('../../../../src/renderer-remote/api/remote-client', () => ({
  listWorkspaces: mockListWorkspaces,
  listProjects: mockListProjects,
}))

import { WorkspaceNav } from '../../../../src/renderer-remote/components/WorkspaceNav'

const workspaces = [
  { id: 'w1', name: 'Work One', folderPath: '/work/one', color: 'blue', tags: [] },
  { id: 'w2', name: 'Work Two', folderPath: '/work/two', color: 'green', tags: [] },
]
const projects = [
  { id: 'p1', workspaceId: 'w1', name: 'Project A', worktreePath: '/work/one/a' },
  { id: 'p2', workspaceId: 'w1', name: 'Project B' },
]

beforeEach(() => {
  mockListWorkspaces.mockReset()
  mockListProjects.mockReset()
})

describe('WorkspaceNav', () => {
  it('renders Workspaces label', async () => {
    mockListWorkspaces.mockResolvedValueOnce([])
    render(<WorkspaceNav onOpenTerminal={() => {}} />)
    expect(screen.getByText('Workspaces')).toBeTruthy()
  })

  it('lists workspace names after mount', async () => {
    mockListWorkspaces.mockResolvedValueOnce(workspaces)
    render(<WorkspaceNav onOpenTerminal={() => {}} />)
    await waitFor(() => expect(screen.getByText('Work One')).toBeTruthy())
    expect(screen.getByText('Work Two')).toBeTruthy()
  })

  it('loads projects when a workspace is clicked', async () => {
    mockListWorkspaces.mockResolvedValueOnce(workspaces)
    mockListProjects.mockResolvedValueOnce(projects)
    render(<WorkspaceNav onOpenTerminal={() => {}} />)
    await waitFor(() => screen.getByText('Work One'))
    fireEvent.click(screen.getByText('Work One'))
    await waitFor(() => expect(screen.getByText('Project A')).toBeTruthy())
    expect(screen.getByText('Project B')).toBeTruthy()
    expect(mockListProjects).toHaveBeenCalledWith('w1')
  })

  it('clicking project calls onOpenTerminal with worktreePath', async () => {
    mockListWorkspaces.mockResolvedValueOnce(workspaces)
    mockListProjects.mockResolvedValueOnce(projects)
    const onOpen = vi.fn()
    render(<WorkspaceNav onOpenTerminal={onOpen} />)
    await waitFor(() => screen.getByText('Work One'))
    fireEvent.click(screen.getByText('Work One'))
    await waitFor(() => screen.getByText('Project A'))
    fireEvent.click(screen.getByText('Project A'))
    expect(onOpen).toHaveBeenCalledWith('/work/one/a')
  })

  it('clicking project without worktreePath uses workspace folderPath', async () => {
    mockListWorkspaces.mockResolvedValueOnce(workspaces)
    mockListProjects.mockResolvedValueOnce(projects)
    const onOpen = vi.fn()
    render(<WorkspaceNav onOpenTerminal={onOpen} />)
    await waitFor(() => screen.getByText('Work One'))
    fireEvent.click(screen.getByText('Work One'))
    await waitFor(() => screen.getByText('Project B'))
    fireEvent.click(screen.getByText('Project B'))
    expect(onOpen).toHaveBeenCalledWith('/work/one')
  })

  it('+ New Terminal calls onOpenTerminal with workspace folderPath', async () => {
    mockListWorkspaces.mockResolvedValueOnce(workspaces)
    mockListProjects.mockResolvedValueOnce([])
    const onOpen = vi.fn()
    render(<WorkspaceNav onOpenTerminal={onOpen} />)
    await waitFor(() => screen.getByText('Work One'))
    fireEvent.click(screen.getByText('Work One'))
    await waitFor(() => screen.getByText('+ New Terminal'))
    fireEvent.click(screen.getByText('+ New Terminal'))
    expect(onOpen).toHaveBeenCalledWith('/work/one')
  })

  it('swallows listWorkspaces errors silently', async () => {
    mockListWorkspaces.mockRejectedValueOnce(new Error('Network error'))
    render(<WorkspaceNav onOpenTerminal={() => {}} />)
    await waitFor(() => expect(screen.getByText('Workspaces')).toBeTruthy())
  })
})
