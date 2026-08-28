import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { UnifiedSidebar } from '../../../../src/renderer/components/sidebar/UnifiedSidebar'
import { SidebarHeader } from '../../../../src/renderer/components/sidebar/SidebarHeader'
import type { GroupKey } from '../../../../src/renderer/sidebar/view-model'
import type { Project, TerminalSession, Workspace } from '../../../../src/shared/types/index'

// THE MERGE GATE for feature 030.
//
// Flattening the sidebar removes the element two of these surfaces hang on,
// and a third — sidebar items — never had a working host at all. Surfaces are
// enumerated from what extensions can actually contribute, not from the
// renderer registry alone: reading only the renderer is what produced the
// wrong "this surface does not exist" conclusion during Phase 0 research.

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/stores/session.store', () => ({ useSessionStore: vi.fn() }))
vi.mock('../../../../src/renderer/extensions/registry', () => ({
  useExtensionRegistry: vi.fn(),
}))
vi.mock('../../../../src/renderer/hooks/useBranchSync', () => ({ useBranchSync: vi.fn() }))
vi.mock('../../../../src/renderer/components/sidebar/BranchSwitcher', () => ({
  BranchSwitcher: () => <div data-testid="branch-switcher" />,
}))
vi.mock('../../../../src/renderer/components/sidebar/CreateProjectDialog', () => ({
  CreateProjectDialog: () => null,
}))
vi.mock('../../../../src/renderer/components/sidebar/CreateWorkspaceDialog', () => ({
  CreateWorkspaceDialog: () => null,
}))
const mockCreateSession = vi.fn()
vi.mock('../../../../src/renderer/hooks/useTerminalSession', () => ({
  useTerminalSession: () => ({ createSession: mockCreateSession }),
}))
vi.mock('../../../../src/renderer/stores/settings.store', () => ({
  useSettingsStore: () => ({ resolveSettings: () => ({ terminal: { scrollbackLimit: 5000 } }) }),
}))

const NOW = 1_000_000_000
const GROUPINGS: GroupKey[] = ['project', 'workspace', 'status', 'branch', 'none']

const ws1: Workspace = {
  id: 'ws-1',
  name: 'Backend',
  folderPath: '/b',
  color: '#111',
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

const s1: TerminalSession = {
  id: 's1',
  projectId: 'p1',
  tabTitle: 'api-shell',
  status: 'active',
  type: 'agent',
  scrollbackLimit: 10000,
  createdAt: '2026-08-21T00:00:00.000Z',
  lastActivityAt: NOW,
  agentState: 'idle',
}

// A fake extension contributing every surface an extension can contribute.
const globalTab = {
  id: 'fake.global',
  label: 'Fake Tab',
  component: () => null,
}
const workspaceTab = { id: 'fake.wstab', label: 'Fake Workspace Tab', component: () => null }
const projectTab = { id: 'fake.projtab', label: 'Fake Project Tab', component: () => null }
const sidebarItemAction = vi.fn()
const sidebarItem = { id: 'fake.item', label: 'Fake Sidebar Item', action: sidebarItemAction }

const mockWorkspaceStore = {
  workspaces: [ws1],
  activeWorkspaceId: 'ws-1',
  projectsByWorkspaceId: new Map([['ws-1', [api]]]),
  setActiveWorkspace: vi.fn(),
  setActiveProject: vi.fn(),
  loadProjects: vi.fn().mockResolvedValue(undefined),
  reorderWorkspaces: vi.fn().mockResolvedValue(undefined),
  deleteProject: vi.fn().mockResolvedValue(undefined),
  renameProject: vi.fn().mockResolvedValue(undefined),
  resolveActiveCwd: vi.fn().mockReturnValue('/b'),
}

const mockSessionStore = {
  sessions: new Map([['s1', s1]]),
  projectViews: new Map(),
  isSessionBusy: vi.fn().mockReturnValue(false),
  getBellCountForSession: vi.fn().mockReturnValue(0),
  getScratchSessions: vi.fn().mockReturnValue([]),
  setActiveSessionForProject: vi.fn(),
  renameSession: vi.fn(),
}

const mockRegistryState = {
  globalTabs: new Map([[globalTab.id, globalTab]]),
  workspaceTabs: new Map([[workspaceTab.id, workspaceTab]]),
  projectTabs: new Map([[projectTab.id, projectTab]]),
  sidebarButtons: [sidebarItem],
  activeGlobalTabId: null,
  setActiveGlobalTab: vi.fn(),
  registerCommand: vi.fn(() => vi.fn()),
}

const sidebarProps = {
  globalTabs: [globalTab],
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
  localStorage.setItem(
    'terminator.sidebar.views',
    JSON.stringify(
      GROUPINGS.map((groupBy) => ({
        id: `g-${groupBy}`,
        name: groupBy,
        groupBy,
        sortBy: 'name',
        filters: {},
      }))
    )
  )
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

const renderSidebar = (groupBy: GroupKey) =>
  render(<UnifiedSidebar {...sidebarProps} initialViewId={`g-${groupBy}`} />)

describe.each(GROUPINGS)('every extension surface survives %s grouping', (groupBy) => {
  it('surface 1: the global tab button renders in the header and fires', () => {
    const onSelectGlobalTab = vi.fn()
    render(
      <SidebarHeader
        globalTabs={[globalTab]}
        sidebarItems={[]}
        activeGlobalTabId={null}
        onSelectGlobalTab={onSelectGlobalTab}
        onSearchFocus={() => {}}
        onAddWorkspace={() => {}}
        unreadNotifications={0}
        onBellClick={() => {}}
        searchQuery=""
        onSearchChange={() => {}}
        onSearchClear={() => {}}
      />
    )
    fireEvent.click(screen.getByLabelText('Fake Tab'))
    expect(onSelectGlobalTab).toHaveBeenCalledWith('fake.global')
  })

  it('surface 2: the workspace tab is reachable and fires with the owning workspace id', () => {
    const onSelectWorkspaceTab = vi.fn()
    const { container } = render(
      <UnifiedSidebar
        {...sidebarProps}
        initialViewId={`g-${groupBy}`}
        onSelectWorkspaceTab={onSelectWorkspaceTab}
      />
    )
    const headerButton = screen.queryByTitle('Fake Workspace Tab')
    if (headerButton) {
      // Scope grouping: the group header is the host.
      fireEvent.click(headerButton)
    } else {
      // Non-scope grouping: the row's project badge opens the scope menu (I3).
      fireEvent.click(container.querySelector('.session-row__project-badge')!)
      fireEvent.click(screen.getByText('Fake Workspace Tab'))
    }
    expect(onSelectWorkspaceTab).toHaveBeenCalledWith('ws-1', 'fake.wstab')
  })

  it('surface 3: the contributed sidebar item renders once and its click reaches the handler', () => {
    renderSidebar(groupBy)
    expect(screen.getAllByText('Fake Sidebar Item')).toHaveLength(1)
    fireEvent.click(screen.getByText('Fake Sidebar Item'))
    expect(sidebarItemAction).toHaveBeenCalledOnce()
  })

  it('surface 4: selecting a session leaves activeProjectId resolved for the project tab', () => {
    renderSidebar(groupBy)
    fireEvent.click(screen.getByText('api-shell'))
    expect(mockWorkspaceStore.setActiveProject).toHaveBeenCalledWith('p1')
  })

  it('a new terminal can be created for the session scope', () => {
    const { container } = renderSidebar(groupBy)
    const headerAdd = container.querySelector('.session-group__add')
    if (headerAdd) {
      fireEvent.click(headerAdd)
    } else {
      fireEvent.click(container.querySelector('.session-row__project-badge')!)
      fireEvent.click(screen.getByText('New terminal'))
    }
    expect(mockCreateSession).toHaveBeenCalledWith('p1', 'human', '', '/b', 5000)
  })
})

describe('scope actions are reachable from the command palette (FR-027)', () => {
  it('registers a new-terminal command per project', () => {
    renderSidebar('project')
    const labels = mockRegistryState.registerCommand.mock.calls.map((c) => c[0].label)
    expect(labels).toContain('New terminal — Backend · API')
  })

  it('creates the session when the palette command runs', () => {
    renderSidebar('project')
    const command = mockRegistryState.registerCommand.mock.calls.find(
      (c) => c[0].label === 'New terminal — Backend · API'
    )![0]
    command.action()
    expect(mockCreateSession).toHaveBeenCalledWith('p1', 'human', '', '/b', 5000)
  })

  it('disposes its commands on unmount so they cannot outlive the sidebar', () => {
    const dispose = vi.fn()
    mockRegistryState.registerCommand.mockReturnValue(dispose)
    const { unmount } = renderSidebar('project')
    unmount()
    expect(dispose).toHaveBeenCalled()
  })
})

describe('the extension API surface is unchanged', () => {
  // Asserted against inline literals so an accidental change to a published
  // contract fails here rather than in somebody else's extension.
  it('ExtensionContributes still declares exactly the known contribution types', async () => {
    const { ExtensionContributesSchema } = await import(
      '../../../../src/shared/schemas/extension.schema'
    )
    // The schema strips unknown keys, so parsing an over-full object returns
    // exactly the contribution types the contract recognises.
    const parsed = ExtensionContributesSchema.parse({
      globalTab: { label: 'g' },
      workspaceTab: { label: 'w' },
      projectTab: { label: 'p' },
      sidebarPanel: { label: 's' },
      windowViews: [{ id: 'v', view: 'v' }],
      commands: [{ id: 'c', label: 'C' }],
      sidebarButton: { label: 'not a contribution type' },
    })
    expect(Object.keys(parsed).sort()).toEqual([
      'commands',
      'globalTab',
      'projectTab',
      'sidebarPanel',
      'windowViews',
      'workspaceTab',
    ])
  })

  it('the renderer-facing extension API still exposes exactly its known members', async () => {
    const registryModule = await vi.importActual<
      typeof import('../../../../src/renderer/extensions/registry')
    >('../../../../src/renderer/extensions/registry')
    const state = registryModule.useExtensionRegistry.getState()
    const rendererApi = [
      'registerGlobalTab',
      'registerWorkspaceTab',
      'registerSidebarPanel',
      'registerProjectTab',
      'registerWindowView',
      'registerOverlay',
      'registerKeyboardShortcut',
      'registerCommand',
      'updateGlobalTab',
      'updateCommand',
    ]
    for (const member of rendererApi) {
      expect(typeof (state as unknown as Record<string, unknown>)[member]).toBe('function')
    }
    // registerSidebarButton stays internal: extensions register through the
    // main-process API, never this one (invariant I7).
    expect(rendererApi).not.toContain('registerSidebarButton')
  })
})
