import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'
import { useSessionRecordsStore } from '../../../../src/renderer/stores/session-records.store'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { UnifiedSidebar } from '../../../../src/renderer/components/sidebar/UnifiedSidebar'
import { useToastStore } from '../../../../src/renderer/stores/toast.store'
import { useChangeStatsStore } from '../../../../src/renderer/stores/change-stats.store'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../../src/shared/schemas/settings.schema'
import type { SessionFacts } from '../../../../src/renderer/sidebar/session-facts'
import type { Project, TerminalSession, Workspace } from '../../../../src/shared/types/index'
import { fact } from '../sidebar/fixtures/facts'
import { partialFake } from '../../../support/fakes'
import {
  issueFixture,
  projectFixture,
  sessionRecordOf,
  terminalSessionOf,
  workspaceFixture,
} from '../../../support/renderer-stores'

vi.mock('../../../../src/renderer/hooks/useBranchSync', () => ({ useBranchSync: vi.fn() }))
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
vi.mock('../../../../src/renderer/components/integrations/IssueDrawer', () => ({
  IssueDrawer: ({ projectName, onClose }: { projectName: string; onClose: () => void }) => (
    <div data-testid="issue-drawer">
      {projectName}
      <button onClick={onClose}>close-drawer</button>
    </div>
  ),
}))
const mockUseSessionFacts = vi.fn((): SessionFacts[] => [])
vi.mock('../../../../src/renderer/components/session/useSessionFacts', () => ({
  useSessionFacts: () => mockUseSessionFacts(),
}))
vi.mock('../../../../src/renderer/components/session/SessionLinkDialog', () => ({
  SessionLinkDialog: ({
    facts,
    onClose,
  }: {
    facts: { name: string; snapshot: unknown }
    onClose: () => void
  }) => (
    <div data-testid="session-link-dialog">
      {facts.name}
      <button onClick={onClose}>close-session-link</button>
    </div>
  ),
}))

const mockCreateSession = vi.fn().mockResolvedValue('ses-1')
vi.mock('../../../../src/renderer/hooks/useTerminalSession', () => ({
  useTerminalSession: () => ({ createSession: mockCreateSession }),
}))
const staleAfterMs = DEFAULT_GLOBAL_SETTINGS.sidebar.staleAfterMs

const NOW = 1_000_000_000

const ws1 = workspaceFixture({ id: 'ws-1', name: 'Backend', folderPath: '/b', color: '#5c6bc0' })
const ws2 = workspaceFixture({ id: 'ws-2', name: 'Frontend', folderPath: '/f', color: '#26a69a' })

const api = projectFixture({ id: 'p1', workspaceId: 'ws-1', name: 'API', gitBranch: 'main' })
// A worktree has a directory of its own; the fixture claimed to be one
// without saying where, which nothing read until now.
const jobs = projectFixture({
  id: 'p2',
  workspaceId: 'ws-1',
  name: 'Jobs',
  isWorktree: true,
  worktreePath: '/wt/jobs',
})
const web = projectFixture({ id: 'p3', workspaceId: 'ws-2', name: 'Web' })

const projectsOf = (): Map<string, Project[]> =>
  new Map([
    ['ws-1', [api, jobs]],
    ['ws-2', [web]],
  ])

function sidebarSession(
  id: string,
  projectId: string,
  patch: Partial<TerminalSession> = {}
): TerminalSession {
  return terminalSessionOf({
    id,
    projectId,
    type: 'agent',
    createdAt: '2026-08-21T00:00:00.000Z',
    lastActivityAt: NOW,
    ...patch,
  })
}

let sessions: Map<string, TerminalSession>

/** The main process's side of the workspace and project calls the real store makes. */
const projectApi = {
  list: vi.fn(async (workspaceId: string) => ({ projects: projectsOf().get(workspaceId) ?? [] })),
  delete: vi.fn(async () => ({ ok: true })),
  rename: vi.fn(async (id: string, name: string) => ({
    project: { ...[api, jobs, web].find((p) => p.id === id)!, name },
  })),
  reorder: vi.fn(async () => ({ ok: true })),
}
const workspaceApi = {
  delete: vi.fn(async () => ({ ok: true })),
  reorder: vi.fn(async () => ({ ok: true })),
}
const sessionRecordsApi = {
  setLink: vi.fn<Window['electronAPI']['sessionRecords']['setLink']>(async ({ session, link }) => ({
    data: sessionRecordOf(session, { link }),
  })),
}

function setWorkspaces(workspaces: Workspace[], projectsByWorkspaceId = projectsOf()): void {
  useWorkspaceStore.setState({ workspaces, projectsByWorkspaceId })
}

const setSessions = (next: Map<string, TerminalSession>): void =>
  useSessionStore.setState({ sessions: next })

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
  mockUseSessionFacts.mockReturnValue([])
  vi.stubGlobal('electronAPI', {
    project: projectApi,
    workspace: workspaceApi,
    sessionRecords: sessionRecordsApi,
  })
  sessions = new Map([
    ['s1', sidebarSession('s1', 'p1', { tabTitle: 'api-shell' })],
    ['s2', sidebarSession('s2', 'p1', { tabTitle: 'api-agent', lastActivityAt: NOW - 300_000 })],
    ['s3', sidebarSession('s3', 'p2', { tabTitle: 'jobs-run' })],
    ['s4', sidebarSession('s4', 'p3', { tabTitle: 'web-dev' })],
  ])
  useWorkspaceStore.setState({
    ...useWorkspaceStore.getInitialState(),
    workspaces: [ws1, ws2],
    activeWorkspaceId: 'ws-1',
    projectsByWorkspaceId: projectsOf(),
  })
  useSessionStore.setState({ ...useSessionStore.getInitialState(), sessions })
  useExtensionRegistry.setState(useExtensionRegistry.getInitialState(), true)
  useIntegrationsStore.setState(useIntegrationsStore.getInitialState(), true)
  useSessionRecordsStore.setState(useSessionRecordsStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useToastStore.setState(useToastStore.getInitialState(), true)
})

const renderSidebar = (props = {}) => render(<UnifiedSidebar {...defaultProps} {...props} />)

/** A branch row is a button named "<branch> — <state>"; the Filter menu button's name can hold a dash too. */
const branchRows = () =>
  screen.queryAllByRole('button', {
    name: (label, element) => label.includes(' — ') && !element.hasAttribute('aria-haspopup'),
  })

const branchNames = () => branchRows().map((row) => row.getAttribute('aria-label')!.split(' — ')[0])

const branchRow = (name: string) =>
  screen.getByRole('button', { name: (label) => label.startsWith(`${name} — `) })

/** A repo header is the toggle named by its own text; a disclosure or a menu button has a label. */
const repoHeaders = () =>
  screen.queryAllByRole('button', {
    name: (_, element) =>
      element.hasAttribute('aria-expanded') && !element.hasAttribute('aria-label'),
  })

/** A repo header's text is its name, then its branch count. */
const repoNames = () => repoHeaders().map((header) => header.textContent!.replace(/\d+$/, ''))

const scratchSection = () => screen.getByRole('group', { name: 'Scratch' })

const resizeHandle = () => screen.getByRole('separator', { name: 'Resize sidebar' })

const sidebar = () => screen.getByRole('complementary', { name: 'Sidebar' })

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

describe('UnifiedSidebar — the Sidebar setting', () => {
  const setSidebarMode = (sidebarMode: 'tree' | 'inbox') =>
    act(() => {
      const defaults = DEFAULT_GLOBAL_SETTINGS
      useSettingsStore.setState({
        globalSettings: { ...defaults, ui: { ...defaults.ui, sidebarMode } },
      })
    })

  it('swaps the branch tree for the Inbox and back without a restart', async () => {
    renderSidebar()
    expect(branchNames()).toEqual(['main', 'Jobs', 'Web'])
    setSidebarMode('inbox')
    expect(branchRows()).toEqual([])
    expect(await screen.findByRole('list', { name: 'Inbox' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeTruthy()
    setSidebarMode('tree')
    expect(screen.queryByRole('list', { name: 'Inbox' })).toBeNull()
    expect(branchNames()).toEqual(['main', 'Jobs', 'Web'])
  })

  it('takes its width at once while settings load, and slides only after', () => {
    renderSidebar()
    expect(sidebar().classList.contains('unified-sidebar--animated')).toBe(false)
    setSidebarMode('tree')
    expect(sidebar().classList.contains('unified-sidebar--animated')).toBe(true)
  })
})

describe('UnifiedSidebar — the list is branches, not terminals (US1)', () => {
  it('lists one row per branch and no terminals at all', () => {
    renderSidebar()
    expect(branchNames()).toEqual(['main', 'Jobs', 'Web'])
    expect(screen.queryByText('api-shell')).toBeNull()
  })

  it('groups the branches under their repos', () => {
    renderSidebar()
    expect(repoNames()).toEqual(['Backend', 'Frontend'])
  })

  it('counts branches on the repo header, not terminals', () => {
    renderSidebar()
    expect(repoHeaders().map((header) => header.textContent!.match(/\d+$/)?.[0])).toEqual([
      '2',
      '1',
    ])
  })

  it('still lists a branch with no terminals, so you can start one', () => {
    setSessions(new Map())
    renderSidebar()
    expect(branchNames()).toEqual(['main', 'Jobs', 'Web'])
  })
})

describe('UnifiedSidebar — the list is branches, not terminals (US1) — shows a branch state folded from its terminals', () => {
  it('shows a branch state folded from its terminals', () => {
    setSessions(new Map([['s1', sidebarSession('s1', 'p1', { bellCount: 1 })]]))
    renderSidebar()
    expect(within(branchRows()[0]).getByRole('img', { name: 'Waiting on you' })).toBeTruthy()
  })

  it('renders an empty state only when there is no repo either', () => {
    setWorkspaces([], new Map())
    renderSidebar()
    expect(screen.getByText('No branches yet')).toBeTruthy()
  })

  it('offers a repo with no branches its own way in', () => {
    setWorkspaces(
      [ws1, ws2],
      new Map([
        ['ws-1', [api, jobs]],
        ['ws-2', []],
      ])
    )
    renderSidebar()
    expect(repoNames()).toContain('Frontend')
  })
})

const clickBranch = (index = 0) => userEvent.setup().click(branchRows()[index])

describe('UnifiedSidebar — selecting a branch (FR-047)', () => {
  it('activates the branch and its repo', async () => {
    renderSidebar()
    await clickBranch(2)
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-2')
    expect(useWorkspaceStore.getState().activeProjectId).toBe('p3')
  })

  it('focuses the terminal that is waiting on you', async () => {
    sessions = new Map([
      ['s1', sidebarSession('s1', 'p1', { lastActivityAt: NOW })],
      ['s2', sidebarSession('s2', 'p1', { bellCount: 1, lastActivityAt: NOW - 900_000 })],
    ])
    setSessions(sessions)
    renderSidebar()
    await clickBranch()
    expect(useSessionStore.getState().getActiveSessionForProject('p1')).toBe('s2')
  })
})

describe('UnifiedSidebar — selecting a branch (FR-047) — falls back to the one you last had open on that branch', () => {
  it('falls back to the one you last had open on that branch', async () => {
    sessions = new Map([
      ['s1', sidebarSession('s1', 'p1', { lastActivityAt: NOW - 900_000 })],
      ['s2', sidebarSession('s2', 'p1', { lastActivityAt: NOW })],
    ])
    useSessionStore.setState({
      sessions,
      projectViews: new Map([['p1', { activeSessionId: 's1', terminalCounter: 0 }]]),
    })
    renderSidebar()
    await clickBranch()
    expect(useSessionStore.getState().getActiveSessionForProject('p1')).toBe('s1')
  })

  it('falls back to the most recently active when there is no memory of one', async () => {
    sessions = new Map([
      ['s1', sidebarSession('s1', 'p1', { lastActivityAt: NOW - 900_000 })],
      ['s2', sidebarSession('s2', 'p1', { lastActivityAt: NOW })],
    ])
    setSessions(sessions)
    renderSidebar()
    await clickBranch()
    expect(useSessionStore.getState().getActiveSessionForProject('p1')).toBe('s2')
  })
})

describe('UnifiedSidebar — selecting a branch (FR-047) — selects a branch with no terminals and lets the app open its first', () => {
  it('selects a branch with no terminals and lets the app open its first', async () => {
    // App's auto-open effect gives a newly selected branch its first terminal.
    // Starting one here as well opened two, which the e2e caught.
    setSessions(new Map())
    renderSidebar()
    await clickBranch()
    expect(useWorkspaceStore.getState().activeProjectId).toBe('p1')
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it('tells the host a branch was selected', async () => {
    const onSelectProject = vi.fn()
    renderSidebar({ onSelectProject })
    await clickBranch()
    expect(onSelectProject).toHaveBeenCalled()
  })
})

describe('UnifiedSidebar — collapse', () => {
  it('hides a repo branches without hiding the repo', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(repoHeaders()[0])
    expect(branchRows()).toHaveLength(1)
    expect(repoHeaders()).toHaveLength(2)
  })

  it('remembers a collapsed repo across a remount', async () => {
    const user = userEvent.setup()
    const { unmount } = renderSidebar()
    await user.click(repoHeaders()[0])
    unmount()
    renderSidebar()
    expect(branchRows()).toHaveLength(1)
  })

  it('still signals a waiting branch under a collapsed repo', async () => {
    const user = userEvent.setup()
    setSessions(new Map([['s1', sidebarSession('s1', 'p1', { bellCount: 1 })]]))
    renderSidebar()
    await user.click(repoHeaders()[0])
    expect(screen.getByLabelText('A branch here is waiting on you')).toBeTruthy()
  })
})

describe('UnifiedSidebar — a click here dismisses what covers the terminal', () => {
  it('dismisses Home when a click in the sidebar opens nothing else', async () => {
    const user = userEvent.setup()
    useExtensionRegistry.getState().setActiveGlobalTab('core.home')
    renderSidebar()
    await user.click(repoHeaders()[0])
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBeNull()
  })

  it('leaves it showing while the sidebar is being resized', async () => {
    const user = userEvent.setup()
    useExtensionRegistry.getState().setActiveGlobalTab('core.home')
    renderSidebar()
    await user.click(resizeHandle())
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBe('core.home')
  })
})

describe('UnifiedSidebar — branch actions', () => {
  it('creates a branch from the repo header', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole('button', { name: 'New branch in Backend' }))
    expect(screen.getByTestId('create-project-dialog')).toBeTruthy()
  })

  it('offers branch removal from the row menu', () => {
    renderSidebar()
    fireEvent.contextMenu(branchRows()[0])
    expect(screen.getByText('Remove branch')).toBeTruthy()
  })

  it('deletes the branch once removal is confirmed', async () => {
    const user = userEvent.setup()
    renderSidebar()
    fireEvent.contextMenu(branchRows()[0])
    await user.click(screen.getByText('Remove branch'))
    await user.click(screen.getByText('Remove'))
    await waitFor(() => expect(screen.queryByText('main')).toBeNull())
    expect(projectApi.delete).toHaveBeenCalledWith('p1')
  })
})

describe('UnifiedSidebar — branch actions — renames a branch that has no branch to be named by', () => {
  it('renames a branch that has no branch to be named by', async () => {
    const user = userEvent.setup()
    renderSidebar()
    // `web` sits in a folder that is not a repo, so its stored name is its only name.
    fireEvent.contextMenu(branchRow('Web'))
    await user.click(screen.getByText('Rename'))
    const input = screen.getByRole('textbox', { name: 'Branch name' })
    await user.clear(input)
    await user.type(input, 'Web v2{Enter}')
    expect(await screen.findByText('Web v2')).toBeTruthy()
  })

  it('offers no rename on a branch named by its branch (ADR-034)', () => {
    renderSidebar()
    fireEvent.contextMenu(branchRows()[0])
    expect(screen.queryByText('Rename')).toBeNull()
  })
})

describe('UnifiedSidebar — repo extension surfaces', () => {
  it('renders the repo buttons once per repo', () => {
    useExtensionRegistry.setState({
      workspaceTabs: new Map([['t1', { id: 't1', label: 'Fake Tab', component: () => null }]]),
    })
    renderSidebar()
    expect(screen.getAllByRole('button', { name: 'Fake Tab' })).toHaveLength(2)
  })

  it('fires a repo button with the owning repo id', async () => {
    useExtensionRegistry.setState({
      workspaceTabs: new Map([['t1', { id: 't1', label: 'Fake Tab', component: () => null }]]),
    })
    const user = userEvent.setup()
    const onSelectWorkspaceTab = vi.fn()
    renderSidebar({ onSelectWorkspaceTab })
    await user.click(screen.getAllByRole('button', { name: 'Fake Tab' })[0])
    expect(onSelectWorkspaceTab).toHaveBeenCalledWith('ws-1', 't1')
  })
})

describe('UnifiedSidebar — search', () => {
  it('removes non-matching branches instead of dimming them', async () => {
    renderSidebar()
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Search' }), 'jobs')
    const names = branchNames()
    expect(names).toEqual(['Jobs'])
  })

  it('matches on the repo name too', async () => {
    renderSidebar()
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Search' }), 'frontend')
    const names = branchNames()
    expect(names).toEqual(['Web'])
  })

  it('says so when nothing matches', async () => {
    renderSidebar()
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Search' }), 'zzzz')
    expect(screen.getByText('No branches match "zzzz"')).toBeTruthy()
  })
})

/** The hooks every "UnifiedSidebar — scratch is the one place a terminal is still a row" describe registers. */
function setUpUnifiedSidebarScratchIsThe(): void {
  beforeEach(() => {
    sessions = new Map([
      ['sc1', sidebarSession('sc1', '00000000-0000-0000-0000-000000000000', { tabTitle: 'notes' })],
    ])
    setSessions(sessions)
  })
}

describe('UnifiedSidebar — scratch is the one place a terminal is still a row', () => {
  setUpUnifiedSidebarScratchIsThe()

  it('lists a scratch terminal in its own section', () => {
    renderSidebar()
    expect(scratchSection().textContent).toContain('notes')
  })

  it('never lists a scratch terminal as a branch', () => {
    renderSidebar()
    expect(screen.getAllByRole('button', { name: /^notes — / })).toEqual([
      within(scratchSection()).getByRole('button', { name: /^notes — / }),
    ])
  })

  it('counts them on the section header', () => {
    renderSidebar()
    // The head reads "Scratch", the New button's "+", then the count.
    expect(scratchSection().textContent).toMatch(/^Scratch\+1/)
  })
})

describe("UnifiedSidebar — scratch is the one place a terminal is still a row — shows a scratch terminal's own ticket, and one its split pane carries, on its row", () => {
  setUpUnifiedSidebarScratchIsThe()

  it("shows a scratch terminal's own ticket, and one its split pane carries, on its row", () => {
    sessions.set(
      'sc1-pane',
      sidebarSession('sc1-pane', '00000000-0000-0000-0000-000000000000', {
        tabTitle: 'pane',
        parentSessionId: 'sc1',
      })
    )
    mockUseSessionFacts.mockReturnValue([
      fact({
        sessionId: 'sc1',
        workItem: { source: 'session', ref: { tracker: 'linear', key: 'ENG-3' } },
      }),
      fact({
        sessionId: 'sc1-pane',
        workItem: { source: 'session', ref: { tracker: 'linear', key: 'ENG-4' } },
      }),
    ])
    renderSidebar()
    expect(within(scratchSection()).getByText('ENG-3 +1')).toBeTruthy()
  })
})

describe('UnifiedSidebar — scratch is the one place a terminal is still a row — selects a scratch terminal when its row is clicked', () => {
  setUpUnifiedSidebarScratchIsThe()

  it('selects a scratch terminal when its row is clicked', async () => {
    const user = userEvent.setup()
    const onSelectScratchSession = vi.fn()
    renderSidebar({ onSelectScratchSession })
    await user.click(within(scratchSection()).getByRole('button', { name: /^notes — / }))
    expect(onSelectScratchSession).toHaveBeenCalledWith('sc1')
  })

  it('marks the active scratch terminal', () => {
    renderSidebar({ activeScratchSessionId: 'sc1' })
    const row = within(scratchSection()).getByRole('button', { name: /^notes — / })
    expect(row.getAttribute('aria-current')).toBe('true')
  })

  it('starts a new scratch terminal from the section header', async () => {
    const user = userEvent.setup()
    const onNewScratch = vi.fn()
    renderSidebar({ onNewScratch })
    await user.click(screen.getByRole('button', { name: 'New scratch terminal' }))
    expect(onNewScratch).toHaveBeenCalled()
  })

  it('draws no repo rail on a scratch row, since it has no repo', () => {
    renderSidebar()
    const row = within(scratchSection()).getByRole('button', { name: /^notes — / })
    expect(row.style.getPropertyValue('--ws-color')).toBe('')
  })
})
describe('UnifiedSidebar — shell behaviour preserved', () => {
  it('stays mounted but hidden when not visible', () => {
    renderSidebar({ visible: false })
    expect(sidebar().className).toContain('unified-sidebar--hidden')
  })

  it('opens the create-workspace dialog from the header', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole('button', { name: 'New repo' }))
    expect(screen.getByTestId('create-workspace-dialog')).toBeTruthy()
  })

  it('keeps workspace edit and remove reachable under project grouping', async () => {
    const user = userEvent.setup()
    renderSidebar()
    fireEvent.contextMenu(repoHeaders()[0])
    await user.click(screen.getByText('Remove workspace'))
    expect(screen.getByText('Remove workspace "Backend"?')).toBeTruthy()
  })

  it('deletes the workspace once removal is confirmed', async () => {
    const user = userEvent.setup()
    renderSidebar()
    fireEvent.contextMenu(repoHeaders()[0])
    await user.click(screen.getByText('Remove workspace'))
    await user.click(screen.getAllByText('Remove').at(-1)!)
    await waitFor(() => expect(screen.queryByText('Backend')).toBeNull())
    expect(workspaceApi.delete).toHaveBeenCalledWith('ws-1')
  })
})

describe('UnifiedSidebar — shell behaviour preserved — opens the workspace editor', () => {
  it('opens the workspace editor', async () => {
    const user = userEvent.setup()
    renderSidebar()
    fireEvent.contextMenu(repoHeaders()[0])
    await user.click(screen.getByText('Edit workspace'))
    expect(screen.getByTestId('edit-workspace-dialog')).toBeTruthy()
  })

  it('closes the create-project dialog when it asks to close', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole('button', { name: 'New branch in Backend' }))
    await user.click(screen.getByText('close-project'))
    expect(screen.queryByTestId('create-project-dialog')).toBeNull()
  })

  it('restores the default width on a resize-handle double click', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.dblClick(resizeHandle())
    expect(localStorage.getItem('terminator.sidebar.width')).toBe('300')
  })

  it('loads projects for a workspace that has not been fetched', async () => {
    setWorkspaces([ws1, ws2], new Map([['ws-1', [api, jobs]]]))
    renderSidebar()
    expect(await screen.findByText('Web')).toBeTruthy()
    expect(projectApi.list).toHaveBeenCalledWith('ws-2')
  })
})

describe('UnifiedSidebar — shell behaviour preserved — opens at the stored width', () => {
  it.each([
    { stored: '333', width: '333px' },
    { stored: '9999', width: '480px' },
    { stored: 'wide', width: '300px' },
  ])('opens at $width when the stored width is $stored', ({ stored, width }) => {
    localStorage.setItem('terminator.sidebar.width', stored)
    renderSidebar()
    expect(sidebar().style.width).toBe(width)
  })

  it('opens at the default width when nothing is stored', () => {
    renderSidebar()
    expect(sidebar().style.width).toBe('300px')
  })
})

describe('UnifiedSidebar — shell behaviour preserved — persists a new width after a resize drag', () => {
  it('persists a new width after a resize drag', async () => {
    const user = userEvent.setup()
    renderSidebar()
    const handle = resizeHandle()
    await user.pointer([
      { keys: '[MouseLeft>]', target: handle, coords: { clientX: 100 } },
      { coords: { clientX: 150 } },
      { keys: '[/MouseLeft]' },
    ])
    // 50px of drag from the 300px default.
    expect(localStorage.getItem('terminator.sidebar.width')).toBe('350')
  })

  it('reorders workspaces on drop', () => {
    renderSidebar()
    const targets = repoHeaders()
    fireEvent.dragStart(targets[0])
    fireEvent.drop(targets[1])
    expect(useWorkspaceStore.getState().workspaces.map((w) => w.id)).toEqual(['ws-2', 'ws-1'])
  })

  it('clears the search from the header control', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'jobs')
    expect(screen.queryByText('main')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByText('main')).toBeTruthy()
  })
})

describe('UnifiedSidebar — shell behaviour preserved — closes the create-workspace dialog when it asks to close', () => {
  it('closes the create-workspace dialog when it asks to close', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole('button', { name: 'New repo' }))
    await user.click(screen.getByText('close-workspace'))
    expect(screen.queryByTestId('create-workspace-dialog')).toBeNull()
  })
})

const openDisplay = () => userEvent.setup().click(screen.getByRole('button', { name: 'Display' }))

const openFilter = () => userEvent.setup().click(screen.getByRole('button', { name: /^Filter/ }))

describe('UnifiedSidebar — two menus replace four bands of chrome (US5)', () => {
  it('switches grouping from the Display menu', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await openDisplay()
    await user.click(screen.getByRole('menuitemradio', { name: 'None' }))
    expect(repoNames()).toEqual(['All branches'])
  })

  it('persists a grouping change for that view across a remount', async () => {
    const user = userEvent.setup()
    const { unmount } = renderSidebar()
    await openDisplay()
    await user.click(screen.getByRole('menuitemradio', { name: 'None' }))
    unmount()
    renderSidebar()
    expect(repoNames()).toEqual(['All branches'])
  })
})

describe('UnifiedSidebar — two menus replace four bands of chrome (US5) — switches sort from the Display menu', () => {
  it('switches sort from the Display menu', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await openDisplay()
    await user.click(screen.getByRole('menuitemradio', { name: 'Name' }))
    await openDisplay()
    expect(screen.getByRole('menuitemradio', { name: 'Name' }).getAttribute('aria-checked')).toBe(
      'true'
    )
  })

  it('offers every grouping and sort from the one menu (FR-034)', async () => {
    renderSidebar()
    await openDisplay()
    const labels = screen.getAllByRole('menuitemradio').map((item) => item.textContent)
    expect(labels).toEqual([
      'Workspace',
      'Task',
      'None',
      'Recent',
      'Oldest',
      'Name',
      'Status',
      'Manual',
    ])
  })
})

describe('UnifiedSidebar — two menus replace four bands of chrome (US5) — the Filter menu', () => {
  it('offers every saved view and the stale toggle from the other (FR-034)', async () => {
    renderSidebar()
    await openFilter()
    const views = screen.getAllByRole('menuitemradio').map((item) => item.textContent)
    expect(views).toEqual([
      expect.stringMatching(/^Everything/),
      expect.stringMatching(/^Needs me/),
      expect.stringMatching(/^Active/),
      expect.stringMatching(/^Stale/),
    ])
    expect(screen.getByRole('menuitemcheckbox', { name: /Hide stale/ })).not.toBeNull()
  })
})

describe('UnifiedSidebar — two menus replace four bands of chrome (US5) — restores the unfiltered Everything view on mount, never a filtered one (FR-015)', () => {
  it('restores the unfiltered Everything view on mount, never a filtered one (FR-015)', async () => {
    const user = userEvent.setup()
    const { unmount } = renderSidebar()
    await openFilter()
    await user.click(screen.getByRole('menuitemradio', { name: /Needs me/ }))
    expect(screen.queryByText('main')).toBeNull()
    unmount()
    renderSidebar()
    expect(screen.getByText('main')).toBeTruthy()
  })

  // FR-035. The notice band is gone: the count sits on the control that caused
  // the filtering, which is also where the way out is.
  it('counts what a filter is hiding on the Filter control', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await openFilter()
    await user.click(screen.getByRole('menuitemradio', { name: /Needs me/ }))
    expect(screen.getByRole('button', { name: 'Filter — 3 hidden' })).toBeTruthy()
  })

  it('counts what a search is hiding too', async () => {
    renderSidebar()
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Search' }), 'jobs')
    expect(screen.getByRole('button', { name: 'Filter — 2 hidden' })).toBeTruthy()
  })
})

describe('UnifiedSidebar — two menus replace four bands of chrome (US5) — shows no badge when nothing is hidden', () => {
  it('shows no badge when nothing is hidden', () => {
    renderSidebar()
    expect(screen.getByRole('button', { name: 'Filter' })).toBeTruthy()
  })

  it('restores every branch in one interaction from the same control (SC-007)', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await openFilter()
    await user.click(screen.getByRole('menuitemradio', { name: /Needs me/ }))
    await openFilter()
    await user.click(screen.getByRole('menuitem', { name: /show all/ }))
    expect(screen.getByText('main')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Filter' })).toBeTruthy()
  })
})

describe('UnifiedSidebar — two menus replace four bands of chrome (US5) — disables the hide-stale toggle on the Stale view (FR-021)', () => {
  it('disables the hide-stale toggle on the Stale view (FR-021)', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await openFilter()
    await user.click(screen.getByRole('menuitemradio', { name: /Stale/ }))
    await openFilter()
    expect(
      (screen.getByRole('menuitemcheckbox', { name: /Hide stale/ }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  // Fewer than FR-033 allows, since the app band moved out to the window's own
  // left rail: the sidebar's only chrome is the row that acts on its list.
  it('keeps at most two bands of chrome above the first row of work (FR-033)', () => {
    const { container } = renderSidebar()
    // eslint-disable-next-line testing-library/no-node-access -- the count of bands is the layout rule under test; a band has no role
    expect(container.querySelector('.sidebar-header')!.children).toHaveLength(1)
  })
})

describe('UnifiedSidebar — what the branch-first sidebar draws', () => {
  it('names a repo folder under home from ~ on the name tooltip', async () => {
    vi.stubGlobal('electronAPI', {
      project: projectApi,
      app: { getInfo: vi.fn().mockResolvedValue({ homeDir: '/Users/me' }) },
      editor: { detect: vi.fn().mockResolvedValue({ editor: null }), open: vi.fn() },
    })
    setWorkspaces([{ ...ws1, folderPath: '/Users/me/repos/backend' }, ws2])
    renderSidebar()
    await waitFor(() => expect(screen.getByTitle('~/repos/backend').textContent).toBe('Backend'))
  })
})

describe('UnifiedSidebar — agent state is derived, not read from a field nobody writes', () => {
  it('treats a session with an unread bell as awaiting input', async () => {
    const user = userEvent.setup()
    setSessions(new Map([['s6', sidebarSession('s6', 'p1', { tabTitle: 'claude', bellCount: 2 })]]))
    renderSidebar()
    await openFilter()
    await user.click(screen.getByRole('menuitemradio', { name: /Needs me/ }))
    const names = branchNames()
    expect(names).toEqual(['main'])
  })

  it('treats a session producing output as working', async () => {
    const user = userEvent.setup()
    setSessions(new Map([['s7', sidebarSession('s7', 'p1', { tabTitle: 'build', busy: true })]]))
    renderSidebar()
    await openFilter()
    await user.click(screen.getByRole('menuitemradio', { name: /Active/ }))
    const names = branchNames()
    expect(names).toEqual(['main'])
  })
})

describe('UnifiedSidebar — agent state is derived, not read from a field nobody writes — leaves a quiet session idle', () => {
  it('leaves a quiet session idle, so it appears in neither', async () => {
    const user = userEvent.setup()
    sessions.clear()
    sessions.set('s8', sidebarSession('s8', 'p1', { tabTitle: 'quiet' }))
    const { container } = renderSidebar()
    await openFilter()
    await user.click(screen.getByRole('menuitemradio', { name: /Needs me/ }))
    expect(container.textContent).not.toContain('quiet')
    await openFilter()
    await user.click(screen.getByRole('menuitemradio', { name: /Active/ }))
    expect(container.textContent).not.toContain('quiet')
  })
})

describe('UnifiedSidebar — agent state is derived, not read from a field nobody writes — treats a closed session as exited', () => {
  it('treats a closed session as exited', () => {
    sessions.clear()
    sessions.set('s9', sidebarSession('s9', 'p1', { tabTitle: 'gone', status: 'closed' }))
    renderSidebar()
    expect(within(branchRow('main')).getByRole('img', { name: 'Exited' })).toBeTruthy()
  })
})

describe('UnifiedSidebar — the link dialog names what it attaches to (US3, FR-014)', () => {
  it('qualifies the branch with its repo', () => {
    useIntegrationsStore.getState().openLinkDialog('p1')
    renderSidebar()
    expect(screen.getByTestId('link-issue-dialog').textContent).toContain('Backend · main')
  })
})

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
  renderSidebar()
  fireEvent.contextMenu(branchRow('main'))
}

/** The hooks every "UnifiedSidebar — issue actions on a branch header" describe registers. */
function setUpUnifiedSidebarIssueActionsOn(): void {
  beforeEach(() => {
    useIntegrationsStore.setState({ links: new Map([['p1', link]]) })
    vi.stubGlobal('electronAPI', { shell: { openExternal: vi.fn() } })
  })
}

describe('UnifiedSidebar — issue actions on a branch header', () => {
  setUpUnifiedSidebarIssueActionsOn()

  it('opens the linked issue in the tracker', async () => {
    const user = userEvent.setup()
    useIntegrationsStore.setState({
      issues: new Map([
        ['p1', issueFixture({ key: 'TAV-14', url: 'https://linear.app/x/TAV-14' })],
      ]),
    })
    openBranchMenu()
    await user.click(screen.getByText('Open TAV-14 in tracker'))
    expect(window.electronAPI.shell.openExternal).toHaveBeenCalledWith(
      'https://linear.app/x/TAV-14'
    )
  })

  it('opens nothing when the issue could not be read', async () => {
    const user = userEvent.setup()
    // The link is stored but the tracker never answered, so there is no url to
    // open. Failing quietly beats opening `undefined` in a browser.
    useIntegrationsStore.setState({ issues: new Map([['p1', null]]) })
    openBranchMenu()
    await user.click(screen.getByText('Open TAV-14 in tracker'))
    expect(window.electronAPI.shell.openExternal).not.toHaveBeenCalled()
  })

  it('copies the issue key', async () => {
    const user = userEvent.setup()
    openBranchMenu()
    await user.click(screen.getByText('Copy issue key'))
    expect(await navigator.clipboard.readText()).toBe('TAV-14')
  })
})

describe('UnifiedSidebar — issue actions on a branch header — copies nothing when the branch has no link', () => {
  setUpUnifiedSidebarIssueActionsOn()

  it('copies nothing when the branch has no link', () => {
    useIntegrationsStore.setState({ links: new Map() })
    renderSidebar()
    fireEvent.contextMenu(branchRow('main'))
    expect(screen.queryByText('Copy issue key')).toBeNull()
  })

  it('reaches the link dialog from "Change linked issue…"', async () => {
    const user = userEvent.setup()
    openBranchMenu()
    await user.click(screen.getByText('Change linked issue…'))
    expect(screen.getByTestId('link-issue-dialog').textContent).toContain('Backend · main')
  })

  it('unlinks the issue through the store', async () => {
    const user = userEvent.setup()
    openBranchMenu()
    await user.click(screen.getByText('Unlink TAV-14'))
    await waitFor(() => expect(useIntegrationsStore.getState().linkFor('p1')).toBeNull())
  })
})

const openEditor = vi.fn()

const openRowMenu = (name: string) => fireEvent.contextMenu(branchRow(name))

/** The hooks every "UnifiedSidebar — opening a branch in the editor" describe registers. */
function setUpUnifiedSidebarOpeningABranch(): void {
  beforeEach(() => {
    openEditor.mockClear()
    // The real channel always answers with a promise. A bare `vi.fn()` returns
    // undefined, which is not the contract — and it is what let a `.then` on
    // undefined reach CI as an unhandled error while every test still passed.
    openEditor.mockResolvedValue({ ok: true, editor: 'Cursor' })
    vi.stubGlobal('electronAPI', {
      app: { getInfo: vi.fn().mockResolvedValue({ homeDir: '/Users/me' }) },
      editor: {
        detect: vi.fn().mockResolvedValue({ editor: { id: 'cursor', name: 'Cursor' } }),
        open: openEditor,
      },
      shell: { openExternal: vi.fn() },
    })
  })
}

describe('UnifiedSidebar — opening a branch in the editor', () => {
  setUpUnifiedSidebarOpeningABranch()

  it("opens a branch's own working copy when it has one", async () => {
    const user = userEvent.setup()
    // `jobs` is a worktree, so its own directory is the one to open.
    renderSidebar()
    await act(async () => {})
    openRowMenu('Jobs')
    await user.click(screen.getByText(/Open in/))
    expect(openEditor).toHaveBeenCalledWith('/wt/jobs')
  })

  it('falls back to the repo folder for a plain checkout', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await act(async () => {})
    openRowMenu('main')
    await user.click(screen.getByText(/Open in/))
    expect(openEditor).toHaveBeenCalledWith('/b')
  })

  it('opens the repo folder from the repo header', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await act(async () => {})
    fireEvent.contextMenu(repoHeaders()[0])
    await user.click(screen.getByText(/Open in/))
    expect(openEditor).toHaveBeenCalledWith('/b')
  })
})

describe('UnifiedSidebar — opening a branch in the editor — names the detected editor in the menu', () => {
  setUpUnifiedSidebarOpeningABranch()

  it('names the detected editor in the menu', async () => {
    renderSidebar()
    await act(async () => {})
    openRowMenu('main')
    expect(screen.getByText('Open in Cursor')).toBeTruthy()
  })
})

const toasts = () => useToastStore.getState().toasts

const openMenuAndClick = async () => {
  await act(async () => {})
  fireEvent.contextMenu(branchRows()[0])
  await userEvent.setup().click(screen.getByText(/Open in/))
  await act(async () => {})
}

describe('UnifiedSidebar — opening in the editor reports back', () => {
  // The first version discarded the result, so a failure looked exactly like
  // the action not being wired up: nothing at all on screen.
  const openEditor = vi.fn()

  beforeEach(() => {
    openEditor.mockClear()
    vi.stubGlobal('electronAPI', {
      app: { getInfo: vi.fn().mockResolvedValue({ homeDir: '/Users/me' }) },
      editor: { detect: vi.fn().mockResolvedValue({ editor: null }), open: openEditor },
      shell: { openExternal: vi.fn() },
    })
  })

  it('says nothing when it worked', async () => {
    openEditor.mockResolvedValue({ ok: true, editor: 'Cursor' })
    renderSidebar()
    await openMenuAndClick()
    expect(toasts()).toEqual([])
  })
})

describe('UnifiedSidebar — opening in the editor reports back — explains in the user own terms', () => {
  // The first version discarded the result, so a failure looked exactly like
  // the action not being wired up: nothing at all on screen.
  const openEditor = vi.fn()

  beforeEach(() => {
    openEditor.mockClear()
    vi.stubGlobal('electronAPI', {
      app: { getInfo: vi.fn().mockResolvedValue({ homeDir: '/Users/me' }) },
      editor: { detect: vi.fn().mockResolvedValue({ editor: null }), open: openEditor },
      shell: { openExternal: vi.fn() },
    })
  })

  it.each([
    ['FOLDER_NOT_FOUND', /no longer on disk/i],
    ['NO_EDITOR_FOUND', /no supported editor/i],
    ['VALIDATION_ERROR', /could not be opened/i],
  ])('explains %s in the user own terms', async (error, expected) => {
    openEditor.mockResolvedValue({ error })
    renderSidebar()
    await openMenuAndClick()
    expect(toasts()).toEqual([
      expect.objectContaining({ type: 'error', message: expect.stringMatching(expected) }),
    ])
  })
})

describe('UnifiedSidebar — opening in the editor reports back — passes an unrecognised failure through rather than swallowing it', () => {
  // The first version discarded the result, so a failure looked exactly like
  // the action not being wired up: nothing at all on screen.
  const openEditor = vi.fn()

  beforeEach(() => {
    openEditor.mockClear()
    vi.stubGlobal('electronAPI', {
      app: { getInfo: vi.fn().mockResolvedValue({ homeDir: '/Users/me' }) },
      editor: { detect: vi.fn().mockResolvedValue({ editor: null }), open: openEditor },
      shell: { openExternal: vi.fn() },
    })
  })

  it('passes an unrecognised failure through rather than swallowing it', async () => {
    openEditor.mockResolvedValue({ error: 'EACCES' })
    renderSidebar()
    await openMenuAndClick()
    expect(toasts()).toEqual([
      expect.objectContaining({ message: expect.stringContaining('EACCES') }),
    ])
  })
})

describe('UnifiedSidebar — opening in the editor reports back — survives the call rejecting outright', () => {
  // The first version discarded the result, so a failure looked exactly like
  // the action not being wired up: nothing at all on screen.
  const openEditor = vi.fn()

  beforeEach(() => {
    openEditor.mockClear()
    vi.stubGlobal('electronAPI', {
      app: { getInfo: vi.fn().mockResolvedValue({ homeDir: '/Users/me' }) },
      editor: { detect: vi.fn().mockResolvedValue({ editor: null }), open: openEditor },
      shell: { openExternal: vi.fn() },
    })
  })

  it('survives the call rejecting outright', async () => {
    openEditor.mockRejectedValue(new Error('bridge gone'))
    renderSidebar()
    await openMenuAndClick()
    expect(toasts()).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/could not open/i) }),
    ])
  })
})

describe('UnifiedSidebar — where there is no editor API at all', () => {
  // The browser remote omits the editor channels entirely. Optional chaining
  // stops at the call, so a bare `.then` on the undefined it returns throws —
  // which is what CI caught and the local suite did not, because every local
  // mock happened to supply `open`.
  beforeEach(() => {
    vi.stubGlobal('electronAPI', {
      app: { getInfo: vi.fn().mockResolvedValue({ homeDir: '/Users/me' }) },
      shell: { openExternal: vi.fn() },
    })
  })

  it('does not throw when the action is invoked anyway', async () => {
    renderSidebar()
    await act(async () => {})
    fireEvent.contextMenu(branchRows()[0])
    await expect(userEvent.setup().click(screen.getByText(/Open in/))).resolves.toBeUndefined()
  })
})

const pickSort = async (label: string) => {
  await openDisplay()
  await userEvent.setup().click(screen.getByRole('menuitemradio', { name: label }))
}

const checkedSort = async () => {
  await openDisplay()
  return ['Recent', 'Oldest', 'Name', 'Status', 'Manual'].find(
    (label) =>
      screen.getByRole('menuitemradio', { name: label }).getAttribute('aria-checked') === 'true'
  )
}

const branchIdsOf = (workspaceId: string) =>
  useWorkspaceStore
    .getState()
    .projectsByWorkspaceId.get(workspaceId)!
    .map((p) => p.id)

describe('UnifiedSidebar — a drag is the manual order (Display → Manual)', () => {
  // The store's order and the drawn order are two different things the moment a
  // computed sort is on. A drop has to move the row the user actually dragged,
  // so the indices it works in are the drawn ones.
  it('reorders by what is on screen, not by the stored order', async () => {
    setWorkspaces([ws2, ws1])
    renderSidebar()
    await pickSort('Name')
    expect(repoNames()).toEqual(['Backend', 'Frontend'])

    const headers = repoHeaders()
    fireEvent.dragStart(headers[0])
    fireEvent.drop(headers[1])

    expect(useWorkspaceStore.getState().workspaces.map((w) => w.id)).toEqual(['ws-2', 'ws-1'])
  })

  // Dropping under a computed sort used to write an order nothing would ever
  // draw. The drag is the user saying "this is my order", so it says so.
  it.each([
    { dropped: 'a repo header', rowsOf: repoHeaders },
    { dropped: 'a branch row', rowsOf: branchRows },
  ])('switches the view to Manual when $dropped is dropped', async ({ rowsOf }) => {
    renderSidebar()
    await pickSort('Name')
    const rows = rowsOf()
    fireEvent.dragStart(rows[0])
    fireEvent.drop(rows[1])
    expect(await checkedSort()).toBe('Manual')
  })

  it('reorders the branches inside one repo on drop', () => {
    renderSidebar()
    const rows = branchRows()
    fireEvent.dragStart(rows[0])
    fireEvent.drop(rows[1])
    expect(branchIdsOf('ws-1')).toEqual(['p2', 'p1'])
  })
})

describe('UnifiedSidebar — a drag is the manual order (Display → Manual) — does not offer a branch drag when grouping is off', () => {
  // Branches from every repo share one list under "no grouping", and the stores
  // have nowhere to write an order that crosses repos.
  it('does not offer a branch drag when grouping is off', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await openDisplay()
    await user.click(screen.getByRole('menuitemradio', { name: 'None' }))
    const rows = branchRows()
    fireEvent.dragStart(rows[0])
    fireEvent.drop(rows[1])
    expect(branchIdsOf('ws-1')).toEqual(['p1', 'p2'])
    expect(projectApi.reorder).not.toHaveBeenCalled()
  })

  it('sorts a repo with no branches among the rest', async () => {
    const ws3 = workspaceFixture({ id: 'ws-3', name: 'Aardvark' })
    setWorkspaces([ws1, ws2, ws3], new Map([...projectsOf(), ['ws-3', []]]))
    renderSidebar()
    await pickSort('Name')
    expect(repoNames()).toEqual(['Aardvark', 'Backend', 'Frontend'])
  })
})

describe('a session-level ticket link', () => {
  it('shows on the terminal row once linked, without a reload', async () => {
    const user = userEvent.setup()
    mockUseSessionFacts.mockReturnValue([
      fact({
        sessionId: 's1',
        workItem: { source: 'session', ref: { tracker: 'linear', key: 'ENG-9' } },
      }),
    ])
    renderSidebar()
    await user.click(screen.getByRole('button', { name: 'Show terminals in main' }))
    expect(within(terminalRow('api-shell')).getByText('ENG-9')).toBeTruthy()
  })
})

describe('a session-level ticket link — removes the link from the terminal menu', () => {
  it('removes the link from the terminal menu', async () => {
    const user = userEvent.setup()
    const linked = fact({
      sessionId: 's1',
      name: 'api-shell',
      workItem: { source: 'session', ref: { tracker: 'linear', key: 'ENG-9' } },
    })
    mockUseSessionFacts.mockReturnValue([linked])
    useSessionRecordsStore.setState({
      records: new Map([
        ['s1', sessionRecordOf(linked.snapshot, { link: { tracker: 'linear', key: 'ENG-9' } })],
      ]),
    })
    renderSidebar()
    await user.click(screen.getByRole('button', { name: 'Show terminals in main' }))
    fireEvent.contextMenu(terminalRow('api-shell'))
    await user.click(screen.getByText('Remove session link'))
    await waitFor(() =>
      expect(useSessionRecordsStore.getState().records.get('s1')!.link).toBeNull()
    )
  })
})

const changeStats = vi.fn()

const diffsOfMain = (): number => changeStats.mock.calls.filter(([cwd]) => cwd === '/b').length

/** One activity stamp a second while s1 prints, as the session controller sends them. */
async function printFor(
  seconds: number,
  rerender: (ui: React.ReactElement) => void
): Promise<void> {
  for (let second = 1; second <= seconds; second++) {
    const at = NOW + second * 1000
    sessions.set('s1', { ...sessions.get('s1')!, busy: true, lastActivityAt: at })
    setSessions(new Map(sessions))
    await act(async () => rerender(<UnifiedSidebar {...defaultProps} now={at} />))
  }
}

/** The hooks every "a busy terminal and the sidebar" describe registers. */
function setUpABusyTerminalAnd(): void {
  beforeEach(() => {
    useChangeStatsStore.getState().invalidateAll()
    changeStats.mockReset()
    changeStats.mockResolvedValue({ filesChanged: 1, insertions: 1, deletions: 0 })
    vi.stubGlobal('electronAPI', { git: { changeStats } })
  })
}

describe('a busy terminal and the sidebar', () => {
  setUpABusyTerminalAnd()

  it('asks git for its branch once while it prints, and again once it settles', async () => {
    const { rerender } = renderSidebar()
    await act(async () => {})
    expect(diffsOfMain()).toBe(1)

    await printFor(5, rerender)
    expect(diffsOfMain()).toBe(1)

    sessions.set('s1', { ...sessions.get('s1')!, busy: false, lastActivityAt: NOW + 6000 })
    setSessions(new Map(sessions))
    await act(async () => rerender(<UnifiedSidebar {...defaultProps} now={NOW + 6000} />))
    expect(diffsOfMain()).toBe(2)
  })
})

describe('a busy terminal and the sidebar — still lists a branch as stale once its terminals pass the threshold', () => {
  setUpABusyTerminalAnd()

  it('still lists a branch as stale once its terminals pass the threshold', async () => {
    const user = userEvent.setup()
    const { rerender } = renderSidebar()
    await user.click(screen.getByRole('button', { name: /^Filter/ }))
    await user.click(screen.getByRole('menuitemradio', { name: /Stale/ }))
    const rowNames = () => branchNames()
    expect(rowNames()).not.toContain('Web')

    await act(async () =>
      rerender(<UnifiedSidebar {...defaultProps} now={NOW + staleAfterMs + 1000} />)
    )
    expect(rowNames()).toContain('Web')
  })
})

/** A terminal row: a button named by its state, title and Close control. */
const terminalRow = (title: string) =>
  screen.getByRole('button', {
    name: (name) => name.includes(title) && !name.startsWith('Close ') && !name.includes(' — '),
  })

/** Expands main's terminals. */
async function expandMain(): Promise<void> {
  await userEvent.setup().click(screen.getByRole('button', { name: 'Show terminals in main' }))
}

describe('UnifiedSidebar — the terminals under a branch', () => {
  it('shows the terminal picked from them, and tells the host', async () => {
    const user = userEvent.setup()
    const onSelectProject = vi.fn()
    renderSidebar({ onSelectProject })
    await expandMain()
    await user.click(terminalRow('api-agent'))
    expect(useSessionStore.getState().projectViews.get('p1')?.activeSessionId).toBe('s2')
    expect(onSelectProject).toHaveBeenCalled()
  })

  it('marks the terminal the main area is showing', async () => {
    useWorkspaceStore.setState({ activeProjectId: 'p1' })
    useSessionStore.getState().setActiveSessionForProject('p1', 's2')
    renderSidebar()
    await expandMain()
    expect(terminalRow('api-agent').classList).toContain('terminal-row--selected')
    expect(terminalRow('api-shell').classList).not.toContain('terminal-row--selected')
    expect(screen.getAllByRole('button', { current: true })).toEqual([terminalRow('api-agent')])
  })

  it("does not mark a branch's last terminal while another branch is on screen", async () => {
    useWorkspaceStore.setState({ activeProjectId: 'p3' })
    useSessionStore.getState().setActiveSessionForProject('p1', 's2')
    renderSidebar()
    await expandMain()
    expect(screen.getAllByRole('button', { current: true })).toEqual([branchRow('Web')])
  })
})

describe('UnifiedSidebar — nothing is marked while Home covers the main area', () => {
  it('marks no row', async () => {
    useWorkspaceStore.setState({ activeProjectId: 'p1' })
    useSessionStore.getState().setActiveSessionForProject('p1', 's2')
    useExtensionRegistry.getState().setActiveGlobalTab('core.home')
    renderSidebar()
    await expandMain()
    expect(screen.queryAllByRole('button', { current: true })).toEqual([])
  })
})

describe('UnifiedSidebar — the terminals under a branch — closes one by leaving its split first, then ending it', () => {
  it('closes one by leaving its split first, then ending it', async () => {
    const user = userEvent.setup()
    const close = vi.fn(async () => ({ success: true }))
    window.electronAPI.terminal = partialFake<Window['electronAPI']['terminal']>({ close })
    useSessionStore
      .getState()
      .activateSplit('p1', { targetId: 's1', newId: 's2', direction: 'vertical' })
    renderSidebar()
    await expandMain()
    await user.click(screen.getByRole('button', { name: 'Close api-shell' }))
    expect(close).toHaveBeenCalledWith('s1')
    expect(useSessionStore.getState().sessions.has('s1')).toBe(false)
    expect(useSessionStore.getState().getPaneLayout('p1')).toBeNull()
  })
})

describe('UnifiedSidebar — the terminals under a branch — linking one', () => {
  it('opens the session link dialog for it, and closes it again', async () => {
    const user = userEvent.setup()
    mockUseSessionFacts.mockReturnValue([fact({ sessionId: 's1', name: 'api-shell' })])
    renderSidebar()
    await expandMain()
    fireEvent.contextMenu(terminalRow('api-shell'))
    await user.click(screen.getByText('Link issue…'))
    expect(screen.getByTestId('session-link-dialog').textContent).toContain('api-shell')
    await user.click(screen.getByText('close-session-link'))
    expect(screen.queryByTestId('session-link-dialog')).toBeNull()
  })

  it('opens no dialog for a terminal it has no facts about', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await expandMain()
    fireEvent.contextMenu(terminalRow('api-shell'))
    await user.click(screen.getByText('Link issue…'))
    expect(screen.queryByTestId('session-link-dialog')).toBeNull()
  })
})

/** s1 on main with one pane split off it. */
function withPane(): void {
  sessions.set(
    's1-pane',
    sidebarSession('s1-pane', 'p1', { tabTitle: 'pane', parentSessionId: 's1' })
  )
  setSessions(new Map(sessions))
}

describe('UnifiedSidebar — a pane under its terminal', () => {
  it('is drawn nested under the terminal it was split off', async () => {
    withPane()
    renderSidebar()
    await expandMain()
    expect(terminalRow('pane').classList).toContain('terminal-row--nested')
  })

  it('is shown, closed and linked on its own', async () => {
    const user = userEvent.setup()
    withPane()
    mockUseSessionFacts.mockReturnValue([fact({ sessionId: 's1-pane', name: 'pane' })])
    const closeSplitLeaf = vi.fn()
    useSessionStore.setState({ closeSplitLeaf, closeSession: vi.fn(async () => {}) })
    renderSidebar()
    await expandMain()
    await user.click(terminalRow('pane'))
    expect(useSessionStore.getState().projectViews.get('p1')?.activeSessionId).toBe('s1-pane')
    fireEvent.contextMenu(terminalRow('pane'))
    await user.click(screen.getByText('Link issue…'))
    expect(screen.getByTestId('session-link-dialog').textContent).toContain('pane')
    await user.click(screen.getByRole('button', { name: 'Close pane' }))
    expect(closeSplitLeaf).toHaveBeenCalledWith('p1', 's1-pane')
  })
})

describe('UnifiedSidebar — the issue drawer', () => {
  it('opens from the branch key and closes again', async () => {
    const user = userEvent.setup()
    useIntegrationsStore.setState({ links: new Map([['p1', link]]) })
    renderSidebar()
    await user.click(screen.getByRole('button', { name: 'Open TAV-14' }))
    expect((await screen.findByTestId('issue-drawer')).textContent).toBe('mainclose-drawer')
    await user.click(await screen.findByText('close-drawer'))
    expect(screen.queryByTestId('issue-drawer')).toBeNull()
  })

  it('draws neither drawer nor link dialog for a branch it does not know', () => {
    useIntegrationsStore.setState({ drawerProjectId: 'gone', linkDialogProjectId: 'gone' })
    renderSidebar()
    expect(screen.queryByTestId('issue-drawer')).toBeNull()
    expect(screen.queryByTestId('link-issue-dialog')).toBeNull()
  })
})

describe('UnifiedSidebar — backing out of a dialog', () => {
  it('closes the workspace editor when it asks to', async () => {
    const user = userEvent.setup()
    renderSidebar()
    fireEvent.contextMenu(repoHeaders()[0])
    await user.click(screen.getByText('Edit workspace'))
    await user.click(screen.getByText('close-edit'))
    expect(screen.queryByTestId('edit-workspace-dialog')).toBeNull()
  })

  it('keeps the workspace when its removal is cancelled', async () => {
    const user = userEvent.setup()
    renderSidebar()
    fireEvent.contextMenu(repoHeaders()[0])
    await user.click(screen.getByText('Remove workspace'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/Remove workspace "/)).toBeNull()
    expect(workspaceApi.delete).not.toHaveBeenCalled()
  })

  it('keeps the branch when its removal is cancelled', async () => {
    const user = userEvent.setup()
    renderSidebar()
    openRowMenu('main')
    await user.click(screen.getByText('Remove branch'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/Remove branch "/)).toBeNull()
    expect(projectApi.delete).not.toHaveBeenCalled()
  })
})

describe('UnifiedSidebar — odds and ends', () => {
  it('renames a scratch terminal from its row', async () => {
    const user = userEvent.setup()
    setSessions(
      new Map([
        [
          'sc1',
          sidebarSession('sc1', '00000000-0000-0000-0000-000000000000', { tabTitle: 'notes' }),
        ],
      ])
    )
    renderSidebar()
    fireEvent.contextMenu(within(scratchSection()).getByRole('button', { name: /^notes — / }))
    await user.click(screen.getByText('Rename'))
    const input = screen.getByRole('textbox', { name: 'Branch name' })
    await user.clear(input)
    await user.type(input, 'scratchpad{Enter}')
    expect(await screen.findByText('scratchpad')).not.toBeNull()
  })
})

describe('UnifiedSidebar — odds and ends — names no editor and abbreviates no path when main cannot say', () => {
  it('names no editor and abbreviates no path when main cannot say', async () => {
    vi.stubGlobal('electronAPI', {
      app: { getInfo: vi.fn().mockRejectedValue(new Error('gone')) },
      editor: { detect: vi.fn().mockRejectedValue(new Error('gone')), open: vi.fn() },
    })
    renderSidebar()
    await waitFor(() => expect(window.electronAPI.editor.detect).toHaveBeenCalled())
    expect(screen.getByTitle('/b').textContent).toBe('Backend')
    openRowMenu('main')
    expect(screen.getByText('Open in editor')).toBeTruthy()
  })

  it('swallows a terminal that fails to start from a branch row', async () => {
    const user = userEvent.setup()
    mockCreateSession.mockRejectedValueOnce(new Error('pty'))
    renderSidebar()
    await user.click(screen.getByRole('button', { name: 'New terminal in main' }))
    await waitFor(() => expect(mockCreateSession).toHaveBeenCalled())
  })
})

describe('UnifiedSidebar — odds and ends — swallows a terminal that fails to start from the command palette', () => {
  it('swallows a terminal that fails to start from the command palette', async () => {
    mockCreateSession.mockRejectedValueOnce(new Error('pty'))
    renderSidebar()
    const command = useExtensionRegistry
      .getState()
      .commands.find((c) => c.id === 'core.scope.new-terminal.p1')!
    command.action()
    await waitFor(() => expect(mockCreateSession).toHaveBeenCalled())
  })
})
