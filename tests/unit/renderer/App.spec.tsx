import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useWorkspaceStore } from '../../../src/renderer/stores/workspace.store'
import { useSettingsStore } from '../../../src/renderer/stores/settings.store'
import { useSessionStore } from '../../../src/renderer/stores/session.store'
import { useToastStore } from '../../../src/renderer/stores/toast.store'
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { App } from '../../../src/renderer/App'

// Mock all child components and hooks to focus on App logic
vi.mock('../../../src/renderer/stores/workspace.store', () => ({ useWorkspaceStore: vi.fn() }))
vi.mock('../../../src/renderer/stores/settings.store', () => ({ useSettingsStore: vi.fn() }))
vi.mock('../../../src/renderer/stores/session.store', () => ({ useSessionStore: vi.fn() }))
vi.mock('../../../src/renderer/stores/toast.store', () => ({ useToastStore: vi.fn() }))
vi.mock('../../../src/renderer/stores/log.store', () => ({ installLogInterceptor: vi.fn() }))
vi.mock('../../../src/renderer/extensions/registry', () => ({ useExtensionRegistry: vi.fn() }))
vi.mock('../../../src/renderer/extensions/loader', () => ({}))
type ShortcutCallbacks = {
  onOpenSettings?: () => void
  onToggleLog?: () => void
  onOpenCommandPalette?: () => void
}
let capturedShortcutCallbacks: ShortcutCallbacks = {}
vi.mock('../../../src/renderer/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn().mockImplementation((opts: ShortcutCallbacks = {}) => {
    capturedShortcutCallbacks = opts
  }),
}))
vi.mock('../../../src/renderer/hooks/useTerminalSession', () => ({
  useTerminalSession: vi.fn(() => ({ createSession: vi.fn() })),
}))
vi.mock('../../../src/renderer/components/CommandPalette', () => ({
  CommandPalette: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="command-palette">
      <button onClick={onClose}>Close Palette</button>
    </div>
  ),
}))

vi.mock('../../../src/renderer/components/sidebar/WorkspaceRail', () => ({
  WorkspaceRail: () => <div data-testid="workspace-rail" />,
}))
vi.mock('../../../src/renderer/components/sidebar/ProjectsPanel', () => ({
  ProjectsPanel: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="projects-panel" data-workspace-id={workspaceId} />
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
vi.mock('../../../src/renderer/components/EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}))

const mockLoadWorkspaces = vi.fn()
const mockLoadSettings = vi.fn()
const mockMarkWelcomeSeen = vi.fn()
const mockHandleProcessExit = vi.fn()
const mockAddToast = vi.fn()

const defaultExtensionRegistry = {
  sidebarPanels: new Map(),
  projectTabs: new Map(),
  openPanels: new Set<string>(),
  activeProjectTabId: null,
  togglePanel: vi.fn(),
  setActiveProjectTab: vi.fn(),
  keyboardShortcuts: [],
  commands: [],
}

function setupMocks(
  overrides: {
    activeWorkspaceId?: string | null
    activeProjectId?: string | null
    globalSettings?: Record<string, unknown> | null
    workspaces?: unknown[]
  } = {}
) {
  const {
    activeWorkspaceId = null,
    activeProjectId = null,
    globalSettings = { appearance: { theme: 'dark' }, ui: { hasSeenWelcome: false } },
    workspaces = [],
  } = overrides

  vi.mocked(useWorkspaceStore).mockReturnValue({
    loadWorkspaces: mockLoadWorkspaces,
    activeWorkspaceId,
    activeProjectId,
    workspaces,
    projectsByWorkspaceId: new Map(),
    setActiveWorkspace: vi.fn(),
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useSettingsStore).mockReturnValue({
    loadSettings: mockLoadSettings,
    globalSettings,
    markWelcomeSeen: mockMarkWelcomeSeen,
    resolveSettings: vi.fn().mockReturnValue({ terminal: { scrollbackLimit: 5000 } }),
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useSessionStore).mockReturnValue({
    handleProcessExit: mockHandleProcessExit,
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
  mockUnsubscribe = vi.fn()
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    terminal: {
      onProcessExit: vi.fn().mockReturnValue(mockUnsubscribe),
    },
    extensionEvents: null,
  }
  setupMocks()
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('App', () => {
  it('renders WorkspaceRail', () => {
    render(<App />)
    expect(screen.getByTestId('workspace-rail')).toBeTruthy()
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

  it('shows ProjectsPanel when activeWorkspaceId is set', () => {
    setupMocks({
      activeWorkspaceId: 'ws-1',
      workspaces: [{ id: 'ws-1', name: 'Test', folderPath: '/test', color: '#fff', tags: [] }],
    })
    render(<App />)
    expect(screen.getByTestId('projects-panel')).toBeTruthy()
  })

  it('does not show ProjectsPanel when no activeWorkspaceId', () => {
    setupMocks({ activeWorkspaceId: null })
    render(<App />)
    expect(screen.queryByTestId('projects-panel')).toBeNull()
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

  it('opens SettingsPanel when open-settings event fires', async () => {
    render(<App />)
    await waitFor(() => window.dispatchEvent(new Event('open-settings')))
    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeTruthy())
  })

  it('closes SettingsPanel when onClose is called', async () => {
    render(<App />)
    await waitFor(() => window.dispatchEvent(new Event('open-settings')))
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
    }
    render(<App />)
    expect(mockTogglePanel).toHaveBeenCalledWith('git-changes')
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
    }
    render(<App />)
    expect(mockSetActiveProjectTab).toHaveBeenCalledWith('git')
  })
})
