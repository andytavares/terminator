import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
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
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: { project: projectApi, workspace: workspaceApi, sessionRecords: sessionRecordsApi },
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

const branchRows = (c: HTMLElement) => Array.from(c.querySelectorAll('.branch-row'))

const branchNames = (c: HTMLElement) =>
  branchRows(c).map((r) => r.querySelector('.branch-row__name')!.textContent)

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
    const { container } = renderSidebar()
    expect(branchNames(container)).toEqual(['main', 'Jobs', 'Web'])
    setSidebarMode('inbox')
    expect(branchRows(container)).toEqual([])
    expect(await screen.findByRole('list', { name: 'Inbox' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeTruthy()
    setSidebarMode('tree')
    expect(screen.queryByRole('list', { name: 'Inbox' })).toBeNull()
    expect(branchNames(container)).toEqual(['main', 'Jobs', 'Web'])
  })
})

describe('UnifiedSidebar — the list is branches, not terminals (US1)', () => {
  it('lists one row per branch and no terminals at all', () => {
    const { container } = renderSidebar()
    expect(branchNames(container)).toEqual(['main', 'Jobs', 'Web'])
    expect(container.querySelectorAll('.terminal-row')).toHaveLength(0)
    expect(screen.queryByText('api-shell')).toBeNull()
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
    setSessions(new Map())
    const { container } = renderSidebar()
    expect(branchNames(container)).toEqual(['main', 'Jobs', 'Web'])
  })
})

describe('UnifiedSidebar — the list is branches, not terminals (US1) — shows a branch state folded from its terminals', () => {
  it('shows a branch state folded from its terminals', () => {
    setSessions(new Map([['s1', sidebarSession('s1', 'p1', { bellCount: 1 })]]))
    const { container } = renderSidebar()
    const main = branchRows(container)[0]
    expect(main.querySelector('.branch-row__gutter svg')!.getAttribute('data-state')).toBe(
      'awaiting-input'
    )
  })

  it('renders an empty state only when there is no repo either', () => {
    setWorkspaces([], new Map())
    const { container } = renderSidebar()
    expect(container.querySelector('.unified-sidebar__empty')).toBeTruthy()
  })

  it('offers a repo with no branches its own way in', () => {
    setWorkspaces(
      [ws1, ws2],
      new Map([
        ['ws-1', [api, jobs]],
        ['ws-2', []],
      ])
    )
    const { container } = renderSidebar()
    const names = Array.from(container.querySelectorAll('.repo-header__name')).map(
      (h) => h.textContent
    )
    expect(names).toContain('Frontend')
  })
})

const clickBranch = (container: HTMLElement, index = 0) =>
  userEvent.setup().click(container.querySelectorAll('.branch-row')[index])

describe('UnifiedSidebar — selecting a branch (FR-047)', () => {
  it('activates the branch and its repo', async () => {
    const { container } = renderSidebar()
    await clickBranch(container, 2)
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-2')
    expect(useWorkspaceStore.getState().activeProjectId).toBe('p3')
  })

  it('focuses the terminal that is waiting on you', async () => {
    sessions = new Map([
      ['s1', sidebarSession('s1', 'p1', { lastActivityAt: NOW })],
      ['s2', sidebarSession('s2', 'p1', { bellCount: 1, lastActivityAt: NOW - 900_000 })],
    ])
    setSessions(sessions)
    const { container } = renderSidebar()
    await clickBranch(container)
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
    const { container } = renderSidebar()
    await clickBranch(container)
    expect(useSessionStore.getState().getActiveSessionForProject('p1')).toBe('s1')
  })

  it('falls back to the most recently active when there is no memory of one', async () => {
    sessions = new Map([
      ['s1', sidebarSession('s1', 'p1', { lastActivityAt: NOW - 900_000 })],
      ['s2', sidebarSession('s2', 'p1', { lastActivityAt: NOW })],
    ])
    setSessions(sessions)
    const { container } = renderSidebar()
    await clickBranch(container)
    expect(useSessionStore.getState().getActiveSessionForProject('p1')).toBe('s2')
  })
})

describe('UnifiedSidebar — selecting a branch (FR-047) — selects a branch with no terminals and lets the app open its first', () => {
  it('selects a branch with no terminals and lets the app open its first', async () => {
    // App's auto-open effect gives a newly selected branch its first terminal.
    // Starting one here as well opened two, which the e2e caught.
    setSessions(new Map())
    const { container } = renderSidebar()
    await clickBranch(container)
    expect(useWorkspaceStore.getState().activeProjectId).toBe('p1')
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it('tells the host a branch was selected', async () => {
    const onSelectProject = vi.fn()
    const { container } = renderSidebar({ onSelectProject })
    await clickBranch(container)
    expect(onSelectProject).toHaveBeenCalled()
  })
})

describe('UnifiedSidebar — collapse', () => {
  it('hides a repo branches without hiding the repo', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    await user.click(container.querySelector('.repo-header')!)
    expect(container.querySelectorAll('.branch-row')).toHaveLength(1)
    expect(container.querySelectorAll('.repo-header')).toHaveLength(2)
  })

  it('remembers a collapsed repo across a remount', async () => {
    const user = userEvent.setup()
    const { container, unmount } = renderSidebar()
    await user.click(container.querySelector('.repo-header')!)
    unmount()
    const second = renderSidebar()
    expect(second.container.querySelectorAll('.branch-row')).toHaveLength(1)
  })

  it('still signals a waiting branch under a collapsed repo', async () => {
    const user = userEvent.setup()
    setSessions(new Map([['s1', sidebarSession('s1', 'p1', { bellCount: 1 })]]))
    const { container } = renderSidebar()
    await user.click(container.querySelector('.repo-header')!)
    expect(container.querySelector('.repo-header__needs-you')).toBeTruthy()
  })
})

describe('UnifiedSidebar — a click here dismisses what covers the terminal', () => {
  it('dismisses Home when a click in the sidebar opens nothing else', async () => {
    const user = userEvent.setup()
    useExtensionRegistry.getState().setActiveGlobalTab('core.home')
    const { container } = renderSidebar()
    await user.click(container.querySelector('.repo-header')!)
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBeNull()
  })

  it('leaves it showing while the sidebar is being resized', async () => {
    const user = userEvent.setup()
    useExtensionRegistry.getState().setActiveGlobalTab('core.home')
    const { container } = renderSidebar()
    await user.click(container.querySelector('.unified-sidebar__resize-handle')!)
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBe('core.home')
  })
})

describe('UnifiedSidebar — branch actions', () => {
  it('creates a branch from the repo header', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    await user.click(container.querySelector('.repo-header__action')!)
    expect(screen.getByTestId('create-project-dialog')).toBeTruthy()
  })

  it('offers branch removal from the row menu', () => {
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelector('.branch-row')!)
    expect(screen.getByText('Remove branch')).toBeTruthy()
  })

  it('deletes the branch once removal is confirmed', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelector('.branch-row')!)
    await user.click(screen.getByText('Remove branch'))
    await user.click(screen.getByText('Remove'))
    await waitFor(() => expect(screen.queryByText('main')).toBeNull())
    expect(projectApi.delete).toHaveBeenCalledWith('p1')
  })
})

describe('UnifiedSidebar — branch actions — renames a branch that has no branch to be named by', () => {
  it('renames a branch that has no branch to be named by', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    // `web` sits in a folder that is not a repo, so its stored name is its only name.
    const rows = Array.from(container.querySelectorAll('.branch-row'))
    const webRow = rows.find((r) => r.querySelector('.branch-row__name')!.textContent === 'Web')!
    fireEvent.contextMenu(webRow)
    await user.click(screen.getByText('Rename'))
    const input = container.querySelector('.branch-row__rename') as HTMLInputElement
    await user.clear(input)
    await user.type(input, 'Web v2{Enter}')
    expect(await screen.findByText('Web v2')).toBeTruthy()
  })

  it('offers no rename on a branch named by its branch (ADR-034)', () => {
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelector('.branch-row')!)
    expect(screen.queryByText('Rename')).toBeNull()
  })
})

describe('UnifiedSidebar — repo extension surfaces', () => {
  it('renders the repo buttons once per repo', () => {
    useExtensionRegistry.setState({
      workspaceTabs: new Map([['t1', { id: 't1', label: 'Fake Tab', component: () => null }]]),
    })
    const { container } = renderSidebar()
    const buttons = Array.from(container.querySelectorAll('.repo-header__action')).filter(
      (b) => b.getAttribute('aria-label') === 'Fake Tab'
    )
    expect(buttons).toHaveLength(2)
  })

  it('fires a repo button with the owning repo id', async () => {
    useExtensionRegistry.setState({
      workspaceTabs: new Map([['t1', { id: 't1', label: 'Fake Tab', component: () => null }]]),
    })
    const user = userEvent.setup()
    const onSelectWorkspaceTab = vi.fn()
    const { container } = renderSidebar({ onSelectWorkspaceTab })
    await user.click(
      Array.from(container.querySelectorAll('.repo-header__action')).find(
        (b) => b.getAttribute('aria-label') === 'Fake Tab'
      )!
    )
    expect(onSelectWorkspaceTab).toHaveBeenCalledWith('ws-1', 't1')
  })
})

describe('UnifiedSidebar — search', () => {
  it('removes non-matching branches instead of dimming them', async () => {
    const { container } = renderSidebar()
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Search' }), 'jobs')
    const names = Array.from(container.querySelectorAll('.branch-row__name')).map(
      (n) => n.textContent
    )
    expect(names).toEqual(['Jobs'])
  })

  it('matches on the repo name too', async () => {
    const { container } = renderSidebar()
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Search' }), 'frontend')
    const names = Array.from(container.querySelectorAll('.branch-row__name')).map(
      (n) => n.textContent
    )
    expect(names).toEqual(['Web'])
  })

  it('says so when nothing matches', async () => {
    const { container } = renderSidebar()
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Search' }), 'zzzz')
    expect(container.querySelector('.unified-sidebar__empty')!.textContent).toContain('zzzz')
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
    const { container } = renderSidebar()
    const key = container.querySelector('.unified-sidebar__scratch .branch-row__issue')!
    expect(key.textContent).toBe('ENG-3 +1')
  })
})

describe('UnifiedSidebar — scratch is the one place a terminal is still a row — selects a scratch terminal when its row is clicked', () => {
  setUpUnifiedSidebarScratchIsThe()

  it('selects a scratch terminal when its row is clicked', async () => {
    const user = userEvent.setup()
    const onSelectScratchSession = vi.fn()
    const { container } = renderSidebar({ onSelectScratchSession })
    const scratch = container.querySelector('.unified-sidebar__scratch')!
    await user.click(scratch.querySelector('.branch-row')!)
    expect(onSelectScratchSession).toHaveBeenCalledWith('sc1')
  })

  it('marks the active scratch terminal', () => {
    const { container } = renderSidebar({ activeScratchSessionId: 'sc1' })
    const scratch = container.querySelector('.unified-sidebar__scratch')!
    expect(scratch.querySelector('.branch-row--selected')).toBeTruthy()
  })

  it('starts a new scratch terminal from the section header', async () => {
    const user = userEvent.setup()
    const onNewScratch = vi.fn()
    const { container } = renderSidebar({ onNewScratch })
    await user.click(container.querySelector('.unified-sidebar__scratch-add')!)
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

  it('opens the create-workspace dialog from the header', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    await user.click(container.querySelector('.sidebar-header__add')!)
    expect(screen.getByTestId('create-workspace-dialog')).toBeTruthy()
  })

  it('keeps workspace edit and remove reachable under project grouping', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelectorAll('.repo-header')[0])
    await user.click(screen.getByText('Remove workspace'))
    expect(screen.getByText('Remove workspace "Backend"?')).toBeTruthy()
  })

  it('deletes the workspace once removal is confirmed', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelectorAll('.repo-header')[0])
    await user.click(screen.getByText('Remove workspace'))
    await user.click(screen.getAllByText('Remove').at(-1)!)
    await waitFor(() => expect(screen.queryByText('Backend')).toBeNull())
    expect(workspaceApi.delete).toHaveBeenCalledWith('ws-1')
  })
})

describe('UnifiedSidebar — shell behaviour preserved — opens the workspace editor', () => {
  it('opens the workspace editor', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelectorAll('.repo-header')[0])
    await user.click(screen.getByText('Edit workspace'))
    expect(screen.getByTestId('edit-workspace-dialog')).toBeTruthy()
  })

  it('closes the create-project dialog when it asks to close', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    await user.click(container.querySelectorAll('.repo-header__action')[0])
    await user.click(screen.getByText('close-project'))
    expect(screen.queryByTestId('create-project-dialog')).toBeNull()
  })

  it('restores the default width on a resize-handle double click', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    await user.dblClick(container.querySelector('.unified-sidebar__resize-handle')!)
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
    const { container } = renderSidebar()
    expect((container.querySelector('.unified-sidebar') as HTMLElement).style.width).toBe(width)
  })

  it('opens at the default width when nothing is stored', () => {
    const { container } = renderSidebar()
    expect((container.querySelector('.unified-sidebar') as HTMLElement).style.width).toBe('300px')
  })
})

describe('UnifiedSidebar — shell behaviour preserved — persists a new width after a resize drag', () => {
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
    expect(useWorkspaceStore.getState().workspaces.map((w) => w.id)).toEqual(['ws-2', 'ws-1'])
  })

  it('clears the search from the header control', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'jobs')
    expect(screen.queryByText('main')).toBeNull()
    await user.click(container.querySelector('.sidebar-search__clear')!)
    expect(screen.getByText('main')).toBeTruthy()
  })
})

describe('UnifiedSidebar — shell behaviour preserved — closes the create-workspace dialog when it asks to close', () => {
  it('closes the create-workspace dialog when it asks to close', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    await user.click(container.querySelector('.sidebar-header__add')!)
    await user.click(screen.getByText('close-workspace'))
    expect(screen.queryByTestId('create-workspace-dialog')).toBeNull()
  })
})

const openDisplay = () => userEvent.setup().click(screen.getByRole('button', { name: 'Display' }))

const openFilter = () => userEvent.setup().click(screen.getByRole('button', { name: /^Filter/ }))

describe('UnifiedSidebar — two menus replace four bands of chrome (US5)', () => {
  it('switches grouping from the Display menu', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    await openDisplay()
    await user.click(screen.getByRole('menuitemradio', { name: 'None' }))
    const labels = Array.from(container.querySelectorAll('.repo-header__name')).map(
      (el) => el.textContent
    )
    expect(labels).toEqual(['All branches'])
  })

  it('persists a grouping change for that view across a remount', async () => {
    const user = userEvent.setup()
    const { unmount } = renderSidebar()
    await openDisplay()
    await user.click(screen.getByRole('menuitemradio', { name: 'None' }))
    unmount()
    const { container } = renderSidebar()
    const labels = Array.from(container.querySelectorAll('.repo-header__name')).map(
      (el) => el.textContent
    )
    expect(labels).toEqual(['All branches'])
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
    const { container } = renderSidebar()
    await openFilter()
    await user.click(screen.getByRole('menuitemradio', { name: /Needs me/ }))
    expect(container.querySelector('.count-badge')!.textContent).toBe('3')
  })

  it('counts what a search is hiding too', async () => {
    const { container } = renderSidebar()
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Search' }), 'jobs')
    expect(container.querySelector('.count-badge')!.textContent).toBe('2')
  })
})

describe('UnifiedSidebar — two menus replace four bands of chrome (US5) — shows no badge when nothing is hidden', () => {
  it('shows no badge when nothing is hidden', () => {
    const { container } = renderSidebar()
    expect(container.querySelector('.count-badge')).toBeNull()
  })

  it('restores every branch in one interaction from the same control (SC-007)', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    await openFilter()
    await user.click(screen.getByRole('menuitemradio', { name: /Needs me/ }))
    await openFilter()
    await user.click(screen.getByRole('menuitem', { name: /show all/ }))
    expect(screen.getByText('main')).toBeTruthy()
    expect(container.querySelector('.count-badge')).toBeNull()
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
    const header = container.querySelector('.sidebar-header')!
    expect(header.children).toHaveLength(1)
    expect(container.querySelector('.app-band')).toBeNull()
    expect(container.querySelector('.sidebar-header__search-row')).toBeTruthy()
  })
})

describe('UnifiedSidebar — what the branch-first sidebar draws', () => {
  it('names a repo folder under home from ~ on the name tooltip', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        project: projectApi,
        app: { getInfo: vi.fn().mockResolvedValue({ homeDir: '/Users/me' }) },
        editor: { detect: vi.fn().mockResolvedValue({ editor: null }), open: vi.fn() },
      },
    })
    setWorkspaces([{ ...ws1, folderPath: '/Users/me/repos/backend' }, ws2])
    const { container } = renderSidebar()
    const name = container.querySelector('.repo-header__name')!
    await waitFor(() => expect(name.getAttribute('title')).toBe('~/repos/backend'))
  })
})

describe('UnifiedSidebar — agent state is derived, not read from a field nobody writes', () => {
  it('treats a session with an unread bell as awaiting input', async () => {
    const user = userEvent.setup()
    setSessions(new Map([['s6', sidebarSession('s6', 'p1', { tabTitle: 'claude', bellCount: 2 })]]))
    const { container } = renderSidebar()
    await openFilter()
    await user.click(screen.getByRole('menuitemradio', { name: /Needs me/ }))
    const names = Array.from(container.querySelectorAll('.branch-row__name')).map(
      (n) => n.textContent
    )
    expect(names).toEqual(['main'])
  })

  it('treats a session producing output as working', async () => {
    const user = userEvent.setup()
    setSessions(new Map([['s7', sidebarSession('s7', 'p1', { tabTitle: 'build', busy: true })]]))
    const { container } = renderSidebar()
    await openFilter()
    await user.click(screen.getByRole('menuitemradio', { name: /Active/ }))
    const names = Array.from(container.querySelectorAll('.branch-row__name')).map(
      (n) => n.textContent
    )
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
    const { container } = renderSidebar()
    expect(container.querySelector('.branch-row__gutter svg')!.getAttribute('data-state')).toBe(
      'exited'
    )
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
  const { container } = renderSidebar()
  const rows = Array.from(container.querySelectorAll('.branch-row'))
  fireEvent.contextMenu(
    rows.find((r) => r.querySelector('.branch-row__name')?.textContent === 'main')!
  )
}

/** The hooks every "UnifiedSidebar — issue actions on a branch header" describe registers. */
function setUpUnifiedSidebarIssueActionsOn(): void {
  beforeEach(() => {
    useIntegrationsStore.setState({ links: new Map([['p1', link]]) })
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { shell: { openExternal: vi.fn() } },
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn() },
    })
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
    const { container } = renderSidebar()
    const rows = Array.from(container.querySelectorAll('.branch-row'))
    fireEvent.contextMenu(
      rows.find((r) => r.querySelector('.branch-row__name')?.textContent === 'main')!
    )
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

const openRowMenu = (container: HTMLElement, name: string) => {
  const row = Array.from(container.querySelectorAll('.branch-row')).find(
    (r) => r.querySelector('.branch-row__name')?.textContent === name
  )!
  fireEvent.contextMenu(row)
}

/** The hooks every "UnifiedSidebar — opening a branch in the editor" describe registers. */
function setUpUnifiedSidebarOpeningABranch(): void {
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
}

describe('UnifiedSidebar — opening a branch in the editor', () => {
  setUpUnifiedSidebarOpeningABranch()

  it("opens a branch's own working copy when it has one", async () => {
    const user = userEvent.setup()
    // `jobs` is a worktree, so its own directory is the one to open.
    const { container } = renderSidebar()
    await act(async () => {})
    openRowMenu(container, 'Jobs')
    await user.click(screen.getByText(/Open in/))
    expect(openEditor).toHaveBeenCalledWith('/wt/jobs')
  })

  it('falls back to the repo folder for a plain checkout', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    await act(async () => {})
    openRowMenu(container, 'main')
    await user.click(screen.getByText(/Open in/))
    expect(openEditor).toHaveBeenCalledWith('/b')
  })

  it('opens the repo folder from the repo header', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    await act(async () => {})
    fireEvent.contextMenu(container.querySelector('.repo-header')!)
    await user.click(screen.getByText(/Open in/))
    expect(openEditor).toHaveBeenCalledWith('/b')
  })
})

describe('UnifiedSidebar — opening a branch in the editor — names the detected editor in the menu', () => {
  setUpUnifiedSidebarOpeningABranch()

  it('names the detected editor in the menu', async () => {
    const { container } = renderSidebar()
    await act(async () => {})
    openRowMenu(container, 'main')
    expect(screen.getByText('Open in Cursor')).toBeTruthy()
  })
})

const toasts = () => useToastStore.getState().toasts

const openMenuAndClick = async (container: HTMLElement) => {
  await act(async () => {})
  fireEvent.contextMenu(container.querySelector('.branch-row')!)
  await userEvent.setup().click(screen.getByText(/Open in/))
  await act(async () => {})
}

describe('UnifiedSidebar — opening in the editor reports back', () => {
  // The first version discarded the result, so a failure looked exactly like
  // the action not being wired up: nothing at all on screen.
  const openEditor = vi.fn()

  beforeEach(() => {
    openEditor.mockClear()
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        app: { getInfo: vi.fn().mockResolvedValue({ homeDir: '/Users/me' }) },
        editor: { detect: vi.fn().mockResolvedValue({ editor: null }), open: openEditor },
        shell: { openExternal: vi.fn() },
      },
    })
  })

  it('says nothing when it worked', async () => {
    openEditor.mockResolvedValue({ ok: true, editor: 'Cursor' })
    const { container } = renderSidebar()
    await openMenuAndClick(container)
    expect(toasts()).toEqual([])
  })
})

describe('UnifiedSidebar — opening in the editor reports back — explains in the user own terms', () => {
  // The first version discarded the result, so a failure looked exactly like
  // the action not being wired up: nothing at all on screen.
  const openEditor = vi.fn()

  beforeEach(() => {
    openEditor.mockClear()
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        app: { getInfo: vi.fn().mockResolvedValue({ homeDir: '/Users/me' }) },
        editor: { detect: vi.fn().mockResolvedValue({ editor: null }), open: openEditor },
        shell: { openExternal: vi.fn() },
      },
    })
  })

  it.each([
    ['FOLDER_NOT_FOUND', /no longer on disk/i],
    ['NO_EDITOR_FOUND', /no supported editor/i],
    ['VALIDATION_ERROR', /could not be opened/i],
  ])('explains %s in the user own terms', async (error, expected) => {
    openEditor.mockResolvedValue({ error })
    const { container } = renderSidebar()
    await openMenuAndClick(container)
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
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        app: { getInfo: vi.fn().mockResolvedValue({ homeDir: '/Users/me' }) },
        editor: { detect: vi.fn().mockResolvedValue({ editor: null }), open: openEditor },
        shell: { openExternal: vi.fn() },
      },
    })
  })

  it('passes an unrecognised failure through rather than swallowing it', async () => {
    openEditor.mockResolvedValue({ error: 'EACCES' })
    const { container } = renderSidebar()
    await openMenuAndClick(container)
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
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        app: { getInfo: vi.fn().mockResolvedValue({ homeDir: '/Users/me' }) },
        editor: { detect: vi.fn().mockResolvedValue({ editor: null }), open: openEditor },
        shell: { openExternal: vi.fn() },
      },
    })
  })

  it('survives the call rejecting outright', async () => {
    openEditor.mockRejectedValue(new Error('bridge gone'))
    const { container } = renderSidebar()
    await openMenuAndClick(container)
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
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        app: { getInfo: vi.fn().mockResolvedValue({ homeDir: '/Users/me' }) },
        shell: { openExternal: vi.fn() },
      },
    })
  })

  it('does not throw when the action is invoked anyway', async () => {
    const { container } = renderSidebar()
    await act(async () => {})
    fireEvent.contextMenu(container.querySelector('.branch-row')!)
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

const repoNames = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.repo-header__name')).map((el) => el.textContent)

describe('UnifiedSidebar — a drag is the manual order (Display → Manual)', () => {
  // The store's order and the drawn order are two different things the moment a
  // computed sort is on. A drop has to move the row the user actually dragged,
  // so the indices it works in are the drawn ones.
  it('reorders by what is on screen, not by the stored order', async () => {
    setWorkspaces([ws2, ws1])
    const { container } = renderSidebar()
    await pickSort('Name')
    expect(repoNames(container)).toEqual(['Backend', 'Frontend'])

    const headers = container.querySelectorAll('.repo-header')
    fireEvent.dragStart(headers[0])
    fireEvent.drop(headers[1])

    expect(useWorkspaceStore.getState().workspaces.map((w) => w.id)).toEqual(['ws-2', 'ws-1'])
  })

  // Dropping under a computed sort used to write an order nothing would ever
  // draw. The drag is the user saying "this is my order", so it says so.
  it.each([
    { dropped: 'a repo header', selector: '.repo-header' },
    { dropped: 'a branch row', selector: '.branch-row' },
  ])('switches the view to Manual when $dropped is dropped', async ({ selector }) => {
    const { container } = renderSidebar()
    await pickSort('Name')
    const rows = container.querySelectorAll(selector)
    fireEvent.dragStart(rows[0])
    fireEvent.drop(rows[1])
    expect(await checkedSort()).toBe('Manual')
  })

  it('reorders the branches inside one repo on drop', () => {
    const { container } = renderSidebar()
    const rows = container.querySelectorAll('.branch-row')
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
    const { container } = renderSidebar()
    await openDisplay()
    await user.click(screen.getByRole('menuitemradio', { name: 'None' }))
    const rows = container.querySelectorAll('.branch-row')
    fireEvent.dragStart(rows[0])
    fireEvent.drop(rows[1])
    expect(branchIdsOf('ws-1')).toEqual(['p1', 'p2'])
    expect(projectApi.reorder).not.toHaveBeenCalled()
  })

  it('sorts a repo with no branches among the rest', async () => {
    const ws3 = workspaceFixture({ id: 'ws-3', name: 'Aardvark' })
    setWorkspaces([ws1, ws2, ws3], new Map([...projectsOf(), ['ws-3', []]]))
    const { container } = renderSidebar()
    await pickSort('Name')
    expect(repoNames(container)).toEqual(['Aardvark', 'Backend', 'Frontend'])
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
    const { container } = renderSidebar()
    await user.click(screen.getByRole('button', { name: 'Show terminals in main' }))
    expect(container.querySelector('.terminal-row__key')!.textContent).toBe('ENG-9')
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
    const { container } = renderSidebar()
    await user.click(screen.getByRole('button', { name: 'Show terminals in main' }))
    const row = container.querySelector('.terminal-row')!
    fireEvent.contextMenu(row)
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
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { git: { changeStats } },
    })
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
    const { container, rerender } = renderSidebar()
    await user.click(screen.getByRole('button', { name: /^Filter/ }))
    await user.click(screen.getByRole('menuitemradio', { name: /Stale/ }))
    const rowNames = () =>
      Array.from(container.querySelectorAll('.branch-row__name')).map((n) => n.textContent)
    expect(rowNames()).not.toContain('Web')

    await act(async () =>
      rerender(<UnifiedSidebar {...defaultProps} now={NOW + staleAfterMs + 1000} />)
    )
    expect(rowNames()).toContain('Web')
  })
})

/** Expands main's terminals and returns the terminal rows drawn under it. */
async function expandMain(container: HTMLElement): Promise<Element[]> {
  await userEvent.setup().click(screen.getByRole('button', { name: 'Show terminals in main' }))
  return Array.from(container.querySelectorAll('.terminal-row'))
}

const terminalRowNamed = (container: HTMLElement, title: string): Element =>
  Array.from(container.querySelectorAll('.terminal-row')).find(
    (r) => r.querySelector('.terminal-row__name')?.textContent === title
  )!

describe('UnifiedSidebar — the terminals under a branch', () => {
  it('shows the terminal picked from them, and tells the host', async () => {
    const user = userEvent.setup()
    const onSelectProject = vi.fn()
    const { container } = renderSidebar({ onSelectProject })
    await expandMain(container)
    await user.click(terminalRowNamed(container, 'api-agent'))
    expect(useSessionStore.getState().projectViews.get('p1')?.activeSessionId).toBe('s2')
    expect(onSelectProject).toHaveBeenCalled()
  })

  it('marks the terminal the main area is showing', async () => {
    useWorkspaceStore.setState({ activeProjectId: 'p1' })
    useSessionStore.getState().setActiveSessionForProject('p1', 's2')
    const { container } = renderSidebar()
    await expandMain(container)
    expect(terminalRowNamed(container, 'api-agent').classList).toContain('terminal-row--selected')
    expect(terminalRowNamed(container, 'api-shell').classList).not.toContain(
      'terminal-row--selected'
    )
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
  })

  it("does not mark a branch's last terminal while another branch is on screen", async () => {
    useWorkspaceStore.setState({ activeProjectId: 'p3' })
    useSessionStore.getState().setActiveSessionForProject('p1', 's2')
    const { container } = renderSidebar()
    await expandMain(container)
    expect(container.querySelector('.terminal-row--selected')).toBeNull()
    expect(container.querySelector('.branch-row--selected')?.textContent).toContain('Web')
  })
})

describe('UnifiedSidebar — nothing is marked while Home covers the main area', () => {
  it('marks no row', async () => {
    useWorkspaceStore.setState({ activeProjectId: 'p1' })
    useSessionStore.getState().setActiveSessionForProject('p1', 's2')
    useExtensionRegistry.getState().setActiveGlobalTab('core.home')
    const { container } = renderSidebar()
    await expandMain(container)
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(0)
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
    const { container } = renderSidebar()
    await expandMain(container)
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
    const { container } = renderSidebar()
    await expandMain(container)
    fireEvent.contextMenu(terminalRowNamed(container, 'api-shell'))
    await user.click(screen.getByText('Link issue…'))
    expect(screen.getByTestId('session-link-dialog').textContent).toContain('api-shell')
    await user.click(screen.getByText('close-session-link'))
    expect(screen.queryByTestId('session-link-dialog')).toBeNull()
  })

  it('opens no dialog for a terminal it has no facts about', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    await expandMain(container)
    fireEvent.contextMenu(terminalRowNamed(container, 'api-shell'))
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
    const { container } = renderSidebar()
    await expandMain(container)
    expect(terminalRowNamed(container, 'pane').classList).toContain('terminal-row--nested')
  })

  it('is shown, closed and linked on its own', async () => {
    const user = userEvent.setup()
    withPane()
    mockUseSessionFacts.mockReturnValue([fact({ sessionId: 's1-pane', name: 'pane' })])
    const closeSplitLeaf = vi.fn()
    useSessionStore.setState({ closeSplitLeaf, closeSession: vi.fn(async () => {}) })
    const { container } = renderSidebar()
    await expandMain(container)
    await user.click(terminalRowNamed(container, 'pane'))
    expect(useSessionStore.getState().projectViews.get('p1')?.activeSessionId).toBe('s1-pane')
    fireEvent.contextMenu(terminalRowNamed(container, 'pane'))
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
    const { container } = renderSidebar()
    expect(container.parentElement!.querySelector('.issue-drawer-host')).toBeNull()
    expect(screen.queryByTestId('link-issue-dialog')).toBeNull()
  })
})

describe('UnifiedSidebar — backing out of a dialog', () => {
  it('closes the workspace editor when it asks to', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelector('.repo-header')!)
    await user.click(screen.getByText('Edit workspace'))
    await user.click(screen.getByText('close-edit'))
    expect(screen.queryByTestId('edit-workspace-dialog')).toBeNull()
  })

  it('keeps the workspace when its removal is cancelled', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelector('.repo-header')!)
    await user.click(screen.getByText('Remove workspace'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/Remove workspace "/)).toBeNull()
    expect(workspaceApi.delete).not.toHaveBeenCalled()
  })

  it('keeps the branch when its removal is cancelled', async () => {
    const user = userEvent.setup()
    const { container } = renderSidebar()
    openRowMenu(container, 'main')
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
    const { container } = renderSidebar()
    const row = container.querySelector('.unified-sidebar__scratch .branch-row')!
    fireEvent.contextMenu(row)
    await user.click(screen.getByText('Rename'))
    const input = container.querySelector<HTMLInputElement>('.branch-row__rename')!
    await user.clear(input)
    await user.type(input, 'scratchpad{Enter}')
    expect(await screen.findByText('scratchpad')).not.toBeNull()
  })
})

describe('UnifiedSidebar — odds and ends — names no editor and abbreviates no path when main cannot say', () => {
  it('names no editor and abbreviates no path when main cannot say', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        app: { getInfo: vi.fn().mockRejectedValue(new Error('gone')) },
        editor: { detect: vi.fn().mockRejectedValue(new Error('gone')), open: vi.fn() },
      },
    })
    const { container } = renderSidebar()
    await waitFor(() => expect(window.electronAPI.editor.detect).toHaveBeenCalled())
    expect(container.querySelector('.repo-header__name')!.getAttribute('title')).toBe('/b')
    openRowMenu(container, 'main')
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
