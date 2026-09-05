import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'
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
vi.mock('../../../../src/renderer/stores/integrations.store', () => ({
  useIntegrationsStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/components/integrations/LinkIssueDialog', () => ({
  LinkIssueDialog: ({ projectName }: { projectName: string }) => (
    <div data-testid="link-issue-dialog">{projectName}</div>
  ),
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
const staleAfterMs = 2 * 60 * 60 * 1000
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
  getScratchSessions: vi.fn(() =>
    [...sessions.values()].filter((s) => s.projectId === '00000000-0000-0000-0000-000000000000')
  ),
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

const mockIntegrationsStore = {
  linkFor: vi.fn().mockReturnValue(null),
  issueFor: vi.fn().mockReturnValue(null),
  loadLink: vi.fn().mockResolvedValue(undefined),
  unlinkIssue: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn().mockReturnValue(() => {}),
  loadConnections: vi.fn().mockResolvedValue(undefined),
  linkDialogProjectId: null as string | null,
  openLinkDialog: vi.fn(),
  closeLinkDialog: vi.fn(),
  drawerProjectId: null as string | null,
  openDrawer: vi.fn(),
  closeDrawer: vi.fn(),
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
  mockIntegrationsStore.linkDialogProjectId = null
  mockIntegrationsStore.drawerProjectId = null
  mockIntegrationsStore.linkFor.mockReturnValue(null)
  mockIntegrationsStore.issueFor.mockReturnValue(null)
  mockIntegrationsStore.subscribe.mockReturnValue(() => {})
  vi.mocked(useIntegrationsStore).mockReturnValue(
    mockIntegrationsStore as unknown as ReturnType<typeof useIntegrationsStore>
  )
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

describe('UnifiedSidebar — the list is branches, not terminals (US1)', () => {
  const branchRows = (c: HTMLElement) => Array.from(c.querySelectorAll('.branch-row'))
  const branchNames = (c: HTMLElement) =>
    branchRows(c).map((r) => r.querySelector('.branch-row__name')!.textContent)

  it('lists one row per branch and no terminals at all', () => {
    const { container } = renderSidebar()
    expect(branchNames(container)).toEqual(['main', 'Jobs', 'Web'])
    for (const title of ['api-shell', 'api-agent', 'jobs-run', 'web-dev']) {
      expect(screen.queryByText(title)).toBeNull()
    }
  })

  it('groups the branches under their repos', () => {
    const { container } = renderSidebar()
    const names = Array.from(container.querySelectorAll('.repo-header__name')).map(
      (h) => h.textContent
    )
    expect(names).toEqual(['Backend', 'Frontend'])
  })

  it('counts branches on the repo header, not terminals', () => {
    const { container } = renderSidebar()
    const counts = Array.from(container.querySelectorAll('.repo-header__count')).map(
      (c) => c.textContent
    )
    expect(counts).toEqual(['2', '1'])
  })

  it('still lists a branch with no terminals, so you can start one', () => {
    sessions = new Map()
    mockSessionStore.sessions = sessions
    const { container } = renderSidebar()
    expect(branchNames(container)).toEqual(['main', 'Jobs', 'Web'])
  })

  it('shows a branch state folded from its terminals', () => {
    sessions = new Map([['s1', session('s1', 'p1', { bellCount: 1 })]])
    mockSessionStore.sessions = sessions
    const { container } = renderSidebar()
    const main = branchRows(container)[0]
    expect(main.querySelector('.branch-row__gutter svg')!.getAttribute('data-state')).toBe(
      'awaiting-input'
    )
  })

  it('renders an empty state only when there is no repo either', () => {
    mockWorkspaceStore.projectsByWorkspaceId = new Map()
    mockWorkspaceStore.workspaces = []
    const { container } = renderSidebar()
    expect(container.querySelector('.unified-sidebar__empty')).toBeTruthy()
    mockWorkspaceStore.workspaces = [ws1, ws2]
  })

  it('offers a repo with no branches its own way in', () => {
    mockWorkspaceStore.projectsByWorkspaceId = new Map([['ws-1', [api, jobs]]])
    const { container } = renderSidebar()
    const names = Array.from(container.querySelectorAll('.repo-header__name')).map(
      (h) => h.textContent
    )
    expect(names).toContain('Frontend')
  })
})

describe('UnifiedSidebar — selecting a branch (FR-047)', () => {
  const clickBranch = (container: HTMLElement, index = 0) =>
    fireEvent.click(container.querySelectorAll('.branch-row')[index])

  it('activates the branch and its repo', () => {
    const { container } = renderSidebar()
    clickBranch(container)
    expect(mockWorkspaceStore.setActiveWorkspace).toHaveBeenCalledWith('ws-1')
    expect(mockWorkspaceStore.setActiveProject).toHaveBeenCalledWith('p1')
  })

  it('focuses the terminal that is waiting on you', () => {
    sessions = new Map([
      ['s1', session('s1', 'p1', { lastActivityAt: NOW })],
      ['s2', session('s2', 'p1', { bellCount: 1, lastActivityAt: NOW - 900_000 })],
    ])
    mockSessionStore.sessions = sessions
    const { container } = renderSidebar()
    clickBranch(container)
    expect(mockSessionStore.setActiveSessionForProject).toHaveBeenCalledWith('p1', 's2')
  })

  it('falls back to the one you last had open on that branch', () => {
    sessions = new Map([
      ['s1', session('s1', 'p1', { lastActivityAt: NOW - 900_000 })],
      ['s2', session('s2', 'p1', { lastActivityAt: NOW })],
    ])
    mockSessionStore.sessions = sessions
    mockSessionStore.projectViews = new Map([['p1', { activeSessionId: 's1' }]])
    const { container } = renderSidebar()
    clickBranch(container)
    expect(mockSessionStore.setActiveSessionForProject).toHaveBeenCalledWith('p1', 's1')
    mockSessionStore.projectViews = new Map()
  })

  it('falls back to the most recently active when there is no memory of one', () => {
    sessions = new Map([
      ['s1', session('s1', 'p1', { lastActivityAt: NOW - 900_000 })],
      ['s2', session('s2', 'p1', { lastActivityAt: NOW })],
    ])
    mockSessionStore.sessions = sessions
    const { container } = renderSidebar()
    clickBranch(container)
    expect(mockSessionStore.setActiveSessionForProject).toHaveBeenCalledWith('p1', 's2')
  })

  it('selects a branch with no terminals and lets the app open its first', () => {
    // App's auto-open effect gives a newly selected branch its first terminal.
    // Starting one here as well opened two, which the e2e caught.
    sessions = new Map()
    mockSessionStore.sessions = sessions
    const { container } = renderSidebar()
    clickBranch(container)
    expect(mockWorkspaceStore.setActiveProject).toHaveBeenCalledWith('p1')
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it('tells the host a branch was selected', () => {
    const onSelectProject = vi.fn()
    const { container } = renderSidebar({ onSelectProject })
    clickBranch(container)
    expect(onSelectProject).toHaveBeenCalled()
  })
})

describe('UnifiedSidebar — collapse', () => {
  it('hides a repo branches without hiding the repo', () => {
    const { container } = renderSidebar()
    fireEvent.click(container.querySelector('.repo-header')!)
    expect(container.querySelectorAll('.branch-row')).toHaveLength(1)
    expect(container.querySelectorAll('.repo-header')).toHaveLength(2)
  })

  it('remembers a collapsed repo across a remount', () => {
    const { container, unmount } = renderSidebar()
    fireEvent.click(container.querySelector('.repo-header')!)
    unmount()
    const second = renderSidebar()
    expect(second.container.querySelectorAll('.branch-row')).toHaveLength(1)
  })

  it('still signals a waiting branch under a collapsed repo', () => {
    sessions = new Map([['s1', session('s1', 'p1', { bellCount: 1 })]])
    mockSessionStore.sessions = sessions
    const { container } = renderSidebar()
    fireEvent.click(container.querySelector('.repo-header')!)
    expect(container.querySelector('.repo-header__needs-you')).toBeTruthy()
  })
})

describe('UnifiedSidebar — branch actions', () => {
  it('starts a terminal on a branch from its row', () => {
    const { container } = renderSidebar()
    fireEvent.click(container.querySelector('.branch-row__action')!)
    expect(mockCreateSession).toHaveBeenCalled()
  })

  it('creates a branch from the repo header', () => {
    const { container } = renderSidebar()
    fireEvent.click(container.querySelector('.repo-header__action')!)
    expect(screen.getByTestId('create-project-dialog')).toBeTruthy()
  })

  it('offers branch removal from the row menu', () => {
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelector('.branch-row')!)
    expect(screen.getByText('Remove branch')).toBeTruthy()
  })

  it('deletes the branch once removal is confirmed', () => {
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelector('.branch-row')!)
    fireEvent.click(screen.getByText('Remove branch'))
    fireEvent.click(screen.getByText('Remove'))
    expect(mockWorkspaceStore.deleteProject).toHaveBeenCalledWith('p1')
  })

  it('renames a branch that has no branch to be named by', () => {
    const { container } = renderSidebar()
    // `web` sits in a folder that is not a repo, so its stored name is its only name.
    const rows = Array.from(container.querySelectorAll('.branch-row'))
    const webRow = rows.find((r) => r.querySelector('.branch-row__name')!.textContent === 'Web')!
    fireEvent.contextMenu(webRow)
    fireEvent.click(screen.getByText('Rename'))
    const input = container.querySelector('.branch-row__rename') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Web v2' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockWorkspaceStore.renameProject).toHaveBeenCalledWith('p3', 'Web v2')
  })

  it('offers no rename on a branch named by its branch (ADR-034)', () => {
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelector('.branch-row')!)
    expect(screen.queryByText('Rename')).toBeNull()
  })
})

describe('UnifiedSidebar — repo extension surfaces', () => {
  it('renders the repo buttons once per repo', () => {
    mockRegistryState.workspaceTabs = new Map([
      ['t1', { id: 't1', label: 'Fake Tab', component: () => null }],
    ])
    const { container } = renderSidebar()
    const buttons = Array.from(container.querySelectorAll('.repo-header__action')).filter(
      (b) => b.getAttribute('aria-label') === 'Fake Tab'
    )
    expect(buttons).toHaveLength(2)
    mockRegistryState.workspaceTabs = new Map()
  })

  it('fires a repo button with the owning repo id', () => {
    mockRegistryState.workspaceTabs = new Map([
      ['t1', { id: 't1', label: 'Fake Tab', component: () => null }],
    ])
    const onSelectWorkspaceTab = vi.fn()
    const { container } = renderSidebar({ onSelectWorkspaceTab })
    fireEvent.click(
      Array.from(container.querySelectorAll('.repo-header__action')).find(
        (b) => b.getAttribute('aria-label') === 'Fake Tab'
      )!
    )
    expect(onSelectWorkspaceTab).toHaveBeenCalledWith('ws-1', 't1')
    mockRegistryState.workspaceTabs = new Map()
  })
})

describe('UnifiedSidebar — search', () => {
  it('removes non-matching branches instead of dimming them', () => {
    const { container } = renderSidebar()
    fireEvent.change(container.querySelector('.sidebar-search input')!, {
      target: { value: 'jobs' },
    })
    const names = Array.from(container.querySelectorAll('.branch-row__name')).map(
      (n) => n.textContent
    )
    expect(names).toEqual(['Jobs'])
  })

  it('matches on the repo name too', () => {
    const { container } = renderSidebar()
    fireEvent.change(container.querySelector('.sidebar-search input')!, {
      target: { value: 'frontend' },
    })
    const names = Array.from(container.querySelectorAll('.branch-row__name')).map(
      (n) => n.textContent
    )
    expect(names).toEqual(['Web'])
  })

  it('says so when nothing matches', () => {
    const { container } = renderSidebar()
    fireEvent.change(container.querySelector('.sidebar-search input')!, {
      target: { value: 'zzzz' },
    })
    expect(container.querySelector('.unified-sidebar__empty')!.textContent).toContain('zzzz')
  })
})

describe('UnifiedSidebar — scratch is the one place a terminal is still a row', () => {
  beforeEach(() => {
    sessions = new Map([
      ['sc1', session('sc1', '00000000-0000-0000-0000-000000000000', { tabTitle: 'notes' })],
    ])
    mockSessionStore.sessions = sessions
  })

  it('lists a scratch terminal in its own section', () => {
    const { container } = renderSidebar()
    const scratch = container.querySelector('.unified-sidebar__scratch')!
    expect(scratch.textContent).toContain('notes')
  })

  it('never lists a scratch terminal as a branch', () => {
    const { container } = renderSidebar()
    const inList = Array.from(
      container.querySelectorAll('.unified-sidebar__list > .branch-row .branch-row__name')
    ).map((n) => n.textContent)
    expect(inList).not.toContain('notes')
  })

  it('counts them on the section header', () => {
    const { container } = renderSidebar()
    expect(container.querySelector('.unified-sidebar__scratch-count')!.textContent).toBe('1')
  })

  it('selects a scratch terminal when its row is clicked', () => {
    const onSelectScratchSession = vi.fn()
    const { container } = renderSidebar({ onSelectScratchSession })
    const scratch = container.querySelector('.unified-sidebar__scratch')!
    fireEvent.click(scratch.querySelector('.branch-row')!)
    expect(onSelectScratchSession).toHaveBeenCalledWith('sc1')
  })

  it('marks the active scratch terminal', () => {
    const { container } = renderSidebar({ activeScratchSessionId: 'sc1' })
    const scratch = container.querySelector('.unified-sidebar__scratch')!
    expect(scratch.querySelector('.branch-row--selected')).toBeTruthy()
  })

  it('starts a new scratch terminal from the section header', () => {
    const onNewScratch = vi.fn()
    const { container } = renderSidebar({ onNewScratch })
    fireEvent.click(container.querySelector('.unified-sidebar__scratch-add')!)
    expect(onNewScratch).toHaveBeenCalled()
  })

  it('draws no repo rail on a scratch row, since it has no repo', () => {
    const { container } = renderSidebar()
    const row = container.querySelector<HTMLElement>('.unified-sidebar__scratch .branch-row')!
    expect(row.style.getPropertyValue('--ws-color')).toBe('')
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

  it('keeps workspace edit and remove reachable under project grouping', () => {
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelectorAll('.repo-header')[0])
    fireEvent.click(screen.getByText('Remove workspace'))
    expect(screen.getByText('Remove workspace "Backend"?')).toBeTruthy()
  })

  it('deletes the workspace once removal is confirmed', () => {
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelectorAll('.repo-header')[0])
    fireEvent.click(screen.getByText('Remove workspace'))
    fireEvent.click(screen.getAllByText('Remove').at(-1)!)
    expect(mockWorkspaceStore.deleteWorkspace).toHaveBeenCalledWith('ws-1')
  })

  it('opens the workspace editor', () => {
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelectorAll('.repo-header')[0])
    fireEvent.click(screen.getByText('Edit workspace'))
    expect(screen.getByTestId('edit-workspace-dialog')).toBeTruthy()
  })

  it('closes the create-project dialog when it asks to close', () => {
    const { container } = renderSidebar()
    fireEvent.click(container.querySelectorAll('.repo-header__action')[0])
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

  it('opens at the default width when nothing is stored', () => {
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
    const targets = container.querySelectorAll('.repo-header')
    fireEvent.dragStart(targets[0])
    fireEvent.drop(targets[1])
    expect(mockWorkspaceStore.reorderWorkspaces).toHaveBeenCalledWith(['ws-2', 'ws-1'])
  })

  it('clears the search from the header control', () => {
    const { container } = renderSidebar()
    fireEvent.change(
      container.querySelector('.sidebar-search input') ?? container.querySelector('input')!,
      { target: { value: 'jobs' } }
    )
    expect(screen.queryByText('main')).toBeNull()
    fireEvent.click(container.querySelector('.sidebar-search__clear')!)
    expect(screen.getByText('main')).toBeTruthy()
  })

  it('closes the create-workspace dialog when it asks to close', () => {
    const { container } = renderSidebar()
    fireEvent.click(container.querySelector('.sidebar-header__add')!)
    fireEvent.click(screen.getByText('close-workspace'))
    expect(screen.queryByTestId('create-workspace-dialog')).toBeNull()
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
    fireEvent.click(screen.getByText('None'))
    const labels = Array.from(container.querySelectorAll('.repo-header__name')).map(
      (el) => el.textContent
    )
    expect(labels).toEqual(['All branches'])
  })

  it('persists a grouping change for that view across a remount', () => {
    // Grouping by branch and by status are retired with the terminal rows
    // (FR-038), and a stored preference naming one now degrades to the view's
    // own default — so persistence is exercised with a grouping that survives.
    const { unmount } = renderSidebar()
    fireEvent.click(screen.getByText('Group: Workspace'))
    fireEvent.click(screen.getByText('None'))
    unmount()
    const { container } = renderSidebar()
    const labels = Array.from(container.querySelectorAll('.repo-header__name')).map(
      (el) => el.textContent
    )
    expect(labels).toEqual(['All branches'])
  })

  it('restores the unfiltered Everything view on mount, never a filtered one (FR-015)', () => {
    const { container, unmount } = renderSidebar()
    fireEvent.click(screen.getByText('Needs me'))
    expect(screen.queryByText('api-shell')).toBeNull()
    unmount()
    renderSidebar()
    expect(screen.getByText('main')).toBeTruthy()
    expect(container.querySelector('.filter-notice')).toBeNull()
  })

  it('explains a filtered list with shown and total counts (FR-016)', () => {
    renderSidebar()
    fireEvent.click(screen.getByText('Needs me'))
    expect(screen.getByText('Filtered · showing 0 of 3')).toBeTruthy()
  })

  it('explains a search-filtered list too', () => {
    const { container } = renderSidebar()
    fireEvent.change(container.querySelector('.sidebar-search input, input')!, {
      target: { value: 'jobs' },
    })
    expect(screen.getByText('Filtered · showing 1 of 3')).toBeTruthy()
  })

  it('shows no notice when nothing is filtered', () => {
    const { container } = renderSidebar()
    expect(container.querySelector('.filter-notice')).toBeNull()
  })

  it('restores every session in one interaction from the notice (SC-007)', () => {
    renderSidebar()
    fireEvent.click(screen.getByText('Needs me'))
    fireEvent.click(screen.getByText('show all'))
    expect(screen.getByText('main')).toBeTruthy()
    expect(screen.queryByText('show all')).toBeNull()
  })

  it('hides the hide-stale toggle on the Stale view (FR-021)', () => {
    renderSidebar()
    expect(screen.getByText('Hide stale')).toBeTruthy()
    fireEvent.click(screen.getByText('Stale'))
    expect(screen.queryByText('Hide stale')).toBeNull()
  })
})

describe('UnifiedSidebar — agent state is derived, not read from a field nobody writes', () => {
  it('treats a session with an unread bell as awaiting input', () => {
    sessions = new Map([['s6', session('s6', 'p1', { tabTitle: 'claude', bellCount: 2 })]])
    mockSessionStore.sessions = sessions
    const { container } = renderSidebar({ initialViewId: 'needs-me' })
    const names = Array.from(container.querySelectorAll('.branch-row__name')).map(
      (n) => n.textContent
    )
    expect(names).toEqual(['main'])
  })

  it('treats a session producing output as working', () => {
    sessions = new Map([['s7', session('s7', 'p1', { tabTitle: 'build', busy: true })]])
    mockSessionStore.sessions = sessions
    const { container } = renderSidebar({ initialViewId: 'active' })
    const names = Array.from(container.querySelectorAll('.branch-row__name')).map(
      (n) => n.textContent
    )
    expect(names).toEqual(['main'])
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
    expect(container.querySelector('.branch-row__gutter svg')!.getAttribute('data-state')).toBe(
      'exited'
    )
  })
})

describe('UnifiedSidebar — the link dialog names what it attaches to (US3, FR-014)', () => {
  it('qualifies the branch with its repo', () => {
    mockIntegrationsStore.linkDialogProjectId = 'p1'
    renderSidebar()
    expect(screen.getByTestId('link-issue-dialog').textContent).toContain('Backend · main')
    mockIntegrationsStore.linkDialogProjectId = null
  })
})

describe('UnifiedSidebar — app surfaces have one home, scratch has a group (US4)', () => {
  it('draws contributed sidebar items in the app band, not a separate footer', () => {
    mockRegistryState.sidebarButtons = [{ id: 'git', label: 'Git Changes', action: vi.fn() }]
    const { container } = renderSidebar()
    expect(container.querySelector('.extension-footer')).toBeNull()
    expect(container.querySelector('.app-band')).toBeTruthy()
    expect(screen.getAllByText('Git Changes')).toHaveLength(1)
    mockRegistryState.sidebarButtons = []
  })

  it('offers a way to start a scratch terminal from that group', () => {
    const onNewScratch = vi.fn()
    const { container } = renderSidebar({ onNewScratch })
    const add = container.querySelector('.unified-sidebar__scratch-add')
    expect(add).toBeTruthy()
    fireEvent.click(add!)
    expect(onNewScratch).toHaveBeenCalledOnce()
  })
})

describe('UnifiedSidebar — issue actions on a branch header', () => {
  // These reach openLinkedIssue and copyIssueKey, which the header context menu
  // and ScopeMenu both call through issueActionsFor. Nothing exercised them
  // before, which is what held the file's function coverage under the 80% gate.
  const link = {
    projectId: 'p1',
    tracker: 'linear' as const,
    key: 'TAV-14',
    injectContext: false,
    linkedAt: '',
  }

  function openBranchMenu(): void {
    const { container } = renderSidebar()
    const rows = Array.from(container.querySelectorAll('.branch-row'))
    fireEvent.contextMenu(
      rows.find((r) => r.querySelector('.branch-row__name')?.textContent === 'main')!
    )
  }

  beforeEach(() => {
    mockIntegrationsStore.linkFor.mockImplementation((id: string) => (id === 'p1' ? link : null))
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { shell: { openExternal: vi.fn() } },
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn() },
    })
  })

  it('opens the linked issue in the tracker', () => {
    mockIntegrationsStore.issueFor.mockReturnValue({ url: 'https://linear.app/x/TAV-14' })
    openBranchMenu()
    fireEvent.click(screen.getByText('Open TAV-14 in tracker'))
    expect(window.electronAPI.shell.openExternal).toHaveBeenCalledWith(
      'https://linear.app/x/TAV-14'
    )
  })

  it('opens nothing when the issue could not be read', () => {
    // The link is stored but the tracker never answered, so there is no url to
    // open. Failing quietly beats opening `undefined` in a browser.
    mockIntegrationsStore.issueFor.mockReturnValue(null)
    openBranchMenu()
    fireEvent.click(screen.getByText('Open TAV-14 in tracker'))
    expect(window.electronAPI.shell.openExternal).not.toHaveBeenCalled()
  })

  it('copies the issue key', () => {
    openBranchMenu()
    fireEvent.click(screen.getByText('Copy issue key'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('TAV-14')
  })

  it('copies nothing when the branch has no link', () => {
    mockIntegrationsStore.linkFor.mockReturnValue(null)
    const { container } = renderSidebar()
    const rows = Array.from(container.querySelectorAll('.branch-row'))
    fireEvent.contextMenu(
      rows.find((r) => r.querySelector('.branch-row__name')?.textContent === 'main')!
    )
    expect(screen.queryByText('Copy issue key')).toBeNull()
  })

  it('reaches the link dialog from "Change linked issue…"', () => {
    openBranchMenu()
    fireEvent.click(screen.getByText('Change linked issue…'))
    expect(mockIntegrationsStore.openLinkDialog).toHaveBeenCalledWith('p1')
  })

  it('unlinks the issue through the store', () => {
    openBranchMenu()
    fireEvent.click(screen.getByText('Unlink TAV-14'))
    expect(mockIntegrationsStore.unlinkIssue).toHaveBeenCalledWith('p1')
  })
})
