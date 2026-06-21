import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { ProjectRow } from '../../../../src/renderer/components/sidebar/ProjectRow'
import type { Project } from '../../../../src/shared/types/index'

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'proj-1',
  workspaceId: 'ws-1',
  name: 'API Server',
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
  ...overrides,
})

const mockSessionStore = {
  getSessionsForProject: vi.fn().mockReturnValue([]),
  getBellCountForProject: vi.fn().mockReturnValue(0),
  isProjectBusy: vi.fn().mockReturnValue(false),
  isSessionBusy: vi.fn().mockReturnValue(false),
  activeSessionIdByProject: new Map<string, string>(),
  setActiveSessionForProject: vi.fn(),
}

const mockWorkspaceStore = {
  deleteProject: vi.fn().mockResolvedValue(undefined),
  renameProject: vi.fn().mockResolvedValue(undefined),
  workspaces: [],
  updateProjectBranch: vi.fn().mockResolvedValue(undefined),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useSessionStore).mockReturnValue(
    mockSessionStore as unknown as ReturnType<typeof useSessionStore>
  )
  vi.mocked(useWorkspaceStore).mockReturnValue(
    mockWorkspaceStore as unknown as ReturnType<typeof useWorkspaceStore>
  )
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ProjectRow', () => {
  const defaultProps = {
    project: makeProject(),
    workspaceId: 'ws-1',
    isActive: false,
    isExpanded: false,
    workspaceColor: '#5c6bc0',
    onSelect: vi.fn(),
    onAddSession: vi.fn(),
  }

  it('renders the project name', () => {
    render(<ProjectRow {...defaultProps} />)
    expect(screen.getByText('API Server')).toBeTruthy()
  })

  it('applies project-row--active class when isActive is true', () => {
    const { container } = render(<ProjectRow {...defaultProps} isActive />)
    expect(container.querySelector('.project-row--active')).toBeTruthy()
  })

  it('does not apply project-row--active when isActive is false', () => {
    const { container } = render(<ProjectRow {...defaultProps} isActive={false} />)
    expect(container.querySelector('.project-row--active')).toBeNull()
  })

  it('calls onSelect when the row is clicked', () => {
    const onSelect = vi.fn()
    render(<ProjectRow {...defaultProps} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('API Server'))
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('renders sessions when isExpanded is true', () => {
    const sessions = [
      {
        id: 's1',
        projectId: 'proj-1',
        tabTitle: 'Terminal 1',
        status: 'active' as const,
        type: 'human' as const,
        scrollbackLimit: 1000,
        createdAt: '',
      },
    ]
    mockSessionStore.getSessionsForProject.mockReturnValue(sessions)
    render(<ProjectRow {...defaultProps} isExpanded />)
    expect(screen.getByText('Terminal 1')).toBeTruthy()
  })

  it('does not render sessions when isExpanded is false', () => {
    const sessions = [
      {
        id: 's1',
        projectId: 'proj-1',
        tabTitle: 'Terminal 1',
        status: 'active' as const,
        type: 'human' as const,
        scrollbackLimit: 1000,
        createdAt: '',
      },
    ]
    mockSessionStore.getSessionsForProject.mockReturnValue(sessions)
    render(<ProjectRow {...defaultProps} isExpanded={false} />)
    expect(screen.queryByText('Terminal 1')).toBeNull()
  })

  it('calls onAddSession when add session button is clicked', () => {
    const onAddSession = vi.fn()
    render(<ProjectRow {...defaultProps} isExpanded onAddSession={onAddSession} />)
    fireEvent.click(screen.getByTitle(/new terminal/i))
    expect(onAddSession).toHaveBeenCalledOnce()
  })

  it('shows right-click context menu on contextmenu event', () => {
    const { container } = render(<ProjectRow {...defaultProps} />)
    const row = container.querySelector('.project-row')!
    fireEvent.contextMenu(row)
    expect(document.querySelector('.ctx-menu')).toBeTruthy()
  })

  it('context menu has Rename and Remove project options', () => {
    const { container } = render(<ProjectRow {...defaultProps} />)
    fireEvent.contextMenu(container.querySelector('.project-row')!)
    expect(document.querySelector('.ctx-menu')?.textContent).toContain('Rename')
    expect(document.querySelector('.ctx-menu')?.textContent).toContain('Remove project')
  })

  it('double-click on project name activates rename input', () => {
    vi.useFakeTimers()
    render(<ProjectRow {...defaultProps} />)
    const nameEl = screen.getByText('API Server')
    fireEvent.dblClick(nameEl)
    vi.runAllTimers()
    expect(screen.getByDisplayValue('API Server')).toBeTruthy()
  })

  it('renders busy indicator when isBusy is true', () => {
    mockSessionStore.isProjectBusy.mockReturnValue(true)
    const { container } = render(<ProjectRow {...defaultProps} />)
    expect(container.querySelector('.project-row__busy')).toBeTruthy()
  })

  it('rename input blur commits rename when value changed', async () => {
    const renameProject = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useWorkspaceStore).mockReturnValue({
      ...mockWorkspaceStore,
      renameProject,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<ProjectRow {...defaultProps} />)
    fireEvent.dblClick(screen.getByText('API Server'))
    const input = screen.getByDisplayValue('API Server')
    fireEvent.change(input, { target: { value: 'New Name' } })
    await act(async () => {
      fireEvent.blur(input)
    })
    expect(renameProject).toHaveBeenCalledWith('proj-1', 'New Name')
  })

  it('rename input Enter commits rename', async () => {
    const renameProject = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useWorkspaceStore).mockReturnValue({
      ...mockWorkspaceStore,
      renameProject,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<ProjectRow {...defaultProps} />)
    fireEvent.dblClick(screen.getByText('API Server'))
    const input = screen.getByDisplayValue('API Server')
    fireEvent.change(input, { target: { value: 'Changed' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(renameProject).toHaveBeenCalledWith('proj-1', 'Changed')
  })

  it('rename input Escape cancels rename without committing', async () => {
    const renameProject = vi.fn()
    vi.mocked(useWorkspaceStore).mockReturnValue({
      ...mockWorkspaceStore,
      renameProject,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<ProjectRow {...defaultProps} />)
    fireEvent.dblClick(screen.getByText('API Server'))
    const input = screen.getByDisplayValue('API Server')
    fireEvent.change(input, { target: { value: 'Aborted' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(renameProject).not.toHaveBeenCalled()
    expect(screen.getByText('API Server')).toBeTruthy()
  })

  it('clicking Rename in context menu starts rename', () => {
    const { container } = render(<ProjectRow {...defaultProps} />)
    fireEvent.contextMenu(container.querySelector('.project-row')!)
    const renameBtn = document.querySelector('.ctx-menu__item') as HTMLElement
    fireEvent.click(renameBtn)
    expect(screen.getByDisplayValue('API Server')).toBeTruthy()
  })

  it('clicking Remove project in context menu shows confirm dialog', () => {
    const { container } = render(<ProjectRow {...defaultProps} />)
    fireEvent.contextMenu(container.querySelector('.project-row')!)
    const items = document.querySelectorAll('.ctx-menu__item')
    const removeBtn = Array.from(items).find((el) =>
      el.textContent?.includes('Remove')
    ) as HTMLElement
    fireEvent.click(removeBtn)
    expect(screen.getByText(/Remove project/i)).toBeTruthy()
  })

  it('rename blur is no-op when name unchanged', async () => {
    const renameProject = vi.fn()
    vi.mocked(useWorkspaceStore).mockReturnValue({
      ...mockWorkspaceStore,
      renameProject,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<ProjectRow {...defaultProps} />)
    fireEvent.dblClick(screen.getByText('API Server'))
    const input = screen.getByDisplayValue('API Server')
    await act(async () => {
      fireEvent.blur(input)
    })
    expect(renameProject).not.toHaveBeenCalled()
    expect(screen.getByText('API Server')).toBeTruthy()
  })

  it('clicking session row when expanded calls setActiveSessionForProject', () => {
    const sessions = [
      {
        id: 's1',
        projectId: 'proj-1',
        tabTitle: 'Terminal 1',
        status: 'active' as const,
        type: 'human' as const,
        scrollbackLimit: 1000,
        createdAt: '',
      },
    ]
    const setActiveSessionForProject = vi.fn()
    mockSessionStore.getSessionsForProject.mockReturnValue(sessions)
    vi.mocked(useSessionStore).mockReturnValue({
      ...mockSessionStore,
      setActiveSessionForProject,
    } as unknown as ReturnType<typeof useSessionStore>)
    // Also mock getState used in the onSelect handler
    Object.assign(useSessionStore, {
      getState: vi.fn().mockReturnValue({ setActiveSessionForProject }),
    })
    render(<ProjectRow {...defaultProps} isExpanded />)
    fireEvent.click(screen.getByText('Terminal 1'))
    expect(setActiveSessionForProject).toHaveBeenCalledWith('proj-1', 's1')
  })

  it('closing ConfirmDialog sets confirmOpen to false', () => {
    const { container } = render(<ProjectRow {...defaultProps} />)
    fireEvent.contextMenu(container.querySelector('.project-row')!)
    const items = document.querySelectorAll('.ctx-menu__item')
    const removeBtn = Array.from(items).find((el) =>
      el.textContent?.includes('Remove')
    ) as HTMLElement
    fireEvent.click(removeBtn)
    const cancelBtn = screen.getByText('Cancel')
    fireEvent.click(cancelBtn)
    expect(screen.queryByText('Cancel')).toBeNull()
  })

  it('confirming in ConfirmDialog calls deleteProject', async () => {
    const deleteProject = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useWorkspaceStore).mockReturnValue({
      ...mockWorkspaceStore,
      deleteProject,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    const { container } = render(<ProjectRow {...defaultProps} />)
    fireEvent.contextMenu(container.querySelector('.project-row')!)
    const items = document.querySelectorAll('.ctx-menu__item')
    const removeBtn = Array.from(items).find((el) =>
      el.textContent?.includes('Remove')
    ) as HTMLElement
    fireEvent.click(removeBtn)
    const confirmBtn = screen.getByText('Remove')
    await act(async () => {
      fireEvent.click(confirmBtn)
    })
    expect(deleteProject).toHaveBeenCalledWith('proj-1')
  })

  it('context menu close function is called on window click', () => {
    const { container } = render(<ProjectRow {...defaultProps} />)
    fireEvent.contextMenu(container.querySelector('.project-row')!)
    expect(document.querySelector('.ctx-menu')).toBeTruthy()
    fireEvent.click(window)
    expect(document.querySelector('.ctx-menu')).toBeNull()
  })

  it('context menu cleanup runs on unmount', () => {
    const { container, unmount } = render(<ProjectRow {...defaultProps} />)
    fireEvent.contextMenu(container.querySelector('.project-row')!)
    unmount()
    // no error expected; cleanup listener removal covered
  })

  describe('session drag-and-drop', () => {
    const twoSessions = [
      {
        id: 's1',
        projectId: 'proj-1',
        tabTitle: 'Term 1',
        status: 'active' as const,
        type: 'human' as const,
        scrollbackLimit: 1000,
        createdAt: '',
      },
      {
        id: 's2',
        projectId: 'proj-1',
        tabTitle: 'Term 2',
        status: 'active' as const,
        type: 'human' as const,
        scrollbackLimit: 1000,
        createdAt: '',
      },
    ]
    const reorderSessions = vi.fn()

    beforeEach(() => {
      mockSessionStore.getSessionsForProject.mockReturnValue(twoSessions)
      Object.assign(useSessionStore, {
        getState: vi.fn().mockReturnValue({ reorderSessions, setActiveSessionForProject: vi.fn() }),
      })
    })

    function getSessionWrappers(container: HTMLElement): Element[] {
      // Session wrappers are draggable divs that are NOT the project-row div
      return Array.from(container.querySelectorAll('div[draggable]')).filter(
        (el) => !el.classList.contains('project-row')
      )
    }

    it('session drag start begins drag tracking', () => {
      const { container } = render(<ProjectRow {...defaultProps} isExpanded />)
      const wrappers = getSessionWrappers(container)
      expect(wrappers.length).toBe(2)
      fireEvent.dragStart(wrappers[0])
    })

    it('session drag over highlights target slot', () => {
      const { container } = render(<ProjectRow {...defaultProps} isExpanded />)
      const wrappers = getSessionWrappers(container)
      fireEvent.dragStart(wrappers[0])
      fireEvent.dragOver(wrappers[1])
      expect(container.querySelector('.session-dnd-over')).toBeTruthy()
    })

    it('session drag leave clears highlight', () => {
      const { container } = render(<ProjectRow {...defaultProps} isExpanded />)
      const wrappers = getSessionWrappers(container)
      fireEvent.dragStart(wrappers[0])
      fireEvent.dragOver(wrappers[1])
      fireEvent.dragLeave(wrappers[1])
      expect(container.querySelector('.session-dnd-over')).toBeNull()
    })

    it('session drop calls reorderSessions with new order', () => {
      const { container } = render(<ProjectRow {...defaultProps} isExpanded />)
      const wrappers = getSessionWrappers(container)
      fireEvent.dragStart(wrappers[0])
      fireEvent.dragOver(wrappers[1])
      fireEvent.drop(wrappers[1])
      expect(reorderSessions).toHaveBeenCalledWith('proj-1', ['s2', 's1'])
    })

    it('session drag end clears drag state', () => {
      const { container } = render(<ProjectRow {...defaultProps} isExpanded />)
      const wrappers = getSessionWrappers(container)
      fireEvent.dragStart(wrappers[0])
      fireEvent.dragOver(wrappers[1])
      fireEvent.dragEnd(wrappers[0])
      expect(container.querySelector('.session-dnd-over')).toBeNull()
    })
  })

  describe('branch chip (T039)', () => {
    it('renders branch chip when project has gitBranch', () => {
      render(<ProjectRow {...defaultProps} project={makeProject({ gitBranch: 'main' })} />)
      expect(screen.getByText('main')).toBeTruthy()
    })

    it('does not render branch chip when project has no gitBranch', () => {
      const { container } = render(<ProjectRow {...defaultProps} />)
      expect(container.querySelector('.project-row__branch-chip')).toBeNull()
    })

    it('chip has chip-clean class when gitDirty is false and no conflict', () => {
      const { container } = render(
        <ProjectRow
          {...defaultProps}
          project={makeProject({ gitBranch: 'main' })}
          gitDirty={false}
          gitConflict={false}
        />
      )
      expect(container.querySelector('.chip-clean')).toBeTruthy()
    })

    it('chip has chip-dirty class when gitDirty is true', () => {
      const { container } = render(
        <ProjectRow {...defaultProps} project={makeProject({ gitBranch: 'feat' })} gitDirty />
      )
      expect(container.querySelector('.chip-dirty')).toBeTruthy()
    })

    it('chip has chip-conflict class when gitConflict is true', () => {
      const { container } = render(
        <ProjectRow {...defaultProps} project={makeProject({ gitBranch: 'feat' })} gitConflict />
      )
      expect(container.querySelector('.chip-conflict')).toBeTruthy()
    })

    it('clicking chip calls onBranchBadgeClick', () => {
      const onBranchBadgeClick = vi.fn()
      const { container } = render(
        <ProjectRow
          {...defaultProps}
          project={makeProject({ gitBranch: 'main' })}
          onBranchBadgeClick={onBranchBadgeClick}
        />
      )
      fireEvent.click(container.querySelector('.project-row__branch-chip')!)
      expect(onBranchBadgeClick).toHaveBeenCalledOnce()
    })
  })
})
