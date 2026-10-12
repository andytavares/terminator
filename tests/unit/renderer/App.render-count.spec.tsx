import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useSessionStore } from '../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../src/renderer/stores/workspace.store'
import { useSettingsStore } from '../../../src/renderer/stores/settings.store'
import { useMetricsStore } from '../../../src/renderer/stores/metrics.store'
import { useSessionRecordsStore } from '../../../src/renderer/stores/session-records.store'
import { App } from '../../../src/renderer/App'
import type { SystemMetrics, TerminalSession } from '../../../src/shared/types/index'

// The app shell is what is measured here. Everything it draws is a stub that
// subscribes to nothing, and the sidebar stub counts its renders: it renders
// again exactly when the shell does.
let shellRenders = 0
vi.mock('../../../src/renderer/components/sidebar/UnifiedSidebar', () => ({
  UnifiedSidebar: () => {
    shellRenders++
    return <div />
  },
}))
vi.mock('../../../src/renderer/components/sidebar/AppBand', () => ({ AppBand: () => <div /> }))
vi.mock('../../../src/renderer/components/terminal/TerminalPane', () => ({
  TerminalPane: () => <div />,
}))
vi.mock('../../../src/renderer/components/terminal/TabBar', () => ({ TabBar: () => <div /> }))
vi.mock('../../../src/renderer/components/home/HomeScreen', () => ({ HomeScreen: () => <div /> }))
vi.mock('../../../src/renderer/components/overview/OverviewScreen', () => ({
  OverviewScreen: () => <div />,
}))
vi.mock('../../../src/renderer/components/NotificationPanel', () => ({
  NotificationPanel: () => <div />,
}))
vi.mock('../../../src/renderer/components/ToastContainer', () => ({
  ToastContainer: () => <div />,
}))
vi.mock('../../../src/renderer/components/overview/MetricsBar', () => ({
  MetricsBar: () => <div />,
}))
vi.mock('../../../src/renderer/hooks/useBranchSync', () => ({ useBranchSync: vi.fn() }))
vi.mock('../../../src/renderer/hooks/useTerminalSession', () => ({
  useTerminalSession: () => ({
    createSession: vi.fn().mockResolvedValue('s1'),
    splitSession: vi.fn().mockResolvedValue(undefined),
  }),
}))

const NOW = 1_000_000_000

const busyTerminal: TerminalSession = {
  id: 's1',
  projectId: 'p1',
  tabTitle: 'build',
  status: 'active',
  type: 'human',
  scrollbackLimit: 1000,
  createdAt: '2026-10-01T00:00:00.000Z',
  lastActivityAt: NOW,
  agentState: 'idle',
  busy: true,
}

const system = { cpuPercent: 10, memUsedBytes: 1, memTotalBytes: 2 } as unknown as SystemMetrics

function stubElectronApi(): void {
  const unsubscribe = vi.fn()
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    terminal: { onProcessExit: vi.fn(() => unsubscribe), input: vi.fn() },
    notifications: { list: vi.fn().mockResolvedValue([]), onPush: vi.fn(() => unsubscribe) },
    extensionBridge: { on: vi.fn(() => unsubscribe) },
    extension: { setBottomInset: vi.fn() },
    quickActions: { onOpen: vi.fn(() => unsubscribe) },
    extensionEvents: null,
  }
}

/** Renders the app and returns how many times the shell has rendered since. */
function renderShell(): () => number {
  render(<App />)
  const before = shellRenders
  return () => shellRenders - before
}

beforeEach(() => {
  stubElectronApi()
  useWorkspaceStore.setState({
    loadWorkspaces: vi.fn().mockResolvedValue(undefined),
    activeWorkspaceId: 'w1',
    activeProjectId: 'p1',
  })
  useSettingsStore.setState({
    loadSettings: vi.fn().mockResolvedValue(undefined),
    globalSettings: { ui: { hasSeenWelcome: true, showMetricsBar: true } },
  } as unknown as Parameters<typeof useSettingsStore.setState>[0])
  useSessionRecordsStore.setState({
    load: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(() => vi.fn()),
  } as unknown as Parameters<typeof useSessionRecordsStore.setState>[0])
  useMetricsStore.setState({ enableGlobalMetrics: vi.fn(), disableGlobalMetrics: vi.fn() })
  useSessionStore.setState({
    sessions: new Map([['s1', busyTerminal]]),
    projectViews: new Map([['p1', { activeSessionId: 's1', order: ['s1'], terminalCounter: 1 }]]),
  } as unknown as Parameters<typeof useSessionStore.setState>[0])
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('the app shell while a terminal is busy', () => {
  it('does not re-render on the activity stamp a busy terminal sends each second', () => {
    const rendersSince = renderShell()
    for (let second = 1; second <= 5; second++) {
      act(() => useSessionStore.getState().stampActivity('s1', NOW + second * 1000))
    }
    expect(rendersSince()).toBe(0)
  })

  it("does not re-render when the busy terminal's latest line changes", () => {
    const rendersSince = renderShell()
    act(() =>
      useSessionStore.getState().setSessionScreen('s1', { latestLine: 'done', choicePrompt: null })
    )
    expect(rendersSince()).toBe(0)
  })

  it('does not re-render when a system metrics sample arrives', () => {
    const rendersSince = renderShell()
    act(() => useMetricsStore.getState().setSystem(system))
    act(() => useMetricsStore.getState().setSystem({ ...system }))
    expect(rendersSince()).toBe(0)
  })
})
