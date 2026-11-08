import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWorkspaceStore } from '../../../../src/stores/workspace.store'
import { useSessionStore } from '../../../../src/stores/session.store'
import { useExtensionRegistry } from '../../../../src/extensions/registry'
import { UnifiedSidebar } from '../../../../src/components/sidebar/UnifiedSidebar'
import type { GroupKey } from '../../../../src/sidebar/view-model'
import { useSettingsStore } from '../../../../src/stores/settings.store'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../../../core-shared/src/schemas/settings.schema'
import {
  projectFixture,
  terminalSessionOf,
  workspaceFixture,
} from '../../../../../test-support/src/renderer-stores'

// THE MERGE GATE for feature 030.
//
// Flattening the sidebar removes the element two of these surfaces hang on.
// Surfaces are enumerated from what extensions can actually contribute, not from the
// renderer registry alone: reading only the renderer is what produced the
// wrong "this surface does not exist" conclusion during Phase 0 research.

vi.mock('../../../../src/hooks/useBranchSync', () => ({ useBranchSync: vi.fn() }))
vi.mock('../../../../src/components/sidebar/CreateProjectDialog', () => ({
  CreateProjectDialog: () => null,
}))
vi.mock('../../../../src/components/sidebar/CreateWorkspaceDialog', () => ({
  CreateWorkspaceDialog: () => null,
}))
const mockCreateSession = vi.fn()
vi.mock('../../../../src/hooks/useTerminalSession', () => ({
  useTerminalSession: () => ({ createSession: mockCreateSession }),
}))
vi.mock('../../../../src/components/session/useSessionFacts', () => ({
  useSessionFacts: () => [],
}))

const NOW = 1_000_000_000
const GROUPINGS: GroupKey[] = ['workspace', 'none']

const ws1 = workspaceFixture({ id: 'ws-1', name: 'Backend', folderPath: '/b', color: '#111' })
const api = projectFixture({ id: 'p1', workspaceId: 'ws-1', name: 'API', gitBranch: 'main' })
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

/** The grouping the user saved for the view the sidebar opens on, so each test can open it under any grouping. */
function saveOpeningViewGrouping(groupBy: GroupKey): void {
  localStorage.setItem(
    'terminator.sidebar.views',
    JSON.stringify({ overrides: { everything: { groupBy, sortBy: 'name' } } })
  )
}

/** The real stores, holding one repo with one branch and its terminal. */
function seedStores(): void {
  // Only loading a repo's branches reaches the main process.
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
}

/** What the fake extension contributed, in the real registry. */
function seedRegistry(): void {
  useExtensionRegistry.setState(useExtensionRegistry.getInitialState(), true)
  useExtensionRegistry.setState({
    globalTabs: new Map([[globalTab.id, globalTab]]),
    workspaceTabs: new Map([[workspaceTab.id, workspaceTab]]),
    projectTabs: new Map([[projectTab.id, projectTab]]),
  })
}

beforeEach(() => {
  mockCreateSession.mockResolvedValue('ses-1')
  localStorage.clear()
  seedStores()
  seedRegistry()
})

const commandLabels = (): string[] =>
  useExtensionRegistry.getState().commands.map((command) => command.label)

/** The first branch row: a button named "<branch> — <state>". */
const branchRow = () => screen.getAllByRole('button', { name: / — / })[0]

const renderSidebar = (groupBy: GroupKey) => {
  saveOpeningViewGrouping(groupBy)
  return render(<UnifiedSidebar {...sidebarProps} />)
}

const renderWithWorkspaceTab = (groupBy: GroupKey, onSelectWorkspaceTab: () => void) => {
  saveOpeningViewGrouping(groupBy)
  return render(<UnifiedSidebar {...sidebarProps} onSelectWorkspaceTab={onSelectWorkspaceTab} />)
}

describe('surface 2: the workspace tab is reachable and fires with the owning workspace id', () => {
  it('opens from the repo header when grouped by workspace', async () => {
    const user = userEvent.setup()
    const onSelectWorkspaceTab = vi.fn()
    renderWithWorkspaceTab('workspace', onSelectWorkspaceTab)
    await user.click(screen.getByRole('button', { name: 'Fake Workspace Tab' }))
    expect(onSelectWorkspaceTab).toHaveBeenCalledWith('ws-1', 'fake.wstab')
  })

  it('opens from the branch row menu when ungrouped, as there is no repo header', async () => {
    const user = userEvent.setup()
    const onSelectWorkspaceTab = vi.fn()
    renderWithWorkspaceTab('none', onSelectWorkspaceTab)
    expect(screen.queryByRole('button', { name: 'Fake Workspace Tab' })).toBeNull()
    fireEvent.contextMenu(branchRow())
    await user.click(screen.getByText('Fake Workspace Tab'))
    expect(onSelectWorkspaceTab).toHaveBeenCalledWith('ws-1', 'fake.wstab')
  })
})

describe.each(GROUPINGS)('the branch scope survives %s grouping', (groupBy) => {
  it('surface 4: selecting a branch leaves activeProjectId resolved for the project tab', async () => {
    const user = userEvent.setup()
    renderSidebar(groupBy)
    await user.click(branchRow())
    expect(useWorkspaceStore.getState().activeProjectId).toBe('p1')
  })

  it('a new terminal can be created for the branch scope', async () => {
    const user = userEvent.setup()
    renderSidebar(groupBy)
    await user.click(screen.getAllByRole('button', { name: /^New terminal in / })[0])
    expect(mockCreateSession).toHaveBeenCalledWith({
      projectId: 'p1',
      type: 'human',
      title: '',
      cwd: '/b',
      scrollbackLimit: 5000,
    })
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
    expect(mockCreateSession).toHaveBeenCalledWith({
      projectId: 'p1',
      type: 'human',
      title: '',
      cwd: '/b',
      scrollbackLimit: 5000,
    })
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
    const { ExtensionContributesSchema } =
      await import('../../../../../core-shared/src/schemas/extension.schema')
    // The schema strips unknown keys, so parsing an over-full object returns
    // exactly the contribution types the contract recognises.
    const parsed = ExtensionContributesSchema.parse({
      globalTab: { label: 'g' },
      workspaceTab: { label: 'w' },
      projectTab: { label: 'p' },
      sidebarPanel: { label: 's' },
      insightsSection: { label: 'h' },
      windowViews: [{ id: 'v', view: 'v' }],
      commands: [{ id: 'c', label: 'C' }],
      sidebarButton: { label: 'not a contribution type' },
    })
    expect(Object.keys(parsed).sort()).toEqual([
      'commands',
      'globalTab',
      'insightsSection',
      'projectTab',
      'quickActions',
      'shellRoots',
      'sidebarPanel',
      'startWorkOptions',
      'usage',
      'windowViews',
      'workspaceTab',
    ])
  })
})
