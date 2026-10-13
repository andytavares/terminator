import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  useCoreQuickActions,
  type ShellCommands,
} from '../../../../src/renderer/quick-actions/use-core-quick-actions'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import type { QuickActionTarget } from '../../../../src/renderer/quick-actions/use-active-scope'
import type { TerminalSession } from '../../../../src/shared/types/index'
import {
  projectOf,
  resetStore,
  terminalSessionOf,
  workspaceOf,
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

const WS = workspaceOf({ id: 'ws-1' })
const PROJECT = projectOf({ id: 'p1', workspaceId: 'ws-1' })
const terminal = vi.fn()
const close = vi.fn()
const openExternal = vi.fn()

function seed(sessions: TerminalSession[]): void {
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

/** Runs one core action as the palette would, for a terminal focused in p1. */
function run(id: string, target: QuickActionTarget = FOCUSED) {
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
  seed([terminalSessionOf({ id: 's1', projectId: 'p1' })])
})

describe('useCoreQuickActions — the focused terminal', () => {
  it('Clear sends a form feed to the focused terminal', () => {
    run('core.clear')
    expect(terminal).toHaveBeenCalledWith('s1', '\x0c')
  })

  it('Clear does nothing with no terminal focused', () => {
    run('core.clear', { projectId: 'p1', focusedSessionId: null, focusedSession: undefined })
    expect(terminal).not.toHaveBeenCalled()
  })

  it('Edit session note opens the note of the focused terminal', () => {
    run('core.edit-note')
    expect(shell.onEditNote).toHaveBeenCalledWith('s1')
  })

  it('Close pane closes the focused pane of a split and keeps the other', async () => {
    seed([
      terminalSessionOf({ id: 's1', projectId: 'p1' }),
      terminalSessionOf({ id: 's2', projectId: 'p1' }),
    ])
    useSessionStore.getState().setActiveSessionForProject('p1', 's1')
    useSessionStore.getState().activateSplit('p1', 's1', 's2', 'vertical')
    run('core.close-tab')
    await vi.waitFor(() => expect(useSessionStore.getState().sessions.has('s2')).toBe(false))
    expect(useSessionStore.getState().getPaneLayout('p1')).toBeNull()
    expect(useSessionStore.getState().getActiveSessionForProject('p1')).toBe('s1')
  })
})

describe('useCoreQuickActions — the focused terminal — cycling tabs in a project with none open changes nothing', () => {
  it('cycling tabs in a project with none open changes nothing', () => {
    seed([])
    run('core.next-tab')
    expect(useSessionStore.getState().getActiveSessionForProject('p1')).toBeNull()
  })
})

describe('useCoreQuickActions — sessions waiting on you', () => {
  it('Next waiting does nothing when no session waits', () => {
    run('core.next-waiting')
    expect(useSessionStore.getState().focusRequest).toBeNull()
  })

  it('Next waiting reveals the waiting session after the focused one', () => {
    seed([
      terminalSessionOf({ id: 's1', projectId: 'p1', bellCount: 1 }),
      terminalSessionOf({ id: 's2', projectId: 'p1', bellCount: 1 }),
    ])
    run('core.next-waiting')
    expect(useSessionStore.getState().getActiveSessionForProject('p1')).toBe('s2')
  })
})

describe('useCoreQuickActions — the global tabs', () => {
  it('Resume and Home both open Home', () => {
    useExtensionRegistry.getState().setActiveGlobalTab(null)
    run('core.resume')
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBe('core.home')
    useExtensionRegistry.getState().setActiveGlobalTab(null)
    run('core.open-home')
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBe('core.home')
  })
})

describe('useCoreQuickActions — the linked issue', () => {
  it('View issue opens the drawer for the active branch', () => {
    focused.workItem = { ref: { tracker: 'linear', key: 'ENG-1' } }
    run('core.view-issue')
    expect(useIntegrationsStore.getState().drawerProjectId).toBe('p1')
  })

  it('Open issue opens the ticket in the tracker', () => {
    focused.workItem = { ref: { tracker: 'linear', key: 'ENG-1' } }
    focused.issue = { url: 'https://linear.app/t/ENG-1' }
    run('core.open-issue')
    expect(openExternal).toHaveBeenCalledWith('https://linear.app/t/ENG-1')
  })

  it('Open issue does nothing while the ticket has not loaded', () => {
    focused.workItem = { ref: { tracker: 'linear', key: 'ENG-1' } }
    run('core.open-issue')
    expect(openExternal).not.toHaveBeenCalled()
  })
})
