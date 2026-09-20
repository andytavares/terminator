import { describe, it, expect, vi } from 'vitest'
import {
  buildCoreActions,
  CORE_SHORTCUTS,
  type CoreActionDeps,
} from '../../../../src/renderer/quick-actions/core-actions'
import { CORE_GROUPS, findMnemonicConflicts } from '../../../../src/renderer/quick-actions/groups'

function makeDeps(overrides: Partial<CoreActionDeps> = {}): CoreActionDeps {
  return {
    hasProjectFocused: true,
    hasTerminalFocused: true,
    activeWorkspaceId: 'ws-1',
    workspaces: [{ id: 'ws-1', name: 'WS 1' }],
    sessions: [{ id: 's1', projectId: 'p1', tabTitle: 'Terminal 1', projectName: 'main' }],
    issueLink: { key: 'ABC-1', tracker: 'linear' },
    issue: { url: 'https://example.com' },
    onNewTab: vi.fn(),
    onSplit: vi.fn(),
    onClosePane: vi.fn(),
    onClear: vi.fn(),
    onNewScratch: vi.fn(),
    onEditNote: vi.fn(),
    onCycleTab: vi.fn(),
    onCycleRecentSession: vi.fn(),
    onSelectSession: vi.fn(),
    onNextWaiting: vi.fn(),
    onResume: vi.fn(),
    onSwitchWorkspace: vi.fn(),
    onCycleWorkspace: vi.fn(),
    onLinkIssue: vi.fn(),
    onViewIssue: vi.fn(),
    onCopyIssueKey: vi.fn(),
    onOpenIssue: vi.fn(),
    onHome: vi.fn(),
    onOverview: vi.fn(),
    onToggleSidebar: vi.fn(),
    onOpenSettings: vi.fn(),
    onToggleLog: vi.fn(),
    ...overrides,
  }
}

describe('buildCoreActions', () => {
  it('places actions in the terminal, sessions, workspace and top groups', () => {
    const actions = buildCoreActions(makeDeps())
    const groupsUsed = new Set(actions.map((a) => a.group))
    expect(groupsUsed).toEqual(new Set(['terminal', 'sessions', 'workspace', 'top']))
  })

  it('assigns the documented mnemonics to the terminal group', () => {
    const actions = buildCoreActions(makeDeps())
    const byMnemonic = Object.fromEntries(
      actions.filter((a) => a.group === 'terminal').map((a) => [a.mnemonic, a.label])
    )
    expect(byMnemonic.t).toBe('New tab')
    expect(byMnemonic.d).toBe('Split right')
    expect(byMnemonic.D).toBe('Split down')
    expect(byMnemonic.w).toBe('Close pane')
    expect(byMnemonic.k).toBe('Clear')
    expect(byMnemonic.n).toBe('New scratch terminal')
    expect(byMnemonic.i).toBe('Edit session note')
  })

  it('disables terminal actions with "No terminal focused" when nothing is focused', () => {
    const actions = buildCoreActions(makeDeps({ hasTerminalFocused: false }))
    const clear = actions.find((a) => a.id === 'core.clear')!
    expect(clear.disabledReason).toBe('No terminal focused')
  })

  it('disables New tab with "No project focused" when no project is focused', () => {
    const actions = buildCoreActions(makeDeps({ hasProjectFocused: false }))
    const newTab = actions.find((a) => a.id === 'core.new-tab')!
    expect(newTab.disabledReason).toBe('No project focused')
  })

  it('disables issue actions with "No linked issue" when there is a project but no link', () => {
    const actions = buildCoreActions(makeDeps({ issueLink: null }))
    expect(actions.find((a) => a.id === 'core.view-issue')!.disabledReason).toBe('No linked issue')
    expect(actions.find((a) => a.id === 'core.copy-issue-key')!.disabledReason).toBe(
      'No linked issue'
    )
    expect(actions.find((a) => a.id === 'core.open-issue')!.disabledReason).toBe('No linked issue')
  })

  it('never omits an action for lack of context — it is present, only disabled', () => {
    const actions = buildCoreActions(
      makeDeps({ hasProjectFocused: false, hasTerminalFocused: false, issueLink: null })
    )
    expect(actions.find((a) => a.id === 'core.close-tab')).toBeDefined()
    expect(actions.find((a) => a.id === 'core.link-issue')).toBeDefined()
  })

  it('runs the matching dep callback', () => {
    const deps = makeDeps()
    const actions = buildCoreActions(deps)
    actions.find((a) => a.id === 'core.clear')!.run()
    expect(deps.onClear).toHaveBeenCalled()
    actions.find((a) => a.id === 'core.split-vertical')!.run()
    expect(deps.onSplit).toHaveBeenCalledWith('vertical')
  })

  it('lists one action per open session with mnemonics 1-9', () => {
    const sessions = Array.from({ length: 3 }, (_, i) => ({
      id: `s${i}`,
      projectId: 'p1',
      tabTitle: `Terminal ${i}`,
      projectName: 'main',
    }))
    const actions = buildCoreActions(makeDeps({ sessions }))
    const sessionActions = actions.filter((a) => a.id.startsWith('session:'))
    expect(sessionActions).toHaveLength(3)
    expect(sessionActions.map((a) => a.mnemonic)).toEqual(['1', '2', '3'])
  })

  it('produces no mnemonic conflicts against CORE_GROUPS', () => {
    const actions = buildCoreActions(makeDeps())
    expect(findMnemonicConflicts(actions, CORE_GROUPS)).toEqual([])
  })
})

describe('CORE_SHORTCUTS', () => {
  const actions = buildCoreActions(makeDeps())

  it('has a matching action with the same shortcut display for every entry', () => {
    for (const entry of CORE_SHORTCUTS) {
      if (entry.actionId === 'core.switch-workspace') {
        const matches = actions.filter((a) => a.id.startsWith('core.switch-workspace-'))
        expect(matches.length).toBeGreaterThan(0)
        for (const m of matches) expect(m.shortcut).toMatch(/^⌘[1-9]$/)
        continue
      }
      const action = actions.find((a) => a.id === entry.actionId)
      expect(action, `no action for CORE_SHORTCUTS entry "${entry.actionId}"`).toBeDefined()
      expect(action!.shortcut).toBe(entry.display)
    }
  })

  it('matches the KeyboardEvent shape it documents', () => {
    const entry = CORE_SHORTCUTS.find((s) => s.actionId === 'core.clear')!
    expect(
      entry.match({ key: 'k', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })
    ).toBe(true)
    expect(
      entry.match({ key: 'k', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })
    ).toBe(false)
  })
})
