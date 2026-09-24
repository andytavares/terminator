import type { QuickAction } from './types'

export interface CoreSessionSummary {
  id: string
  projectId: string
  tabTitle: string
  projectName: string
}

export interface CoreWorkspaceSummary {
  id: string
  name: string
}

export interface CoreIssueLink {
  key: string
  tracker: 'linear' | 'jira'
}

export interface CoreActionDeps {
  /** A branch/project is focused (a tab bar could show, even with no session open yet). */
  hasProjectFocused: boolean
  /** A terminal session is open and focused within that project. */
  hasTerminalFocused: boolean
  activeWorkspaceId: string | null
  workspaces: CoreWorkspaceSummary[]
  sessions: CoreSessionSummary[]
  issueLink: CoreIssueLink | null
  issue: { url: string } | null

  onNewTab(): void
  onSplit(direction: 'vertical' | 'horizontal'): void
  onClosePane(): void
  onClear(): void
  onNewScratch(): void
  onEditNote(): void
  onCycleTab(delta: number): void
  onCycleRecentSession(delta: number): void
  onSelectSession(session: { id: string; projectId: string }): void
  onNextWaiting(): void
  onResume(): void
  onSwitchWorkspace(workspaceId: string): void
  onCycleWorkspace(delta: number): void
  /** Links the focused terminal's own session — not its branch. */
  onLinkIssue(): void
  /** The old "Link issue" behaviour: links the focused branch. */
  onLinkIssueBranch(): void
  onViewIssue(): void
  onCopyIssueKey(): void
  onOpenIssue(): void
  onHome(): void
  onOverview(): void
  onToggleSidebar(): void
  onOpenSettings(): void
  onToggleLog(): void
}

export interface ShortcutEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

interface ShortcutSpec {
  actionId: string
  display: string
  match(e: ShortcutEvent): boolean
}

function meta(e: ShortcutEvent): boolean {
  return e.metaKey || e.ctrlKey
}

/**
 * Every direct shortcut in `useKeyboardShortcuts.ts`, plus the menu
 * accelerators handled in `App.tsx`'s `menu:*` subscriptions. This is the one
 * table both the conflict-guard test and `buildCoreActions` read, so a new
 * direct shortcut cannot exist without an action showing it (AC 4).
 */
export const CORE_SHORTCUTS: ShortcutSpec[] = [
  { actionId: 'core.open-home', display: '⌘`', match: (e) => meta(e) && e.key === '`' },
  {
    actionId: 'core.open-settings',
    display: '⌘,',
    match: (e) => meta(e) && !e.shiftKey && e.key === ',',
  },
  {
    actionId: 'core.toggle-log',
    display: '⌘⇧L',
    match: (e) => meta(e) && e.shiftKey && e.key.toLowerCase() === 'l',
  },
  {
    actionId: 'core.toggle-overview',
    display: '⌘⇧E',
    match: (e) => meta(e) && e.shiftKey && e.key.toLowerCase() === 'e',
  },
  {
    actionId: 'core.new-scratch',
    display: '⌘⇧T',
    match: (e) => meta(e) && e.shiftKey && e.key.toLowerCase() === 't',
  },
  {
    actionId: 'core.switch-workspace',
    display: '⌘1–9',
    match: (e) => meta(e) && e.key >= '1' && e.key <= '9',
  },
  {
    actionId: 'core.cycle-workspace-next',
    display: '⌘=',
    match: (e) => meta(e) && (e.key === '=' || e.key === '+'),
  },
  {
    actionId: 'core.cycle-workspace-prev',
    display: '⌘-',
    match: (e) => meta(e) && e.key === '-',
  },
  { actionId: 'core.clear', display: '⌘K', match: (e) => meta(e) && e.key.toLowerCase() === 'k' },
  {
    actionId: 'core.new-tab',
    display: '⌘T',
    match: (e) => meta(e) && !e.shiftKey && e.key.toLowerCase() === 't',
  },
  {
    actionId: 'core.split-vertical',
    display: '⌘D',
    match: (e) => meta(e) && !e.shiftKey && e.key.toLowerCase() === 'd',
  },
  {
    actionId: 'core.split-horizontal',
    display: '⌘⇧D',
    match: (e) => meta(e) && e.shiftKey && e.key.toLowerCase() === 'd',
  },
  {
    actionId: 'core.close-tab',
    display: '⌘W',
    match: (e) => meta(e) && e.key.toLowerCase() === 'w',
  },
  {
    actionId: 'core.cycle-recent-next',
    display: '⌘]',
    match: (e) => meta(e) && e.key === ']',
  },
  {
    actionId: 'core.cycle-recent-prev',
    display: '⌘[',
    match: (e) => meta(e) && e.key === '[',
  },
  {
    actionId: 'core.next-waiting',
    display: '⌘⇧A',
    match: (e) => meta(e) && e.shiftKey && e.key.toLowerCase() === 'a',
  },
  {
    actionId: 'core.edit-note',
    display: '⌘I',
    match: (e) => meta(e) && !e.shiftKey && e.key.toLowerCase() === 'i',
  },
  {
    actionId: 'core.prev-tab',
    display: '⌘←',
    match: (e) => meta(e) && e.key === 'ArrowLeft',
  },
  {
    actionId: 'core.next-tab',
    display: '⌘→',
    match: (e) => meta(e) && e.key === 'ArrowRight',
  },
  {
    actionId: 'core.toggle-sidebar',
    display: '⌘B',
    match: (e) => meta(e) && e.key.toLowerCase() === 'b',
  },
]

const NO_TERMINAL = 'No terminal focused'
const NO_PROJECT = 'No project focused'
const NO_ISSUE = 'No linked issue'

export function buildCoreActions(deps: CoreActionDeps): QuickAction[] {
  const actions: QuickAction[] = []

  actions.push(
    {
      id: 'core.new-tab',
      label: 'New tab',
      group: 'terminal',
      mnemonic: 't',
      shortcut: '⌘T',
      disabledReason: deps.hasProjectFocused ? undefined : NO_PROJECT,
      run: deps.onNewTab,
    },
    {
      id: 'core.split-vertical',
      label: 'Split right',
      group: 'terminal',
      mnemonic: 'd',
      shortcut: '⌘D',
      disabledReason: deps.hasTerminalFocused ? undefined : NO_TERMINAL,
      run: () => deps.onSplit('vertical'),
    },
    {
      id: 'core.split-horizontal',
      label: 'Split down',
      group: 'terminal',
      mnemonic: 'D',
      shortcut: '⌘⇧D',
      disabledReason: deps.hasTerminalFocused ? undefined : NO_TERMINAL,
      run: () => deps.onSplit('horizontal'),
    },
    {
      id: 'core.close-tab',
      label: 'Close pane',
      group: 'terminal',
      mnemonic: 'w',
      shortcut: '⌘W',
      disabledReason: deps.hasTerminalFocused ? undefined : NO_TERMINAL,
      run: deps.onClosePane,
    },
    {
      id: 'core.clear',
      label: 'Clear',
      group: 'terminal',
      mnemonic: 'k',
      shortcut: '⌘K',
      disabledReason: deps.hasTerminalFocused ? undefined : NO_TERMINAL,
      run: deps.onClear,
    },
    {
      id: 'core.new-scratch',
      label: 'New scratch terminal',
      group: 'terminal',
      mnemonic: 'n',
      shortcut: '⌘⇧T',
      run: deps.onNewScratch,
    },
    {
      id: 'core.edit-note',
      label: 'Edit session note',
      group: 'terminal',
      mnemonic: 'i',
      shortcut: '⌘I',
      disabledReason: deps.hasTerminalFocused ? undefined : NO_TERMINAL,
      run: deps.onEditNote,
    },
    {
      id: 'core.prev-tab',
      label: 'Previous tab',
      group: 'terminal',
      mnemonic: '[',
      shortcut: '⌘←',
      disabledReason: deps.hasTerminalFocused ? undefined : NO_TERMINAL,
      run: () => deps.onCycleTab(-1),
    },
    {
      id: 'core.next-tab',
      label: 'Next tab',
      group: 'terminal',
      mnemonic: ']',
      shortcut: '⌘→',
      disabledReason: deps.hasTerminalFocused ? undefined : NO_TERMINAL,
      run: () => deps.onCycleTab(1),
    },
    {
      id: 'core.cycle-recent-prev',
      label: 'Previous recent session',
      group: 'terminal',
      mnemonic: 'p',
      shortcut: '⌘[',
      run: () => deps.onCycleRecentSession(-1),
    },
    {
      id: 'core.cycle-recent-next',
      label: 'Next recent session',
      group: 'terminal',
      mnemonic: 'r',
      shortcut: '⌘]',
      run: () => deps.onCycleRecentSession(1),
    }
  )

  actions.push({
    id: 'core.next-waiting',
    label: 'Next waiting on you',
    group: 'sessions',
    mnemonic: 'a',
    shortcut: '⌘⇧A',
    run: deps.onNextWaiting,
  })

  deps.sessions.slice(0, 9).forEach((session, i) => {
    actions.push({
      id: `session:${session.id}`,
      label: session.tabTitle,
      group: 'sessions',
      mnemonic: String(i + 1),
      description: session.projectName,
      run: () => deps.onSelectSession(session),
    })
  })

  actions.push({
    id: 'core.resume',
    label: 'Resume a conversation…',
    group: 'sessions',
    mnemonic: 'r',
    run: deps.onResume,
  })

  deps.workspaces.slice(0, 9).forEach((ws, i) => {
    actions.push({
      id: `core.switch-workspace-${ws.id}`,
      label: `Switch to ${ws.name}`,
      group: 'workspace',
      mnemonic: String(i + 1),
      shortcut: `⌘${i + 1}`,
      run: () => deps.onSwitchWorkspace(ws.id),
    })
  })

  actions.push(
    {
      id: 'core.cycle-workspace-next',
      label: 'Next workspace',
      group: 'workspace',
      mnemonic: '=',
      shortcut: '⌘=',
      run: () => deps.onCycleWorkspace(1),
    },
    {
      id: 'core.cycle-workspace-prev',
      label: 'Previous workspace',
      group: 'workspace',
      mnemonic: '-',
      shortcut: '⌘-',
      run: () => deps.onCycleWorkspace(-1),
    },
    {
      // Targets the focused terminal's own session — the branch's link is
      // "Link issue to branch", below.
      id: 'core.link-issue',
      label: deps.issueLink ? 'Change linked issue' : 'Link issue',
      group: 'workspace',
      mnemonic: 'l',
      disabledReason: deps.hasTerminalFocused ? undefined : NO_TERMINAL,
      run: deps.onLinkIssue,
    },
    {
      id: 'core.link-issue-branch',
      label: 'Link issue to branch',
      group: 'workspace',
      mnemonic: 'k',
      disabledReason: deps.hasProjectFocused ? undefined : NO_PROJECT,
      run: deps.onLinkIssueBranch,
    },
    {
      id: 'core.view-issue',
      label: deps.issueLink ? `View ${deps.issueLink.key}` : 'View linked issue',
      group: 'workspace',
      mnemonic: 'v',
      disabledReason: !deps.hasProjectFocused ? NO_PROJECT : !deps.issueLink ? NO_ISSUE : undefined,
      run: deps.onViewIssue,
    },
    {
      id: 'core.copy-issue-key',
      label: deps.issueLink ? `Copy issue key (${deps.issueLink.key})` : 'Copy issue key',
      group: 'workspace',
      mnemonic: 'c',
      disabledReason: !deps.hasProjectFocused ? NO_PROJECT : !deps.issueLink ? NO_ISSUE : undefined,
      run: deps.onCopyIssueKey,
    },
    {
      id: 'core.open-issue',
      label: deps.issueLink
        ? `Open ${deps.issueLink.key} in ${deps.issueLink.tracker === 'linear' ? 'Linear' : 'Jira'}`
        : 'Open issue in tracker',
      group: 'workspace',
      mnemonic: 'o',
      disabledReason: !deps.hasProjectFocused ? NO_PROJECT : !deps.issueLink ? NO_ISSUE : undefined,
      run: deps.onOpenIssue,
    }
  )

  actions.push(
    {
      id: 'core.open-home',
      label: 'Home',
      group: 'top',
      mnemonic: 'h',
      shortcut: '⌘`',
      run: deps.onHome,
    },
    {
      id: 'core.toggle-overview',
      label: 'Overview',
      group: 'top',
      mnemonic: 'o',
      shortcut: '⌘⇧E',
      run: deps.onOverview,
    },
    {
      id: 'core.next-waiting-top',
      label: 'Next waiting session',
      group: 'top',
      mnemonic: 'a',
      shortcut: '⌘⇧A',
      run: deps.onNextWaiting,
    },
    {
      id: 'core.toggle-sidebar',
      label: 'Toggle sidebar',
      group: 'top',
      mnemonic: 'b',
      shortcut: '⌘B',
      run: deps.onToggleSidebar,
    },
    {
      id: 'core.open-settings',
      label: 'Settings',
      group: 'top',
      mnemonic: ',',
      shortcut: '⌘,',
      run: deps.onOpenSettings,
    },
    {
      id: 'core.toggle-log',
      label: 'Toggle log window',
      group: 'top',
      shortcut: '⌘⇧L',
      run: deps.onToggleLog,
    }
  )

  return actions
}
