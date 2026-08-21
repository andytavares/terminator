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
  getBellCountForSession: vi.fn().mockReturnValue(0),
  renameSession: vi.fn(),
  closeSession: vi.fn(),
  isProjectBusy: vi.fn().mockReturnValue(false),
  isSessionBusy: vi.fn().mockReturnValue(false),
  projectViews: new Map(),
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

  describe('branch coverage — grouping, dimming, expand toggle, worktree icon', () => {
    const mkSession = (id: string, tabTitle: string, parentSessionId?: string) => ({
      id,
      projectId: 'proj-1',
      tabTitle,
      status: 'active',
      type: 'human',
      scrollbackLimit: 1000,
      createdAt: '',
      parentSessionId,
    })

    it('groups split children under their parent session when expanded', () => {
      mockSessionStore.getSessionsForProject.mockReturnValue([
        mkSession('root-1', 'Root'),
        mkSession('child-1', 'Child', 'root-1'),
      ])
      render(<ProjectRow {...defaultProps} isExpanded />)
      expect(screen.getByText('Root')).toBeTruthy()
      // the child renders inside the root session's group
      expect(screen.getByText('Child')).toBeTruthy()
    })

    it('dims the row when the search query matches neither project nor any session title', () => {
      mockSessionStore.getSessionsForProject.mockReturnValue([mkSession('s1', 'Terminal 1')])
      const { container } = render(<ProjectRow {...defaultProps} searchQuery="zzz-no-match" />)
      expect(container.querySelector('.project-row--dimmed')).toBeTruthy()
    })

    it('does not dim when a session title matches the query even if the project name does not', () => {
      mockSessionStore.getSessionsForProject.mockReturnValue([mkSession('s1', 'deploy-watch')])
      const { container } = render(<ProjectRow {...defaultProps} searchQuery="deploy" />)
      expect(container.querySelector('.project-row--dimmed')).toBeNull()
    })

    it('shows the expand toggle with the right chevron state and stops click propagation', () => {
      mockSessionStore.getSessionsForProject.mockReturnValue([mkSession('s1', 'Terminal 1')])
      const onToggleExpand = vi.fn()
      const onSelect = vi.fn()
      const { container, rerender } = render(
        <ProjectRow
          {...defaultProps}
          isExpanded={false}
          onToggleExpand={onToggleExpand}
          onSelect={onSelect}
        />
      )
      const toggle = container.querySelector('.project-row__expand-toggle')!
      fireEvent.click(toggle)
      expect(onToggleExpand).toHaveBeenCalledOnce()
      expect(onSelect).not.toHaveBeenCalled()
      rerender(
        <ProjectRow
          {...defaultProps}
          isExpanded
          onToggleExpand={onToggleExpand}
          onSelect={onSelect}
        />
      )
      expect(container.querySelector('.project-row__expand-toggle')).toBeTruthy()
    })

    it('renders the worktree icon for worktree projects', () => {
      const { container } = render(
        <ProjectRow {...defaultProps} project={makeProject({ isWorktree: true })} />
      )
      expect(container.querySelector('.project-row__icon')).toBeTruthy()
    })
  })

  describe('per-session status attribution (FR-034, FR-035)', () => {
    const parent = {
      id: 's1',
      projectId: 'proj-1',
      tabTitle: 'Parent',
      status: 'active' as const,
      type: 'human' as const,
      scrollbackLimit: 1000,
      createdAt: '',
    }
    const child = { ...parent, id: 's2', tabTitle: 'Child', parentSessionId: 's1' }

    it('shows a bell count only on the session that rang, not its siblings', () => {
      mockSessionStore.getSessionsForProject.mockReturnValue([
        parent,
        { ...parent, id: 's3', tabTitle: 'Quiet' },
      ])
      // One bell on s1; the project total is also 1.
      mockSessionStore.getBellCountForProject.mockReturnValue(1)
      mockSessionStore.getBellCountForSession.mockImplementation((id: string) =>
        id === 's1' ? 1 : 0
      )

      const { container } = render(<ProjectRow {...defaultProps} isExpanded />)

      // Exactly one row shows a bell — not every row in the project.
      expect(container.querySelectorAll('.session-row__bell')).toHaveLength(1)
    })

    it("reads a child row's busy state from the child, not its parent", () => {
      mockSessionStore.getSessionsForProject.mockReturnValue([parent, child])
      mockSessionStore.isSessionBusy.mockImplementation((id: string) => id === 's1')

      render(<ProjectRow {...defaultProps} isExpanded />)

      // The child must have been asked about itself at least once.
      expect(mockSessionStore.isSessionBusy).toHaveBeenCalledWith('s2')
    })
  })

  describe('session row callbacks are bound to the right session', () => {
    const parent = {
      id: 's1',
      projectId: 'proj-1',
      tabTitle: 'Parent',
      status: 'active' as const,
      type: 'human' as const,
      scrollbackLimit: 1000,
      createdAt: '',
    }
    const child = { ...parent, id: 's2', tabTitle: 'Child', parentSessionId: 's1' }

    beforeEach(() => {
      vi.spyOn(useSessionStore, 'getState').mockReturnValue(
        mockSessionStore as unknown as ReturnType<typeof useSessionStore.getState>
      )
    })

    function renameVia(title: string, next: string) {
      fireEvent.doubleClick(screen.getByText(title))
      const input = document.querySelector('.session-row__rename-input') as HTMLInputElement
      fireEvent.change(input, { target: { value: next } })
      fireEvent.blur(input)
    }

    it('renames the root session it was rendered for', () => {
      mockSessionStore.getSessionsForProject.mockReturnValue([parent])
      render(<ProjectRow {...defaultProps} isExpanded />)
      renameVia('Parent', 'Renamed parent')
      expect(mockSessionStore.renameSession).toHaveBeenCalledWith('s1', 'Renamed parent')
    })

    it('renames the child session, not its parent', () => {
      mockSessionStore.getSessionsForProject.mockReturnValue([parent, child])
      render(<ProjectRow {...defaultProps} isExpanded />)
      renameVia('Child', 'Renamed child')
      expect(mockSessionStore.renameSession).toHaveBeenCalledWith('s2', 'Renamed child')
    })

    it('activates the child session when a child row is selected', () => {
      mockSessionStore.getSessionsForProject.mockReturnValue([parent, child])
      const onSelect = vi.fn()
      render(<ProjectRow {...defaultProps} isExpanded onSelect={onSelect} />)
      fireEvent.click(screen.getByText('Child'))
      expect(onSelect).toHaveBeenCalled()
      expect(mockSessionStore.setActiveSessionForProject).toHaveBeenCalledWith('proj-1', 's2')
    })
  })
})
