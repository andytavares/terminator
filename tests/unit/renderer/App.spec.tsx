import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useWorkspaceStore } from '../../../src/renderer/stores/workspace.store'
import { useSettingsStore } from '../../../src/renderer/stores/settings.store'
import { useSessionStore } from '../../../src/renderer/stores/session.store'
import { useToastStore } from '../../../src/renderer/stores/toast.store'
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { useTerminalSession } from '../../../src/renderer/hooks/useTerminalSession'
import { App } from '../../../src/renderer/App'

// Mock all child components and hooks to focus on App logic
vi.mock('../../../src/renderer/stores/workspace.store', () => ({ useWorkspaceStore: vi.fn() }))
vi.mock('../../../src/renderer/stores/settings.store', () => ({ useSettingsStore: vi.fn() }))
vi.mock('../../../src/renderer/stores/session.store', () => ({ useSessionStore: vi.fn() }))
vi.mock('../../../src/renderer/stores/toast.store', () => ({ useToastStore: vi.fn() }))
vi.mock('../../../src/renderer/stores/log.store', () => ({ installLogInterceptor: vi.fn() }))
vi.mock('../../../src/renderer/extensions/registry', () => {
  const useExtensionRegistry = vi.fn()
  ;(useExtensionRegistry as unknown as { getState: () => unknown }).getState = vi.fn(() => ({
    registerGlobalTab: vi.fn(() => vi.fn()),
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
}
let capturedShortcutCallbacks: ShortcutCallbacks = {}
vi.mock('../../../src/renderer/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn().mockImplementation((opts: ShortcutCallbacks = {}) => {
    capturedShortcutCallbacks = opts
  }),
}))
vi.mock('../../../src/renderer/hooks/useTerminalSession', () => ({
  useTerminalSession: vi.fn(() => ({ createSession: vi.fn(), splitSession: vi.fn() })),
}))
type CommandRegistration = { id: string; label: string; action: () => void }
let capturedPaletteCommands: CommandRegistration[] = []
vi.mock('../../../src/renderer/components/CommandPalette', () => ({
  CommandPalette: ({
    onClose,
    commands,
  }: {
    onClose: () => void
    commands: CommandRegistration[]
  }) => {
    capturedPaletteCommands = commands
    return (
      <div data-testid="command-palette">
        <button onClick={onClose}>Close Palette</button>
      </div>
    )
  },
}))

type GlobalTabCallback = (id: string) => void
let capturedOnSelectGlobalTab: GlobalTabCallback | null = null
let capturedOnSelectSession: ((sessionId: string) => void) | null = null
let capturedOnSelectProject: (() => void) | null = null
vi.mock('../../../src/renderer/components/sidebar/UnifiedSidebar', () => ({
  UnifiedSidebar: ({
    onSelectGlobalTab,
    onSelectScratchSession,
    onSelectProject,
    visible,
  }: {
    onSelectGlobalTab: GlobalTabCallback
    onSelectScratchSession: (sessionId: string) => void
    onSelectProject?: () => void
    visible: boolean
  }) => {
    capturedOnSelectGlobalTab = onSelectGlobalTab
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
vi.mock('../../../src/renderer/components/terminal/TerminalPane', () => ({
  TerminalPane: () => <div data-testid="terminal-pane" />,
}))
vi.mock('../../../src/renderer/components/terminal/TabBar', () => ({
  TabBar: () => <div data-testid="tab-bar" />,
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
}

function setupMocks(
  overrides: {
    activeWorkspaceId?: string | null
    activeProjectId?: string | null
    globalSettings?: Record<string, unknown> | null
    workspaces?: unknown[]
    scratchActive?: boolean
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
    projectsByWorkspaceId: new Map(),
    setActiveWorkspace: vi.fn(),
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
  vi.mocked(useSettingsStore).mockReturnValue({
    loadSettings: mockLoadSettings,
    globalSettings,
    markWelcomeSeen: mockMarkWelcomeSeen,
    resolveSettings: vi.fn().mockReturnValue({ terminal: { scrollbackLimit: 5000 } }),
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useSessionStore).mockReturnValue({
    handleProcessExit: mockHandleProcessExit,
    getSessionsForProject: vi.fn().mockReturnValue([]),
    getScratchSessions: vi.fn().mockReturnValue([]),
    closeSession: vi.fn().mockResolvedValue(undefined),
    activeSessionIdByProject: new Map(),
    setActiveSessionForProject: vi.fn(),
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useToastStore).mockReturnValue({
    addToast: mockAddToast,
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useExtensionRegistry).mockReturnValue(
    defaultExtensionRegistry as unknown as ReturnType<typeof useExtensionRegistry>
  )
}

let mockUnsubscribe: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  capturedPaletteCommands = []
  capturedOnSelectGlobalTab = null
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
        onToast: vi.fn().mockReturnValue(vi.fn()),
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
        onToast: vi.fn().mockReturnValue(vi.fn()),
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
    expect(screen.queryByTestId('command-palette')).toBeNull()
    capturedShortcutCallbacks.onOpenCommandPalette?.()
    await waitFor(() => expect(screen.getByTestId('command-palette')).toBeTruthy())
  })

  it('closes CommandPalette when its onClose is called', async () => {
    render(<App />)
    capturedShortcutCallbacks.onOpenCommandPalette?.()
    await waitFor(() => screen.getByText('Close Palette'))
    fireEvent.click(screen.getByText('Close Palette'))
    await waitFor(() => expect(screen.queryByTestId('command-palette')).toBeNull())
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
        onToast: vi.fn().mockReturnValue(vi.fn()),
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

  it('calls onToast extensionEvent to display a toast', () => {
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      terminal: { onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe) },
      extensionEvents: {
        onMenuOpenSettings: vi.fn().mockReturnValue(vi.fn()),
        onMenuToggleSidebar: vi.fn().mockReturnValue(vi.fn()),
        onMenuOpenPrReviewWindow: vi.fn().mockReturnValue(vi.fn()),
        onToast: (cb: (payload: { type: string; message: string }) => void) => {
          cb({ type: 'info', message: 'hello' })
          return vi.fn()
        },
        onTogglePanel: vi.fn().mockReturnValue(vi.fn()),
        onSelectProjectTab: vi.fn().mockReturnValue(vi.fn()),
      },
      extensionBridge: {
        on: vi.fn().mockReturnValue(mockUnsubscribe),
        invoke: vi.fn().mockResolvedValue({}),
      },
    }
    render(<App />)
    expect(mockAddToast).toHaveBeenCalledWith({ type: 'info', message: 'hello' })
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
        onToast: vi.fn().mockReturnValue(vi.fn()),
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

  it('calls togglePanel for each open panel when workspace changes', async () => {
    const mockTogglePanel = vi.fn()
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      openPanels: new Set(['panel-a']),
      togglePanel: mockTogglePanel,
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    setupMocks({ activeWorkspaceId: 'ws-1' })
    const { rerender } = render(<App />)
    // Switch to a different workspace — should trigger the close-panels effect
    setupMocks({ activeWorkspaceId: 'ws-2' })
    vi.mocked(useExtensionRegistry).mockReturnValue({
      ...defaultExtensionRegistry,
      openPanels: new Set(['panel-a']),
      togglePanel: mockTogglePanel,
    } as unknown as ReturnType<typeof useExtensionRegistry>)
    rerender(<App />)
    expect(mockTogglePanel).toHaveBeenCalledWith('panel-a')
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
        onToast: vi.fn().mockReturnValue(vi.fn()),
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
    await waitFor(() => screen.getByTestId('command-palette'))
    const cmd = capturedPaletteCommands.find((c) => c.id === 'core.open-settings')
    cmd?.action()
    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeTruthy())
  })

  it('command core.toggle-sidebar action adds hidden class to UnifiedSidebar', async () => {
    setupMocks({ activeWorkspaceId: 'ws-1' })
    render(<App />)
    expect(screen.getByTestId('unified-sidebar')).toBeTruthy()
    capturedShortcutCallbacks.onOpenCommandPalette?.()
    await waitFor(() => screen.getByTestId('command-palette'))
    const cmd = capturedPaletteCommands.find((c) => c.id === 'core.toggle-sidebar')
    cmd?.action()
    await waitFor(() =>
      expect(screen.getByTestId('unified-sidebar').className).toContain('unified-sidebar--hidden')
    )
  })

  it('command core.toggle-log action opens LogWindow', async () => {
    render(<App />)
    capturedShortcutCallbacks.onOpenCommandPalette?.()
    await waitFor(() => screen.getByTestId('command-palette'))
    const cmd = capturedPaletteCommands.find((c) => c.id === 'core.toggle-log')
    cmd?.action()
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
    await waitFor(() => screen.getByTestId('command-palette'))
    const cmd = capturedPaletteCommands.find((c) => c.id === 'core.switch-workspace-ws-1')
    cmd?.action()
    expect(mockSetActiveWorkspace).toHaveBeenCalledWith('ws-1')
  })

  it('command core.split-vertical action calls splitSession with activeProjectId', async () => {
    const mockSplitSession = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useTerminalSession).mockReturnValue({
      createSession: vi.fn(),
      splitSession: mockSplitSession,
    })
    setupMocks({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
    render(<App />)
    capturedShortcutCallbacks.onOpenCommandPalette?.()
    await waitFor(() => screen.getByTestId('command-palette'))
    const cmd = capturedPaletteCommands.find((c) => c.id === 'core.split-vertical')
    cmd?.action()
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
      createSession: vi.fn(),
      splitSession: mockSplitSession,
    })
    setupMocks({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
    render(<App />)
    capturedShortcutCallbacks.onOpenCommandPalette?.()
    await waitFor(() => screen.getByTestId('command-palette'))
    const cmd = capturedPaletteCommands.find((c) => c.id === 'core.split-horizontal')
    cmd?.action()
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
    capturedOnSelectGlobalTab?.('task-vault')
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
        closeSession: mockCloseSession,
        activeSessionIdByProject: new Map([['proj-1', 'ses-active']]),
        setActiveSessionForProject: vi.fn(),
      } as unknown as ReturnType<typeof useSessionStore>)
      setupMocks({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
      vi.mocked(useSessionStore).mockReturnValue({
        handleProcessExit: mockHandleProcessExit,
        getSessionsForProject: vi.fn().mockReturnValue([]),
        getScratchSessions: vi.fn().mockReturnValue([]),
        closeSession: mockCloseSession,
        activeSessionIdByProject: new Map([['proj-1', 'ses-active']]),
        setActiveSessionForProject: vi.fn(),
      } as unknown as ReturnType<typeof useSessionStore>)

      let closeTabCallback: (() => void) | null = null
      ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
        terminal: { onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe) },
        extensionEvents: {
          onMenuOpenSettings: vi.fn().mockReturnValue(vi.fn()),
          onMenuToggleSidebar: vi.fn().mockReturnValue(vi.fn()),
          onMenuOpenPrReviewWindow: vi.fn().mockReturnValue(vi.fn()),
          onToast: vi.fn().mockReturnValue(vi.fn()),
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
        closeSession: mockCloseSession,
        activeSessionIdByProject: new Map(),
        setActiveSessionForProject: vi.fn(),
      } as unknown as ReturnType<typeof useSessionStore>)

      let closeTabCallback: (() => void) | null = null
      ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
        terminal: { onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe) },
        extensionEvents: {
          onMenuOpenSettings: vi.fn().mockReturnValue(vi.fn()),
          onMenuToggleSidebar: vi.fn().mockReturnValue(vi.fn()),
          onMenuOpenPrReviewWindow: vi.fn().mockReturnValue(vi.fn()),
          onToast: vi.fn().mockReturnValue(vi.fn()),
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
        closeSession: mockCloseSession,
        activeSessionIdByProject: new Map([[SCRATCH_PROJECT_ID, 'ses-scratch']]),
        setActiveSessionForProject: vi.fn(),
      } as unknown as ReturnType<typeof useSessionStore>)

      let closeTabCallback: (() => void) | null = null
      ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
        terminal: { onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe) },
        extensionEvents: {
          onMenuOpenSettings: vi.fn().mockReturnValue(vi.fn()),
          onMenuToggleSidebar: vi.fn().mockReturnValue(vi.fn()),
          onMenuOpenPrReviewWindow: vi.fn().mockReturnValue(vi.fn()),
          onToast: vi.fn().mockReturnValue(vi.fn()),
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
        closeSession: mockCloseSession,
        // proj-1 has no active session mapped
        activeSessionIdByProject: new Map(),
        setActiveSessionForProject: vi.fn(),
      } as unknown as ReturnType<typeof useSessionStore>)

      let closeTabCallback: (() => void) | null = null
      ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
        terminal: { onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe) },
        extensionEvents: {
          onMenuOpenSettings: vi.fn().mockReturnValue(vi.fn()),
          onMenuToggleSidebar: vi.fn().mockReturnValue(vi.fn()),
          onMenuOpenPrReviewWindow: vi.fn().mockReturnValue(vi.fn()),
          onToast: vi.fn().mockReturnValue(vi.fn()),
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
    await waitFor(() => screen.getByTestId('command-palette'))
    const cmd = capturedPaletteCommands.find((c) => c.id === 'core.toggle-overview')
    cmd?.action()
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
        onToast: vi.fn().mockReturnValue(vi.fn()),
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
        onToast: vi.fn().mockReturnValue(vi.fn()),
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
        onToast: vi.fn().mockReturnValue(vi.fn()),
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
        onToast: vi.fn().mockReturnValue(vi.fn()),
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
      setActiveGlobalTab: vi.fn(),
      sidebarPanels: new Map(),
    }))
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
