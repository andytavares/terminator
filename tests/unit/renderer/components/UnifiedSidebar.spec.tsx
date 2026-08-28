import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { UnifiedSidebar } from '../../../../src/renderer/components/sidebar/UnifiedSidebar'
import type { Project, TerminalSession, Workspace } from '../../../../src/shared/types/index'

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/extensions/registry', () => ({
  useExtensionRegistry: vi.fn(),
}))
vi.mock('../../../../src/renderer/hooks/useBranchSync', () => ({ useBranchSync: vi.fn() }))
vi.mock('../../../../src/renderer/components/sidebar/BranchSwitcher', () => ({
  BranchSwitcher: () => <div data-testid="branch-switcher" />,
}))
vi.mock('../../../../src/renderer/components/sidebar/CreateProjectDialog', () => ({
  CreateProjectDialog: ({ onClose }: { workspaceId: string; onClose: () => void }) => (
    <div data-testid="create-project-dialog">
      <button onClick={onClose}>close-project</button>
    </div>
  ),
}))
vi.mock('../../../../src/renderer/components/sidebar/EditWorkspaceDialog', () => ({
  EditWorkspaceDialog: ({ onClose }: { workspace: unknown; onClose: () => void }) => (
    <div data-testid="edit-workspace-dialog">
      <button onClick={onClose}>close-edit</button>
    </div>
  ),
}))
vi.mock('../../../../src/renderer/components/sidebar/CreateWorkspaceDialog', () => ({
  CreateWorkspaceDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="create-workspace-dialog">
      <button onClick={onClose}>close-workspace</button>
    </div>
  ),
}))

const mockCreateSession = vi.fn()
vi.mock('../../../../src/renderer/hooks/useTerminalSession', () => ({
  useTerminalSession: () => ({ createSession: mockCreateSession }),
}))
let staleAfterMs = 2 * 60 * 60 * 1000
vi.mock('../../../../src/renderer/stores/settings.store', () => ({
  useSettingsStore: () => ({
    resolveSettings: () => ({
      terminal: { scrollbackLimit: 5000 },
      sidebar: { staleAfterMs },
    }),
  }),
}))

const NOW = 1_000_000_000

const ws1: Workspace = {
  id: 'ws-1',
  name: 'Backend',
  folderPath: '/b',
  color: '#5c6bc0',
  tags: [],
  createdAt: '',
  updatedAt: '',
}
const ws2: Workspace = {
  id: 'ws-2',
  name: 'Frontend',
  folderPath: '/f',
  color: '#26a69a',
  tags: [],
  createdAt: '',
  updatedAt: '',
}

const api: Project = {
  id: 'p1',
  workspaceId: 'ws-1',
  name: 'API',
  gitBranch: 'main',
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
}
const jobs: Project = {
  id: 'p2',
  workspaceId: 'ws-1',
  name: 'Jobs',
  isWorktree: true,
  createdAt: '',
  updatedAt: '',
}
const web: Project = {
  id: 'p3',
  workspaceId: 'ws-2',
  name: 'Web',
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
}

function session(
  id: string,
  projectId: string,
  patch: Partial<TerminalSession> = {}
): TerminalSession {
  return {
    id,
    projectId,
    tabTitle: id,
    status: 'active',
    type: 'agent',
    scrollbackLimit: 10000,
    createdAt: '2026-08-21T00:00:00.000Z',
    lastActivityAt: NOW,
    agentState: 'idle',
    ...patch,
  }
}

let sessions: Map<string, TerminalSession>

const mockWorkspaceStore = {
  workspaces: [ws1, ws2],
  activeWorkspaceId: 'ws-1',
  activeProjectId: null as string | null,
  projectsByWorkspaceId: new Map([
    ['ws-1', [api, jobs]],
    ['ws-2', [web]],
  ]),
  setActiveWorkspace: vi.fn(),
  setActiveProject: vi.fn(),
  loadProjects: vi.fn().mockResolvedValue(undefined),
  reorderWorkspaces: vi.fn().mockResolvedValue(undefined),
  deleteProject: vi.fn().mockResolvedValue(undefined),
  renameProject: vi.fn().mockResolvedValue(undefined),
  resolveActiveCwd: vi.fn().mockReturnValue('/b'),
  deleteWorkspace: vi.fn().mockResolvedValue(undefined),
}

const mockSessionStore = {
  sessions: new Map<string, TerminalSession>(),
  projectViews: new Map(),
  isSessionBusy: vi.fn().mockReturnValue(false),
  getBellCountForSession: vi.fn().mockReturnValue(0),
  getScratchSessions: vi.fn().mockReturnValue([]),
  setActiveSessionForProject: vi.fn(),
  renameSession: vi.fn(),
}

const mockRegistryState = {
  globalTabs: new Map(),
  workspaceTabs: new Map(),
  activeGlobalTabId: null,
  sidebarButtons: [] as Array<{ id: string; label: string; action: () => void }>,
  setActiveGlobalTab: vi.fn(),
  registerCommand: vi.fn(() => vi.fn()),
}

const defaultProps = {
  globalTabs: [],
  activeGlobalTabId: null as string | null,
  onSelectGlobalTab: vi.fn(),
  activeWorkspaceTabId: null as string | null,
  onSelectWorkspaceTab: vi.fn(),
  unreadNotifications: 0,
  notificationPanelOpen: false,
  onBellClick: vi.fn(),
  scratchActive: false,
  hasScratchSessions: false,
  onNewScratch: vi.fn(),
  activeScratchSessionId: null as string | null,
  onSelectScratchSession: vi.fn(),
  visible: true,
  now: NOW,
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessions = new Map([
    ['s1', session('s1', 'p1', { tabTitle: 'api-shell' })],
    ['s2', session('s2', 'p1', { tabTitle: 'api-agent', lastActivityAt: NOW - 300_000 })],
    ['s3', session('s3', 'p2', { tabTitle: 'jobs-run' })],
    ['s4', session('s4', 'p3', { tabTitle: 'web-dev' })],
  ])
  mockSessionStore.sessions = sessions
  mockWorkspaceStore.projectsByWorkspaceId = new Map([
    ['ws-1', [api, jobs]],
    ['ws-2', [web]],
  ])
  mockWorkspaceStore.activeProjectId = null
  mockRegistryState.workspaceTabs = new Map()
  vi.mocked(useWorkspaceStore).mockReturnValue(
    mockWorkspaceStore as unknown as ReturnType<typeof useWorkspaceStore>
  )
  vi.mocked(useSessionStore).mockReturnValue(
    mockSessionStore as unknown as ReturnType<typeof useSessionStore>
  )
  vi.mocked(useExtensionRegistry).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((selector: any) =>
      typeof selector === 'function'
        ? selector(mockRegistryState)
        : mockRegistryState) as unknown as typeof useExtensionRegistry
  )
})

const renderSidebar = (props = {}) => render(<UnifiedSidebar {...defaultProps} {...props} />)

describe('UnifiedSidebar — every session visible at a glance (US1)', () => {
  it('renders every session on first paint with nothing expanded by the user (SC-001)', () => {
    renderSidebar()
    for (const title of ['api-shell', 'api-agent', 'jobs-run', 'web-dev']) {
      expect(screen.getByText(title)).toBeTruthy()
    }
  })

  it('defaults every group to expanded (FR-008)', () => {
    const { container } = renderSidebar()
    // Two workspaces plus the three project groups nested inside them.
    expect(container.querySelectorAll('.session-group__sessions')).toHaveLength(5)
  })

  it('shows a relative last-activity label on each row', () => {
    renderSidebar()
    expect(screen.getByText('5m')).toBeTruthy()
  })

  it('omits the project badge under project grouping — the header already says it', () => {
    const { container } = renderSidebar()
    expect(container.querySelector('.session-row__project-badge')).toBeNull()
  })

  it('still lists every project when no session exists, so you can start one', () => {
    mockSessionStore.sessions = new Map()
    const { container } = renderSidebar()
    const labels = Array.from(container.querySelectorAll('.session-group__label')).map(
      (el) => el.textContent
    )
    expect(labels).toEqual(['Backend', 'API', 'Jobs', 'Frontend', 'Web'])
    expect(container.querySelectorAll('.session-group__add')).toHaveLength(3)
  })

  it('offers a way into a workspace that has no projects yet', () => {
    mockSessionStore.sessions = new Map()
    mockWorkspaceStore.projectsByWorkspaceId = new Map()
    renderSidebar()
    // Not an empty state — the workspaces are still reachable, which is the
    // only route to creating that first project.
    expect(screen.getByText('Backend')).toBeTruthy()
    expect(screen.getByText('Frontend')).toBeTruthy()
    expect(screen.queryByText('No sessions yet')).toBeNull()
  })

  it('renders an empty state only when there is no workspace either', () => {
    mockSessionStore.sessions = new Map()
    mockWorkspaceStore.projectsByWorkspaceId = new Map()
    mockWorkspaceStore.workspaces = []
    renderSidebar()
    expect(screen.getByText('No sessions yet')).toBeTruthy()
    mockWorkspaceStore.workspaces = [ws1, ws2]
  })
})

describe('UnifiedSidebar — selection keeps project-scoped state resolved (I4, SC-010)', () => {
  it('sets activeProjectId to the selected session project', () => {
    renderSidebar()
    fireEvent.click(screen.getByText('jobs-run'))
    expect(mockWorkspaceStore.setActiveProject).toHaveBeenCalledWith('p2')
  })

  it('sets the active session for that project', () => {
    renderSidebar()
    fireEvent.click(screen.getByText('jobs-run'))
    expect(mockSessionStore.setActiveSessionForProject).toHaveBeenCalledWith('p2', 's3')
  })

  it('switches the active workspace to the one owning the session', () => {
    renderSidebar()
    fireEvent.click(screen.getByText('web-dev'))
    expect(mockWorkspaceStore.setActiveWorkspace).toHaveBeenCalledWith('ws-2')
  })

  it('notifies the host that a project was selected', () => {
    const onSelectProject = vi.fn()
    renderSidebar({ onSelectProject })
    fireEvent.click(screen.getByText('api-shell'))
    expect(onSelectProject).toHaveBeenCalledOnce()
  })
})

describe('UnifiedSidebar — collapse state', () => {
  it('selects the project when its header is clicked', () => {
    const { container } = renderSidebar()
    fireEvent.click(container.querySelectorAll('.session-group__header')[1])
    expect(mockWorkspaceStore.setActiveProject).toHaveBeenCalledWith('p1')
  })

  it('collapses a group and hides only its sessions', () => {
    const { container } = renderSidebar()
    fireEvent.click(container.querySelectorAll('.session-group__chevron')[1])
    expect(screen.queryByText('api-shell')).toBeNull()
    expect(screen.getByText('jobs-run')).toBeTruthy()
  })

  it('persists the collapsed group across a remount', () => {
    const { container, unmount } = renderSidebar()
    fireEvent.click(container.querySelectorAll('.session-group__chevron')[1])
    unmount()
    renderSidebar()
    expect(screen.queryByText('api-shell')).toBeNull()
  })
})

describe('UnifiedSidebar — scope actions on the group header (FR-026)', () => {
  it('hosts a branch switcher on the active project only', () => {
    mockWorkspaceStore.activeProjectId = 'p1'
    renderSidebar()
    expect(screen.getAllByTestId('branch-switcher')).toHaveLength(1)
  })

  it('shows no branch switcher at all when no project is active', () => {
    renderSidebar()
    expect(screen.queryByTestId('branch-switcher')).toBeNull()
  })

  it('creates a session in the group project', () => {
    renderSidebar()
    fireEvent.click(screen.getAllByTitle('New terminal')[1])
    expect(mockCreateSession).toHaveBeenCalledWith('p2', 'human', '', '/b', 5000)
  })

  it('selects the project it just started a terminal in', () => {
    renderSidebar()
    fireEvent.click(screen.getAllByTitle('New terminal')[1])
    expect(mockWorkspaceStore.setActiveProject).toHaveBeenCalledWith('p2')
    expect(mockWorkspaceStore.setActiveWorkspace).toHaveBeenCalledWith('ws-1')
  })

  it('offers project removal from the header context menu', () => {
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelectorAll('.session-group__header')[1])
    fireEvent.click(screen.getByText('Remove'))
    expect(screen.getByText('Remove project "API"?')).toBeTruthy()
  })

  it('deletes the project once removal is confirmed', () => {
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelectorAll('.session-group__header')[1])
    fireEvent.click(screen.getByText('Remove'))
    fireEvent.click(screen.getAllByText('Remove').at(-1)!)
    expect(mockWorkspaceStore.deleteProject).toHaveBeenCalledWith('p1')
  })
})

describe('UnifiedSidebar — workspace extension buttons (surface 2)', () => {
  beforeEach(() => {
    mockRegistryState.workspaceTabs = new Map([
      ['speckit', { id: 'speckit', label: 'SpecKit', component: () => null }],
      ['reviews', { id: 'reviews', label: 'Code Reviews', component: () => null }],
    ])
  })

  it('renders the buttons once per workspace, not once per project', () => {
    renderSidebar()
    // Two workspaces are on screen; ws-1 has two projects but must show one strip.
    expect(screen.getAllByTitle('SpecKit')).toHaveLength(2)
  })

  it('fires the tab with the owning workspace id', () => {
    const onSelectWorkspaceTab = vi.fn()
    renderSidebar({ onSelectWorkspaceTab })
    fireEvent.click(screen.getAllByTitle('Code Reviews')[1])
    expect(onSelectWorkspaceTab).toHaveBeenCalledWith('ws-2', 'reviews')
  })
})

describe('UnifiedSidebar — search filters rather than dims (FR-031)', () => {
  it('removes non-matching sessions instead of dimming them', () => {
    const { container } = renderSidebar()
    fireEvent.change(
      container.querySelector('.sidebar-search input') ?? container.querySelector('input')!,
      { target: { value: 'jobs' } }
    )
    expect(screen.getByText('jobs-run')).toBeTruthy()
    expect(screen.queryByText('api-shell')).toBeNull()
    expect(container.querySelector('.project-row--dimmed')).toBeNull()
  })

  it('matches on project name, not only session title', () => {
    const { container } = renderSidebar()
    fireEvent.change(container.querySelector('input')!, { target: { value: 'Web' } })
    expect(screen.getByText('web-dev')).toBeTruthy()
    expect(screen.queryByText('api-shell')).toBeNull()
  })

  it('explains an empty result rather than showing a blank list', () => {
    const { container } = renderSidebar()
    fireEvent.change(container.querySelector('input')!, { target: { value: 'zzzz' } })
    // A query that matches nothing narrows the view, so the workspace rows are
    // suppressed too and only the explanation is left.
    expect(screen.getByText('No sessions match "zzzz"')).toBeTruthy()
    expect(screen.queryByText('Backend')).toBeNull()
  })
})

describe('UnifiedSidebar — shell behaviour preserved', () => {
  it('stays mounted but hidden when not visible', () => {
    const { container } = renderSidebar({ visible: false })
    expect(container.querySelector('.unified-sidebar--hidden')).toBeTruthy()
  })

  it('opens the create-workspace dialog from the header', () => {
    const { container } = renderSidebar()
    fireEvent.click(container.querySelector('.sidebar-header__add')!)
    expect(screen.getByTestId('create-workspace-dialog')).toBeTruthy()
  })

  it("puts each workspace's new-project row with that workspace, not in a heap at the bottom", () => {
    const { container } = renderSidebar()
    // ws-1 owns API and Jobs; ws-2 owns Web. The row for a workspace must come
    // straight after that workspace's last project group.
    const order = Array.from(
      container.querySelectorAll('.session-group__label, .ws-row__name')
    ).map((el) => el.textContent)
    expect(order).toEqual(['Backend', 'API', 'Jobs', 'Backend', 'Frontend', 'Web', 'Frontend'])
  })

  it('offers a create-project entry point per workspace', () => {
    const { container } = renderSidebar()
    fireEvent.click(container.querySelectorAll('.ws-row__name')[1])
    expect(screen.getByTestId('create-project-dialog')).toBeTruthy()
  })

  it('keeps workspace edit and remove reachable under project grouping', () => {
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelectorAll('.ws-row')[0])
    fireEvent.click(screen.getByText('Remove workspace'))
    expect(screen.getByText('Remove workspace "Backend"?')).toBeTruthy()
  })

  it('deletes the workspace once removal is confirmed', () => {
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelectorAll('.ws-row')[0])
    fireEvent.click(screen.getByText('Remove workspace'))
    fireEvent.click(screen.getAllByText('Remove').at(-1)!)
    expect(mockWorkspaceStore.deleteWorkspace).toHaveBeenCalledWith('ws-1')
  })

  it('opens the workspace editor', () => {
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelectorAll('.ws-row')[0])
    fireEvent.click(screen.getByText('Edit workspace'))
    expect(screen.getByTestId('edit-workspace-dialog')).toBeTruthy()
  })

  it('closes the create-project dialog when it asks to close', () => {
    const { container } = renderSidebar()
    fireEvent.click(container.querySelectorAll('.ws-row__name')[1])
    fireEvent.click(screen.getByText('close-project'))
    expect(screen.queryByTestId('create-project-dialog')).toBeNull()
  })

  it('restores the default width on a resize-handle double click', () => {
    const { container } = renderSidebar()
    fireEvent.doubleClick(container.querySelector('.unified-sidebar__resize-handle')!)
    expect(localStorage.getItem('terminator.sidebar.width')).toBe('300')
  })

  it('loads projects for a workspace that has not been fetched', () => {
    mockWorkspaceStore.projectsByWorkspaceId = new Map([['ws-1', [api, jobs]]])
    renderSidebar()
    expect(mockWorkspaceStore.loadProjects).toHaveBeenCalledWith('ws-2')
    mockWorkspaceStore.projectsByWorkspaceId = new Map([
      ['ws-1', [api, jobs]],
      ['ws-2', [web]],
    ])
  })

  it('restores a previously stored width', () => {
    localStorage.setItem('terminator.sidebar.width', '333')
    const { container } = renderSidebar()
    expect((container.querySelector('.unified-sidebar') as HTMLElement).style.width).toBe('333px')
  })

  it('clamps a stored width that is out of range', () => {
    localStorage.setItem('terminator.sidebar.width', '9999')
    const { container } = renderSidebar()
    expect((container.querySelector('.unified-sidebar') as HTMLElement).style.width).toBe('480px')
  })

  it('ignores a stored width that is not a number', () => {
    localStorage.setItem('terminator.sidebar.width', 'wide')
    const { container } = renderSidebar()
    expect((container.querySelector('.unified-sidebar') as HTMLElement).style.width).toBe('300px')
  })

  it('opens at the branch-row default width when nothing is stored', () => {
    const { container } = renderSidebar()
    expect((container.querySelector('.unified-sidebar') as HTMLElement).style.width).toBe('300px')
  })

  it('lets a stored width beat the new default, so a resize survives the change', () => {
    localStorage.setItem('terminator.sidebar.width', '264')
    const { container } = renderSidebar()
    expect((container.querySelector('.unified-sidebar') as HTMLElement).style.width).toBe('264px')
  })

  it('persists a new width after a resize drag', () => {
    const { container } = renderSidebar()
    const handle = container.querySelector('.unified-sidebar__resize-handle')!
    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent.mouseMove(document, { clientX: 150 })
    fireEvent.mouseUp(document, { clientX: 150 })
    // 50px of drag from the 300px default.
    expect(localStorage.getItem('terminator.sidebar.width')).toBe('350')
  })

  it('reorders workspaces on drop', () => {
    const { container } = renderSidebar()
    const targets = container.querySelectorAll('.unified-sidebar__ws-actions')
    fireEvent.dragStart(targets[0])
    fireEvent.drop(targets[1])
    expect(mockWorkspaceStore.reorderWorkspaces).toHaveBeenCalledWith(['ws-2', 'ws-1'])
  })

  it('renames a project through the store', () => {
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelectorAll('.session-group__header')[1])
    fireEvent.click(screen.getByText('Rename'))
    const input = container.querySelector('.session-group__rename-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'API v2' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockWorkspaceStore.renameProject).toHaveBeenCalledWith('p1', 'API v2')
  })

  it('renames a session through the store', () => {
    renderSidebar()
    fireEvent.doubleClick(screen.getByText('api-shell'))
    const input = document.querySelector('.session-row__rename-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'renamed' } })
    fireEvent.blur(input)
    expect(mockSessionStore.renameSession).toHaveBeenCalledWith('s1', 'renamed')
  })

  it('clears the search from the header control', () => {
    const { container } = renderSidebar()
    fireEvent.change(
      container.querySelector('.sidebar-search input') ?? container.querySelector('input')!,
      { target: { value: 'jobs' } }
    )
    expect(screen.queryByText('api-shell')).toBeNull()
    fireEvent.click(container.querySelector('.sidebar-search__clear')!)
    expect(screen.getByText('api-shell')).toBeTruthy()
  })

  it('closes the create-workspace dialog when it asks to close', () => {
    const { container } = renderSidebar()
    fireEvent.click(container.querySelector('.sidebar-header__add')!)
    fireEvent.click(screen.getByText('close-workspace'))
    expect(screen.queryByTestId('create-workspace-dialog')).toBeNull()
  })

  it('leaves the project alone when removal is cancelled', () => {
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelectorAll('.session-group__header')[1])
    fireEvent.click(screen.getByText('Remove'))
    fireEvent.click(screen.getByText('Cancel'))
    expect(mockWorkspaceStore.deleteProject).not.toHaveBeenCalled()
    expect(screen.queryByText('Remove project "API"?')).toBeNull()
  })

  it('marks a busy group with the aggregate indicator', () => {
    mockSessionStore.isSessionBusy.mockImplementation((id: string) => id === 's3')
    const { container } = renderSidebar()
    // The workspace header aggregates its projects, so both it and the project
    // group carry the indicator.
    expect(container.querySelectorAll('.session-group__busy')).toHaveLength(2)
    mockSessionStore.isSessionBusy.mockReturnValue(false)
  })

  it('renders a split child row as a sub-session', () => {
    sessions.set('s5', session('s5', 'p1', { tabTitle: 'split', parentSessionId: 's1' }))
    const { container } = renderSidebar()
    expect(container.querySelectorAll('.session-row--sub')).toHaveLength(1)
  })
})

describe('UnifiedSidebar — non-project groupings (FR-010, FR-027)', () => {
  beforeEach(() => {
    localStorage.setItem(
      'terminator.sidebar.views',
      JSON.stringify([
        { id: 'by-status', name: 'By status', groupBy: 'status', sortBy: 'name', filters: {} },
        {
          id: 'by-workspace',
          name: 'By workspace',
          groupBy: 'workspace',
          sortBy: 'name',
          filters: {},
        },
        { id: 'flat', name: 'Flat', groupBy: 'none', sortBy: 'name', filters: {} },
      ])
    )
  })

  it('groups by workspace and keeps the workspace scope on the header', () => {
    const { container } = renderSidebar({ initialViewId: 'by-workspace' })
    const labels = Array.from(container.querySelectorAll('.session-group__label')).map((el) =>
      el.textContent!.trim()
    )
    expect(labels).toEqual(['Backend', 'API', 'Jobs', 'Frontend', 'Web'])
  })

  it('shows the project badge on every row once the header stops naming the project', () => {
    renderSidebar({ initialViewId: 'by-status' })
    const badges = Array.from(document.querySelectorAll('.session-row__project-badge')).map(
      (el) => el.textContent
    )
    expect(badges.sort()).toEqual(['API', 'API', 'Jobs', 'Web'])
  })

  it('offers no project-scoped header actions when the grouping is not a scope', () => {
    const { container } = renderSidebar({ initialViewId: 'by-status' })
    expect(container.querySelector('.session-group__add')).toBeNull()
    expect(screen.queryByTestId('branch-switcher')).toBeNull()
  })

  it('still resolves activeProjectId when selecting under status grouping (SC-010)', () => {
    renderSidebar({ initialViewId: 'by-status' })
    fireEvent.click(screen.getByText('web-dev'))
    expect(mockWorkspaceStore.setActiveProject).toHaveBeenCalledWith('p3')
  })

  it('collapses one group without touching the same key in another grouping mode', () => {
    const { container, unmount } = renderSidebar({ initialViewId: 'by-status' })
    fireEvent.click(container.querySelectorAll('.session-group__chevron')[0])
    expect(screen.queryByText('api-shell')).toBeNull()
    unmount()
    renderSidebar()
    expect(screen.getByText('api-shell')).toBeTruthy()
  })

  it('renders a single group when grouping is switched off', () => {
    const { container } = renderSidebar({ initialViewId: 'flat' })
    expect(container.querySelectorAll('.session-group')).toHaveLength(1)
    expect(container.querySelector('.session-group__label')!.textContent).toBe('All sessions')
  })

  it('hosts the workspace extension buttons on a workspace group header', () => {
    mockRegistryState.workspaceTabs = new Map([
      ['speckit', { id: 'speckit', label: 'SpecKit', component: () => null }],
    ])
    renderSidebar({ initialViewId: 'by-workspace' })
    expect(screen.getAllByTitle('SpecKit')).toHaveLength(2)
  })

  it('falls back to the default view when the stored view id is unknown', () => {
    const { container } = renderSidebar({ initialViewId: 'nope' })
    const labels = Array.from(container.querySelectorAll('.session-group__label')).map((el) =>
      el.textContent!.trim()
    )
    expect(labels).toEqual(['Backend', 'API', 'Jobs', 'Frontend', 'Web'])
  })

  it('highlights the workspace drop target during a drag', () => {
    const { container } = renderSidebar()
    const targets = container.querySelectorAll('.unified-sidebar__ws-actions')
    fireEvent.dragOver(targets[1])
    expect(container.querySelector('.ws-card--dnd-over')).toBeTruthy()
  })
})

describe('UnifiedSidebar — contributed sidebar items in the footer (FR-028)', () => {
  const action = vi.fn()

  beforeEach(() => {
    mockRegistryState.sidebarButtons = [{ id: 'git-sidebar-toggle', label: 'Git Changes', action }]
  })

  it('renders each contributed item exactly once', () => {
    renderSidebar()
    expect(screen.getAllByText('Git Changes')).toHaveLength(1)
  })

  it('fires the item action on click', () => {
    renderSidebar()
    fireEvent.click(screen.getByText('Git Changes'))
    expect(action).toHaveBeenCalledOnce()
  })

  it.each(['by-status', 'by-workspace', 'flat'])(
    'keeps the item in the footer under the %s grouping',
    (viewId) => {
      localStorage.setItem(
        'terminator.sidebar.views',
        JSON.stringify([
          { id: 'by-status', name: 'S', groupBy: 'status', sortBy: 'name', filters: {} },
          { id: 'by-workspace', name: 'W', groupBy: 'workspace', sortBy: 'name', filters: {} },
          { id: 'flat', name: 'F', groupBy: 'none', sortBy: 'name', filters: {} },
        ])
      )
      renderSidebar({ initialViewId: viewId })
      expect(screen.getAllByText('Git Changes')).toHaveLength(1)
    }
  )

  it('renders no footer when no extension contributes an item', () => {
    mockRegistryState.sidebarButtons = []
    const { container } = renderSidebar()
    expect(container.querySelector('.extension-footer')).toBeNull()
  })
})

describe('UnifiedSidebar — views and the filter notice (US4, US5)', () => {
  it('switches grouping from the view bar', () => {
    const { container } = renderSidebar()
    fireEvent.click(screen.getByText('Group: Workspace'))
    fireEvent.click(screen.getByText('Status'))
    const labels = Array.from(container.querySelectorAll('.session-group__label')).map(
      (el) => el.textContent
    )
    expect(labels).toEqual(['Idle'])
  })

  it('persists a grouping change for that view across a remount', () => {
    const { unmount } = renderSidebar()
    fireEvent.click(screen.getByText('Group: Workspace'))
    fireEvent.click(screen.getByText('Project'))
    unmount()
    const { container } = renderSidebar()
    const labels = Array.from(container.querySelectorAll('.session-group__label')).map(
      (el) => el.firstChild!.textContent
    )
    expect(labels).toEqual(['API', 'Jobs', 'Web'])
  })

  it('restores the unfiltered Everything view on mount, never a filtered one (FR-015)', () => {
    const { container, unmount } = renderSidebar()
    fireEvent.click(screen.getByText('Needs me'))
    expect(screen.queryByText('api-shell')).toBeNull()
    unmount()
    renderSidebar()
    expect(screen.getByText('api-shell')).toBeTruthy()
    expect(container.querySelector('.filter-notice')).toBeNull()
  })

  it('explains a filtered list with shown and total counts (FR-016)', () => {
    renderSidebar()
    fireEvent.click(screen.getByText('Needs me'))
    expect(screen.getByText('Filtered · showing 0 of 4')).toBeTruthy()
  })

  it('explains a search-filtered list too', () => {
    const { container } = renderSidebar()
    fireEvent.change(container.querySelector('.sidebar-search input, input')!, {
      target: { value: 'jobs' },
    })
    expect(screen.getByText('Filtered · showing 1 of 4')).toBeTruthy()
  })

  it('shows no notice when nothing is filtered', () => {
    const { container } = renderSidebar()
    expect(container.querySelector('.filter-notice')).toBeNull()
  })

  it('restores every session in one interaction from the notice (SC-007)', () => {
    renderSidebar()
    fireEvent.click(screen.getByText('Needs me'))
    fireEvent.click(screen.getByText('show all'))
    expect(screen.getByText('api-shell')).toBeTruthy()
    expect(screen.queryByText('show all')).toBeNull()
  })

  it('hides the hide-stale toggle on the Stale view (FR-021)', () => {
    renderSidebar()
    expect(screen.getByText('Hide stale')).toBeTruthy()
    fireEvent.click(screen.getByText('Stale'))
    expect(screen.queryByText('Hide stale')).toBeNull()
  })

  it('hides stale sessions when the toggle is turned on', () => {
    sessions.set('old', session('old', 'p1', { tabTitle: 'ancient', lastActivityAt: 0 }))
    renderSidebar()
    expect(screen.getByText('ancient')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Hide stale'))
    expect(screen.queryByText('ancient')).toBeNull()
  })
})

describe('UnifiedSidebar — stale cleanup (US3)', () => {
  beforeEach(() => {
    // Four stale sessions: three idle-and-old, one waiting on the user.
    sessions = new Map([
      ['a', session('a', 'p1', { tabTitle: 'old-a', lastActivityAt: 0 })],
      ['b', session('b', 'p1', { tabTitle: 'old-b', lastActivityAt: 0 })],
      ['c', session('c', 'p2', { tabTitle: 'old-c', lastActivityAt: 0 })],
      [
        'w',
        // Expressed through the signal that produces the state, not the derived
        // field — agentState is computed from the bell, so setting it directly
        // would be overwritten.
        session('w', 'p1', {
          tabTitle: 'waiting',
          lastActivityAt: 0,
          bellCount: 1,
        }),
      ],
    ])
    mockSessionStore.sessions = sessions
    mockSessionStore.closeSession = vi.fn()
  })

  const openStale = () => {
    const r = renderSidebar()
    fireEvent.click(screen.getByText('Stale'))
    return r
  }

  it('lists only stale sessions, never one that is waiting on you (FR-018)', () => {
    openStale()
    expect(screen.getByText('old-a')).toBeTruthy()
    expect(screen.queryByText('waiting')).toBeNull()
  })

  it('offers selection only in the Stale view', () => {
    const { container } = renderSidebar()
    expect(container.querySelector('.session-row__select')).toBeNull()
    fireEvent.click(screen.getByText('Stale'))
    expect(container.querySelector('.session-row__select')).toBeTruthy()
  })

  it('selects a range with shift-click', () => {
    openStale()
    fireEvent.click(screen.getByLabelText('Select old-a'))
    fireEvent.click(screen.getByLabelText('Select old-c'), { shiftKey: true })
    expect(screen.getByText('3 selected')).toBeTruthy()
  })

  it('selects every session in a group', () => {
    const { container } = openStale()
    fireEvent.click(container.querySelectorAll('.session-group__select-all')[0])
    expect(screen.getByText('2 selected')).toBeTruthy()
  })

  it('deselects a session that is clicked twice', () => {
    openStale()
    fireEvent.click(screen.getByLabelText('Select old-a'))
    fireEvent.click(screen.getByLabelText('Select old-a'))
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  it('clears the selection', () => {
    openStale()
    fireEvent.click(screen.getByLabelText('Select old-a'))
    fireEvent.click(screen.getByText('Clear'))
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  it('closes exactly the selected sessions (SC-005)', () => {
    openStale()
    fireEvent.click(screen.getByLabelText('Select old-a'))
    fireEvent.click(screen.getByLabelText('Select old-c'), { shiftKey: true })
    fireEvent.click(screen.getByText('Close selected'))
    fireEvent.click(screen.getByText('Close sessions'))
    expect(mockSessionStore.closeSession.mock.calls.map((c) => c[0]).sort()).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('removes a worktree-backed project through the existing delete path', () => {
    mockWorkspaceStore.projectsByWorkspaceId = new Map([
      ['ws-1', [api, { ...jobs, worktreePath: '/repo/.worktrees/jobs' }]],
      ['ws-2', [web]],
    ])
    openStale()
    fireEvent.click(screen.getByLabelText('Select old-c'))
    fireEvent.click(screen.getByText('Close selected'))
    expect(screen.getByText('/repo/.worktrees/jobs')).toBeTruthy()
    fireEvent.click(screen.getByText('Close sessions'))
    expect(mockWorkspaceStore.deleteProject).toHaveBeenCalledWith('p2')
    mockWorkspaceStore.projectsByWorkspaceId = new Map([
      ['ws-1', [api, jobs]],
      ['ws-2', [web]],
    ])
  })

  it('reflects a changed staleness threshold without a restart (FR-019)', () => {
    sessions.set('recent', session('recent', 'p1', { tabTitle: 'recent', lastActivityAt: NOW }))
    // Two hours is the default, so a session active a minute ago is not stale.
    const { unmount } = renderSidebar({ now: NOW + 60_000 })
    fireEvent.click(screen.getByText('Stale'))
    expect(screen.queryByText('recent')).toBeNull()
    unmount()

    staleAfterMs = 30_000
    renderSidebar({ now: NOW + 60_000 })
    fireEvent.click(screen.getByText('Stale'))
    expect(screen.getByText('recent')).toBeTruthy()
    staleAfterMs = 2 * 60 * 60 * 1000
  })
})

describe('UnifiedSidebar — session notes (FR-005)', () => {
  beforeEach(() => {
    mockSessionStore.setSessionNote = vi.fn()
  })

  it('opens the note editor for the session the host names (Cmd+I)', () => {
    const { container } = renderSidebar({ editNoteSessionId: 's1' })
    expect(container.querySelector('.session-row__note-input')).toBeTruthy()
  })

  it('saves the note on Enter', () => {
    const { container } = renderSidebar({ editNoteSessionId: 's1' })
    const input = container.querySelector('.session-row__note-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'waiting on review' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockSessionStore.setSessionNote).toHaveBeenCalledWith('s1', 'waiting on review')
  })

  it('saves the note on blur', () => {
    const { container } = renderSidebar({ editNoteSessionId: 's1' })
    const input = container.querySelector('.session-row__note-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'blurred' } })
    fireEvent.blur(input)
    expect(mockSessionStore.setSessionNote).toHaveBeenCalledWith('s1', 'blurred')
  })

  it('abandons the edit on Escape', () => {
    const { container } = renderSidebar({ editNoteSessionId: 's1' })
    fireEvent.keyDown(container.querySelector('.session-row__note-input')!, { key: 'Escape' })
    expect(mockSessionStore.setSessionNote).not.toHaveBeenCalled()
    expect(container.querySelector('.session-row__note-input')).toBeNull()
  })

  it('shows an existing note on the row', () => {
    sessions.set('s1', session('s1', 'p1', { tabTitle: 'api-shell', note: 'blocked on infra' }))
    renderSidebar()
    expect(screen.getByText('blocked on infra')).toBeTruthy()
  })

  it('matches a note in search (FR-031)', () => {
    sessions.set('s1', session('s1', 'p1', { tabTitle: 'api-shell', note: 'blocked on infra' }))
    const { container } = renderSidebar()
    fireEvent.change(container.querySelector('input')!, { target: { value: 'infra' } })
    expect(screen.getByText('api-shell')).toBeTruthy()
    expect(screen.queryByText('web-dev')).toBeNull()
  })

  it('shows no note element when the session has none', () => {
    const { container } = renderSidebar()
    expect(container.querySelector('.session-row__note')).toBeNull()
  })
})

describe('UnifiedSidebar — workspace grouping keeps the project layer (default view)', () => {
  it('nests each project under its workspace', () => {
    const { container } = renderSidebar()
    const labels = Array.from(container.querySelectorAll('.session-group__label')).map((el) =>
      el.textContent!.trim()
    )
    expect(labels).toEqual(['Backend', 'API', 'Jobs', 'Frontend', 'Web'])
  })

  it('starts a terminal on a nested project without changing the grouping', () => {
    const { container } = renderSidebar()
    const jobs = Array.from(container.querySelectorAll('.session-group--nested')).find((el) =>
      el.querySelector('.session-group__label')!.textContent!.startsWith('Jobs')
    )!
    fireEvent.click(jobs.querySelector('.session-group__add')!)
    expect(mockWorkspaceStore.setActiveProject).toHaveBeenCalledWith('p2')
    expect(mockCreateSession).toHaveBeenCalled()
  })

  it('offers the branch switcher on the nested project that is active', () => {
    mockWorkspaceStore.activeProjectId = 'p1'
    renderSidebar()
    expect(screen.getAllByTestId('branch-switcher')).toHaveLength(1)
  })

  it('names no workspace on a nested project — its header already says it', () => {
    const { container } = renderSidebar()
    expect(container.querySelector('.session-group__workspace')).toBeNull()
  })

  it('names the workspace on every project header under project grouping', () => {
    localStorage.setItem(
      'terminator.sidebar.views',
      JSON.stringify([
        { id: 'by-project', name: 'P', groupBy: 'project', sortBy: 'name', filters: {} },
      ])
    )
    const { container } = renderSidebar({ initialViewId: 'by-project' })
    const names = Array.from(container.querySelectorAll('.session-group__workspace')).map(
      (el) => el.textContent
    )
    expect(names).toEqual(['Backend', 'Backend', 'Frontend'])
  })
})

describe('UnifiedSidebar — agent state is derived, not read from a field nobody writes', () => {
  it('treats a session with an unread bell as awaiting input', () => {
    sessions.set('s6', session('s6', 'p1', { tabTitle: 'claude', bellCount: 2 }))
    renderSidebar({ initialViewId: 'needs-me' })
    expect(screen.getByText('claude')).toBeTruthy()
  })

  it('treats a session producing output as working', () => {
    sessions.set('s7', session('s7', 'p1', { tabTitle: 'build', busy: true }))
    renderSidebar({ initialViewId: 'active' })
    expect(screen.getByText('build')).toBeTruthy()
  })

  it('leaves a quiet session idle, so it appears in neither', () => {
    sessions.clear()
    sessions.set('s8', session('s8', 'p1', { tabTitle: 'quiet' }))
    const needs = renderSidebar({ initialViewId: 'needs-me' })
    expect(needs.container.textContent).not.toContain('quiet')
    needs.unmount()
    const active = renderSidebar({ initialViewId: 'active' })
    expect(active.container.textContent).not.toContain('quiet')
  })

  it('treats a closed session as exited', () => {
    sessions.clear()
    sessions.set('s9', session('s9', 'p1', { tabTitle: 'gone', status: 'closed' }))
    const { container } = renderSidebar()
    expect(container.querySelector('.session-row__status svg')!.getAttribute('data-state')).toBe(
      'exited'
    )
  })
})
