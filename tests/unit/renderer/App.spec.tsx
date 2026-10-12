import React, { type ComponentProps } from 'react'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useWorkspaceStore } from '../../../src/renderer/stores/workspace.store'
import { useSettingsStore } from '../../../src/renderer/stores/settings.store'
import { useSessionStore } from '../../../src/renderer/stores/session.store'
import { useToastStore } from '../../../src/renderer/stores/toast.store'
import { useExtensionCommandsStore } from '../../../src/renderer/stores/extension-commands.store'
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { useTerminalOpenErrorStore } from '../../../src/renderer/stores/terminal-open-error.store'
import { useIntegrationsStore } from '../../../src/renderer/stores/integrations.store'
import { App } from '../../../src/renderer/App'
import type { QuickAction } from '../../../src/renderer/quick-actions/types'
import type { QuickActionsProps } from '../../../src/renderer/components/QuickActions'
import type { useTerminalSession } from '../../../src/renderer/hooks/useTerminalSession'
import type { useKeyboardShortcuts } from '../../../src/renderer/hooks/useKeyboardShortcuts'
import type { UnifiedSidebar } from '../../../src/renderer/components/sidebar/UnifiedSidebar'
import type { TerminalInstance } from '../../../src/renderer/components/terminal/TerminalSession'
import {
  SCRATCH_PROJECT_ID,
  type GlobalSettings,
  type Project,
  type TerminalSession,
  type Workspace,
} from '../../../src/shared/types/index'
import type { ElectronAPI } from '../../../src/shared/electron-api/api-type'
import {
  projectOf,
  resetStore,
  terminalSessionOf,
  workspaceOf,
} from '../../support/renderer-stores'
import { bridgeEvents, installElectronApi, pushedEvent } from '../../support/electron-api'
import { partialFake } from '../../support/fakes'

// Settings are answered by the main process's own settings store, kept in memory.
vi.mock('electron-store', async () =>
  (await import('../../support/stores')).inMemoryElectronStore()
)

// The children are stand-ins: what is under test is the shell that wires them.
vi.mock('../../../src/renderer/extensions/loader', () => ({}))
const facts = vi.hoisted(() => ({
  sessionFacts: [] as Array<{ sessionId: string; workItem: null }>,
}))
vi.mock('../../../src/renderer/components/session/useSessionFacts', () => ({
  useSessionFacts: () => facts.sessionFacts,
  useIssue: () => null,
}))
vi.mock('../../../src/renderer/components/session/SessionLinkDialog', () => ({
  SessionLinkDialog: ({
    facts,
    onClose,
  }: {
    facts: { sessionId: string }
    onClose: () => void
  }) => (
    <div data-testid="session-link-dialog">
      {facts.sessionId}
      <button onClick={onClose}>close-session-link</button>
    </div>
  ),
}))

type ShortcutOptions = NonNullable<Parameters<typeof useKeyboardShortcuts>[0]>
const shortcuts = vi.hoisted(() => ({ callbacks: {} as ShortcutOptions }))
vi.mock('../../../src/renderer/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: (options: ShortcutOptions = {}) => {
    shortcuts.callbacks = options
  },
}))

// Opening a terminal builds an xterm, which jsdom cannot run; what is asserted
// is the terminal asked for.
type TerminalSessionApi = ReturnType<typeof useTerminalSession>
const terminals = vi.hoisted(() => ({ createSession: vi.fn(), splitSession: vi.fn() }))
vi.mock('../../../src/renderer/hooks/useTerminalSession', () => ({
  useTerminalSession: (): TerminalSessionApi => terminals,
}))
const createSession = vi.mocked<TerminalSessionApi['createSession']>(terminals.createSession)
const splitSession = vi.mocked<TerminalSessionApi['splitSession']>(terminals.splitSession)

const palette = vi.hoisted(() => ({ props: null as QuickActionsProps | null }))
vi.mock('../../../src/renderer/components/QuickActions', () => ({
  QuickActions: (props: QuickActionsProps) => {
    palette.props = props
    return (
      <div data-testid="quick-actions">
        <button onClick={props.onClose}>Close Palette</button>
      </div>
    )
  },
}))

type SidebarProps = ComponentProps<typeof UnifiedSidebar>
const sidebar = vi.hoisted(() => ({ props: null as SidebarProps | null }))
vi.mock('../../../src/renderer/components/sidebar/UnifiedSidebar', () => ({
  UnifiedSidebar: (props: SidebarProps) => {
    sidebar.props = props
    return (
      <div
        data-testid="unified-sidebar"
        className={props.visible ? '' : 'unified-sidebar--hidden'}
      />
    )
  },
}))
vi.mock('../../../src/renderer/components/AboutDialog', () => ({
  AboutDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="about-dialog">
      <button onClick={onClose}>Close About</button>
    </div>
  ),
}))
vi.mock('../../../src/renderer/components/NameTerminalDialog', () => ({
  NameTerminalDialog: ({
    defaultName,
    onConfirm,
    onCancel,
  }: {
    defaultName: string
    onConfirm: (name: string) => void
    onCancel: () => void
  }) => (
    <div data-testid="name-terminal-dialog">
      <span data-testid="name-terminal-default">{defaultName}</span>
      <button onClick={() => onConfirm('My Terminal')}>Confirm</button>
      <button onClick={onCancel}>Cancel Dialog</button>
    </div>
  ),
}))
vi.mock('../../../src/renderer/components/terminal/TerminalPane', () => ({
  TerminalPane: ({ projectId }: { projectId: string }) => (
    <div data-testid="terminal-pane">{projectId}</div>
  ),
}))
const tabBar = vi.hoisted(() => ({ editNoteSessionId: null as string | null }))
vi.mock('../../../src/renderer/components/terminal/TabBar', () => ({
  TabBar: ({ editNoteSessionId }: { editNoteSessionId?: string | null }) => {
    // App sets the id then clears it on a microtask, so pressing the shortcut
    // twice reopens the editor. The last render therefore always sees null —
    // what the test is asking is whether the tab bar was ever handed the id.
    if (editNoteSessionId) tabBar.editNoteSessionId = editNoteSessionId
    return <div data-testid="tab-bar" />
  },
}))
vi.mock('../../../src/renderer/components/settings/SettingsPanel', () => ({
  SettingsPanel: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="settings-panel">
      <button onClick={onClose}>Close Settings</button>
    </div>
  ),
}))
vi.mock('../../../src/renderer/components/home/HomeScreen', () => ({
  HomeScreen: () => <div data-testid="home-screen" />,
}))
vi.mock('../../../src/renderer/components/overview/OverviewScreen', () => ({
  OverviewScreen: () => <div data-testid="overview-screen" />,
}))
vi.mock('../../../src/renderer/components/ToastContainer', () => ({
  ToastContainer: () => <div data-testid="toast-container" />,
}))
vi.mock('../../../src/renderer/components/LogWindow', () => ({
  LogWindow: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="log-window">
      <button onClick={onClose}>Close Log</button>
    </div>
  ),
}))
vi.mock('../../../src/renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// ── The main process ─────────────────────────────────────────────────────────

type MainSettings = typeof import('../../../src/main/storage/settings-store')
let mainSettings: MainSettings

/** Settings as saved: the defaults, with `patch` written over them by main's own merge. */
function settingsWith(patch: Record<string, unknown>): GlobalSettings {
  return mainSettings.updateGlobalSettings(patch)
}

/** What main pushes to the window, and what the window sends back to it. */
function mainProcess(data: { workspaces: Workspace[]; projects: Map<string, Project[]> }) {
  const events = {
    processExit: pushedEvent<[string, number | null]>(),
    commandsChanged: pushedEvent<[]>(),
    quickActionsOpen: pushedEvent<[]>(),
    openSettings: pushedEvent<[]>(),
    openAbout: pushedEvent<[]>(),
    openHome: pushedEvent<[]>(),
    toggleSidebar: pushedEvent<[]>(),
    closeTab: pushedEvent<[]>(),
    togglePanel: pushedEvent<[string]>(),
    selectProjectTab: pushedEvent<[string]>(),
    bridge: bridgeEvents(),
  }
  const sent = {
    input: vi.fn<ElectronAPI['terminal']['input']>(),
    notifyPanelState: vi.fn<ElectronAPI['extensionEvents']['notifyPanelState']>(),
    getCommands: vi.fn<ElectronAPI['extension']['getCommands']>(async () => ({ commands: [] })),
    updateGlobal: vi.fn<ElectronAPI['settings']['updateGlobal']>(async (patch) => ({
      settings: mainSettings.updateGlobalSettings(patch),
    })),
  }
  const unsubscribe = () => {}
  const parts = {
    terminal: {
      onProcessExit: events.processExit.subscribe,
      input: sent.input,
      close: async () => ({ success: true }),
    },
    workspace: { list: async () => ({ workspaces: data.workspaces }) },
    project: { list: async (id: string) => ({ projects: data.projects.get(id) ?? [] }) },
    settings: {
      getGlobal: async () => ({ settings: mainSettings.getGlobalSettings() }),
      getWorkspace: async (id: string) => ({ settings: mainSettings.getWorkspaceSettings(id) }),
      updateGlobal: sent.updateGlobal,
    },
    extensionEvents: {
      onMenuOpenSettings: events.openSettings.subscribe,
      onMenuOpenAbout: events.openAbout.subscribe,
      onMenuOpenHome: events.openHome.subscribe,
      onMenuToggleSidebar: events.toggleSidebar.subscribe,
      onMenuCloseTab: events.closeTab.subscribe,
      onTogglePanel: events.togglePanel.subscribe,
      onSelectProjectTab: events.selectProjectTab.subscribe,
      notifyPanelState: sent.notifyPanelState,
    },
    notifications: {
      list: async () => [],
      onPush: () => unsubscribe,
      create: async () => ({ id: 'n1' }),
    },
    extensionBridge: { on: events.bridge.on, invoke: async () => ({}) },
    extension: {
      setBottomInset: () => {},
      getCommands: sent.getCommands,
      onCommandsChanged: events.commandsChanged.subscribe,
      list: async () => ({ extensions: [] }),
      executeCommand: () => {},
    },
    quickActions: { onOpen: events.quickActionsOpen.subscribe },
    sessionRecords: { list: async () => ({ data: [] }), onChanged: () => unsubscribe },
    metrics: {
      getSystem: async () => ({
        data: {
          cpuPercent: 0,
          memUsedBytes: 0,
          memTotalBytes: 1,
          netInBytesPerSec: 0,
          netOutBytesPerSec: 0,
        },
      }),
      getProcesses: async () => ({ data: [] }),
    },
    git: { currentBranch: async () => ({ branch: 'main' }) },
  }
  return { events, sent, parts }
}

let main: ReturnType<typeof mainProcess>

const WS1 = workspaceOf({ id: 'ws-1', name: 'One', folderPath: '/a' })
const WS2 = workspaceOf({ id: 'ws-2', name: 'Two', folderPath: '/b' })
const PROJ1 = projectOf({ id: 'proj-1', workspaceId: 'ws-1', name: 'API' })

interface AppState {
  activeWorkspaceId?: string | null
  activeProjectId?: string | null
  globalSettings?: GlobalSettings | null
  workspaces?: Workspace[]
  scratchActive?: boolean
  sessions?: TerminalSession[]
  projectsByWorkspaceId?: Map<string, Project[]>
}

/**
 * The renderer's stores as the app would hold them, and a main process that
 * answers with the same workspaces, projects and settings.
 */
function setupApp(state: AppState = {}): void {
  const workspaces = state.workspaces ?? []
  const projects = state.projectsByWorkspaceId ?? new Map<string, Project[]>()
  main = mainProcess({ workspaces, projects })
  installElectronApi(main.parts)
  resetStore(useWorkspaceStore, {
    workspaces,
    projectsByWorkspaceId: projects,
    activeWorkspaceId: state.activeWorkspaceId ?? null,
    activeProjectId: state.activeProjectId ?? null,
    scratchActive: state.scratchActive ?? false,
  })
  resetStore(useSettingsStore, {
    globalSettings: state.globalSettings === undefined ? settingsWith({}) : state.globalSettings,
  })
  resetStore(useSessionStore, {
    sessions: new Map((state.sessions ?? []).map((s) => [s.id, s])),
  })
}

/** Shows `sessionId` in its project, as a click on its tab does. */
function showTab(projectId: string, sessionId: string): void {
  useSessionStore.getState().setActiveSessionForProject(projectId, sessionId)
}

/** The operator leaves Home for the main area, as clicking Home in the band does. */
function leaveHome(): void {
  fireEvent.click(screen.getByRole('button', { name: /^Home/ }))
}

const registry = () => useExtensionRegistry.getState()
const settings = () => useSettingsStore.getState().globalSettings
const toasts = () => useToastStore.getState().toasts

function openPalette(): void {
  act(() => shortcuts.callbacks.onOpenCommandPalette?.())
}

/** Runs a Quick Actions entry by id, as a click on its row does. */
function runAction(id: string): void {
  act(() => {
    void paletteAction(id)?.run()
  })
}

function paletteAction(id: string): QuickAction | undefined {
  return palette.props?.actions.find((a) => a.id === id)
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  mainSettings = await import('../../../src/main/storage/settings-store')
  shortcuts.callbacks = {}
  palette.props = null
  sidebar.props = null
  tabBar.editNoteSessionId = null
  facts.sessionFacts = []
  localStorage.clear()
  createSession.mockResolvedValue('ses-1')
  splitSession.mockResolvedValue(undefined)
  resetStore(useExtensionRegistry)
  resetStore(useToastStore)
  resetStore(useExtensionCommandsStore)
  resetStore(useTerminalOpenErrorStore)
  resetStore(useIntegrationsStore)
  setupApp()
})

// App opens these with React.lazy. Loading them first makes each lazy() resolve
// from the module cache, so a surface mounts within its own test.
beforeAll(async () => {
  await Promise.all([
    import('../../../src/renderer/components/settings/SettingsPanel'),
    import('../../../src/renderer/components/overview/OverviewScreen'),
  ])
})

describe('App', () => {
  // An extension backend can activate after the app (and an open Quick Actions
  // panel) is up; its commands must still show without reopening the panel.
  it('reads the extension commands again when they change', async () => {
    render(<App />)
    await waitFor(() => expect(main.sent.getCommands).toHaveBeenCalled())
    const command = { key: 'k1', extensionId: 'ext', id: 'go', label: 'Go' }
    main.sent.getCommands.mockResolvedValue({ commands: [command] })
    act(() => main.events.commandsChanged.emit())
    await waitFor(() => expect(useExtensionCommandsStore.getState().registered).toEqual([command]))
  })

  it('always shows the sidebar, with or without a workspace', () => {
    const { unmount } = render(<App />)
    expect(screen.getByTestId('unified-sidebar')).toBeTruthy()
    unmount()
    setupApp({ activeWorkspaceId: 'ws-1', workspaces: [WS1] })
    render(<App />)
    expect(screen.getByTestId('unified-sidebar')).toBeTruthy()
  })

  it('renders ToastContainer', () => {
    render(<App />)
    expect(screen.getByTestId('toast-container')).toBeTruthy()
  })

  it('loads the workspaces and settings from main on mount', async () => {
    setupApp({ workspaces: [WS1, WS2] })
    useWorkspaceStore.setState({ workspaces: [] })
    useSettingsStore.setState({ globalSettings: null })
    render(<App />)
    await waitFor(() => expect(useWorkspaceStore.getState().workspaces).toEqual([WS1, WS2]))
    expect(settings()).toEqual(mainSettings.getGlobalSettings())
  })

  it("shows the project's terminal once the operator leaves Home", () => {
    setupApp({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
    render(<App />)
    expect(screen.getByTestId('home-screen')).toBeTruthy()
    leaveHome()
    expect(screen.getByTestId('terminal-pane').textContent).toBe('proj-1')
  })

  it('shows EmptyState with workspace prompt when activeWorkspaceId but no project and welcome seen', () => {
    setupApp({
      activeWorkspaceId: 'ws-1',
      globalSettings: settingsWith({ ui: { hasSeenWelcome: true } }),
    })
    render(<App />)
    leaveHome()
    expect(screen.getByRole('heading', { name: 'Select or create a project' })).toBeTruthy()
  })

  it('shows Welcome to Terminator EmptyState when no welcome seen', () => {
    setupApp({ globalSettings: settingsWith({ ui: { hasSeenWelcome: false } }) })
    render(<App />)
    leaveHome()
    expect(screen.getByRole('heading', { name: 'Welcome to Terminator' })).toBeTruthy()
  })

  it('asks for a workspace while the settings are still on their way', () => {
    setupApp({ globalSettings: null })
    installElectronApi({
      ...main.parts,
      settings: { ...main.parts.settings, getGlobal: () => new Promise(() => {}) },
    })
    render(<App />)
    leaveHome()
    expect(screen.getByRole('heading', { name: 'Select a workspace to get started' })).toBeTruthy()
  })

  it('opens SettingsPanel via menu:open-settings IPC event', async () => {
    render(<App />)
    expect(screen.queryByTestId('settings-panel')).toBeNull()
    act(() => main.events.openSettings.emit())
    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeTruthy())
  })

  it('closes SettingsPanel when onClose is called', async () => {
    render(<App />)
    act(() => main.events.openSettings.emit())
    await waitFor(() => screen.getByText('Close Settings'))
    fireEvent.click(screen.getByText('Close Settings'))
    await waitFor(() => expect(screen.queryByTestId('settings-panel')).toBeNull())
  })

  it("marks the session exited when main reports its process's exit", () => {
    setupApp({ sessions: [terminalSessionOf({ id: 'sess-1', projectId: 'p1', tabTitle: 'zsh' })] })
    render(<App />)
    act(() => main.events.processExit.emit('sess-1', 0))
    expect(useSessionStore.getState().sessions.get('sess-1')).toMatchObject({
      status: 'closed',
      tabTitle: 'zsh [exited]',
    })
  })

  it("loads the active workspace's own settings", async () => {
    setupApp({ activeWorkspaceId: 'ws-1', workspaces: [WS1] })
    render(<App />)
    await waitFor(() =>
      expect(useSettingsStore.getState().workspaceSettings.get('ws-1')).toEqual(
        mainSettings.getWorkspaceSettings('ws-1')
      )
    )
  })

  it('records the welcome as seen once a project is opened', async () => {
    setupApp({
      activeProjectId: 'proj-1',
      activeWorkspaceId: 'ws-1',
      globalSettings: settingsWith({ ui: { hasSeenWelcome: false } }),
    })
    render(<App />)
    await waitFor(() => expect(settings()?.ui.hasSeenWelcome).toBe(true))
    expect(mainSettings.getGlobalSettings().ui.hasSeenWelcome).toBe(true)
  })

  it('opens SettingsPanel via onOpenSettings keyboard shortcut callback', async () => {
    render(<App />)
    act(() => shortcuts.callbacks.onOpenSettings?.())
    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeTruthy())
  })

  it('opens LogWindow via onToggleLog keyboard shortcut callback', async () => {
    render(<App />)
    expect(screen.queryByTestId('log-window')).toBeNull()
    act(() => shortcuts.callbacks.onToggleLog?.())
    await waitFor(() => expect(screen.getByTestId('log-window')).toBeTruthy())
  })

  it('closes LogWindow when its onClose is called', async () => {
    render(<App />)
    act(() => shortcuts.callbacks.onToggleLog?.())
    await waitFor(() => screen.getByText('Close Log'))
    fireEvent.click(screen.getByText('Close Log'))
    await waitFor(() => expect(screen.queryByTestId('log-window')).toBeNull())
  })

  it('opens CommandPalette via onOpenCommandPalette keyboard shortcut callback', async () => {
    render(<App />)
    expect(screen.queryByTestId('quick-actions')).toBeNull()
    openPalette()
    await waitFor(() => expect(screen.getByTestId('quick-actions')).toBeTruthy())
  })

  it('closes CommandPalette when its onClose is called', async () => {
    render(<App />)
    openPalette()
    await waitFor(() => screen.getByText('Close Palette'))
    fireEvent.click(screen.getByText('Close Palette'))
    await waitFor(() => expect(screen.queryByTestId('quick-actions')).toBeNull())
  })

  it('onToggleOverview keyboard shortcut opens Overview, and closes it when it is open', () => {
    render(<App />)
    act(() => shortcuts.callbacks.onToggleOverview?.())
    expect(registry().activeGlobalTabId).toBe('core.overview')
    act(() => shortcuts.callbacks.onToggleOverview?.())
    expect(registry().activeGlobalTabId).toBeNull()
  })

  it('activates core.home when the menu:open-home event fires', () => {
    render(<App />)
    leaveHome()
    act(() => main.events.openHome.emit())
    expect(registry().activeGlobalTabId).toBe('core.home')
  })

  it('renders overlay components from extension registry', () => {
    registry().registerOverlay(() => <div data-testid="mock-overlay">Overlay</div>)
    render(<App />)
    expect(screen.getByTestId('mock-overlay')).toBeTruthy()
  })

  it('renders an open extension sidebar panel, and closes it from the panel', () => {
    registry().registerSidebarPanel({
      id: 'git-changes',
      label: 'Git',
      defaultOpen: true,
      component: ({ onClose }) => (
        <div data-testid="mock-panel">
          <button onClick={onClose}>Close Panel</button>
        </div>
      ),
    })
    render(<App />)
    leaveHome()
    fireEvent.click(screen.getByText('Close Panel'))
    expect(screen.queryByTestId('mock-panel')).toBeNull()
    expect(registry().openPanels.has('git-changes')).toBe(false)
  })

  it('opens a panel when main asks to toggle it', () => {
    render(<App />)
    act(() => main.events.togglePanel.emit('git-changes'))
    expect(registry().openPanels.has('git-changes')).toBe(true)
  })

  it("shows an extension's project tab in place of the terminal once it is selected", () => {
    setupApp({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
    registry().registerProjectTab({
      id: 'git',
      label: 'Git',
      component: ({ repoRoot }) => (
        <div data-testid="project-tab-content">{repoRoot ?? 'no-root'}</div>
      ),
    })
    render(<App />)
    leaveHome()
    act(() => main.events.selectProjectTab.emit('git'))
    expect(screen.getByTestId('project-tab-content')).toBeTruthy()
    expect(screen.queryByTestId('terminal-pane')).toBeNull()
  })

  it('renders global tab component when activeGlobalTabId is set', () => {
    registry().registerGlobalTab({
      id: 'task-vault',
      label: 'Tasks',
      component: () => <div data-testid="global-tab-content">Global Tab</div>,
    })
    render(<App />)
    act(() => registry().setActiveGlobalTab('task-vault'))
    expect(screen.getByTestId('global-tab-content')).toBeTruthy()
  })

  it('does not close open panels when workspace changes', () => {
    setupApp({ activeWorkspaceId: 'ws-1', workspaces: [WS1, WS2] })
    registry().togglePanel('panel-a')
    render(<App />)
    act(() => useWorkspaceStore.getState().setActiveWorkspace('ws-2'))
    expect(registry().openPanels.has('panel-a')).toBe(true)
  })

  it('selects the project tab main asks for', () => {
    render(<App />)
    act(() => main.events.selectProjectTab.emit('git'))
    expect(registry().activeProjectTabId).toBe('git')
  })

  it('command core.open-settings action opens SettingsPanel', async () => {
    render(<App />)
    openPalette()
    runAction('core.open-settings')
    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeTruthy())
  })

  it('command core.toggle-sidebar action adds hidden class to UnifiedSidebar', async () => {
    setupApp({ activeWorkspaceId: 'ws-1' })
    render(<App />)
    openPalette()
    runAction('core.toggle-sidebar')
    await waitFor(() =>
      expect(screen.getByTestId('unified-sidebar').className).toContain('unified-sidebar--hidden')
    )
  })

  it('command core.toggle-log action opens LogWindow', async () => {
    render(<App />)
    openPalette()
    runAction('core.toggle-log')
    await waitFor(() => expect(screen.getByTestId('log-window')).toBeTruthy())
  })

  it('command core.switch-workspace-{id} action switches to that workspace', () => {
    setupApp({ activeWorkspaceId: 'ws-2', workspaces: [WS1, WS2] })
    render(<App />)
    openPalette()
    runAction('core.switch-workspace-ws-1')
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1')
  })

  it('command core.split-vertical action splits the active project', () => {
    setupApp({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1', workspaces: [WS1] })
    render(<App />)
    openPalette()
    runAction('core.split-vertical')
    expect(splitSession).toHaveBeenCalledWith('proj-1', 'vertical', '/a', 10000)
  })

  it('command core.split-horizontal action splits the active project', () => {
    setupApp({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1', workspaces: [WS1] })
    render(<App />)
    openPalette()
    runAction('core.split-horizontal')
    expect(splitSession).toHaveBeenCalledWith('proj-1', 'horizontal', '/a', 10000)
  })

  it('onSelectGlobalTab toggles activeGlobalTab off when same id clicked', () => {
    registry().registerGlobalTab({ id: 'task-vault', label: 'Tasks', component: () => null })
    render(<App />)
    act(() => registry().setActiveGlobalTab('task-vault'))
    // Pressed on the app band itself, which is where these destinations live.
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
    expect(registry().activeGlobalTabId).toBeNull()
  })

  it('EmptyState Open Settings action opens SettingsPanel', async () => {
    setupApp({ globalSettings: settingsWith({ ui: { hasSeenWelcome: false } }) })
    render(<App />)
    leaveHome()
    fireEvent.click(screen.getByRole('button', { name: /Open Settings/ }))
    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeTruthy())
  })

  describe('menu:close-tab (onMenuCloseTab)', () => {
    const tab = (id: string, projectId: string) => terminalSessionOf({ id, projectId })
    const has = (id: string) => useSessionStore.getState().sessions.has(id)

    it('closes the active session of the active project', async () => {
      setupApp({
        activeProjectId: 'proj-1',
        activeWorkspaceId: 'ws-1',
        sessions: [tab('ses-active', 'proj-1'), tab('ses-other', 'proj-1')],
      })
      showTab('proj-1', 'ses-active')
      render(<App />)
      act(() => main.events.closeTab.emit())
      await waitFor(() => expect(has('ses-active')).toBe(false))
      expect(has('ses-other')).toBe(true)
    })

    it('closes nothing when there is no active project', async () => {
      setupApp({ sessions: [tab('ses-active', 'proj-1')] })
      showTab('proj-1', 'ses-active')
      render(<App />)
      act(() => main.events.closeTab.emit())
      await act(async () => {})
      expect(has('ses-active')).toBe(true)
    })

    it('closes the scratch session once a new scratch terminal has made scratch active', async () => {
      setupApp({ activeWorkspaceId: 'ws-1', sessions: [tab('ses-scratch', SCRATCH_PROJECT_ID)] })
      showTab(SCRATCH_PROJECT_ID, 'ses-scratch')
      render(<App />)
      act(() => shortcuts.callbacks.onNewScratch?.())
      await waitFor(() => expect(useWorkspaceStore.getState().scratchActive).toBe(true))
      act(() => main.events.closeTab.emit())
      await waitFor(() => expect(has('ses-scratch')).toBe(false))
    })

    it('closes nothing when the active project has no active session', async () => {
      setupApp({
        activeProjectId: 'proj-1',
        activeWorkspaceId: 'ws-1',
        sessions: [tab('ses-1', 'proj-1')],
      })
      render(<App />)
      act(() => main.events.closeTab.emit())
      await act(async () => {})
      expect(has('ses-1')).toBe(true)
    })
  })

  it('command core.toggle-overview action opens Overview', () => {
    render(<App />)
    openPalette()
    runAction('core.toggle-overview')
    expect(registry().activeGlobalTabId).toBe('core.overview')
  })

  it('opens AboutDialog when main asks, and closes it', async () => {
    render(<App />)
    expect(screen.queryByTestId('about-dialog')).toBeNull()
    act(() => main.events.openAbout.emit())
    await waitFor(() => screen.getByTestId('about-dialog'))
    fireEvent.click(screen.getByText('Close About'))
    await waitFor(() => expect(screen.queryByTestId('about-dialog')).toBeNull())
  })

  it('opens a scratch terminal and switches to scratch once it is up', async () => {
    setupApp({ activeWorkspaceId: 'ws-1', workspaces: [WS1] })
    render(<App />)
    act(() => shortcuts.callbacks.onNewScratch?.())
    expect(createSession).toHaveBeenCalledWith(SCRATCH_PROJECT_ID, 'human', 'Scratch', '/a', 10000)
    await waitFor(() => expect(useWorkspaceStore.getState().scratchActive).toBe(true))
  })

  it('renders MetricsBar when showMetricsBar is true', () => {
    setupApp({
      globalSettings: settingsWith({ ui: { hasSeenWelcome: true, showMetricsBar: true } }),
    })
    const { container } = render(<App />)
    expect(container.querySelector('.app-global-metrics')).toBeTruthy()
  })

  it('UnifiedSidebar onSelectScratchSession activates scratch view for chosen session', () => {
    setupApp({
      activeWorkspaceId: 'ws-1',
      sessions: [terminalSessionOf({ id: 'sess-scratch', projectId: SCRATCH_PROJECT_ID })],
    })
    render(<App />)
    act(() => sidebar.props?.onSelectScratchSession('sess-scratch'))
    expect(useWorkspaceStore.getState().scratchActive).toBe(true)
    expect(useSessionStore.getState().getActiveSessionForProject(SCRATCH_PROJECT_ID)).toBe(
      'sess-scratch'
    )
    expect(registry().activeGlobalTabId).toBeNull()
  })

  it('toggles sidebar when onMenuToggleSidebar event fires', async () => {
    setupApp({ activeWorkspaceId: 'ws-1' })
    render(<App />)
    expect(screen.getByTestId('unified-sidebar').className).toBe('')
    act(() => main.events.toggleSidebar.emit())
    await waitFor(() =>
      expect(screen.getByTestId('unified-sidebar').className).toContain('unified-sidebar--hidden')
    )
  })

  it('opens a workspace tab chosen in the sidebar, in that workspace', () => {
    setupApp({ workspaces: [WS1] })
    registry().registerWorkspaceTab({
      id: 'code-reviews',
      label: 'Code Reviews',
      component: () => <div data-testid="workspace-tab-content">Workspace Tab</div>,
    })
    render(<App />)
    act(() => sidebar.props?.onSelectWorkspaceTab('ws-1', 'code-reviews'))
    expect(screen.getByTestId('workspace-tab-content')).toBeTruthy()
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1')
  })

  it('onSelectProject clears active global, workspace, and project tabs', () => {
    render(<App />)
    act(() => {
      registry().setActiveWorkspaceTab('code-reviews')
      registry().setActiveProjectTab('git')
    })
    act(() => sidebar.props?.onSelectProject?.())
    expect(registry()).toMatchObject({
      activeGlobalTabId: null,
      activeWorkspaceTabId: null,
      activeProjectTabId: null,
    })
  })

  it('tells main whether each registered panel is open, whenever that changes', async () => {
    registry().registerSidebarPanel({
      id: 'git-changes',
      label: 'Git',
      defaultOpen: true,
      component: () => null,
    })
    render(<App />)
    await waitFor(() =>
      expect(main.sent.notifyPanelState).toHaveBeenCalledWith('git-changes', true)
    )
    act(() => registry().togglePanel('git-changes'))
    await waitFor(() =>
      expect(main.sent.notifyPanelState).toHaveBeenLastCalledWith('git-changes', false)
    )
    expect(JSON.parse(localStorage.getItem('openPanels') ?? '')).toEqual([])
  })

  it('reopens saved panels from localStorage that are not yet open on mount', () => {
    localStorage.setItem('openPanels', JSON.stringify(['saved-panel']))
    render(<App />)
    expect(registry().openPanels.has('saved-panel')).toBe(true)
  })

  it('shows an open panel when the bridge has no extensionEvents (the remote window)', () => {
    const { extensionEvents: _left, ...remote } = main.parts
    installElectronApi(remote)
    registry().registerSidebarPanel({
      id: 'git-changes',
      label: 'Git',
      defaultOpen: true,
      component: () => <div data-testid="mock-panel" />,
    })
    render(<App />)
    leaveHome()
    expect(screen.getByTestId('mock-panel')).toBeTruthy()
  })

  describe('Home', () => {
    it('registers Home as a permanent core tab, ahead of Overview', () => {
      render(<App />)
      const tabs = [...registry().globalTabs.values()]
      expect(tabs.map((t) => [t.id, t.permanent])).toEqual([
        ['core.home', true],
        ['core.overview', true],
      ])
    })

    it('opens on Home at launch', () => {
      render(<App />)
      expect(registry().activeGlobalTabId).toBe('core.home')
      expect(screen.getByTestId('home-screen')).toBeTruthy()
    })

    it('badges Home with the number of sessions waiting on the operator', () => {
      // State is derived, never read from the store: a bell or a visible choice
      // makes a session wait on the operator; a closed one never does.
      const session = (id: string, patch: Partial<TerminalSession>) =>
        terminalSessionOf({ id, projectId: 'p', ...patch })
      setupApp({
        sessions: [
          session('a', { bellCount: 1 }),
          session('b', { choicePrompt: { question: 'Proceed?', options: [] } }),
          session('c', { busy: true }),
          session('d', { bellCount: 2, status: 'closed' }),
        ],
      })
      render(<App />)
      expect(registry().globalTabs.get('core.home')).toMatchObject({
        badge: 2,
        badgeLabel: '2 need you',
      })
      expect(screen.getByRole('button', { name: 'Home, 2 need you' })).toBeTruthy()
    })
  })

  describe('auto-open terminal failure', () => {
    it("keeps the reason a branch's first terminal failed to open", async () => {
      createSession.mockRejectedValue(new Error('spawn EBADF'))
      setupApp({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
      render(<App />)
      await waitFor(() =>
        expect(useTerminalOpenErrorStore.getState().errors['proj-1']).toBe('spawn EBADF')
      )
      expect(createSession).toHaveBeenCalledTimes(1)
    })

    it('opens again when Try again bumps the retry, and clears the error on success', async () => {
      createSession.mockRejectedValueOnce(new Error('spawn EBADF')).mockResolvedValue('ses-1')
      setupApp({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
      render(<App />)
      await waitFor(() =>
        expect(useTerminalOpenErrorStore.getState().errors['proj-1']).toBeTruthy()
      )
      act(() => useTerminalOpenErrorStore.getState().retry('proj-1'))
      await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2))
      await waitFor(() =>
        expect(useTerminalOpenErrorStore.getState().errors['proj-1']).toBeUndefined()
      )
    })
  })

  describe('handleNewTab', () => {
    const promptForName = () => settingsWith({ terminal: { promptForName: true } })

    it('does nothing when there is no active project and scratchActive is false', () => {
      render(<App />)
      act(() => shortcuts.callbacks.onNewTab?.())
      expect(createSession).not.toHaveBeenCalled()
    })

    it('opens a terminal straight away when promptForName is off', () => {
      setupApp({
        activeProjectId: 'proj-1',
        activeWorkspaceId: 'ws-1',
        workspaces: [WS1],
        sessions: [terminalSessionOf({ id: 'existing', projectId: 'proj-1' })],
      })
      render(<App />)
      act(() => shortcuts.callbacks.onNewTab?.())
      expect(createSession).toHaveBeenCalledWith('proj-1', 'human', '', '/a', 10000)
    })

    it('shows NameTerminalDialog when promptForName is true', async () => {
      setupApp({
        activeProjectId: 'proj-1',
        activeWorkspaceId: 'ws-1',
        globalSettings: promptForName(),
        sessions: [terminalSessionOf({ id: 'existing', projectId: 'proj-1' })],
      })
      useSessionStore.setState({
        projectViews: new Map([['proj-1', { terminalCounter: 2, activeSessionId: 'existing' }]]),
      })
      render(<App />)
      leaveHome()
      act(() => shortcuts.callbacks.onNewTab?.())
      await waitFor(() => expect(screen.getByTestId('name-terminal-dialog')).toBeTruthy())
      expect(screen.getByTestId('name-terminal-default').textContent).toBe('Terminal 3')
    })

    it('NameTerminalDialog onConfirm opens the named terminal and closes the dialog', async () => {
      setupApp({
        activeProjectId: 'proj-1',
        activeWorkspaceId: 'ws-1',
        globalSettings: promptForName(),
        sessions: [terminalSessionOf({ id: 'existing', projectId: 'proj-1' })],
      })
      render(<App />)
      act(() => shortcuts.callbacks.onNewTab?.())
      await waitFor(() => screen.getByTestId('name-terminal-dialog'))
      fireEvent.click(screen.getByText('Confirm'))
      await waitFor(() => expect(screen.queryByTestId('name-terminal-dialog')).toBeNull())
      expect(createSession).toHaveBeenCalledWith('proj-1', 'human', 'My Terminal', '~', 10000)
    })

    it('NameTerminalDialog onCancel closes dialog without creating a named session', async () => {
      setupApp({
        activeProjectId: 'proj-1',
        activeWorkspaceId: 'ws-1',
        globalSettings: promptForName(),
        sessions: [terminalSessionOf({ id: 'existing', projectId: 'proj-1' })],
      })
      render(<App />)
      act(() => shortcuts.callbacks.onNewTab?.())
      await waitFor(() => screen.getByTestId('name-terminal-dialog'))
      fireEvent.click(screen.getByText('Cancel Dialog'))
      await waitFor(() => expect(screen.queryByTestId('name-terminal-dialog')).toBeNull())
      expect(createSession).not.toHaveBeenCalled()
    })
  })

  it('reopens saved panels when switching back to Terminal tab', () => {
    setupApp({ activeProjectId: 'proj-1' })
    registry().togglePanel('panel-a')
    render(<App />)
    act(() => registry().setActiveProjectTab('git'))
    expect(registry().openPanels.has('panel-a')).toBe(false)
    act(() => registry().setActiveProjectTab(null))
    expect(registry().openPanels.has('panel-a')).toBe(true)
  })
})

describe('App — command palette sessions and note editing (US6)', () => {
  const paletteSession = terminalSessionOf({
    id: 's1',
    projectId: 'proj-1',
    tabTitle: 'api-shell',
    type: 'agent',
  })
  const projects = new Map([['ws-1', [PROJ1]]])

  it('offers open sessions to the panel, one action per session named by project', () => {
    setupApp({ sessions: [paletteSession], projectsByWorkspaceId: projects })
    render(<App />)
    openPalette()
    expect(paletteAction('session:s1')).toMatchObject({ label: 'api-shell', description: 'API' })
  })

  it('omits closed sessions from the panel', () => {
    setupApp({
      sessions: [{ ...paletteSession, status: 'closed' }],
      projectsByWorkspaceId: projects,
    })
    render(<App />)
    openPalette()
    expect(paletteAction('session:s1')).toBeUndefined()
  })

  it('leaves the project name blank when the project is unknown', () => {
    setupApp({ sessions: [paletteSession] })
    render(<App />)
    openPalette()
    expect(paletteAction('session:s1')?.description).toBe('')
  })

  it('activates both the project and the session when one is chosen', () => {
    setupApp({ sessions: [paletteSession], projectsByWorkspaceId: projects })
    render(<App />)
    openPalette()
    runAction('session:s1')
    expect(useWorkspaceStore.getState().activeProjectId).toBe('proj-1')
    expect(useSessionStore.getState().getActiveSessionForProject('proj-1')).toBe('s1')
  })

  it('asks the tab bar to edit the active terminal note on Cmd+I', () => {
    setupApp({ activeProjectId: 'proj-1', sessions: [paletteSession] })
    showTab('proj-1', 's1')
    render(<App />)
    leaveHome()
    act(() => shortcuts.callbacks.onEditSessionNote?.())
    expect(tabBar.editNoteSessionId).toBe('s1')
  })

  it('asks for nothing when no project is active', () => {
    render(<App />)
    act(() => shortcuts.callbacks.onEditSessionNote?.())
    expect(tabBar.editNoteSessionId).toBeNull()
  })
})

describe('App — Quick Actions integration (feature 057)', () => {
  it('opens the panel via the quickActions.onOpen bridge event', async () => {
    render(<App />)
    expect(screen.queryByTestId('quick-actions')).toBeNull()
    act(() => main.events.quickActionsOpen.emit())
    await waitFor(() => expect(screen.getByTestId('quick-actions')).toBeTruthy())
  })

  it('pressing Cmd+P again while open bumps the searchSignal prop', async () => {
    render(<App />)
    openPalette()
    await waitFor(() => screen.getByTestId('quick-actions'))
    const before = palette.props?.searchSignal ?? 0
    openPalette()
    expect(palette.props?.searchSignal).toBe(before + 1)
  })

  it('running an action records its use in the saved settings', async () => {
    render(<App />)
    openPalette()
    act(() => palette.props?.onRun(paletteAction('core.clear')!))
    await waitFor(() =>
      expect(settings()?.quickActions.usage.some((u) => u.id === 'core.clear')).toBe(true)
    )
  })

  it('shows a "Next time" hint toast when a shortcut action with a fresh direct-use count runs', () => {
    render(<App />)
    openPalette()
    act(() => palette.props?.onRun(paletteAction('core.clear')!))
    expect(toasts()).toContainEqual(
      expect.objectContaining({ type: 'info', message: expect.stringContaining('Next time') })
    )
  })

  it('the AppBand Quick actions button opens the panel', async () => {
    render(<App />)
    expect(screen.queryByTestId('quick-actions')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Quick actions (⌘P)' }))
    await waitFor(() => expect(screen.getByTestId('quick-actions')).toBeTruthy())
  })

  it('runs the terminal, session and workspace core actions against the stores', async () => {
    const s1 = terminalSessionOf({ id: 's1', projectId: 'proj-1' })
    const s2 = terminalSessionOf({
      id: 's2',
      projectId: 'proj-2',
      agentState: 'awaiting-input',
      lastAttendedAt: 5,
    })
    const s3 = terminalSessionOf({ id: 's3', projectId: 'proj-1' })
    setupApp({
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-1',
      workspaces: [WS1, WS2],
      projectsByWorkspaceId: new Map([
        ['ws-1', [PROJ1]],
        ['ws-2', [projectOf({ id: 'proj-2', workspaceId: 'ws-2' })]],
      ]),
      sessions: [s1, s2, s3],
    })
    showTab('proj-1', 's1')
    render(<App />)
    openPalette()
    const shown = (projectId: string) =>
      useSessionStore.getState().getActiveSessionForProject(projectId)

    runAction('core.cycle-recent-next')
    expect(shown('proj-2')).toBe('s2')

    runAction('core.next-waiting')
    expect(shown('proj-2')).toBe('s2')

    runAction('session:s1')
    expect(useWorkspaceStore.getState()).toMatchObject({
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-1',
    })
    runAction('core.prev-tab')
    expect(shown('proj-1')).toBe('s3')

    runAction('core.close-tab')
    await waitFor(() => expect(useSessionStore.getState().sessions.has('s3')).toBe(false))

    runAction('core.cycle-workspace-next')
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-2')
  })

  it('"Link issue" opens the dialog for the focused terminal\'s own session', async () => {
    facts.sessionFacts = [{ sessionId: 's1', workItem: null }]
    setupApp({
      activeProjectId: 'proj-1',
      activeWorkspaceId: 'ws-1',
      sessions: [terminalSessionOf({ id: 's1', projectId: 'proj-1' })],
    })
    showTab('proj-1', 's1')
    render(<App />)
    openPalette()
    runAction('core.link-issue')
    expect(screen.getByTestId('session-link-dialog').textContent).toContain('s1')
  })

  it('"Link issue to branch" opens the branch dialog rather than the session one', () => {
    facts.sessionFacts = [{ sessionId: 's1', workItem: null }]
    setupApp({
      activeProjectId: 'proj-1',
      activeWorkspaceId: 'ws-1',
      sessions: [terminalSessionOf({ id: 's1', projectId: 'proj-1' })],
    })
    showTab('proj-1', 's1')
    render(<App />)
    openPalette()
    runAction('core.link-issue-branch')
    expect(useIntegrationsStore.getState().linkDialogProjectId).toBe('proj-1')
    expect(screen.queryByTestId('session-link-dialog')).toBeNull()
  })

  it('pinning an action saves it in the pins', async () => {
    render(<App />)
    openPalette()
    act(() => palette.props?.onTogglePin('core.clear'))
    await waitFor(() => expect(settings()?.quickActions.pins).toEqual(['core.clear']))
  })

  it('unpinning an already-pinned action removes it from the saved pins', async () => {
    setupApp({ globalSettings: settingsWith({ quickActions: { pins: ['core.clear'] } }) })
    render(<App />)
    openPalette()
    act(() => palette.props?.onTogglePin('core.clear'))
    await waitFor(() => expect(settings()?.quickActions.pins).toEqual([]))
  })
})

describe('App — Quick Actions branch coverage (context, surfaces, custom vars, errors)', () => {
  const customAction = (id: string, body: string, target: 'new-tab' | 'focused') =>
    settingsWith({
      ui: { hasSeenWelcome: true },
      quickActions: { custom: [{ id, label: id, kind: 'shell', target, body }] },
    })
  const shell = terminalSessionOf({ id: 's1', projectId: 'proj-1', tabTitle: 'shell' })

  it('labels the context "in <group label>" when an extension surface is active', () => {
    registry().setQuickActionGroups([
      { id: 'ext:git-integration', mnemonic: 'g', label: 'Git', owner: 'git-integration' },
    ])
    render(<App />)
    act(() => registry().setActiveGlobalTab('git-integration'))
    openPalette()
    expect(palette.props?.contextGroupId).toBe('ext:git-integration')
    expect(palette.props?.contextLabel).toBe('in Git')
  })

  it('labels the context "in terminal · <tab title>" when a terminal is focused and no surface is active', () => {
    setupApp({ activeProjectId: 'proj-1', sessions: [{ ...shell, tabTitle: 'api-shell' }] })
    showTab('proj-1', 's1')
    render(<App />)
    openPalette()
    expect(palette.props?.contextGroupId).toBeNull()
    expect(palette.props?.contextLabel).toBe('in terminal · api-shell')
  })

  it('shows no context label with no surface active and no terminal focused', () => {
    render(<App />)
    openPalette()
    expect(palette.props?.contextGroupId).toBeNull()
    expect(palette.props?.contextLabel).toBeUndefined()
  })

  it('extension:show-surface activates the registered surface matching the extension id and view', () => {
    registry().registerGlobalTab({
      id: 'git-integration',
      label: 'Git',
      view: 'main',
      component: () => null,
    })
    render(<App />)
    act(() =>
      main.events.bridge.emit('extension:show-surface', {
        extensionId: 'git-integration',
        view: 'main',
      })
    )
    expect(registry().activeGlobalTabId).toBe('git-integration')
  })

  it('extension:show-surface does nothing when no registered surface matches', () => {
    registry().registerGlobalTab({
      id: 'git-integration',
      label: 'Git',
      view: 'main',
      component: () => null,
    })
    render(<App />)
    act(() =>
      main.events.bridge.emit('extension:show-surface', {
        extensionId: 'not-registered',
        view: 'main',
      })
    )
    expect(registry().activeGlobalTabId).toBe('core.home')
  })

  it('disables a custom action referencing {issue} with "No linked issue" when nothing is linked', () => {
    setupApp({
      activeProjectId: 'proj-1',
      activeWorkspaceId: 'ws-1',
      globalSettings: customAction('c1', 'echo {issue}', 'new-tab'),
    })
    render(<App />)
    openPalette()
    expect(paletteAction('custom:c1')?.disabledReason).toBe('No linked issue')
  })

  it('enables a custom action referencing {issue} once the project has a linked issue', () => {
    setupApp({
      activeProjectId: 'proj-1',
      activeWorkspaceId: 'ws-1',
      globalSettings: customAction('c1', 'echo {issue}', 'new-tab'),
    })
    useIntegrationsStore.setState({
      links: new Map([
        [
          'proj-1',
          {
            projectId: 'proj-1',
            tracker: 'linear',
            key: 'ABC-1',
            injectContext: false,
            linkedAt: '',
          },
        ],
      ]),
    })
    render(<App />)
    openPalette()
    expect(paletteAction('custom:c1')?.disabledReason).toBeUndefined()
  })

  it('disables a custom action referencing {selection} with "No text selected" when nothing is selected', () => {
    setupApp({
      activeProjectId: 'proj-1',
      globalSettings: customAction('c2', 'echo {selection}', 'focused'),
      sessions: [shell],
    })
    showTab('proj-1', 's1')
    render(<App />)
    openPalette()
    expect(paletteAction('custom:c2')?.disabledReason).toBe('No text selected')
  })

  it('enables and runs a custom action referencing {selection} once there is a selection', () => {
    setupApp({
      activeProjectId: 'proj-1',
      globalSettings: customAction('c2', 'echo {selection}', 'focused'),
      sessions: [shell],
    })
    showTab('proj-1', 's1')
    useSessionStore
      .getState()
      .setTerminalInstance(
        's1',
        partialFake<TerminalInstance>({ getSelection: () => 'picked-text' })
      )
    render(<App />)
    openPalette()
    const action = paletteAction('custom:c2')!
    expect(action.disabledReason).toBeUndefined()
    act(() => palette.props?.onRun(action))
    expect(main.sent.input).toHaveBeenCalledWith('s1', expect.stringContaining('picked-text'))
  })

  it('shows an error toast with the thrown message when an action fails synchronously', async () => {
    render(<App />)
    openPalette()
    act(() =>
      palette.props?.onRun({
        id: 'test.throws-error',
        label: 'Throws',
        group: 'top',
        run: () => {
          throw new Error('boom')
        },
      })
    )
    await waitFor(() =>
      expect(toasts()).toContainEqual(expect.objectContaining({ type: 'error', message: 'boom' }))
    )
  })

  it('shows a generic "Action failed" error toast when a non-Error value is rejected', async () => {
    render(<App />)
    openPalette()
    act(() =>
      palette.props?.onRun({
        id: 'test.rejects-string',
        label: 'Rejects',
        group: 'top',
        run: () => Promise.reject('nope'),
      })
    )
    await waitFor(() =>
      expect(toasts()).toContainEqual(
        expect.objectContaining({ type: 'error', message: 'Action failed' })
      )
    )
  })

  it('suppresses the "Next time" hint once the shortcut has been used directly three times', () => {
    setupApp({
      globalSettings: settingsWith({
        quickActions: { directUse: [{ id: 'core.clear', count: 3 }] },
      }),
    })
    render(<App />)
    openPalette()
    act(() => palette.props?.onRun(paletteAction('core.clear')!))
    expect(toasts()).not.toContainEqual(expect.objectContaining({ type: 'info' }))
  })

  it('records direct-use for Home, sidebar-toggle, settings and close-tab menu accelerators', async () => {
    setupApp({ activeProjectId: 'proj-1' })
    render(<App />)
    const directUse = () => settings()?.quickActions.directUse.map((d) => d.id) ?? []

    act(() => main.events.openHome.emit())
    await waitFor(() => expect(directUse()).toContain('core.open-home'))

    act(() => main.events.toggleSidebar.emit())
    await waitFor(() => expect(directUse()).toContain('core.toggle-sidebar'))

    act(() => main.events.openSettings.emit())
    await waitFor(() => expect(directUse()).toContain('core.open-settings'))

    act(() => main.events.closeTab.emit())
    await waitFor(() => expect(directUse()).toContain('core.close-tab'))
  })

  it('writes no settings for a shortcut whose hint has already stopped showing', () => {
    setupApp({
      globalSettings: settingsWith({
        quickActions: { directUse: [{ id: 'core.new-tab', count: 3 }] },
      }),
    })
    render(<App />)
    for (let press = 0; press < 5; press++) {
      act(() => shortcuts.callbacks.onDirectShortcut?.('core.new-tab'))
    }
    expect(main.sent.updateGlobal).not.toHaveBeenCalled()
  })

  it('leaves everything as it was for core actions with no project, no sessions and no workspaces', () => {
    render(<App />)
    openPalette()
    for (const id of [
      'core.split-vertical',
      'core.close-tab',
      'core.clear',
      'core.prev-tab',
      'core.cycle-recent-next',
      'core.next-waiting',
      'core.cycle-workspace-next',
      'core.copy-issue-key',
      'core.open-issue',
    ]) {
      runAction(id)
    }
    expect(splitSession).not.toHaveBeenCalled()
    expect(main.sent.input).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull()
    expect(toasts()).not.toContainEqual(expect.objectContaining({ type: 'error' }))
  })
})
