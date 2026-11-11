import { describe, it, expect, vi } from 'vitest'
import { buildCoreActions, type CoreActionDeps } from '../../../../src/quick-actions/core-actions'
import { CORE_GROUPS } from '../../../../src/quick-actions/groups'
import {
  CORE_SHORTCUTS,
  findMnemonicConflicts,
} from '../../../../../test-support/src/quick-actions'
import type { QuickAction } from '../../../../src/quick-actions/types'

function makeDeps(overrides: Partial<CoreActionDeps> = {}): CoreActionDeps {
  return {
    hasProjectFocused: true,
    hasTerminalFocused: true,
    activeWorkspaceId: 'ws-1',
    workspaces: [{ id: 'ws-1', name: 'WS 1' }],
    sessions: [{ id: 's1', projectId: 'p1', tabTitle: 'Terminal 1', projectName: 'main' }],
    issueLink: { key: 'ABC-1', tracker: 'linear' },
    issue: { url: 'https://example.com' },
    canGoBack: true,
    canGoForward: true,
    hasClosedTab: true,
    canReportBug: true,
    ...coreActionHandlers(),
    ...overrides,
  }
}

/** Fakes for the handlers that act on terminals, sessions and workspaces. */
function sessionHandlers() {
  return {
    onNewTab: vi.fn(),
    onSplit: vi.fn(),
    onBreakOut: vi.fn(),
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
    onGoBack: vi.fn(),
    onGoForward: vi.fn(),
    onReopenClosedTab: vi.fn(),
  }
}

/** A fake for every handler an action can run. */
function coreActionHandlers() {
  return {
    ...sessionHandlers(),
    onLinkIssue: vi.fn(),
    onLinkIssueBranch: vi.fn(),
    onViewIssue: vi.fn(),
    onCopyIssueKey: vi.fn(),
    onOpenIssue: vi.fn(),
    onHome: vi.fn(),
    onTaskSwitcher: vi.fn(),
    onStartWork: vi.fn(),
    onOverview: vi.fn(),
    onUsage: vi.fn(),
    onToggleSidebar: vi.fn(),
    onToggleSidebarMode: vi.fn(),
    onOpenSettings: vi.fn(),
    onToggleLog: vi.fn(),
    onReportBug: vi.fn(),
  }
}

/** The label of the action with `id`. */
function actionLabelOf(actions: QuickAction[], id: string): string {
  return actions.find((action) => action.id === id)!.label
}

describe('buildCoreActions', () => {
  it('places actions in the terminal, sessions, navigate, workspace and top groups', () => {
    const actions = buildCoreActions(makeDeps())
    const groupsUsed = new Set(actions.map((a) => a.group))
    expect(groupsUsed).toEqual(new Set(['terminal', 'sessions', 'navigate', 'workspace', 'top']))
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
})

describe('buildCoreActions — never omits an action for lack of context — it is present, only disabled', () => {
  it('never omits an action for lack of context — it is present, only disabled', () => {
    const actions = buildCoreActions(
      makeDeps({ hasProjectFocused: false, hasTerminalFocused: false, issueLink: null })
    )
    expect(actions.find((a) => a.id === 'core.close-tab')).toBeDefined()
    expect(actions.find((a) => a.id === 'core.link-issue')).toBeDefined()
  })
})

describe('buildCoreActions — an action without its context is disabled with the reason', () => {
  it.each([
    ['core.clear', { hasTerminalFocused: false }, 'No terminal focused'],
    ['core.new-tab', { hasProjectFocused: false }, 'No project focused'],
    ['core.view-issue', { issueLink: null }, 'No linked issue'],
    ['core.copy-issue-key', { issueLink: null }, 'No linked issue'],
    ['core.open-issue', { issueLink: null }, 'No linked issue'],
    [
      'core.link-issue',
      { hasTerminalFocused: false, hasProjectFocused: true },
      'No terminal focused',
    ],
    ['core.break-out', { hasTerminalFocused: false }, 'No terminal focused'],
    ['core.break-out', {}, undefined],
    ['core.go-back', { canGoBack: false }, 'Nothing to go back to'],
    ['core.go-back', {}, undefined],
    ['core.go-forward', { canGoForward: false }, 'Nothing to go forward to'],
    ['core.go-forward', {}, undefined],
    ['core.reopen-closed-tab', { hasClosedTab: false }, 'No closed tab to reopen'],
    ['core.reopen-closed-tab', {}, undefined],
  ] as [string, Partial<CoreActionDeps>, string | undefined][])(
    '%s with %o has disabledReason %s',
    (id, deps, reason) => {
      const action = buildCoreActions(makeDeps(deps)).find((a) => a.id === id)!
      expect(action.disabledReason).toBe(reason)
    }
  )
})

describe('buildCoreActions — linking issues to a session vs a branch', () => {
  it('offers a separate "Link ticket to branch" action, disabled by "No project focused"', () => {
    const actions = buildCoreActions(makeDeps({ hasProjectFocused: false }))
    const branch = actions.find((a) => a.id === 'core.link-issue-branch')!
    expect(branch.label).toBe('Link ticket to branch')
    expect(branch.disabledReason).toBe('No project focused')
  })
})

describe('buildCoreActions — lists one action per open session with mnemonics 1-9', () => {
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

  const SWITCH_WORKSPACE = 'core.switch-workspace'
  const ordinaryEntries = CORE_SHORTCUTS.filter((entry) => entry.actionId !== SWITCH_WORKSPACE)

  it('has a matching action with the same shortcut display for every entry', () => {
    const shown = ordinaryEntries.map((entry) => ({
      actionId: entry.actionId,
      display: actions.find((a) => a.id === entry.actionId)?.shortcut,
    }))
    expect(shown).toEqual(
      ordinaryEntries.map((entry) => ({ actionId: entry.actionId, display: entry.display }))
    )
  })

  it('shows ⌘1 to ⌘9 on each switch-workspace action', () => {
    expect(CORE_SHORTCUTS.map((entry) => entry.actionId)).toContain(SWITCH_WORKSPACE)
    const matches = actions.filter((a) => a.id.startsWith(`${SWITCH_WORKSPACE}-`))
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.filter((a) => !/^⌘[1-9]$/.test(a.shortcut ?? ''))).toEqual([])
  })

  it('matches the KeyboardEvent shape it documents', () => {
    const entry = CORE_SHORTCUTS.find((s) => s.actionId === 'core.clear')!
    expect(
      entry.firedBy({ key: 'k', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })
    ).toBe(true)
    expect(
      entry.firedBy({ key: 'k', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })
    ).toBe(false)
  })
})

const HANDLED_BY: [string, keyof CoreActionDeps, unknown[]][] = [
  ['core.new-tab', 'onNewTab', []],
  ['core.split-horizontal', 'onSplit', ['horizontal']],
  ['core.split-vertical', 'onSplit', ['vertical']],
  ['core.clear', 'onClear', []],
  ['core.link-issue', 'onLinkIssue', []],
  ['core.link-issue-branch', 'onLinkIssueBranch', []],
  ['core.go-back', 'onGoBack', []],
  ['core.go-forward', 'onGoForward', []],
  ['core.reopen-closed-tab', 'onReopenClosedTab', []],
  ['core.break-out', 'onBreakOut', []],
  ['core.close-tab', 'onClosePane', []],
  ['core.new-scratch', 'onNewScratch', []],
  ['core.edit-note', 'onEditNote', []],
  ['core.prev-tab', 'onCycleTab', [-1]],
  ['core.next-tab', 'onCycleTab', [1]],
  ['core.cycle-recent-prev', 'onCycleRecentSession', [-1]],
  ['core.cycle-recent-next', 'onCycleRecentSession', [1]],
  ['core.next-waiting', 'onNextWaiting', []],
  ['session:s1', 'onSelectSession', [expect.objectContaining({ id: 's1', projectId: 'p1' })]],
  ['core.resume', 'onResume', []],
  ['core.switch-workspace-ws-1', 'onSwitchWorkspace', ['ws-1']],
  ['core.cycle-workspace-next', 'onCycleWorkspace', [1]],
  ['core.cycle-workspace-prev', 'onCycleWorkspace', [-1]],
  ['core.view-issue', 'onViewIssue', []],
  ['core.copy-issue-key', 'onCopyIssueKey', []],
  ['core.open-issue', 'onOpenIssue', []],
  ['core.open-home', 'onHome', []],
  ['core.switch-task', 'onTaskSwitcher', []],
  ['core.start-work', 'onStartWork', []],
  ['core.toggle-overview', 'onOverview', []],
  ['core.open-usage', 'onUsage', []],
  ['core.next-waiting-top', 'onNextWaiting', []],
  ['core.toggle-sidebar', 'onToggleSidebar', []],
  ['core.toggle-sidebar-inbox', 'onToggleSidebarMode', []],
  ['core.open-settings', 'onOpenSettings', []],
  ['core.toggle-log', 'onToggleLog', []],
]

describe('buildCoreActions — every action runs its own handler', () => {
  it.each(HANDLED_BY)('%s runs %s', async (id, handler, args) => {
    const deps = makeDeps()
    await buildCoreActions(deps)
      .find((a) => a.id === id)!
      .run()
    expect(deps[handler]).toHaveBeenCalledWith(...args)
  })
})

describe('buildCoreActions — issue labels name the linked issue', () => {
  it('names a linked issue and its tracker', () => {
    const actions = buildCoreActions(makeDeps({ issueLink: { key: 'J-7', tracker: 'linear' } }))
    expect(actionLabelOf(actions, 'core.link-issue')).toBe('Change linked ticket')
    expect(actionLabelOf(actions, 'core.view-issue')).toBe('View J-7')
    expect(actionLabelOf(actions, 'core.copy-issue-key')).toBe('Copy ticket key (J-7)')
    expect(actionLabelOf(actions, 'core.open-issue')).toBe('Open J-7 in Linear')
  })

  it('says what it would do when nothing is linked', () => {
    const actions = buildCoreActions(makeDeps({ issueLink: null }))
    expect(actionLabelOf(actions, 'core.link-issue')).toBe('Link ticket')
    expect(actionLabelOf(actions, 'core.view-issue')).toBe('View linked ticket')
    expect(actionLabelOf(actions, 'core.copy-issue-key')).toBe('Copy ticket key')
    expect(actionLabelOf(actions, 'core.open-issue')).toBe('Open ticket in tracker')
  })
})

describe('buildCoreActions — Move to its own window', () => {
  const find = (overrides: Partial<CoreActionDeps>) =>
    buildCoreActions(makeDeps(overrides)).find((a) => a.id === 'core.break-out')

  it('is a terminal action listed with ⌘⇧O', () => {
    expect(find({})).toMatchObject({
      label: 'Move to its own window',
      group: 'terminal',
      shortcut: '⌘⇧O',
    })
  })
})

describe('buildCoreActions — back, forward and reopen', () => {
  it('lists Go back with its shortcut in the navigate group', () => {
    const back = buildCoreActions(makeDeps()).find((a) => a.id === 'core.go-back')!
    expect(back.shortcut).toBe('⌘⌥←')
    expect(back.group).toBe('navigate')
  })
})

// Every core action with its mark: a new id fails here until someone decides whether it closes,
// clears or deletes something, which makes the Terminator MCP server ask before it runs.
const DESTRUCTIVE_BY_ID: Record<string, boolean> = {
  'core.new-tab': false,
  'core.reopen-closed-tab': false,
  'core.split-vertical': false,
  'core.split-horizontal': false,
  'core.break-out': false,
  'core.close-tab': true,
  'core.clear': true,
  'core.new-scratch': false,
  'core.edit-note': false,
  'core.prev-tab': false,
  'core.next-tab': false,
  'core.cycle-recent-prev': false,
  'core.cycle-recent-next': false,
  'core.next-waiting': false,
  'core.resume': false,
  'core.go-back': false,
  'core.go-forward': false,
  'core.cycle-workspace-next': false,
  'core.cycle-workspace-prev': false,
  'core.link-issue': false,
  'core.link-issue-branch': false,
  'core.view-issue': false,
  'core.copy-issue-key': false,
  'core.open-issue': false,
  'core.start-work': false,
  'core.open-home': false,
  'core.switch-task': false,
  'core.toggle-overview': false,
  'core.open-usage': false,
  'core.next-waiting-top': false,
  'core.toggle-sidebar': false,
  'core.toggle-sidebar-inbox': false,
  'core.open-settings': false,
  'core.toggle-log': false,
  'core.report-bug': false,
  'session:s1': false,
  'core.switch-workspace-ws-1': false,
}

describe('buildCoreActions — destructive marks', () => {
  it('marks exactly the actions that close or clear something', () => {
    const marks = Object.fromEntries(
      buildCoreActions(makeDeps()).map((a) => [a.id, a.destructive === true])
    )
    expect(marks).toEqual(DESTRUCTIVE_BY_ID)
  })
})

describe('buildCoreActions — report a bug', () => {
  it('opens a bug report from the top group, showing its menu shortcut', async () => {
    const deps = makeDeps()
    const action = buildCoreActions(deps).find((a) => a.id === 'core.report-bug')!

    expect(action).toMatchObject({ label: 'Report a bug', group: 'top', shortcut: '⌘⇧B' })
    await action.run()
    expect(deps.onReportBug).toHaveBeenCalled()
  })

  it('is unavailable, and says so, where bug reports do not exist', () => {
    const action = buildCoreActions(makeDeps({ canReportBug: false })).find(
      (a) => a.id === 'core.report-bug'
    )!

    expect(action.disabledReason).toBe('Report bugs from the desktop app')
  })
})
