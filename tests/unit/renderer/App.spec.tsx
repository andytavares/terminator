import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useWorkspaceStore } from '../../../src/renderer/stores/workspace.store'
import { useSettingsStore } from '../../../src/renderer/stores/settings.store'
import { useSessionStore } from '../../../src/renderer/stores/session.store'
import { useToastStore } from '../../../src/renderer/stores/toast.store'
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { useTerminalSession } from '../../../src/renderer/hooks/useTerminalSession'
import { useIntegrationsStore } from '../../../src/renderer/stores/integrations.store'
import { App } from '../../../src/renderer/App'

// Mock all child components and hooks to focus on App logic
vi.mock('../../../src/renderer/stores/workspace.store', () => ({ useWorkspaceStore: vi.fn() }))
vi.mock('../../../src/renderer/stores/settings.store', () => ({
  useSettingsStore: Object.assign(vi.fn(), { getState: vi.fn() }),
}))
vi.mock('../../../src/renderer/stores/session.store', () => ({ useSessionStore: vi.fn() }))
vi.mock('../../../src/renderer/stores/toast.store', () => ({ useToastStore: vi.fn() }))
vi.mock('../../../src/renderer/stores/log.store', () => ({ installLogInterceptor: vi.fn() }))
vi.mock('../../../src/renderer/extensions/registry', () => {
  const useExtensionRegistry = vi.fn()
  ;(useExtensionRegistry as unknown as { getState: () => unknown }).getState = vi.fn(() => ({
    registerGlobalTab: vi.fn(() => vi.fn()),
    updateGlobalTab: vi.fn(),
    setActiveGlobalTab: vi.fn(),
    sidebarPanels: new Map(),
  }))
  return { useExtensionRegistry }
})
vi.mock('../../../src/renderer/extensions/loader', () => ({}))
type ShortcutCallbacks = {
  onOpenSettings?: () => void
  onToggleLog?: () => void
  onOpenCommandPalette?: () => void
  onToggleOverview?: () => void
  onNewScratch?: () => void
  onNewTab?: () => void
  onEditSessionNote?: () => void
}
let capturedShortcutCallbacks: ShortcutCallbacks = {}
vi.mock('../../../src/renderer/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn().mockImplementation((opts: ShortcutCallbacks = {}) => {
    capturedShortcutCallbacks = opts
  }),
}))
vi.mock('../../../src/renderer/hooks/useTerminalSession', () => ({
  useTerminalSession: vi.fn(() => ({
    // Both resolve: the real hook hands back promises, and every call site
    // attaches a rejection handler to them.
    createSession: vi.fn().mockResolvedValue('ses-1'),
    splitSession: vi.fn().mockResolvedValue(undefined),
  })),
}))
type QuickActionLike = { id: string; label: string; group: string; run: () => void }
type QuickActionsProps = {
  onClose: () => void
  actions: QuickActionLike[]
  groups?: unknown[]
  pinned?: QuickActionLike[]
  recent?: QuickActionLike[]
  contextGroupId?: string | null
  contextLabel?: string
  onRun?: (a: QuickActionLike) => void
  onTogglePin?: (id: string) => void
}
let capturedQuickActionsProps: QuickActionsProps | null = null
// Back-compat aliases so the many pre-existing assertions below (written
// against the old CommandPalette) keep reading from the same live data.
let capturedPaletteCommands: QuickActionLike[] = []
vi.mock('../../../src/renderer/components/QuickActions', () => ({
  QuickActions: (props: QuickActionsProps) => {
    capturedQuickActionsProps = props
    capturedPaletteCommands = props.actions
    return (
      <div data-testid="quick-actions">
        <button onClick={props.onClose}>Close Palette</button>
      </div>
    )
  },
}))

let capturedOnSelectSession: ((sessionId: string) => void) | null = null
let capturedOnSelectProject: (() => void) | null = null
let capturedEditNoteSessionId: string | null = null
vi.mock('../../../src/renderer/components/sidebar/UnifiedSidebar', () => ({
  UnifiedSidebar: ({
    onSelectScratchSession,
    onSelectProject,
    visible,
  }: {
    onSelectScratchSession: (sessionId: string) => void
    onSelectProject?: () => void
    visible: boolean
  }) => {
    capturedOnSelectSession = onSelectScratchSession
    capturedOnSelectProject = onSelectProject ?? null
    return (
      <div data-testid="unified-sidebar" className={visible ? '' : 'unified-sidebar--hidden'} />
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
  TerminalPane: () => <div data-testid="terminal-pane" />,
}))
vi.mock('../../../src/renderer/components/terminal/TabBar', () => ({
  TabBar: ({ editNoteSessionId }: { editNoteSessionId?: string | null }) => {
    // App sets the id then clears it on a microtask, so pressing the shortcut
    // twice reopens the editor. The last render therefore always sees null —
    // what the test is asking is whether the tab bar was ever handed the id.
    if (editNoteSessionId) capturedEditNoteSessionId = editNoteSessionId
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
type EmptyStateAction = { label: string; onClick: () => void }
vi.mock('../../../src/renderer/components/EmptyState', () => ({
  EmptyState: ({ title, actions }: { title: string; actions?: EmptyStateAction[] }) => (
    <div data-testid="empty-state">
      {title}
      {actions?.map((a) => (
        <button key={a.label} onClick={a.onClick}>
          {a.label}
        </button>
      ))}
    </div>
  ),
}))

const mockLoadWorkspaces = vi.fn()
const mockLoadSettings = vi.fn()
const mockMarkWelcomeSeen = vi.fn()
const mockHandleProcessExit = vi.fn()
const mockAddToast = vi.fn()

const defaultExtensionRegistry = {
  sidebarPanels: new Map(),
  projectTabs: new Map(),
  globalTabs: new Map(),
  workspaceTabs: new Map(),
  openPanels: new Set<string>(),
  activeProjectTabId: null,
  activeGlobalTabId: null,
  activeWorkspaceTabId: null,
  togglePanel: vi.fn(),
  setActiveProjectTab: vi.fn(),
  setActiveGlobalTab: vi.fn(),
  setActiveWorkspaceTab: vi.fn(),
  keyboardShortcuts: [],
  commands: [],
  overlays: [],
  // App draws the app band itself now, which reads the contributed items.
  sidebarButtons: [],
  quickActionGroups: [],
}

function setupMocks(
  overrides: {
    activeWorkspaceId?: string | null
    activeProjectId?: string | null
    globalSettings?: Record<string, unknown> | null
    workspaces?: unknown[]
    scratchActive?: boolean
    sessions?: Map<string, unknown>
    projectViews?: Map<string, unknown>
    projectsByWorkspaceId?: Map<string, unknown>
  } = {}
) {
  const {
    activeWorkspaceId = null,
    activeProjectId = null,
    globalSettings = { appearance: { theme: 'dark' }, ui: { hasSeenWelcome: false } },
    workspaces = [],
    scratchActive: initialScratchActive = false,
  } = overrides

  const workspaceState = {
    loadWorkspaces: mockLoadWorkspaces,
    activeWorkspaceId,
    activeProjectId,
    workspaces,
    projectsByWorkspaceId: overrides.projectsByWorkspaceId ?? new Map(),
    setActiveWorkspace: vi.fn(),
    setActiveProject: mockSetActiveProject,
    resolveActiveCwd: vi.fn().mockReturnValue('~'),
    scratchActive: initialScratchActive,
    setScratchActive: vi.fn((value: boolean) => {
      workspaceState.scratchActive = value
      vi.mocked(useWorkspaceStore).mockReturnValue(
        workspaceState as unknown as ReturnType<typeof useWorkspaceStore>
      )
    }),
  }
  vi.mocked(useWorkspaceStore).mockReturnValue(
    workspaceState as unknown as ReturnType<typeof useWorkspaceStore>
  )
  const settingsState = {
    loadSettings: mockLoadSettings,
    globalSettings,
    markWelcomeSeen: mockMarkWelcomeSeen,
    resolveSettings: vi.fn().mockReturnValue({ terminal: { scrollbackLimit: 5000 } }),
    updateQuickActions: vi.fn().mockResolvedValue(undefined),
    workspaceSettings: new Map(),
  }
  vi.mocked(useSettingsStore).mockReturnValue(
    settingsState as unknown as ReturnType<typeof useWorkspaceStore>
  )
  vi.mocked(useSettingsStore.getState).mockReturnValue(
    settingsState as unknown as ReturnType<typeof useSettingsStore.getState>
  )
  vi.mocked(useSessionStore).mockReturnValue({
    handleProcessExit: mockHandleProcessExit,
    getSessionsForProject: vi.fn().mockReturnValue([]),
    getActiveSessionForProject: vi.fn().mockReturnValue(null),
    getFocusedSession: vi.fn().mockReturnValue(null),
    getPaneLayout: vi.fn().mockReturnValue(null),
    closeSplitLeaf: vi.fn(),
    getTerminalInstance: vi.fn().mockReturnValue(undefined),
    getScratchSessions: vi.fn().mockReturnValue([]),
    sessions: overrides.sessions ?? new Map(),
    setActiveSessionForProject: mockSetActiveSessionForProject,
    closeSession: vi.fn().mockResolvedValue(undefined),
    projectViews: overrides.projectViews ?? new Map(),
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useToastStore).mockReturnValue({
    addToast: mockAddToast,
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useExtensionRegistry).mockReturnValue(
    defaultExtensionRegistry as unknown as ReturnType<typeof useExtensionRegistry>
  )
}

const mockSetActiveProject = vi.fn()
const mockSetActiveSessionForProject = vi.fn()

let mockUnsubscribe: ReturnType<typeof vi.fn>

beforeEach(() => {
  capturedEditNoteSessionId = null

  vi.clearAllMocks()
  capturedPaletteCommands = []
  capturedOnSelectSession = null
  capturedOnSelectProject = null
  mockUnsubscribe = vi.fn()
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    terminal: {
      onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe),
    },
    extensionEvents: null,
    notifications: {
      list: vi.fn().mockResolvedValue([]),
      dismiss: vi.fn().mockResolvedValue({ ok: true }),
      onPush: vi.fn().mockReturnValue(mockUnsubscribe),
    },
    extensionBridge: {
      on: vi.fn().mockReturnValue(mockUnsubscribe),
      invoke: vi.fn().mockResolvedValue({}),
    },
    extension: {
      setBottomInset: vi.fn(),
      getCommands: vi.fn().mockResolvedValue({ commands: [] }),
      list: vi.fn().mockResolvedValue({ extensions: [] }),
      executeCommand: vi.fn(),
    },
    quickActions: {
      onOpen: vi.fn().mockReturnValue(mockUnsubscribe),
    },
  }
  setupMocks()
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('App', () => {
  it('renders UnifiedSidebar', () => {
    render(<App />)
    expect(screen.getByTestId('unified-sidebar')).toBeTruthy()
  })

  it('renders ToastContainer', () => {
    render(<App />)
    expect(screen.getByTestId('toast-container')).toBeTruthy()
  })

  it('calls loadWorkspaces and loadSettings on mount', () => {
    render(<App />)
    expect(mockLoadWorkspaces).toHaveBeenCalled()
    expect(mockLoadSettings).toHaveBeenCalled()
  })

  it('shows UnifiedSidebar when activeWorkspaceId is set', () => {
    setupMocks({
      activeWorkspaceId: 'ws-1',
      workspaces: [{ id: 'ws-1', name: 'Test', folderPath: '/test', color: '#fff', tags: [] }],
    })
    render(<App />)
    expect(screen.getByTestId('unified-sidebar')).toBeTruthy()
  })

  it('shows UnifiedSidebar even when no activeWorkspaceId (sidebar is always present)', () => {
    setupMocks({ activeWorkspaceId: null })
    render(<App />)
    expect(screen.getByTestId('unified-sidebar')).toBeTruthy()
  })

  it('shows TerminalPane when activeProjectId is set', () => {
    setupMocks({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
    render(<App />)
    expect(screen.getByTestId('terminal-pane')).toBeTruthy()
  })

  it('shows EmptyState with workspace prompt when activeWorkspaceId but no project and welcome seen', () => {
    setupMocks({
      activeWorkspaceId: 'ws-1',
      activeProjectId: null,
      globalSettings: { ui: { hasSeenWelcome: true } },
    })
    render(<App />)
    expect(screen.getByTestId('empty-state')).toBeTruthy()
    expect(screen.getByText('Select or create a project')).toBeTruthy()
  })

  it('shows Welcome to Terminator EmptyState when no welcome seen', () => {
    setupMocks({
      activeWorkspaceId: null,
      activeProjectId: null,
      globalSettings: { ui: { hasSeenWelcome: false } },
    })
    render(<App />)
    expect(screen.getByTestId('empty-state')).toBeTruthy()
    expect(screen.getByText('Welcome to Terminator')).toBeTruthy()
  })

  it('shows select workspace prompt when globalSettings is null', () => {
    setupMocks({
      activeWorkspaceId: null,
      activeProjectId: null,
      globalSettings: null,
    })
    render(<App />)
    expect(screen.getByTestId('empty-state')).toBeTruthy()
    expect(screen.getByText('Select a workspace to get started')).toBeTruthy()
  })

  it('does not show SettingsPanel by default', () => {
    render(<App />)
    expect(screen.queryByTestId('settings-panel')).toBeNull()
  })

  it('opens SettingsPanel via menu:open-settings IPC event', async () => {
    let openSettingsCb: (() => void) | null = null
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      terminal: { onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe) },
      extensionEvents: {
        onMenuOpenSettings: (cb: () => void) => {
          openSettingsCb = cb
          return vi.fn()
        },
        onMenuToggleSidebar: vi.fn().mockReturnValue(vi.fn()),
        onMenuOpenPrReviewWindow: vi.fn().mockReturnValue(vi.fn()),
        onTogglePanel: vi.fn().mockReturnValue(vi.fn()),
        onSelectProjectTab: vi.fn().mockReturnValue(vi.fn()),
      },
      extensionBridge: {
        on: vi.fn().mockReturnValue(mockUnsubscribe),
        invoke: vi.fn().mockResolvedValue({}),
      },
    }
    render(<App />)
    openSettingsCb?.()
    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeTruthy())
  })

  it('closes SettingsPanel when onClose is called', async () => {
    let openSettingsCb: (() => void) | null = null
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      terminal: { onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe) },
      extensionEvents: {
        onMenuOpenSettings: (cb: () => void) => {
          openSettingsCb = cb
          return vi.fn()
        },
        onMenuToggleSidebar: vi.fn().mockReturnValue(vi.fn()),
        onMenuOpenPrReviewWindow: vi.fn().mockReturnValue(vi.fn()),
        onTogglePanel: vi.fn().mockReturnValue(vi.fn()),
        onSelectProjectTab: vi.fn().mockReturnValue(vi.fn()),
      },
      extensionBridge: {
        on: vi.fn().mockReturnValue(mockUnsubscribe),
        invoke: vi.fn().mockResolvedValue({}),
      },
    }
    render(<App />)
    openSettingsCb?.()
    await waitFor(() => screen.getByText('Close Settings'))
    fireEvent.click(screen.getByText('Close Settings'))
    await waitFor(() => expect(screen.queryByTestId('settings-panel')).toBeNull())
  })

  it('does not show LogWindow by default', () => {
    render(<App />)
    expect(screen.queryByTestId('log-window')).toBeNull()
  })

  it('subscribes to terminal process exit events on mount', () => {
    render(<App />)
    expect(
      (globalThis as unknown as Record<string, unknown>).electronAPI as Record<string, unknown>
    ).toBeTruthy()
    expect(
      (window.electronAPI as unknown as { terminal: { onProcessExit: ReturnType<typeof vi.fn> } })
        .terminal.onProcessExit
    ).toHaveBeenCalled()
  })

  it('calls loadSettings with activeWorkspaceId when workspace changes', () => {
    setupMocks({ activeWorkspaceId: 'ws-1' })
    render(<App />)
    expect(mockLoadSettings).toHaveBeenCalledWith('ws-1')
  })

  it('calls markWelcomeSeen when activeProjectId is set and welcome not seen', () => {
    setupMocks({
      activeProjectId: 'proj-1',
      activeWorkspaceId: 'ws-1',
      globalSettings: { ui: { hasSeenWelcome: false } },
    })
    render(<App />)
    expect(mockMarkWelcomeSeen).toHaveBeenCalled()
  })

  it('opens SettingsPanel via onOpenSettings keyboard shortcut callback', async () => {
    render(<App />)
    expect(screen.queryByTestId('settings-panel')).toBeNull()
    capturedShortcutCallbacks.onOpenSettings?.()
    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeTruthy())
  })

  it('opens LogWindow via onToggleLog keyboard shortcut callback', async () => {
    render(<App />)
    expect(screen.queryByTestId('log-window')).toBeNull()
    capturedShortcutCallbacks.onToggleLog?.()
    await waitFor(() => expect(screen.getByTestId('log-window')).toBeTruthy())
  })

  it('closes LogWindow when its onClose is called', async () => {
    render(<App />)
    capturedShortcutCallbacks.onToggleLog?.()
    await waitFor(() => screen.getByText('Close Log'))
    fireEvent.click(screen.getByText('Close Log'))
    await waitFor(() => expect(screen.queryByTestId('log-window')).toBeNull())
  })

  it('opens CommandPalette via onOpenCommandPalette keyboard shortcut callback', async () => {
    render(<App />)
    expect(screen.queryByTestId('quick-actions')).toBeNull()
    capturedShortcutCallbacks.onOpenCommandPalette?.()
    await waitFor(() => expect(screen.getByTestId('quick-actions')).toBeTruthy())
  })

  it('closes CommandPalette when its onClose is called', async () => {
    render(<App />)
    capturedShortcutCallbacks.onOpenCommandPalette?.()
    await waitFor(() => screen.getByText('Close Palette'))
    fireEvent.click(screen.getByText('Close Palette'))
    await waitFor(() => expect(screen.queryByTestId('quick-actions')).toBeNull())
  })

  it('onToggleOverview keyboard shortcut activates core.overview tab', () => {
    const mockSetActiveGlobalTab = vi.fn()
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      activeGlobalTabId: null,
      setActiveGlobalTab: mockSetActiveGlobalTab,
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    render(<App />)
    capturedShortcutCallbacks.onToggleOverview?.()
    expect(mockSetActiveGlobalTab).toHaveBeenCalledWith('core.overview')
  })

  it('onToggleOverview keyboard shortcut deactivates core.overview tab when already active', () => {
    const mockSetActiveGlobalTab = vi.fn()
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      activeGlobalTabId: 'core.overview',
      setActiveGlobalTab: mockSetActiveGlobalTab,
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    render(<App />)
    capturedShortcutCallbacks.onToggleOverview?.()
    expect(mockSetActiveGlobalTab).toHaveBeenCalledWith(null)
  })

  it('activates core.home when the menu:open-home event fires', () => {
    const mockSetActiveGlobalTab = vi.fn()
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      setActiveGlobalTab: mockSetActiveGlobalTab,
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    let openHomeCb: (() => void) | null = null
    ;(window.electronAPI as unknown as Record<string, unknown>).extensionEvents = {
      onMenuOpenHome: (cb: () => void) => {
        openHomeCb = cb
        return vi.fn()
      },
    }
    render(<App />)
    mockSetActiveGlobalTab.mockClear()
    openHomeCb!()
    expect(mockSetActiveGlobalTab).toHaveBeenCalledWith('core.home')
  })

  it('renders overlay components from extension registry', () => {
    const MockOverlay = () => <div data-testid="mock-overlay">Overlay</div>
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      overlays: [MockOverlay],
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    render(<App />)
    expect(screen.getByTestId('mock-overlay')).toBeTruthy()
  })

  it('renders extension sidebar panels when openPanels is non-empty', async () => {
    const MockPanel = ({ onClose }: { onClose: () => void }) => (
      <div data-testid="mock-panel">
        <button onClick={onClose}>Close Panel</button>
      </div>
    )
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      openPanels: new Set(['git-changes']),
      sidebarPanels: new Map([
        ['git-changes', { id: 'git-changes', label: 'Git', component: MockPanel }],
      ]),
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    render(<App />)
    expect(screen.getByTestId('mock-panel')).toBeTruthy()
    fireEvent.click(screen.getByText('Close Panel'))
  })

  it('calls onMenuOpenSettings extensionEvent to open settings panel', async () => {
    let openSettingsCallback: (() => void) | null = null
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      terminal: { onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe) },
      extensionEvents: {
        onMenuOpenSettings: (cb: () => void) => {
          openSettingsCallback = cb
          return vi.fn()
        },
        onMenuToggleSidebar: vi.fn().mockReturnValue(vi.fn()),
        onMenuOpenPrReviewWindow: vi.fn().mockReturnValue(vi.fn()),
        onTogglePanel: vi.fn().mockReturnValue(vi.fn()),
        onSelectProjectTab: vi.fn().mockReturnValue(vi.fn()),
      },
      extensionBridge: {
        on: vi.fn().mockReturnValue(mockUnsubscribe),
        invoke: vi.fn().mockResolvedValue({}),
      },
    }
    render(<App />)
    openSettingsCallback?.()
    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeTruthy())
  })

  it('calls onTogglePanel extensionEvent to toggle a panel', () => {
    const mockTogglePanel = vi.fn()
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      togglePanel: mockTogglePanel,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      terminal: { onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe) },
      extensionEvents: {
        onMenuOpenSettings: vi.fn().mockReturnValue(vi.fn()),
        onMenuToggleSidebar: vi.fn().mockReturnValue(vi.fn()),
        onMenuOpenPrReviewWindow: vi.fn().mockReturnValue(vi.fn()),
        onTogglePanel: (cb: (panelId: string) => void) => {
          cb('git-changes')
          return vi.fn()
        },
        onSelectProjectTab: vi.fn().mockReturnValue(vi.fn()),
      },
      extensionBridge: {
        on: vi.fn().mockReturnValue(mockUnsubscribe),
        invoke: vi.fn().mockResolvedValue({}),
      },
    }
    render(<App />)
    expect(mockTogglePanel).toHaveBeenCalledWith('git-changes')
  })

  it('renders extension project tab component when activeProjectTabId matches projectTabs', () => {
    const MockProjectTab = ({ repoRoot }: { repoRoot: string | null }) => (
      <div data-testid="project-tab-content">{repoRoot ?? 'no-root'}</div>
    )
    setupMocks({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      activeProjectTabId: 'git',
      projectTabs: new Map([['git', { id: 'git', label: 'Git', component: MockProjectTab }]]),
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    render(<App />)
    expect(screen.getByTestId('project-tab-content')).toBeTruthy()
  })

  it('renders global tab component when activeGlobalTabId is set', () => {
    const MockGlobalTab = () => <div data-testid="global-tab-content">Global Tab</div>
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      globalTabs: new Map([
        ['task-vault', { id: 'task-vault', label: 'Tasks', component: MockGlobalTab }],
      ]),
      activeGlobalTabId: 'task-vault',
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    render(<App />)
    expect(screen.getByTestId('global-tab-content')).toBeTruthy()
  })

  it('does not close open panels when workspace changes', async () => {
    const mockTogglePanel = vi.fn()
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      openPanels: new Set(['panel-a']),
      togglePanel: mockTogglePanel,
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    setupMocks({ activeWorkspaceId: 'ws-1' })
    const { rerender } = render(<App />)
    setupMocks({ activeWorkspaceId: 'ws-2' })
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      openPanels: new Set(['panel-a']),
      togglePanel: mockTogglePanel,
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    rerender(<App />)
    expect(mockTogglePanel).not.toHaveBeenCalledWith('panel-a')
  })

  it('calls onSelectProjectTab extensionEvent to set active tab', () => {
    const mockSetActiveProjectTab = vi.fn()
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      setActiveProjectTab: mockSetActiveProjectTab,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      terminal: { onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe) },
      extensionEvents: {
        onMenuOpenSettings: vi.fn().mockReturnValue(vi.fn()),
        onMenuToggleSidebar: vi.fn().mockReturnValue(vi.fn()),
        onMenuOpenPrReviewWindow: vi.fn().mockReturnValue(vi.fn()),
        onTogglePanel: vi.fn().mockReturnValue(vi.fn()),
        onSelectProjectTab: (cb: (tabId: string) => void) => {
          cb('git')
          return vi.fn()
        },
      },
      extensionBridge: {
        on: vi.fn().mockReturnValue(mockUnsubscribe),
        invoke: vi.fn().mockResolvedValue({}),
      },
    }
    render(<App />)
    expect(mockSetActiveProjectTab).toHaveBeenCalledWith('git')
  })

  it('command core.open-settings action opens SettingsPanel', async () => {
    render(<App />)
    capturedShortcutCallbacks.onOpenCommandPalette?.()
    await waitFor(() => screen.getByTestId('quick-actions'))
    const cmd = capturedPaletteCommands.find((c) => c.id === 'core.open-settings')
    cmd?.run()
    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeTruthy())
  })

  it('command core.toggle-sidebar action adds hidden class to UnifiedSidebar', async () => {
    setupMocks({ activeWorkspaceId: 'ws-1' })
    render(<App />)
    expect(screen.getByTestId('unified-sidebar')).toBeTruthy()
    capturedShortcutCallbacks.onOpenCommandPalette?.()
    await waitFor(() => screen.getByTestId('quick-actions'))
    const cmd = capturedPaletteCommands.find((c) => c.id === 'core.toggle-sidebar')
    cmd?.run()
    await waitFor(() =>
      expect(screen.getByTestId('unified-sidebar').className).toContain('unified-sidebar--hidden')
    )
  })

  it('command core.toggle-log action opens LogWindow', async () => {
    render(<App />)
    capturedShortcutCallbacks.onOpenCommandPalette?.()
    await waitFor(() => screen.getByTestId('quick-actions'))
    const cmd = capturedPaletteCommands.find((c) => c.id === 'core.toggle-log')
    cmd?.run()
    await waitFor(() => expect(screen.getByTestId('log-window')).toBeTruthy())
  })

  it('command core.switch-workspace-{id} action calls setActiveWorkspace', async () => {
    const mockSetActiveWorkspace = vi.fn()
    vi.mocked(useWorkspaceStore).mockReturnValue({
      loadWorkspaces: mockLoadWorkspaces,
      activeWorkspaceId: 'ws-1',
      activeProjectId: null,
      workspaces: [{ id: 'ws-1', name: 'Work', folderPath: '/', color: '#fff', tags: [] }],
      projectsByWorkspaceId: new Map(),
      setActiveWorkspace: mockSetActiveWorkspace,
      resolveActiveCwd: vi.fn().mockReturnValue('~'),
      scratchActive: false,
      setScratchActive: vi.fn(),
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<App />)
    capturedShortcutCallbacks.onOpenCommandPalette?.()
    await waitFor(() => screen.getByTestId('quick-actions'))
    const cmd = capturedPaletteCommands.find((c) => c.id === 'core.switch-workspace-ws-1')
    cmd?.run()
    expect(mockSetActiveWorkspace).toHaveBeenCalledWith('ws-1')
  })

  it('command core.split-vertical action calls splitSession with activeProjectId', async () => {
    const mockSplitSession = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useTerminalSession).mockReturnValue({
      createSession: vi.fn().mockResolvedValue('ses-1'),
      splitSession: mockSplitSession,
    })
    setupMocks({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
    render(<App />)
    capturedShortcutCallbacks.onOpenCommandPalette?.()
    await waitFor(() => screen.getByTestId('quick-actions'))
    const cmd = capturedPaletteCommands.find((c) => c.id === 'core.split-vertical')
    cmd?.run()
    expect(mockSplitSession).toHaveBeenCalledWith(
      'proj-1',
      'vertical',
      expect.any(String),
      expect.any(Number)
    )
  })

  it('command core.split-horizontal action calls splitSession with activeProjectId', async () => {
    const mockSplitSession = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useTerminalSession).mockReturnValue({
      createSession: vi.fn().mockResolvedValue('ses-1'),
      splitSession: mockSplitSession,
    })
    setupMocks({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
    render(<App />)
    capturedShortcutCallbacks.onOpenCommandPalette?.()
    await waitFor(() => screen.getByTestId('quick-actions'))
    const cmd = capturedPaletteCommands.find((c) => c.id === 'core.split-horizontal')
    cmd?.run()
    expect(mockSplitSession).toHaveBeenCalledWith(
      'proj-1',
      'horizontal',
      expect.any(String),
      expect.any(Number)
    )
  })

  it('onSelectGlobalTab toggles activeGlobalTab off when same id clicked', async () => {
    const mockSetActiveGlobalTab = vi.fn()
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      globalTabs: new Map([
        ['task-vault', { id: 'task-vault', label: 'Tasks', component: () => null }],
      ]),
      activeGlobalTabId: 'task-vault',
      setActiveGlobalTab: mockSetActiveGlobalTab,
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    render(<App />)
    // Pressed on the app band itself, which is where these destinations live.
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
    expect(mockSetActiveGlobalTab).toHaveBeenCalledWith(null)
  })

  it('EmptyState Open Settings action opens SettingsPanel', async () => {
    setupMocks({
      activeWorkspaceId: null,
      activeProjectId: null,
      globalSettings: { ui: { hasSeenWelcome: false } },
    })
    render(<App />)
    fireEvent.click(screen.getByText('Open Settings'))
    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeTruthy())
  })

  describe('menu:close-tab (onMenuCloseTab)', () => {
    it('calls closeSession with active session id when active project has an active session', async () => {
      const mockCloseSession = vi.fn().mockResolvedValue(undefined)
      vi.mocked(useSessionStore).mockReturnValue({
        handleProcessExit: mockHandleProcessExit,
        getSessionsForProject: vi.fn().mockReturnValue([]),
        getScratchSessions: vi.fn().mockReturnValue([]),
        sessions: new Map(),
        setActiveSessionForProject: vi.fn(),
        sessions: new Map(),
        setActiveSessionForProject: vi.fn(),
        closeSession: mockCloseSession,
        projectViews: new Map([['proj-1', { terminalCounter: 0, activeSessionId: 'ses-active' }]]),
        setActiveSessionForProject: vi.fn(),
      } as unknown as ReturnType<typeof useSessionStore>)
      setupMocks({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
      vi.mocked(useSessionStore).mockReturnValue({
        handleProcessExit: mockHandleProcessExit,
        getSessionsForProject: vi.fn().mockReturnValue([]),
        getScratchSessions: vi.fn().mockReturnValue([]),
        sessions: new Map(),
        setActiveSessionForProject: vi.fn(),
        sessions: new Map(),
        setActiveSessionForProject: vi.fn(),
        closeSession: mockCloseSession,
        projectViews: new Map([['proj-1', { terminalCounter: 0, activeSessionId: 'ses-active' }]]),
        setActiveSessionForProject: vi.fn(),
      } as unknown as ReturnType<typeof useSessionStore>)

      let closeTabCallback: (() => void) | null = null
      ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
        terminal: { onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe) },
        extensionEvents: {
          onMenuOpenSettings: vi.fn().mockReturnValue(vi.fn()),
          onMenuToggleSidebar: vi.fn().mockReturnValue(vi.fn()),
          onMenuOpenPrReviewWindow: vi.fn().mockReturnValue(vi.fn()),
          onTogglePanel: vi.fn().mockReturnValue(vi.fn()),
          onSelectProjectTab: vi.fn().mockReturnValue(vi.fn()),
          onMenuCloseTab: (cb: () => void) => {
            closeTabCallback = cb
            return vi.fn()
          },
        },
        notifications: {
          list: vi.fn().mockResolvedValue([]),
          dismiss: vi.fn().mockResolvedValue({ ok: true }),
          onPush: vi.fn().mockReturnValue(mockUnsubscribe),
        },
        extensionBridge: {
          on: vi.fn().mockReturnValue(mockUnsubscribe),
          invoke: vi.fn().mockResolvedValue({}),
        },
      }
      render(<App />)
      closeTabCallback?.()
      await waitFor(() => expect(mockCloseSession).toHaveBeenCalledWith('ses-active'))
    })

    it('does not crash when onMenuCloseTab fires and there is no active project', async () => {
      const mockCloseSession = vi.fn().mockResolvedValue(undefined)
      setupMocks({ activeProjectId: null, activeWorkspaceId: null })
      vi.mocked(useSessionStore).mockReturnValue({
        handleProcessExit: mockHandleProcessExit,
        getSessionsForProject: vi.fn().mockReturnValue([]),
        getScratchSessions: vi.fn().mockReturnValue([]),
        sessions: new Map(),
        setActiveSessionForProject: vi.fn(),
        sessions: new Map(),
        setActiveSessionForProject: vi.fn(),
        closeSession: mockCloseSession,
        projectViews: new Map(),
        setActiveSessionForProject: vi.fn(),
      } as unknown as ReturnType<typeof useSessionStore>)

      let closeTabCallback: (() => void) | null = null
      ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
        terminal: { onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe) },
        extensionEvents: {
          onMenuOpenSettings: vi.fn().mockReturnValue(vi.fn()),
          onMenuToggleSidebar: vi.fn().mockReturnValue(vi.fn()),
          onMenuOpenPrReviewWindow: vi.fn().mockReturnValue(vi.fn()),
          onTogglePanel: vi.fn().mockReturnValue(vi.fn()),
          onSelectProjectTab: vi.fn().mockReturnValue(vi.fn()),
          onMenuCloseTab: (cb: () => void) => {
            closeTabCallback = cb
            return vi.fn()
          },
        },
        notifications: {
          list: vi.fn().mockResolvedValue([]),
          dismiss: vi.fn().mockResolvedValue({ ok: true }),
          onPush: vi.fn().mockReturnValue(mockUnsubscribe),
        },
        extensionBridge: {
          on: vi.fn().mockReturnValue(mockUnsubscribe),
          invoke: vi.fn().mockResolvedValue({}),
        },
      }
      render(<App />)
      expect(() => closeTabCallback?.()).not.toThrow()
      expect(mockCloseSession).not.toHaveBeenCalled()
    })

    it('closes scratch session when scratch is active and menu close fires', async () => {
      const SCRATCH_PROJECT_ID = '00000000-0000-0000-0000-000000000000'
      const mockCloseSession = vi.fn().mockResolvedValue(undefined)
      const mockCreateSession = vi.fn().mockResolvedValue('ses-scratch')
      vi.mocked(useTerminalSession).mockReturnValue({ createSession: mockCreateSession })
      setupMocks({ activeProjectId: null, activeWorkspaceId: 'ws-1', scratchActive: true })
      vi.mocked(useSessionStore).mockReturnValue({
        handleProcessExit: mockHandleProcessExit,
        getSessionsForProject: vi.fn().mockReturnValue([]),
        getScratchSessions: vi.fn().mockReturnValue([]),
        sessions: new Map(),
        setActiveSessionForProject: vi.fn(),
        sessions: new Map(),
        setActiveSessionForProject: vi.fn(),
        closeSession: mockCloseSession,
        projectViews: new Map([
          [SCRATCH_PROJECT_ID, { terminalCounter: 0, activeSessionId: 'ses-scratch' }],
        ]),
        setActiveSessionForProject: vi.fn(),
      } as unknown as ReturnType<typeof useSessionStore>)

      let closeTabCallback: (() => void) | null = null
      ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
        terminal: { onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe) },
        extensionEvents: {
          onMenuOpenSettings: vi.fn().mockReturnValue(vi.fn()),
          onMenuToggleSidebar: vi.fn().mockReturnValue(vi.fn()),
          onMenuOpenPrReviewWindow: vi.fn().mockReturnValue(vi.fn()),
          onTogglePanel: vi.fn().mockReturnValue(vi.fn()),
          onSelectProjectTab: vi.fn().mockReturnValue(vi.fn()),
          onMenuCloseTab: (cb: () => void) => {
            closeTabCallback = cb
            return vi.fn()
          },
        },
        notifications: {
          list: vi.fn().mockResolvedValue([]),
          dismiss: vi.fn().mockResolvedValue({ ok: true }),
          onPush: vi.fn().mockReturnValue(mockUnsubscribe),
        },
        extensionBridge: {
          on: vi.fn().mockReturnValue(mockUnsubscribe),
          invoke: vi.fn().mockResolvedValue({}),
        },
      }
      render(<App />)
      // Activate scratch mode
      capturedShortcutCallbacks.onNewScratch?.()
      await waitFor(() => expect(mockCreateSession).toHaveBeenCalled())
      // Now fire the menu close — should target the scratch session
      closeTabCallback?.()
      await waitFor(() => expect(mockCloseSession).toHaveBeenCalledWith('ses-scratch'))
    })

    it('does not call closeSession when active project has no active session', async () => {
      const mockCloseSession = vi.fn().mockResolvedValue(undefined)
      setupMocks({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
      vi.mocked(useSessionStore).mockReturnValue({
        handleProcessExit: mockHandleProcessExit,
        getSessionsForProject: vi.fn().mockReturnValue([]),
        getScratchSessions: vi.fn().mockReturnValue([]),
        sessions: new Map(),
        setActiveSessionForProject: vi.fn(),
        sessions: new Map(),
        setActiveSessionForProject: vi.fn(),
        closeSession: mockCloseSession,
        // proj-1 has no active session mapped
        projectViews: new Map(),
        setActiveSessionForProject: vi.fn(),
      } as unknown as ReturnType<typeof useSessionStore>)

      let closeTabCallback: (() => void) | null = null
      ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
        terminal: { onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe) },
        extensionEvents: {
          onMenuOpenSettings: vi.fn().mockReturnValue(vi.fn()),
          onMenuToggleSidebar: vi.fn().mockReturnValue(vi.fn()),
          onMenuOpenPrReviewWindow: vi.fn().mockReturnValue(vi.fn()),
          onTogglePanel: vi.fn().mockReturnValue(vi.fn()),
          onSelectProjectTab: vi.fn().mockReturnValue(vi.fn()),
          onMenuCloseTab: (cb: () => void) => {
            closeTabCallback = cb
            return vi.fn()
          },
        },
        notifications: {
          list: vi.fn().mockResolvedValue([]),
          dismiss: vi.fn().mockResolvedValue({ ok: true }),
          onPush: vi.fn().mockReturnValue(mockUnsubscribe),
        },
        extensionBridge: {
          on: vi.fn().mockReturnValue(mockUnsubscribe),
          invoke: vi.fn().mockResolvedValue({}),
        },
      }
      render(<App />)
      closeTabCallback?.()
      expect(mockCloseSession).not.toHaveBeenCalled()
    })
  })

  it('command core.toggle-overview action toggles overview tab on and off', async () => {
    const mockSetActiveGlobalTab = vi.fn()
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      activeGlobalTabId: null,
      setActiveGlobalTab: mockSetActiveGlobalTab,
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    render(<App />)
    capturedShortcutCallbacks.onOpenCommandPalette?.()
    await waitFor(() => screen.getByTestId('quick-actions'))
    const cmd = capturedPaletteCommands.find((c) => c.id === 'core.toggle-overview')
    cmd?.run()
    expect(mockSetActiveGlobalTab).toHaveBeenCalledWith('core.overview')
  })

  it('closes AboutDialog when onClose is called', async () => {
    let openAboutCb: (() => void) | null = null
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      terminal: { onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe) },
      extensionEvents: {
        onMenuOpenSettings: vi.fn().mockReturnValue(vi.fn()),
        onMenuOpenAbout: (cb: () => void) => {
          openAboutCb = cb
          return vi.fn()
        },
        onMenuToggleSidebar: vi.fn().mockReturnValue(vi.fn()),
        onTogglePanel: vi.fn().mockReturnValue(vi.fn()),
        onSelectProjectTab: vi.fn().mockReturnValue(vi.fn()),
      },
      notifications: {
        list: vi.fn().mockResolvedValue([]),
        onPush: vi.fn().mockReturnValue(mockUnsubscribe),
      },
      extensionBridge: {
        on: vi.fn().mockReturnValue(mockUnsubscribe),
        invoke: vi.fn().mockResolvedValue({}),
      },
    }
    render(<App />)
    openAboutCb?.()
    await waitFor(() => screen.getByTestId('about-dialog'))
    fireEvent.click(screen.getByText('Close About'))
    await waitFor(() => expect(screen.queryByTestId('about-dialog')).toBeNull())
  })

  it('renders scratch terminal after handleNewScratch resolves', async () => {
    const mockCreateSession = vi.fn().mockResolvedValue('sess-scratch')
    vi.mocked(useTerminalSession).mockReturnValue({ createSession: mockCreateSession })
    setupMocks({ scratchActive: true })
    render(<App />)
    capturedShortcutCallbacks.onNewScratch?.()
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled()
      expect(screen.getByTestId('tab-bar')).toBeTruthy()
    })
  })

  it('renders MetricsBar when showMetricsBar is true', () => {
    setupMocks({
      globalSettings: { ui: { hasSeenWelcome: true, showMetricsBar: true } },
    })
    const { container } = render(<App />)
    expect(container.querySelector('.app-global-metrics')).toBeTruthy()
  })

  it('UnifiedSidebar onSelectScratchSession activates scratch view for chosen session', async () => {
    setupMocks({ activeWorkspaceId: 'ws-1' })
    const mockSetActiveSessionForProject = vi.fn()
    ;(useSessionStore as unknown as { getState: () => unknown }).getState = () => ({
      setActiveSessionForProject: mockSetActiveSessionForProject,
    })
    render(<App />)
    capturedOnSelectSession?.('sess-scratch')
    await waitFor(() => {
      expect(mockSetActiveSessionForProject).toHaveBeenCalledWith(
        expect.any(String),
        'sess-scratch'
      )
    })
  })

  it('triggers handleProcessExit when onProcessExit callback fires', () => {
    let processExitCb: ((sessionId: string, exitCode: number) => void) | null = null
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      terminal: {
        onProcessExit: (cb: (sessionId: string, exitCode: number) => void) => {
          processExitCb = cb
          return mockUnsubscribe
        },
      },
      extensionEvents: null,
      notifications: {
        list: vi.fn().mockResolvedValue([]),
        onPush: vi.fn().mockReturnValue(mockUnsubscribe),
      },
      extensionBridge: {
        on: vi.fn().mockReturnValue(mockUnsubscribe),
        invoke: vi.fn().mockResolvedValue({}),
      },
    }
    render(<App />)
    processExitCb?.('sess-1', 0)
    expect(mockHandleProcessExit).toHaveBeenCalledWith('sess-1', 0)
  })

  it('opens AboutDialog when onMenuOpenAbout event fires', async () => {
    let openAboutCb: (() => void) | null = null
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      terminal: { onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe) },
      extensionEvents: {
        onMenuOpenSettings: vi.fn().mockReturnValue(vi.fn()),
        onMenuOpenAbout: (cb: () => void) => {
          openAboutCb = cb
          return vi.fn()
        },
        onMenuToggleSidebar: vi.fn().mockReturnValue(vi.fn()),
        onTogglePanel: vi.fn().mockReturnValue(vi.fn()),
        onSelectProjectTab: vi.fn().mockReturnValue(vi.fn()),
      },
      notifications: {
        list: vi.fn().mockResolvedValue([]),
        onPush: vi.fn().mockReturnValue(mockUnsubscribe),
      },
      extensionBridge: {
        on: vi.fn().mockReturnValue(mockUnsubscribe),
        invoke: vi.fn().mockResolvedValue({}),
      },
    }
    render(<App />)
    expect(screen.queryByTestId('about-dialog')).toBeNull()
    openAboutCb?.()
    await waitFor(() => expect(screen.getByTestId('about-dialog')).toBeTruthy())
  })

  it('toggles sidebar when onMenuToggleSidebar event fires', async () => {
    setupMocks({ activeWorkspaceId: 'ws-1' })
    let toggleSidebarCb: (() => void) | null = null
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      terminal: { onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe) },
      extensionEvents: {
        onMenuOpenSettings: vi.fn().mockReturnValue(vi.fn()),
        onMenuOpenAbout: vi.fn().mockReturnValue(vi.fn()),
        onMenuToggleSidebar: (cb: () => void) => {
          toggleSidebarCb = cb
          return vi.fn()
        },
        onTogglePanel: vi.fn().mockReturnValue(vi.fn()),
        onSelectProjectTab: vi.fn().mockReturnValue(vi.fn()),
      },
      notifications: {
        list: vi.fn().mockResolvedValue([]),
        onPush: vi.fn().mockReturnValue(mockUnsubscribe),
      },
      extensionBridge: {
        on: vi.fn().mockReturnValue(mockUnsubscribe),
        invoke: vi.fn().mockResolvedValue({}),
      },
    }
    render(<App />)
    expect(screen.getByTestId('unified-sidebar')).toBeTruthy()
    toggleSidebarCb?.()
    await waitFor(() =>
      expect(screen.getByTestId('unified-sidebar').className).toContain('unified-sidebar--hidden')
    )
  })

  it('renders workspace tab component when activeWorkspaceTabId is set', () => {
    const MockWorkspaceTab = () => <div data-testid="workspace-tab-content">Workspace Tab</div>
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      workspaceTabs: new Map([
        [
          'code-reviews',
          { id: 'code-reviews', label: 'Code Reviews', component: MockWorkspaceTab },
        ],
      ]),
      activeWorkspaceTabId: 'code-reviews',
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    render(<App />)
    expect(screen.getByTestId('workspace-tab-content')).toBeTruthy()
  })

  it('onSelectProject clears active global, workspace, and project tabs', () => {
    const mockSetActiveGlobalTab = vi.fn()
    const mockSetActiveWorkspaceTab = vi.fn()
    const mockSetActiveProjectTab = vi.fn()
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      activeGlobalTabId: 'task-vault',
      activeWorkspaceTabId: 'code-reviews',
      activeProjectTabId: 'git',
      setActiveGlobalTab: mockSetActiveGlobalTab,
      setActiveWorkspaceTab: mockSetActiveWorkspaceTab,
      setActiveProjectTab: mockSetActiveProjectTab,
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    render(<App />)
    capturedOnSelectProject?.()
    expect(mockSetActiveGlobalTab).toHaveBeenCalledWith(null)
    expect(mockSetActiveWorkspaceTab).toHaveBeenCalledWith(null)
    expect(mockSetActiveProjectTab).toHaveBeenCalledWith(null)
  })

  it('calls notifyPanelState for each registered panel when openPanels changes', async () => {
    const mockNotifyPanelState = vi.fn()
    // setupMocks first so its electronAPI/registry setup happens before our overrides
    setupMocks({ activeProjectId: 'proj-1' })
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      terminal: { onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe) },
      extensionEvents: {
        onMenuOpenSettings: vi.fn().mockReturnValue(vi.fn()),
        onMenuToggleSidebar: vi.fn().mockReturnValue(vi.fn()),
        onMenuOpenPrReviewWindow: vi.fn().mockReturnValue(vi.fn()),
        onTogglePanel: vi.fn().mockReturnValue(vi.fn()),
        onSelectProjectTab: vi.fn().mockReturnValue(vi.fn()),
        notifyPanelState: mockNotifyPanelState,
      },
      extensionBridge: {
        on: vi.fn().mockReturnValue(mockUnsubscribe),
        invoke: vi.fn().mockResolvedValue({}),
      },
      notifications: {
        list: vi.fn().mockResolvedValue([]),
        dismiss: vi.fn().mockResolvedValue({ ok: true }),
        onPush: vi.fn().mockReturnValue(mockUnsubscribe),
      },
    }
    // Registry has a registered panel; getState returns a sidebarPanels map with one entry
    ;(useExtensionRegistry as unknown as { getState: () => unknown }).getState = vi.fn(() => ({
      registerGlobalTab: vi.fn(() => vi.fn()),
      updateGlobalTab: vi.fn(),
      setActiveGlobalTab: vi.fn(),
      sidebarPanels: new Map([['git-changes', {}]]),
    }))
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      openPanels: new Set(['git-changes']),
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    const { rerender } = render(<App />)
    await waitFor(() => {
      expect(mockNotifyPanelState).toHaveBeenCalledWith('git-changes', true)
    })
    // After initial mount, panelsRestored.current = true. Change openPanels to trigger
    // the effect again — this covers the localStorage.setItem branch (panelsRestored = true).
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      openPanels: new Set<string>(),
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    rerender(<App />)
    await waitFor(() => {
      expect(mockNotifyPanelState).toHaveBeenCalledWith('git-changes', false)
    })
    // Restore the default getState mock
    ;(useExtensionRegistry as unknown as { getState: () => unknown }).getState = vi.fn(() => ({
      registerGlobalTab: vi.fn(() => vi.fn()),
      updateGlobalTab: vi.fn(),
      setActiveGlobalTab: vi.fn(),
      sidebarPanels: new Map(),
    }))
  })

  it('reopens saved panels from localStorage that are not yet open on mount', async () => {
    // Covers line 343: `if (!openPanels.has(id)) togglePanel(id)` — true branch
    const mockTogglePanel = vi.fn()
    setupMocks({ activeProjectId: 'proj-1' })
    localStorage.setItem('openPanels', JSON.stringify(['saved-panel']))
    ;(useExtensionRegistry as unknown as { getState: () => unknown }).getState = vi.fn(() => ({
      registerGlobalTab: vi.fn(() => vi.fn()),
      updateGlobalTab: vi.fn(),
      setActiveGlobalTab: vi.fn(),
      sidebarPanels: new Map(),
      openPanels: new Set<string>(), // 'saved-panel' is NOT open → triggers togglePanel
    }))
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      togglePanel: mockTogglePanel,
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    render(<App />)
    await waitFor(() => {
      expect(mockTogglePanel).toHaveBeenCalledWith('saved-panel')
    })
    localStorage.removeItem('openPanels')
    ;(useExtensionRegistry as unknown as { getState: () => unknown }).getState = vi.fn(() => ({
      registerGlobalTab: vi.fn(() => vi.fn()),
      updateGlobalTab: vi.fn(),
      setActiveGlobalTab: vi.fn(),
      sidebarPanels: new Map(),
    }))
  })

  it('does not throw when extensionEvents is null and registered panels are open', async () => {
    // extensionEvents: null + sidebarPanels has entries → covers the null branch of
    // `extensionEvents?.notifyPanelState?.(...)` inside the for loop body
    setupMocks({ activeProjectId: 'proj-1' })
    // leave electronAPI.extensionEvents as null (set by setupMocks → beforeEach default)
    ;(useExtensionRegistry as unknown as { getState: () => unknown }).getState = vi.fn(() => ({
      registerGlobalTab: vi.fn(() => vi.fn()),
      updateGlobalTab: vi.fn(),
      setActiveGlobalTab: vi.fn(),
      sidebarPanels: new Map([['git-changes', {}]]),
    }))
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      openPanels: new Set(['git-changes']),
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    expect(() => render(<App />)).not.toThrow()
    ;(useExtensionRegistry as unknown as { getState: () => unknown }).getState = vi.fn(() => ({
      registerGlobalTab: vi.fn(() => vi.fn()),
      updateGlobalTab: vi.fn(),
      setActiveGlobalTab: vi.fn(),
      sidebarPanels: new Map(),
    }))
  })

  describe('Home', () => {
    it('registers Home as a permanent core tab, ahead of Overview', () => {
      const registered: string[] = []
      ;(useExtensionRegistry as unknown as { getState: () => unknown }).getState = vi.fn(() => ({
        registerGlobalTab: vi.fn((tab: { id: string; permanent?: boolean }) => {
          registered.push(`${tab.id}:${tab.permanent}`)
          return vi.fn()
        }),
        updateGlobalTab: vi.fn(),
        setActiveGlobalTab: vi.fn(),
        sidebarPanels: new Map(),
      }))
      setupMocks({})
      render(<App />)
      expect(registered.indexOf('core.home:true')).toBeGreaterThanOrEqual(0)
      expect(registered.indexOf('core.home:true')).toBeLessThan(
        registered.indexOf('core.overview:true')
      )
    })

    it('opens on Home at launch', () => {
      setupMocks({})
      render(<App />)
      expect(defaultExtensionRegistry.setActiveGlobalTab).toHaveBeenCalledWith('core.home')
    })

    it('badges Home with the number of sessions waiting on the operator', () => {
      const updateGlobalTab = vi.fn()
      ;(useExtensionRegistry as unknown as { getState: () => unknown }).getState = vi.fn(() => ({
        registerGlobalTab: vi.fn(() => vi.fn()),
        updateGlobalTab,
        setActiveGlobalTab: vi.fn(),
        sidebarPanels: new Map(),
      }))
      // State is derived, never read from the store: a bell or a visible choice
      // makes a session wait on the operator; a closed one never does.
      const session = (id: string, patch: Record<string, unknown>) => [
        id,
        { id, projectId: 'p', tabTitle: id, agentState: 'idle', status: 'active', ...patch },
      ]
      setupMocks({
        sessions: new Map([
          session('a', { bellCount: 1 }),
          session('b', { choicePrompt: { question: 'Proceed?', options: [] } }),
          session('c', { busy: true }),
          session('d', { bellCount: 2, status: 'closed' }),
        ] as never),
      })
      render(<App />)
      expect(updateGlobalTab).toHaveBeenLastCalledWith('core.home', {
        badge: 2,
        badgeLabel: '2 need you',
      })
    })
  })

  describe('handleNewTab', () => {
    it('does nothing when there is no active project and scratchActive is false', () => {
      const mockCreateSession = vi.fn().mockResolvedValue('ses-1')
      vi.mocked(useTerminalSession).mockReturnValue({ createSession: mockCreateSession })
      setupMocks({ activeProjectId: null, scratchActive: false })
      render(<App />)
      capturedShortcutCallbacks.onNewTab?.()
      expect(mockCreateSession).not.toHaveBeenCalled()
    })

    it('calls createSession when promptForName is false and a project is active', () => {
      const mockCreateSession = vi.fn().mockResolvedValue('ses-1')
      vi.mocked(useTerminalSession).mockReturnValue({ createSession: mockCreateSession })
      setupMocks({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
      // Default resolveSettings returns { terminal: { scrollbackLimit: 5000 } } — no promptForName
      render(<App />)
      capturedShortcutCallbacks.onNewTab?.()
      expect(mockCreateSession).toHaveBeenCalledWith('proj-1', 'human', '', '~', 5000)
    })

    it('shows NameTerminalDialog when promptForName is true', async () => {
      const mockCreateSession = vi.fn().mockResolvedValue('ses-1')
      vi.mocked(useTerminalSession).mockReturnValue({ createSession: mockCreateSession })
      setupMocks({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
      vi.mocked(useSettingsStore).mockReturnValue({
        loadSettings: mockLoadSettings,
        globalSettings: { appearance: { theme: 'dark' }, ui: { hasSeenWelcome: true } },
        markWelcomeSeen: mockMarkWelcomeSeen,
        resolveSettings: vi
          .fn()
          .mockReturnValue({ terminal: { scrollbackLimit: 5000, promptForName: true } }),
      } as unknown as ReturnType<typeof useSettingsStore>)
      ;(useSessionStore as unknown as { getState: () => unknown }).getState = () => ({
        projectViews: new Map([['proj-1', { terminalCounter: 2 }]]),
        setActiveSessionForProject: vi.fn(),
      })
      render(<App />)
      capturedShortcutCallbacks.onNewTab?.()
      await waitFor(() => expect(screen.getByTestId('name-terminal-dialog')).toBeTruthy())
      expect(screen.getByTestId('name-terminal-default').textContent).toBe('Terminal 3')
    })

    it('NameTerminalDialog onConfirm calls createSession and closes dialog', async () => {
      const mockCreateSession = vi.fn().mockResolvedValue('ses-1')
      vi.mocked(useTerminalSession).mockReturnValue({ createSession: mockCreateSession })
      setupMocks({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
      vi.mocked(useSettingsStore).mockReturnValue({
        loadSettings: mockLoadSettings,
        globalSettings: { appearance: { theme: 'dark' }, ui: { hasSeenWelcome: true } },
        markWelcomeSeen: mockMarkWelcomeSeen,
        resolveSettings: vi
          .fn()
          .mockReturnValue({ terminal: { scrollbackLimit: 5000, promptForName: true } }),
      } as unknown as ReturnType<typeof useSettingsStore>)
      ;(useSessionStore as unknown as { getState: () => unknown }).getState = () => ({
        projectViews: new Map(),
        setActiveSessionForProject: vi.fn(),
      })
      render(<App />)
      capturedShortcutCallbacks.onNewTab?.()
      await waitFor(() => screen.getByTestId('name-terminal-dialog'))
      fireEvent.click(screen.getByText('Confirm'))
      await waitFor(() => expect(screen.queryByTestId('name-terminal-dialog')).toBeNull())
      expect(mockCreateSession).toHaveBeenCalledWith('proj-1', 'human', 'My Terminal', '~', 5000)
    })

    it('NameTerminalDialog onCancel closes dialog without creating a named session', async () => {
      const mockCreateSession = vi.fn().mockResolvedValue('ses-1')
      vi.mocked(useTerminalSession).mockReturnValue({ createSession: mockCreateSession })
      setupMocks({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
      vi.mocked(useSettingsStore).mockReturnValue({
        loadSettings: mockLoadSettings,
        globalSettings: { appearance: { theme: 'dark' }, ui: { hasSeenWelcome: true } },
        markWelcomeSeen: mockMarkWelcomeSeen,
        resolveSettings: vi
          .fn()
          .mockReturnValue({ terminal: { scrollbackLimit: 5000, promptForName: true } }),
      } as unknown as ReturnType<typeof useSettingsStore>)
      ;(useSessionStore as unknown as { getState: () => unknown }).getState = () => ({
        projectViews: new Map(),
        setActiveSessionForProject: vi.fn(),
      })
      render(<App />)
      // clear auto-session-creation calls that fire on mount
      mockCreateSession.mockClear()
      capturedShortcutCallbacks.onNewTab?.()
      await waitFor(() => screen.getByTestId('name-terminal-dialog'))
      fireEvent.click(screen.getByText('Cancel Dialog'))
      await waitFor(() => expect(screen.queryByTestId('name-terminal-dialog')).toBeNull())
      // After cancel, no new session should be created
      expect(mockCreateSession).not.toHaveBeenCalled()
    })
  })

  it('reopens saved panels when switching back to Terminal tab', async () => {
    const mockTogglePanel = vi.fn()
    setupMocks({ activeProjectId: 'proj-1' })
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      activeProjectTabId: 'git',
      openPanels: new Set(['panel-a']),
      togglePanel: mockTogglePanel,
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    const { rerender } = render(<App />)
    // Switch back to terminal (activeProjectTabId → null), with a saved panel
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      activeProjectTabId: null,
      openPanels: new Set<string>(),
      togglePanel: mockTogglePanel,
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    rerender(<App />)
    // togglePanel called when entering extension tab AND when returning to terminal
    expect(mockTogglePanel).toHaveBeenCalledWith('panel-a')
  })
})

describe('App — command palette sessions and note editing (US6)', () => {
  const paletteSession = {
    id: 's1',
    projectId: 'proj-1',
    tabTitle: 'api-shell',
    status: 'active' as const,
    type: 'agent' as const,
    scrollbackLimit: 10000,
    createdAt: '',
    lastActivityAt: 0,
    agentState: 'idle' as const,
  }
  const projects = new Map([
    ['ws-1', [{ id: 'proj-1', workspaceId: 'ws-1', name: 'API', isWorktree: false }]],
  ])

  it('offers open sessions to the panel, one action per session named by project', () => {
    setupMocks({
      sessions: new Map([['s1', paletteSession]]),
      projectsByWorkspaceId: projects,
    })
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    const sessionAction = capturedPaletteCommands.find((a) => a.id === 'session:s1') as
      | (QuickActionLike & { description?: string })
      | undefined
    expect(sessionAction).toMatchObject({ label: 'api-shell', description: 'API' })
  })

  it('omits closed sessions from the panel', () => {
    setupMocks({
      sessions: new Map([['s1', { ...paletteSession, status: 'closed' as const }]]),
      projectsByWorkspaceId: projects,
    })
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    expect(capturedPaletteCommands.find((a) => a.id === 'session:s1')).toBeUndefined()
  })

  it('leaves the project name blank when the project is unknown', () => {
    setupMocks({ sessions: new Map([['s1', paletteSession]]) })
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    const sessionAction = capturedPaletteCommands.find((a) => a.id === 'session:s1') as
      | (QuickActionLike & { description?: string })
      | undefined
    expect(sessionAction?.description).toBe('')
  })

  it('activates both the project and the session when one is chosen', () => {
    setupMocks({
      sessions: new Map([['s1', paletteSession]]),
      projectsByWorkspaceId: projects,
    })
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    const sessionAction = capturedPaletteCommands.find((a) => a.id === 'session:s1')
    act(() => sessionAction?.run())
    expect(mockSetActiveProject).toHaveBeenCalledWith('proj-1')
    expect(mockSetActiveSessionForProject).toHaveBeenCalledWith('proj-1', 's1')
  })

  it('asks the tab bar to edit the active terminal note on Cmd+I', () => {
    setupMocks({
      activeProjectId: 'proj-1',
      sessions: new Map([['s1', paletteSession]]),
      projectViews: new Map([['proj-1', { activeSessionId: 's1' }]]),
    })
    render(<App />)
    act(() => capturedShortcutCallbacks.onEditSessionNote?.())
    expect(capturedEditNoteSessionId).toBe('s1')
  })

  it('asks for nothing when no project is active', () => {
    setupMocks()
    render(<App />)
    act(() => capturedShortcutCallbacks.onEditSessionNote?.())
    expect(capturedEditNoteSessionId).toBeNull()
  })
})

describe('App — Quick Actions integration (feature 057)', () => {
  it('opens the panel via the quickActions.onOpen bridge event', async () => {
    let openCb: (() => void) | undefined
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      ...(globalThis as unknown as { electronAPI: Record<string, unknown> }).electronAPI,
      quickActions: {
        onOpen: (cb: () => void) => {
          openCb = cb
          return vi.fn()
        },
      },
    }
    render(<App />)
    expect(screen.queryByTestId('quick-actions')).toBeNull()
    act(() => openCb?.())
    await waitFor(() => expect(screen.getByTestId('quick-actions')).toBeTruthy())
  })

  it('pressing Cmd+P again while open bumps the searchSignal prop', async () => {
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    await waitFor(() => screen.getByTestId('quick-actions'))
    const firstSignal = capturedQuickActionsProps?.contextGroupId // sanity: props exist
    expect(firstSignal).not.toBeUndefined()
    const before = (capturedQuickActionsProps as unknown as { searchSignal?: number })?.searchSignal
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    const after = (capturedQuickActionsProps as unknown as { searchSignal?: number })?.searchSignal
    expect(after).toBe((before ?? 0) + 1)
  })

  it('running an action records usage through updateQuickActions', async () => {
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    await waitFor(() => screen.getByTestId('quick-actions'))
    const action = capturedPaletteCommands.find((a) => a.id === 'core.clear')
    act(() => capturedQuickActionsProps?.onRun?.(action!))
    const settingsState = useSettingsStore.getState()
    expect(settingsState.updateQuickActions).toHaveBeenCalled()
    const patch = vi.mocked(settingsState.updateQuickActions).mock.calls[0][0] as {
      usage: { id: string }[]
    }
    expect(patch.usage.some((u) => u.id === 'core.clear')).toBe(true)
  })

  it('shows a "Next time" hint toast when a shortcut action with a fresh direct-use count runs', async () => {
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    await waitFor(() => screen.getByTestId('quick-actions'))
    const action = capturedPaletteCommands.find((a) => a.id === 'core.clear')
    act(() => capturedQuickActionsProps?.onRun?.(action!))
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info', message: expect.stringContaining('Next time') })
    )
  })

  it('the AppBand Quick actions button opens the panel', async () => {
    render(<App />)
    expect(screen.queryByTestId('quick-actions')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Quick actions (⌘P)' }))
    await waitFor(() => expect(screen.getByTestId('quick-actions')).toBeTruthy())
  })

  it('exercises the terminal, session, workspace and issue core action callbacks', async () => {
    const mockSplitSession = vi.fn().mockResolvedValue(undefined)
    const mockCloseSession = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useTerminalSession).mockReturnValue({
      createSession: vi.fn().mockResolvedValue('ses-1'),
      splitSession: mockSplitSession,
    })
    const mockSetActiveWorkspace = vi.fn()
    vi.mocked(useWorkspaceStore).mockReturnValue({
      loadWorkspaces: mockLoadWorkspaces,
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-1',
      workspaces: [
        { id: 'ws-1', name: 'One', folderPath: '/a', color: '#fff', tags: [] },
        { id: 'ws-2', name: 'Two', folderPath: '/b', color: '#fff', tags: [] },
      ],
      projectsByWorkspaceId: new Map(),
      setActiveWorkspace: mockSetActiveWorkspace,
      setActiveProject: mockSetActiveProject,
      resolveActiveCwd: vi.fn().mockReturnValue('~'),
      scratchActive: false,
      setScratchActive: vi.fn(),
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    vi.mocked(useSessionStore).mockReturnValue({
      handleProcessExit: mockHandleProcessExit,
      getSessionsForProject: vi.fn().mockReturnValue([{ id: 's1' }, { id: 's2' }]),
      getActiveSessionForProject: vi.fn().mockReturnValue('s1'),
      getFocusedSession: vi.fn().mockReturnValue('s1'),
      getPaneLayout: vi.fn().mockReturnValue({ type: 'split' }),
      closeSplitLeaf: vi.fn(),
      getTerminalInstance: vi.fn().mockReturnValue(undefined),
      getScratchSessions: vi.fn().mockReturnValue([]),
      sessions: new Map([
        ['s1', { id: 's1', projectId: 'proj-1', status: 'active', agentState: 'idle' }],
        [
          's2',
          {
            id: 's2',
            projectId: 'proj-2',
            status: 'active',
            agentState: 'awaiting-input',
            lastAttendedAt: 5,
          },
        ],
      ]),
      setActiveSessionForProject: mockSetActiveSessionForProject,
      closeSession: mockCloseSession,
      projectViews: new Map(),
    } as unknown as ReturnType<typeof useSessionStore>)
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    await waitFor(() => screen.getByTestId('quick-actions'))

    const run = (id: string) => act(() => capturedPaletteCommands.find((a) => a.id === id)?.run())

    run('core.close-tab')
    expect(mockCloseSession).toHaveBeenCalled()

    run('core.cycle-recent-next')
    expect(mockSetActiveSessionForProject).toHaveBeenCalledWith('proj-2', 's2')

    run('core.next-waiting')
    expect(mockSetActiveSessionForProject).toHaveBeenCalledWith('proj-2', 's2')

    run('core.prev-tab')
    expect(mockSetActiveSessionForProject).toHaveBeenCalledWith('proj-1', 's2')

    run('core.cycle-workspace-next')
    expect(mockSetActiveWorkspace).toHaveBeenCalledWith('ws-2')

    run('core.link-issue')
    run('core.view-issue')
    run('core.copy-issue-key')
    run('core.open-issue')
    run('core.resume')
    expect(mockSetActiveWorkspace).toHaveBeenCalled()
  })

  it('pinning an action via onTogglePin persists through updateQuickActions', async () => {
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    await waitFor(() => screen.getByTestId('quick-actions'))
    act(() => capturedQuickActionsProps?.onTogglePin?.('core.clear'))
    const settingsState = useSettingsStore.getState()
    expect(settingsState.updateQuickActions).toHaveBeenCalledWith({ pins: ['core.clear'] })
  })

  it('unpinning an already-pinned action removes it from the persisted pins', async () => {
    setupMocks({
      globalSettings: {
        appearance: { theme: 'dark' },
        ui: { hasSeenWelcome: false },
        quickActions: { pins: ['core.clear'], usage: [], directUse: [], custom: [] },
      },
    })
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    await waitFor(() => screen.getByTestId('quick-actions'))
    act(() => capturedQuickActionsProps?.onTogglePin?.('core.clear'))
    const settingsState = useSettingsStore.getState()
    expect(settingsState.updateQuickActions).toHaveBeenCalledWith({ pins: [] })
  })
})

describe('App — Quick Actions branch coverage (context, surfaces, custom vars, errors)', () => {
  afterEach(() => {
    useIntegrationsStore.setState({ links: new Map(), issues: new Map() })
  })

  it('labels the context "in <group label>" when an extension surface is active', async () => {
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      activeGlobalTabId: 'git-integration',
      quickActionGroups: [
        { id: 'ext:git-integration', mnemonic: 'g', label: 'Git', owner: 'git-integration' },
      ],
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    await waitFor(() => screen.getByTestId('quick-actions'))
    expect(capturedQuickActionsProps?.contextGroupId).toBe('ext:git-integration')
    expect(capturedQuickActionsProps?.contextLabel).toBe('in Git')
  })

  it('labels the context "in terminal · <tab title>" when a terminal is focused and no surface is active', async () => {
    setupMocks({
      activeProjectId: 'proj-1',
      sessions: new Map([
        ['s1', { id: 's1', projectId: 'proj-1', tabTitle: 'api-shell', status: 'active' }],
      ]),
    })
    vi.mocked(useSessionStore).mockReturnValue({
      ...vi.mocked(useSessionStore)(),
      getFocusedSession: vi.fn().mockReturnValue('s1'),
      getActiveSessionForProject: vi.fn().mockReturnValue('s1'),
      sessions: new Map([
        ['s1', { id: 's1', projectId: 'proj-1', tabTitle: 'api-shell', status: 'active' }],
      ]),
    } as unknown as ReturnType<typeof useSessionStore>)
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    await waitFor(() => screen.getByTestId('quick-actions'))
    expect(capturedQuickActionsProps?.contextGroupId).toBeNull()
    expect(capturedQuickActionsProps?.contextLabel).toBe('in terminal · api-shell')
  })

  it('shows no context label with no surface active and no terminal focused', async () => {
    setupMocks()
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    await waitFor(() => screen.getByTestId('quick-actions'))
    expect(capturedQuickActionsProps?.contextGroupId).toBeNull()
    expect(capturedQuickActionsProps?.contextLabel).toBeUndefined()
  })

  it('extension:show-surface activates the registered surface matching the extension id and view', () => {
    const mockSetActiveGlobalTab = vi.fn()
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      globalTabs: new Map([
        [
          'git-integration',
          { id: 'git-integration', label: 'Git', view: 'main', component: () => null },
        ],
      ]),
      setActiveGlobalTab: mockSetActiveGlobalTab,
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    const bridgeHandlers = new Map<string, (data: unknown) => void>()
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      ...(globalThis as unknown as { electronAPI: Record<string, unknown> }).electronAPI,
      extensionBridge: {
        on: (channel: string, handler: (data: unknown) => void) => {
          bridgeHandlers.set(channel, handler)
          return vi.fn()
        },
        invoke: vi.fn().mockResolvedValue({}),
      },
    }
    render(<App />)
    mockSetActiveGlobalTab.mockClear()
    bridgeHandlers.get('extension:show-surface')?.({ extensionId: 'git-integration', view: 'main' })
    expect(mockSetActiveGlobalTab).toHaveBeenCalledWith('git-integration')
  })

  it('extension:show-surface does nothing when no registered surface matches', () => {
    const mockSetActiveGlobalTab = vi.fn()
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      globalTabs: new Map([
        [
          'git-integration',
          { id: 'git-integration', label: 'Git', view: 'main', component: () => null },
        ],
      ]),
      setActiveGlobalTab: mockSetActiveGlobalTab,
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    const bridgeHandlers = new Map<string, (data: unknown) => void>()
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      ...(globalThis as unknown as { electronAPI: Record<string, unknown> }).electronAPI,
      extensionBridge: {
        on: (channel: string, handler: (data: unknown) => void) => {
          bridgeHandlers.set(channel, handler)
          return vi.fn()
        },
        invoke: vi.fn().mockResolvedValue({}),
      },
    }
    render(<App />)
    mockSetActiveGlobalTab.mockClear()
    bridgeHandlers.get('extension:show-surface')?.({ extensionId: 'not-registered', view: 'main' })
    expect(mockSetActiveGlobalTab).not.toHaveBeenCalled()
  })

  it('disables a custom action referencing {issue} with "No linked issue" when nothing is linked', async () => {
    setupMocks({
      activeProjectId: 'proj-1',
      activeWorkspaceId: 'ws-1',
      globalSettings: {
        appearance: { theme: 'dark' },
        ui: { hasSeenWelcome: true },
        quickActions: {
          pins: [],
          usage: [],
          directUse: [],
          custom: [
            {
              id: 'c1',
              label: 'Open issue',
              kind: 'shell',
              target: 'new-tab',
              body: 'echo {issue}',
            },
          ],
        },
      },
    })
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    await waitFor(() => screen.getByTestId('quick-actions'))
    const action = capturedPaletteCommands.find((a) => a.id === 'custom:c1')
    expect((action as unknown as { disabledReason?: string })?.disabledReason).toBe(
      'No linked issue'
    )
  })

  it('enables a custom action referencing {issue} once the project has a linked issue', async () => {
    useIntegrationsStore.setState({
      links: new Map([['proj-1', { key: 'ABC-1', tracker: 'linear' }]]),
    })
    setupMocks({
      activeProjectId: 'proj-1',
      activeWorkspaceId: 'ws-1',
      globalSettings: {
        appearance: { theme: 'dark' },
        ui: { hasSeenWelcome: true },
        quickActions: {
          pins: [],
          usage: [],
          directUse: [],
          custom: [
            {
              id: 'c1',
              label: 'Open issue',
              kind: 'shell',
              target: 'new-tab',
              body: 'echo {issue}',
            },
          ],
        },
      },
    })
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    await waitFor(() => screen.getByTestId('quick-actions'))
    const action = capturedPaletteCommands.find((a) => a.id === 'custom:c1')
    expect((action as unknown as { disabledReason?: string })?.disabledReason).toBeUndefined()
  })

  it('disables a custom action referencing {selection} with "No text selected" when nothing is selected', async () => {
    setupMocks({
      activeProjectId: 'proj-1',
      globalSettings: {
        appearance: { theme: 'dark' },
        ui: { hasSeenWelcome: true },
        quickActions: {
          pins: [],
          usage: [],
          directUse: [],
          custom: [
            {
              id: 'c2',
              label: 'Grep selection',
              kind: 'shell',
              target: 'focused',
              body: 'echo {selection}',
            },
          ],
        },
      },
      sessions: new Map([
        [
          's1',
          { id: 's1', projectId: 'proj-1', tabTitle: 'shell', type: 'human', status: 'active' },
        ],
      ]),
    })
    vi.mocked(useSessionStore).mockReturnValue({
      ...vi.mocked(useSessionStore)(),
      getFocusedSession: vi.fn().mockReturnValue('s1'),
      getActiveSessionForProject: vi.fn().mockReturnValue('s1'),
      getTerminalInstance: vi.fn().mockReturnValue(undefined),
      sessions: new Map([
        [
          's1',
          { id: 's1', projectId: 'proj-1', tabTitle: 'shell', type: 'human', status: 'active' },
        ],
      ]),
    } as unknown as ReturnType<typeof useSessionStore>)
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    await waitFor(() => screen.getByTestId('quick-actions'))
    const action = capturedPaletteCommands.find((a) => a.id === 'custom:c2')
    expect((action as unknown as { disabledReason?: string })?.disabledReason).toBe(
      'No text selected'
    )
  })

  it('enables and runs a custom action referencing {selection} once there is a selection', async () => {
    const mockInput = vi.fn()
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      ...(globalThis as unknown as { electronAPI: Record<string, unknown> }).electronAPI,
      terminal: { onProcessExit: vi.fn().mockReturnValue(vi.fn()), input: mockInput },
    }
    setupMocks({
      activeProjectId: 'proj-1',
      globalSettings: {
        appearance: { theme: 'dark' },
        ui: { hasSeenWelcome: true },
        quickActions: {
          pins: [],
          usage: [],
          directUse: [],
          custom: [
            {
              id: 'c2',
              label: 'Grep selection',
              kind: 'shell',
              target: 'focused',
              body: 'echo {selection}',
            },
          ],
        },
      },
      sessions: new Map([
        [
          's1',
          { id: 's1', projectId: 'proj-1', tabTitle: 'shell', type: 'human', status: 'active' },
        ],
      ]),
    })
    vi.mocked(useSessionStore).mockReturnValue({
      ...vi.mocked(useSessionStore)(),
      getFocusedSession: vi.fn().mockReturnValue('s1'),
      getActiveSessionForProject: vi.fn().mockReturnValue('s1'),
      getTerminalInstance: vi.fn().mockReturnValue({ getSelection: () => 'picked-text' }),
      sessions: new Map([
        [
          's1',
          { id: 's1', projectId: 'proj-1', tabTitle: 'shell', type: 'human', status: 'active' },
        ],
      ]),
    } as unknown as ReturnType<typeof useSessionStore>)
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    await waitFor(() => screen.getByTestId('quick-actions'))
    const action = capturedPaletteCommands.find((a) => a.id === 'custom:c2')
    expect((action as unknown as { disabledReason?: string })?.disabledReason).toBeUndefined()
    act(() => capturedQuickActionsProps?.onRun?.(action!))
    expect(mockInput).toHaveBeenCalledWith('s1', expect.stringContaining('picked-text'))
  })

  it('shows an error toast with the thrown message when an action fails synchronously', async () => {
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    await waitFor(() => screen.getByTestId('quick-actions'))
    act(() =>
      capturedQuickActionsProps?.onRun?.({
        id: 'test.throws-error',
        label: 'Throws',
        group: 'top',
        run: () => {
          throw new Error('boom')
        },
      })
    )
    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith({ type: 'error', message: 'boom' })
    )
  })

  it('shows a generic "Action failed" error toast when a non-Error value is rejected', async () => {
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    await waitFor(() => screen.getByTestId('quick-actions'))
    act(() =>
      capturedQuickActionsProps?.onRun?.({
        id: 'test.rejects-string',
        label: 'Rejects',
        group: 'top',
        run: () => Promise.reject('nope'),
      })
    )
    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith({ type: 'error', message: 'Action failed' })
    )
  })

  it('suppresses the "Next time" hint once the shortcut has been used directly three times', async () => {
    setupMocks({
      globalSettings: {
        appearance: { theme: 'dark' },
        ui: { hasSeenWelcome: false },
        quickActions: {
          pins: [],
          usage: [],
          directUse: [{ id: 'core.clear', count: 3 }],
          custom: [],
        },
      },
    })
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    await waitFor(() => screen.getByTestId('quick-actions'))
    const action = capturedPaletteCommands.find((a) => a.id === 'core.clear')
    act(() => capturedQuickActionsProps?.onRun?.(action!))
    expect(mockAddToast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }))
  })

  it('records direct-use for Home, sidebar-toggle, settings and close-tab menu accelerators', () => {
    let onMenuOpenHome: (() => void) | undefined
    let onMenuToggleSidebar: (() => void) | undefined
    let onMenuOpenSettings: (() => void) | undefined
    let onMenuCloseTab: (() => void) | undefined
    setupMocks({
      activeProjectId: 'proj-1',
      projectViews: new Map([['proj-1', { activeSessionId: 'ses-1' }]]),
    })
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      ...(globalThis as unknown as { electronAPI: Record<string, unknown> }).electronAPI,
      extensionEvents: {
        onMenuOpenHome: (cb: () => void) => {
          onMenuOpenHome = cb
          return vi.fn()
        },
        onMenuToggleSidebar: (cb: () => void) => {
          onMenuToggleSidebar = cb
          return vi.fn()
        },
        onMenuOpenSettings: (cb: () => void) => {
          onMenuOpenSettings = cb
          return vi.fn()
        },
        onMenuCloseTab: (cb: () => void) => {
          onMenuCloseTab = cb
          return vi.fn()
        },
        onMenuOpenPrReviewWindow: vi.fn().mockReturnValue(vi.fn()),
        onTogglePanel: vi.fn().mockReturnValue(vi.fn()),
        onSelectProjectTab: vi.fn().mockReturnValue(vi.fn()),
      },
    }
    render(<App />)
    const settingsState = useSettingsStore.getState()
    const directUseIds = () =>
      vi
        .mocked(settingsState.updateQuickActions)
        .mock.calls.map((c) => (c[0] as { directUse: { id: string }[] }).directUse.map((d) => d.id))
        .flat()

    act(() => onMenuOpenHome?.())
    expect(directUseIds()).toContain('core.open-home')

    act(() => onMenuToggleSidebar?.())
    expect(directUseIds()).toContain('core.toggle-sidebar')

    act(() => onMenuOpenSettings?.())
    expect(directUseIds()).toContain('core.open-settings')

    act(() => onMenuCloseTab?.())
    expect(directUseIds()).toContain('core.close-tab')
  })

  it('exercises the remaining core-action edge branches with no project, no sessions and no workspaces', async () => {
    const mockSplitSession = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useTerminalSession).mockReturnValue({
      createSession: vi.fn().mockResolvedValue('ses-1'),
      splitSession: mockSplitSession,
    })
    setupMocks({ activeProjectId: null, workspaces: [] })
    const setActiveWorkspaceMock = vi.mocked(useWorkspaceStore)().setActiveWorkspace
    render(<App />)
    act(() => capturedShortcutCallbacks.onOpenCommandPalette?.())
    await waitFor(() => screen.getByTestId('quick-actions'))
    const run = (id: string) => act(() => capturedPaletteCommands.find((a) => a.id === id)?.run())

    // None of these should throw with no project, no sessions and no workspaces.
    run('core.split-vertical')
    expect(mockSplitSession).not.toHaveBeenCalled()
    run('core.close-tab')
    run('core.clear')
    run('core.prev-tab')
    run('core.cycle-recent-next')
    run('core.next-waiting')
    run('core.cycle-workspace-next')
    expect(setActiveWorkspaceMock).not.toHaveBeenCalled()
    run('core.copy-issue-key')
    run('core.open-issue')
    expect(mockAddToast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
  })
})
