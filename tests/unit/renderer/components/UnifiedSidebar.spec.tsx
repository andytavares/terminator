import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'
import { UnifiedSidebar } from '../../../../src/renderer/components/sidebar/UnifiedSidebar'
import { useToastStore } from '../../../../src/renderer/stores/toast.store'
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

const mockCreateSession = vi.fn().mockResolvedValue('ses-1')
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
  // A worktree has a directory of its own; the fixture claimed to be one
  // without saying where, which nothing read until now.
  worktreePath: '/wt/jobs',
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
  reorderProjects: vi.fn().mockResolvedValue(undefined),
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
    expect(screen.getAllByRole('button', { name: 'Git Changes' })).toHaveLength(1)
  })

  it('fires the item action on click', () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Git Changes' }))
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
      expect(screen.getAllByRole('button', { name: 'Git Changes' })).toHaveLength(1)
    }
  )

  it('renders no footer when no extension contributes an item', () => {
    mockRegistryState.sidebarButtons = []
    const { container } = renderSidebar()
    expect(container.querySelector('.extension-footer')).toBeNull()
  })
})

describe('UnifiedSidebar — two menus replace four bands of chrome (US5)', () => {
  const openDisplay = () => fireEvent.click(screen.getByRole('button', { name: 'Display' }))
  const openFilter = () => fireEvent.click(screen.getByRole('button', { name: /^Filter/ }))

  it('switches grouping from the Display menu', () => {
    const { container } = renderSidebar()
    openDisplay()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'None' }))
    const labels = Array.from(container.querySelectorAll('.repo-header__name')).map(
      (el) => el.textContent
    )
    expect(labels).toEqual(['All branches'])
  })

  it('persists a grouping change for that view across a remount', () => {
    const { unmount } = renderSidebar()
    openDisplay()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'None' }))
    unmount()
    const { container } = renderSidebar()
    const labels = Array.from(container.querySelectorAll('.repo-header__name')).map(
      (el) => el.textContent
    )
    expect(labels).toEqual(['All branches'])
  })

  it('switches sort from the Display menu', () => {
    renderSidebar()
    openDisplay()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Name' }))
    openDisplay()
    expect(screen.getByRole('menuitemradio', { name: 'Name' }).getAttribute('aria-checked')).toBe(
      'true'
    )
  })

  it('offers every grouping and sort from the one menu (FR-034)', () => {
    renderSidebar()
    openDisplay()
    for (const label of ['Workspace', 'None', 'Recent', 'Oldest', 'Name', 'Status', 'Manual']) {
      expect(screen.getByRole('menuitemradio', { name: label })).toBeTruthy()
    }
  })

  it('offers every saved view and the stale toggle from the other (FR-034)', () => {
    renderSidebar()
    openFilter()
    for (const label of ['Everything', 'Needs me', 'Active', 'Stale']) {
      expect(screen.getByRole('menuitemradio', { name: new RegExp(label) })).toBeTruthy()
    }
    expect(screen.getByRole('menuitemcheckbox', { name: /Hide stale/ })).toBeTruthy()
  })

  it('restores the unfiltered Everything view on mount, never a filtered one (FR-015)', () => {
    const { unmount } = renderSidebar()
    openFilter()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Needs me/ }))
    expect(screen.queryByText('main')).toBeNull()
    unmount()
    renderSidebar()
    expect(screen.getByText('main')).toBeTruthy()
  })

  // FR-035. The notice band is gone: the count sits on the control that caused
  // the filtering, which is also where the way out is.
  it('counts what a filter is hiding on the Filter control', () => {
    const { container } = renderSidebar()
    openFilter()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Needs me/ }))
    expect(container.querySelector('.sidebar-menu__badge')!.textContent).toBe('3')
  })

  it('counts what a search is hiding too', () => {
    const { container } = renderSidebar()
    fireEvent.change(container.querySelector('.sidebar-search input, input')!, {
      target: { value: 'jobs' },
    })
    expect(container.querySelector('.sidebar-menu__badge')!.textContent).toBe('2')
  })

  it('draws no notice band at all', () => {
    const { container } = renderSidebar()
    openFilter()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Needs me/ }))
    expect(container.querySelector('.filter-notice')).toBeNull()
    expect(container.querySelector('.view-bar')).toBeNull()
  })

  it('shows no badge when nothing is hidden', () => {
    const { container } = renderSidebar()
    expect(container.querySelector('.sidebar-menu__badge')).toBeNull()
  })

  it('restores every branch in one interaction from the same control (SC-007)', () => {
    const { container } = renderSidebar()
    openFilter()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Needs me/ }))
    openFilter()
    fireEvent.click(screen.getByRole('menuitem', { name: /show all/ }))
    expect(screen.getByText('main')).toBeTruthy()
    expect(container.querySelector('.sidebar-menu__badge')).toBeNull()
  })

  it('disables the hide-stale toggle on the Stale view (FR-021)', () => {
    renderSidebar()
    openFilter()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Stale/ }))
    openFilter()
    expect(
      (screen.getByRole('menuitemcheckbox', { name: /Hide stale/ }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('keeps at most two bands of chrome above the first row of work (FR-033)', () => {
    const { container } = renderSidebar()
    const header = container.querySelector('.sidebar-header')!
    expect(header.children).toHaveLength(2)
    expect(container.querySelector('.app-band')).toBeTruthy()
    expect(container.querySelector('.sidebar-header__search-row')).toBeTruthy()
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
    expect(screen.getAllByRole('button', { name: 'Git Changes' })).toHaveLength(1)
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

describe('UnifiedSidebar — opening a branch in the editor', () => {
  const openEditor = vi.fn()

  beforeEach(() => {
    openEditor.mockClear()
    // The real channel always answers with a promise. A bare `vi.fn()` returns
    // undefined, which is not the contract — and it is what let a `.then` on
    // undefined reach CI as an unhandled error while every test still passed.
    openEditor.mockResolvedValue({ ok: true, editor: 'Cursor' })
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        app: { getInfo: vi.fn().mockResolvedValue({ homeDir: '/Users/me' }) },
        editor: {
          detect: vi.fn().mockResolvedValue({ editor: { id: 'cursor', name: 'Cursor' } }),
          open: openEditor,
        },
        shell: { openExternal: vi.fn() },
      },
    })
  })

  const openRowMenu = (container: HTMLElement, name: string) => {
    const row = Array.from(container.querySelectorAll('.branch-row')).find(
      (r) => r.querySelector('.branch-row__name')?.textContent === name
    )!
    fireEvent.contextMenu(row)
  }

  it("opens a branch's own working copy when it has one", async () => {
    // `jobs` is a worktree, so its own directory is the one to open.
    const { container } = renderSidebar()
    await act(async () => {})
    openRowMenu(container, 'Jobs')
    fireEvent.click(screen.getByText(/Open in/))
    expect(openEditor).toHaveBeenCalledWith('/wt/jobs')
  })

  it('falls back to the repo folder for a plain checkout', async () => {
    const { container } = renderSidebar()
    await act(async () => {})
    openRowMenu(container, 'main')
    fireEvent.click(screen.getByText(/Open in/))
    expect(openEditor).toHaveBeenCalledWith('/b')
  })

  it('opens the repo folder from the repo header', async () => {
    const { container } = renderSidebar()
    await act(async () => {})
    fireEvent.contextMenu(container.querySelector('.repo-header')!)
    fireEvent.click(screen.getByText(/Open in/))
    expect(openEditor).toHaveBeenCalledWith('/b')
  })

  it('names the detected editor in the menu', async () => {
    const { container } = renderSidebar()
    await act(async () => {})
    openRowMenu(container, 'main')
    expect(screen.getByText('Open in Cursor')).toBeTruthy()
  })
})

describe('UnifiedSidebar — opening in the editor reports back', () => {
  // The first version discarded the result, so a failure looked exactly like
  // the action not being wired up: nothing at all on screen.
  const addToast = vi.fn()
  const openEditor = vi.fn()

  beforeEach(() => {
    addToast.mockClear()
    openEditor.mockClear()
    useToastStore.setState({ addToast } as never)
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        app: { getInfo: vi.fn().mockResolvedValue({ homeDir: '/Users/me' }) },
        editor: { detect: vi.fn().mockResolvedValue({ editor: null }), open: openEditor },
        shell: { openExternal: vi.fn() },
      },
    })
  })

  const openMenuAndClick = async (container: HTMLElement) => {
    await act(async () => {})
    fireEvent.contextMenu(container.querySelector('.branch-row')!)
    fireEvent.click(screen.getByText(/Open in/))
    await act(async () => {})
  }

  it('says nothing when it worked', async () => {
    openEditor.mockResolvedValue({ ok: true, editor: 'Cursor' })
    const { container } = renderSidebar()
    await openMenuAndClick(container)
    expect(addToast).not.toHaveBeenCalled()
  })

  it.each([
    ['FOLDER_NOT_FOUND', /no longer on disk/i],
    ['NO_EDITOR_FOUND', /no supported editor/i],
    ['VALIDATION_ERROR', /could not be opened/i],
  ])('explains %s in the user own terms', async (error, expected) => {
    openEditor.mockResolvedValue({ error })
    const { container } = renderSidebar()
    await openMenuAndClick(container)
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: expect.stringMatching(expected) })
    )
  })

  it('passes an unrecognised failure through rather than swallowing it', async () => {
    openEditor.mockResolvedValue({ error: 'EACCES' })
    const { container } = renderSidebar()
    await openMenuAndClick(container)
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('EACCES') })
    )
  })

  it('survives the call rejecting outright', async () => {
    openEditor.mockRejectedValue(new Error('bridge gone'))
    const { container } = renderSidebar()
    await openMenuAndClick(container)
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/could not open/i) })
    )
  })
})

describe('UnifiedSidebar — where there is no editor API at all', () => {
  // The browser remote omits the editor channels entirely. Optional chaining
  // stops at the call, so a bare `.then` on the undefined it returns throws —
  // which is what CI caught and the local suite did not, because every local
  // mock happened to supply `open`.
  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        app: { getInfo: vi.fn().mockResolvedValue({ homeDir: '/Users/me' }) },
        shell: { openExternal: vi.fn() },
      },
    })
  })

  it('renders without an editor API present', async () => {
    expect(() => renderSidebar()).not.toThrow()
    await act(async () => {})
  })

  it('does not throw when the action is invoked anyway', async () => {
    const { container } = renderSidebar()
    await act(async () => {})
    fireEvent.contextMenu(container.querySelector('.branch-row')!)
    expect(() => fireEvent.click(screen.getByText(/Open in/))).not.toThrow()
  })
})

describe('UnifiedSidebar — a drag is the manual order (Display → Manual)', () => {
  const openDisplay = () => fireEvent.click(screen.getByRole('button', { name: 'Display' }))
  const pickSort = (label: string) => {
    openDisplay()
    fireEvent.click(screen.getByRole('menuitemradio', { name: label }))
  }
  const checkedSort = () => {
    openDisplay()
    return ['Recent', 'Oldest', 'Name', 'Status', 'Manual'].find(
      (label) =>
        screen.getByRole('menuitemradio', { name: label }).getAttribute('aria-checked') === 'true'
    )
  }
  const repoNames = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('.repo-header__name')).map((el) => el.textContent)

  // The store's order and the drawn order are two different things the moment a
  // computed sort is on. A drop has to move the row the user actually dragged,
  // so the indices it works in are the drawn ones.
  it('reorders by what is on screen, not by the stored order', () => {
    mockWorkspaceStore.workspaces = [ws2, ws1]
    const { container } = renderSidebar()
    pickSort('Name')
    expect(repoNames(container)).toEqual(['Backend', 'Frontend'])

    const headers = container.querySelectorAll('.repo-header')
    fireEvent.dragStart(headers[0])
    fireEvent.drop(headers[1])

    expect(mockWorkspaceStore.reorderWorkspaces).toHaveBeenCalledWith(['ws-2', 'ws-1'])
    mockWorkspaceStore.workspaces = [ws1, ws2]
  })

  // Dropping under a computed sort used to write an order nothing would ever
  // draw. The drag is the user saying "this is my order", so it says so.
  it('switches the view to Manual so the drop is visible', () => {
    const { container } = renderSidebar()
    pickSort('Name')
    const headers = container.querySelectorAll('.repo-header')
    fireEvent.dragStart(headers[0])
    fireEvent.drop(headers[1])
    expect(checkedSort()).toBe('Manual')
  })

  it('reorders the branches inside one repo on drop', () => {
    const { container } = renderSidebar()
    const rows = container.querySelectorAll('.branch-row')
    fireEvent.dragStart(rows[0])
    fireEvent.drop(rows[1])
    expect(mockWorkspaceStore.reorderProjects).toHaveBeenCalledWith('ws-1', ['p2', 'p1'])
  })

  it('switches the view to Manual when a branch is dropped', () => {
    const { container } = renderSidebar()
    pickSort('Name')
    const rows = container.querySelectorAll('.branch-row')
    fireEvent.dragStart(rows[0])
    fireEvent.drop(rows[1])
    expect(checkedSort()).toBe('Manual')
  })

  // Branches from every repo share one list under "no grouping", and the stores
  // have nowhere to write an order that crosses repos.
  it('does not offer a branch drag when grouping is off', () => {
    const { container } = renderSidebar()
    openDisplay()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'None' }))
    const rows = container.querySelectorAll('.branch-row')
    fireEvent.dragStart(rows[0])
    fireEvent.drop(rows[1])
    expect(mockWorkspaceStore.reorderProjects).not.toHaveBeenCalled()
  })

  it('sorts a repo with no branches among the rest', () => {
    const ws3: Workspace = { ...ws1, id: 'ws-3', name: 'Aardvark' }
    mockWorkspaceStore.workspaces = [ws1, ws2, ws3]
    const { container } = renderSidebar()
    pickSort('Name')
    expect(repoNames(container)).toEqual(['Aardvark', 'Backend', 'Frontend'])
    mockWorkspaceStore.workspaces = [ws1, ws2]
  })
})
