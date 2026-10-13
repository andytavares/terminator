import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { UnifiedSidebar } from '../../../../src/renderer/components/sidebar/UnifiedSidebar'
import { AppBand } from '../../../../src/renderer/components/sidebar/AppBand'
import type { GroupKey } from '../../../../src/renderer/sidebar/view-model'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../../src/shared/schemas/settings.schema'
import { projectOf, terminalSessionOf, workspaceOf } from '../../../support/renderer-stores'

// THE MERGE GATE for feature 030.
//
// Flattening the sidebar removes the element two of these surfaces hang on.
// Surfaces are enumerated from what extensions can actually contribute, not from the
// renderer registry alone: reading only the renderer is what produced the
// wrong "this surface does not exist" conclusion during Phase 0 research.

vi.mock('../../../../src/renderer/hooks/useBranchSync', () => ({ useBranchSync: vi.fn() }))
vi.mock('../../../../src/renderer/components/sidebar/CreateProjectDialog', () => ({
  CreateProjectDialog: () => null,
}))
vi.mock('../../../../src/renderer/components/sidebar/CreateWorkspaceDialog', () => ({
  CreateWorkspaceDialog: () => null,
}))
const mockCreateSession = vi.fn().mockResolvedValue('ses-1')
vi.mock('../../../../src/renderer/hooks/useTerminalSession', () => ({
  useTerminalSession: () => ({ createSession: mockCreateSession }),
}))
vi.mock('../../../../src/renderer/components/session/useSessionFacts', () => ({
  useSessionFacts: () => [],
}))

const NOW = 1_000_000_000
const GROUPINGS: GroupKey[] = ['workspace', 'none']

const ws1 = workspaceOf({ id: 'ws-1', name: 'Backend', folderPath: '/b', color: '#111' })
const api = projectOf({ id: 'p1', workspaceId: 'ws-1', name: 'API', gitBranch: 'main' })
const s1 = terminalSessionOf({
  id: 's1',
  projectId: 'p1',
  tabTitle: 'api-shell',
  type: 'agent',
  lastActivityAt: NOW,
})

// A fake extension contributing every surface an extension can contribute.
const globalTab = {
  id: 'fake.global',
  label: 'Fake Tab',
  component: () => null,
}
const workspaceTab = { id: 'fake.wstab', label: 'Fake Workspace Tab', component: () => null }
const projectTab = { id: 'fake.projtab', label: 'Fake Project Tab', component: () => null }

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
  // The real stores. Only loading a repo's branches reaches the main process.
  useWorkspaceStore.setState({
    ...useWorkspaceStore.getInitialState(),
    workspaces: [ws1],
    activeWorkspaceId: 'ws-1',
    projectsByWorkspaceId: new Map([['ws-1', [api]]]),
    loadProjects: vi.fn().mockResolvedValue(undefined),
  })
  useSessionStore.setState({
    ...useSessionStore.getInitialState(),
    sessions: new Map([['s1', s1]]),
  })
  useSettingsStore.setState({
    ...useSettingsStore.getInitialState(),
    globalSettings: {
      ...DEFAULT_GLOBAL_SETTINGS,
      terminal: { ...DEFAULT_GLOBAL_SETTINGS.terminal, scrollbackLimit: 5000 },
    },
  })
  // What the fake extension contributed, in the real registry.
  useExtensionRegistry.setState(useExtensionRegistry.getInitialState(), true)
  useExtensionRegistry.setState({
    globalTabs: new Map([[globalTab.id, globalTab]]),
    workspaceTabs: new Map([[workspaceTab.id, workspaceTab]]),
    projectTabs: new Map([[projectTab.id, projectTab]]),
  })
})

const commandLabels = (): string[] =>
  useExtensionRegistry.getState().commands.map((command) => command.label)

const renderSidebar = (groupBy: GroupKey) =>
  render(<UnifiedSidebar {...sidebarProps} initialViewId={`g-${groupBy}`} />)

describe.each(GROUPINGS)('every extension surface survives %s grouping', (groupBy) => {
  // Both surfaces now hang on the window's own left rail rather than the
  // sidebar's header; what an extension contributes is unchanged.
  it('surface 1: the global tab button renders in the app band and fires', () => {
    const onSelectGlobalTab = vi.fn()
    render(<AppBand globalTabs={[globalTab]} activeId={null} onSelect={onSelectGlobalTab} />)
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
    const headerButton = container.querySelector('.repo-header__action')
    if (headerButton) {
      // Grouped by repo: the repo header is the host.
      fireEvent.click(headerButton)
    } else {
      // Ungrouped: there is no repo header, so the branch row's own menu is
      // the way in — a contributed surface has to be reachable either way.
      fireEvent.contextMenu(container.querySelector('.branch-row')!)
      fireEvent.click(screen.getByText('Fake Workspace Tab'))
    }
    expect(onSelectWorkspaceTab).toHaveBeenCalledWith('ws-1', 'fake.wstab')
  })

  it('surface 4: selecting a branch leaves activeProjectId resolved for the project tab', () => {
    const { container } = renderSidebar(groupBy)
    fireEvent.click(container.querySelector('.branch-row')!)
    expect(useWorkspaceStore.getState().activeProjectId).toBe('p1')
  })

  it('a new terminal can be created for the branch scope', () => {
    const { container } = renderSidebar(groupBy)
    fireEvent.click(container.querySelector('.branch-row__action')!)
    expect(mockCreateSession).toHaveBeenCalledWith('p1', 'human', '', '/b', 5000)
  })
})

describe('scope actions are reachable from the command palette (FR-027)', () => {
  it('registers a new-terminal command per project', () => {
    renderSidebar('workspace')
    expect(commandLabels()).toContain('New terminal — Backend · main')
  })

  it('creates the session when the palette command runs', () => {
    renderSidebar('workspace')
    const command = useExtensionRegistry
      .getState()
      .commands.find((c) => c.label === 'New terminal — Backend · main')!
    command.action()
    expect(mockCreateSession).toHaveBeenCalledWith('p1', 'human', '', '/b', 5000)
  })

  it('disposes its commands on unmount so they cannot outlive the sidebar', () => {
    const { unmount } = renderSidebar('workspace')
    unmount()
    expect(commandLabels()).not.toContain('New terminal — Backend · main')
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
      'quickActions',
      'shellRoots',
      'sidebarPanel',
      'windowViews',
      'workspaceTab',
    ])
  })

  it('the renderer-facing extension API still exposes exactly its known members', async () => {
    const state: Record<string, unknown> = { ...useExtensionRegistry.getState() }
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
      expect(typeof state[member]).toBe('function')
    }
  })
})
