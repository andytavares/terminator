import { describe, it, expect, vi } from 'vitest'
import {
  buildCoreActions,
  type CoreActionDeps,
} from '../../../../src/renderer/quick-actions/core-actions'
import { CORE_GROUPS } from '../../../../src/renderer/quick-actions/groups'
import { CORE_SHORTCUTS, findMnemonicConflicts } from '../../../support/quick-actions'
import type { QuickAction } from '../../../../src/renderer/quick-actions/types'

function makeDeps(overrides: Partial<CoreActionDeps> = {}): CoreActionDeps {
  return {
    hasProjectFocused: true,
    hasTerminalFocused: true,
    activeWorkspaceId: 'ws-1',
    workspaces: [{ id: 'ws-1', name: 'WS 1' }],
    sessions: [{ id: 's1', projectId: 'p1', tabTitle: 'Terminal 1', projectName: 'main' }],
    issueLink: { key: 'ABC-1', tracker: 'linear' },
    issue: { url: 'https://example.com' },
    ...coreActionHandlers(),
    ...overrides,
  }
}

/** A fake for every handler an action can run. */
function coreActionHandlers() {
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
    onLinkIssue: vi.fn(),
    onLinkIssueBranch: vi.fn(),
    onViewIssue: vi.fn(),
    onCopyIssueKey: vi.fn(),
    onOpenIssue: vi.fn(),
    onHome: vi.fn(),
    onTaskSwitcher: vi.fn(),
    onStartWork: vi.fn(),
    onOverview: vi.fn(),
    onToggleSidebar: vi.fn(),
    onOpenSettings: vi.fn(),
    onToggleLog: vi.fn(),
  }
}

/** The label of the action with `id`. */
function actionLabelOf(actions: QuickAction[], id: string): string {
  return actions.find((action) => action.id === id)!.label
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
})

describe('buildCoreActions — disables New tab with "No project focused" when no project is focused', () => {
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
})

describe('buildCoreActions — linking issues to a session vs a branch', () => {
  it('targets the focused terminal, disabled by "No terminal focused" rather than project', () => {
    const actions = buildCoreActions(
      makeDeps({ hasTerminalFocused: false, hasProjectFocused: true })
    )
    expect(actions.find((a) => a.id === 'core.link-issue')!.disabledReason).toBe(
      'No terminal focused'
    )
  })

  it('runs onLinkIssue, not onLinkIssueBranch', async () => {
    const deps = makeDeps()
    await buildCoreActions(deps)
      .find((a) => a.id === 'core.link-issue')!
      .run()
    expect(deps.onLinkIssue).toHaveBeenCalledOnce()
    expect(deps.onLinkIssueBranch).not.toHaveBeenCalled()
  })

  it('offers a separate "Link issue to branch" action, disabled by "No project focused"', () => {
    const actions = buildCoreActions(makeDeps({ hasProjectFocused: false }))
    const branch = actions.find((a) => a.id === 'core.link-issue-branch')!
    expect(branch.label).toBe('Link issue to branch')
    expect(branch.disabledReason).toBe('No project focused')
  })
})

describe('buildCoreActions — linking issues to a session vs a branch — runs onLinkIssueBranch for the branch action', () => {
  it('runs onLinkIssueBranch for the branch action', async () => {
    const deps = makeDeps()
    await buildCoreActions(deps)
      .find((a) => a.id === 'core.link-issue-branch')!
      .run()
    expect(deps.onLinkIssueBranch).toHaveBeenCalledOnce()
  })
})

describe('buildCoreActions — runs the matching dep callback', () => {
  it('runs the matching dep callback', async () => {
    const deps = makeDeps()
    const actions = buildCoreActions(deps)
    await actions.find((a) => a.id === 'core.clear')!.run()
    expect(deps.onClear).toHaveBeenCalled()
    await actions.find((a) => a.id === 'core.split-vertical')!.run()
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
  ['core.next-waiting-top', 'onNextWaiting', []],
  ['core.toggle-sidebar', 'onToggleSidebar', []],
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
  it('names a Jira issue and its tracker', () => {
    const actions = buildCoreActions(makeDeps({ issueLink: { key: 'J-7', tracker: 'jira' } }))
    expect(actionLabelOf(actions, 'core.link-issue')).toBe('Change linked issue')
    expect(actionLabelOf(actions, 'core.view-issue')).toBe('View J-7')
    expect(actionLabelOf(actions, 'core.copy-issue-key')).toBe('Copy issue key (J-7)')
    expect(actionLabelOf(actions, 'core.open-issue')).toBe('Open J-7 in Jira')
  })

  it('says what it would do when nothing is linked', () => {
    const actions = buildCoreActions(makeDeps({ issueLink: null }))
    expect(actionLabelOf(actions, 'core.link-issue')).toBe('Link issue')
    expect(actionLabelOf(actions, 'core.view-issue')).toBe('View linked issue')
    expect(actionLabelOf(actions, 'core.copy-issue-key')).toBe('Copy issue key')
    expect(actionLabelOf(actions, 'core.open-issue')).toBe('Open issue in tracker')
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

  it('is unavailable without a focused terminal and available with one', () => {
    expect(find({ hasTerminalFocused: false })?.disabledReason).toBeDefined()
    expect(find({ hasTerminalFocused: true })?.disabledReason).toBeUndefined()
  })
})
