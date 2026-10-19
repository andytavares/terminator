import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  useCoreQuickActions,
  type ShellCommands,
} from '../../../../src/renderer/quick-actions/use-core-quick-actions'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'
import { useDeskSelection } from '../../../../src/renderer/components/home/desk-selection'
import { useSessionRecordsStore } from '../../../../src/renderer/stores/session-records.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import type { QuickActionTarget } from '../../../../src/renderer/quick-actions/use-active-scope'
import type { TerminalSession } from '../../../../src/shared/types/index'
import {
  projectFixture,
  resetStore,
  terminalSessionOf,
  workspaceFixture,
} from '../../../support/renderer-stores'
import { installElectronApi } from '../../../support/electron-api'

// The issue a focused terminal resolves to comes from the facts and the tracker;
// both are given here so the actions can be read against them.
const focused = vi.hoisted(() => ({
  workItem: null as null | { ref: { tracker: 'linear' | 'jira'; key: string } },
  issue: null as null | { url: string },
}))
vi.mock('../../../../src/renderer/components/session/useSessionFacts', () => ({
  useSessionFacts: () => [{ sessionId: 's1', workItem: focused.workItem }],
  useIssue: () => focused.issue,
}))
vi.mock('../../../../src/renderer/hooks/useTerminalSession', () => ({
  useTerminalSession: () => ({ splitSession: vi.fn() }),
}))

const shell: ShellCommands = {
  onNewTab: vi.fn(),
  onNewScratch: vi.fn(),
  onEditNote: vi.fn(),
  onLinkSession: vi.fn(),
  onToggleOverview: vi.fn(),
  onToggleSidebar: vi.fn(),
  onOpenSettings: vi.fn(),
  onToggleLog: vi.fn(),
}

const WS = workspaceFixture({ id: 'ws-1' })
const PROJECT = projectFixture({ id: 'p1', workspaceId: 'ws-1' })
const terminal = vi.fn()
const close = vi.fn()
const openExternal = vi.fn()

function seedFocusedSessions(sessions: TerminalSession[]): void {
  resetStore(useWorkspaceStore, {
    workspaces: [WS],
    projectsByWorkspaceId: new Map([['ws-1', [PROJECT]]]),
    activeWorkspaceId: 'ws-1',
    activeProjectId: 'p1',
  })
  resetStore(useSessionStore, { sessions: new Map(sessions.map((s) => [s.id, s])) })
}

const FOCUSED: QuickActionTarget = {
  projectId: 'p1',
  focusedSessionId: 's1',
  focusedSession: terminalSessionOf({ id: 's1', projectId: 'p1' }),
}

const NOTHING_FOCUSED: QuickActionTarget = {
  projectId: 'p1',
  focusedSessionId: null,
  focusedSession: undefined,
}

/** Runs one core action as the palette would, for a terminal focused in p1. */
function runCoreAction(id: string, target: QuickActionTarget = FOCUSED) {
  const { result } = renderHook(() => useCoreQuickActions(target, shell))
  act(() => {
    void result.current.find((a) => a.id === id)!.run()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  focused.workItem = null
  focused.issue = null
  terminal.mockReset()
  installElectronApi({
    terminal: { input: terminal, close: close.mockResolvedValue(undefined) },
    shell: { openExternal: openExternal.mockResolvedValue(undefined) },
  })
  seedFocusedSessions([terminalSessionOf({ id: 's1', projectId: 'p1' })])
})

describe('useCoreQuickActions — the focused terminal', () => {
  it('Clear sends a form feed to the focused terminal', () => {
    runCoreAction('core.clear')
    expect(terminal).toHaveBeenCalledWith('s1', '\x0c')
  })

  it('Clear does nothing with no terminal focused', () => {
    runCoreAction('core.clear', NOTHING_FOCUSED)
    expect(terminal).not.toHaveBeenCalled()
  })

  it('Edit session note opens the note of the focused terminal', () => {
    runCoreAction('core.edit-note')
    expect(shell.onEditNote).toHaveBeenCalledWith('s1')
  })

  it('Close pane closes the focused pane of a split and keeps the other', async () => {
    seedFocusedSessions([
      terminalSessionOf({ id: 's1', projectId: 'p1' }),
      terminalSessionOf({ id: 's2', projectId: 'p1' }),
    ])
    useSessionStore.getState().setActiveSessionForProject('p1', 's1')
    useSessionStore
      .getState()
      .activateSplit('p1', { targetId: 's1', newId: 's2', direction: 'vertical' })
    runCoreAction('core.close-tab')
    await vi.waitFor(() => expect(useSessionStore.getState().sessions.has('s2')).toBe(false))
    expect(useSessionStore.getState().getPaneLayout('p1')).toBeNull()
    expect(useSessionStore.getState().getActiveSessionForProject('p1')).toBe('s1')
  })
})

describe('useCoreQuickActions — the focused terminal — cycling tabs in a project with none open changes nothing', () => {
  it('cycling tabs in a project with none open changes nothing', () => {
    seedFocusedSessions([])
    runCoreAction('core.next-tab')
    expect(useSessionStore.getState().getActiveSessionForProject('p1')).toBeNull()
  })
})

describe('useCoreQuickActions — sessions waiting on you', () => {
  it('Next waiting does nothing when no session waits', () => {
    runCoreAction('core.next-waiting')
    expect(useSessionStore.getState().focusRequest).toBeNull()
  })

  it('Next waiting reveals the waiting session after the focused one', () => {
    seedFocusedSessions([
      terminalSessionOf({ id: 's1', projectId: 'p1', bellCount: 1 }),
      terminalSessionOf({ id: 's2', projectId: 'p1', bellCount: 1 }),
    ])
    runCoreAction('core.next-waiting')
    expect(useSessionStore.getState().getActiveSessionForProject('p1')).toBe('s2')
  })
})

describe('useCoreQuickActions — the global tabs', () => {
  it('Resume and Home both open Home', () => {
    useExtensionRegistry.getState().setActiveGlobalTab(null)
    runCoreAction('core.resume')
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBe('core.home')
    useExtensionRegistry.getState().setActiveGlobalTab(null)
    runCoreAction('core.open-home')
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBe('core.home')
  })
})

describe('useCoreQuickActions — resume', () => {
  const record = (patch: Record<string, unknown>) =>
    [
      's9',
      { sessionId: 's9', closedAt: '2026-10-18T10:00:00.000Z', resumable: true, ...patch },
    ] as const

  beforeEach(() => {
    useDeskSelection.setState({ resumeRequested: false })
  })

  it('asks Home to open the latest conversation when one can be resumed', () => {
    useSessionRecordsStore.setState({ records: new Map([record({})]) as never })
    runCoreAction('core.resume')
    expect(useDeskSelection.getState().resumeRequested).toBe(true)
  })

  it('only shows Home when nothing can be resumed', () => {
    useSessionRecordsStore.setState({ records: new Map([record({ resumable: false })]) as never })
    runCoreAction('core.resume')
    expect(useDeskSelection.getState().resumeRequested).toBe(false)
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBe('core.home')
  })
})

describe('useCoreQuickActions — the linked issue', () => {
  it('View issue opens the drawer for the active branch', () => {
    focused.workItem = { ref: { tracker: 'linear', key: 'ENG-1' } }
    runCoreAction('core.view-issue')
    expect(useIntegrationsStore.getState().drawerProjectId).toBe('p1')
  })

  it('Open issue opens the ticket in the tracker', () => {
    focused.workItem = { ref: { tracker: 'linear', key: 'ENG-1' } }
    focused.issue = { url: 'https://linear.app/t/ENG-1' }
    runCoreAction('core.open-issue')
    expect(openExternal).toHaveBeenCalledWith('https://linear.app/t/ENG-1')
  })

  it('Open issue does nothing while the ticket has not loaded', () => {
    focused.workItem = { ref: { tracker: 'linear', key: 'ENG-1' } }
    runCoreAction('core.open-issue')
    expect(openExternal).not.toHaveBeenCalled()
  })
})
