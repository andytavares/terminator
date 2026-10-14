import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useSessionStore } from '../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../src/renderer/stores/workspace.store'
import { useSettingsStore } from '../../../src/renderer/stores/settings.store'
import { useMetricsStore } from '../../../src/renderer/stores/metrics.store'
import { useSessionRecordsStore } from '../../../src/renderer/stores/session-records.store'
import { App } from '../../../src/renderer/App'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../src/shared/schemas/settings.schema'
import type { SystemMetrics, TerminalSession } from '../../../src/shared/types/index'
import { installElectronApi } from '../../support/electron-api'

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

const system: SystemMetrics = {
  cpuPercent: 10,
  memUsedBytes: 1,
  memTotalBytes: 2,
  netInBytesPerSec: 0,
  netOutBytesPerSec: 0,
}

function stubElectronApi(): void {
  installElectronApi({
    terminal: { onProcessExit: () => () => {}, input: () => {} },
    notifications: { list: async () => [], onPush: () => () => {} },
    extensionBridge: { on: () => () => {} },
    extension: { setBottomInset: () => {} },
    quickActions: { onOpen: () => () => {} },
  })
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
    loadSettings: async () => {},
    globalSettings: {
      ...DEFAULT_GLOBAL_SETTINGS,
      ui: { ...DEFAULT_GLOBAL_SETTINGS.ui, hasSeenWelcome: true, showMetricsBar: true },
    },
  })
  useSessionRecordsStore.setState({ load: async () => {}, subscribe: () => () => {} })
  useMetricsStore.setState({ enableGlobalMetrics: vi.fn(), disableGlobalMetrics: vi.fn() })
  useSessionStore.setState({
    sessions: new Map([['s1', busyTerminal]]),
    projectViews: new Map([['p1', { activeSessionId: 's1', order: ['s1'], terminalCounter: 1 }]]),
  })
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
