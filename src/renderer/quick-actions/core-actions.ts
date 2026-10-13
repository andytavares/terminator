import type { QuickAction } from './types'

export interface CoreSessionSummary {
  id: string
  projectId: string
  tabTitle: string
  projectName: string
}

interface CoreWorkspaceSummary {
  id: string
  name: string
}

interface CoreIssueLink {
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

const NO_TERMINAL = 'No terminal focused'
const NO_PROJECT = 'No project focused'
const NO_ISSUE = 'No linked issue'

/**
 * One core action as data: what it is called, where it sits, what it needs
 * focused, and which handler it runs. `requires` decides `disabledReason`:
 * `issue` needs a focused project with a linked issue.
 */
interface CoreActionSpec {
  id: string
  label: string | ((deps: CoreActionDeps) => string)
  group: string
  mnemonic?: string
  shortcut?: string
  requires?: 'terminal' | 'project' | 'issue'
  run(deps: CoreActionDeps): void
}

const TERMINAL_ACTIONS: CoreActionSpec[] = [
  {
    id: 'core.new-tab',
    label: 'New tab',
    group: 'terminal',
    mnemonic: 't',
    shortcut: '⌘T',
    requires: 'project',
    run: (d) => d.onNewTab(),
  },
  {
    id: 'core.split-vertical',
    label: 'Split right',
    group: 'terminal',
    mnemonic: 'd',
    shortcut: '⌘D',
    requires: 'terminal',
    run: (d) => d.onSplit('vertical'),
  },
  {
    id: 'core.split-horizontal',
    label: 'Split down',
    group: 'terminal',
    mnemonic: 'D',
    shortcut: '⌘⇧D',
    requires: 'terminal',
    run: (d) => d.onSplit('horizontal'),
  },
  {
    id: 'core.close-tab',
    label: 'Close pane',
    group: 'terminal',
    mnemonic: 'w',
    shortcut: '⌘W',
    requires: 'terminal',
    run: (d) => d.onClosePane(),
  },
  {
    id: 'core.clear',
    label: 'Clear',
    group: 'terminal',
    mnemonic: 'k',
    shortcut: '⌘K',
    requires: 'terminal',
    run: (d) => d.onClear(),
  },
  {
    id: 'core.new-scratch',
    label: 'New scratch terminal',
    group: 'terminal',
    mnemonic: 'n',
    shortcut: '⌘⇧T',
    run: (d) => d.onNewScratch(),
  },
  {
    id: 'core.edit-note',
    label: 'Edit session note',
    group: 'terminal',
    mnemonic: 'i',
    shortcut: '⌘I',
    requires: 'terminal',
    run: (d) => d.onEditNote(),
  },
  {
    id: 'core.prev-tab',
    label: 'Previous tab',
    group: 'terminal',
    mnemonic: '[',
    shortcut: '⌘←',
    requires: 'terminal',
    run: (d) => d.onCycleTab(-1),
  },
  {
    id: 'core.next-tab',
    label: 'Next tab',
    group: 'terminal',
    mnemonic: ']',
    shortcut: '⌘→',
    requires: 'terminal',
    run: (d) => d.onCycleTab(1),
  },
  {
    id: 'core.cycle-recent-prev',
    label: 'Previous recent session',
    group: 'terminal',
    mnemonic: 'p',
    shortcut: '⌘[',
    run: (d) => d.onCycleRecentSession(-1),
  },
  {
    id: 'core.cycle-recent-next',
    label: 'Next recent session',
    group: 'terminal',
    mnemonic: 'r',
    shortcut: '⌘]',
    run: (d) => d.onCycleRecentSession(1),
  },
  {
    id: 'core.next-waiting',
    label: 'Next waiting on you',
    group: 'sessions',
    mnemonic: 'a',
    shortcut: '⌘⇧A',
    run: (d) => d.onNextWaiting(),
  },
]

const RESUME: CoreActionSpec = {
  id: 'core.resume',
  label: 'Resume a conversation…',
  group: 'sessions',
  mnemonic: 'r',
  run: (d) => d.onResume(),
}

const issueKey = (d: CoreActionDeps): string | undefined => d.issueLink?.key
const trackerName = (d: CoreActionDeps): string =>
  d.issueLink?.tracker === 'linear' ? 'Linear' : 'Jira'

const WORKSPACE_ACTIONS: CoreActionSpec[] = [
  {
    id: 'core.cycle-workspace-next',
    label: 'Next workspace',
    group: 'workspace',
    mnemonic: '=',
    shortcut: '⌘=',
    run: (d) => d.onCycleWorkspace(1),
  },
  {
    id: 'core.cycle-workspace-prev',
    label: 'Previous workspace',
    group: 'workspace',
    mnemonic: '-',
    shortcut: '⌘-',
    run: (d) => d.onCycleWorkspace(-1),
  },
  // Targets the focused terminal's own session — the branch's link is
  // "Link issue to branch", below.
  {
    id: 'core.link-issue',
    label: (d) => (d.issueLink ? 'Change linked issue' : 'Link issue'),
    group: 'workspace',
    mnemonic: 'l',
    requires: 'terminal',
    run: (d) => d.onLinkIssue(),
  },
  {
    id: 'core.link-issue-branch',
    label: 'Link issue to branch',
    group: 'workspace',
    mnemonic: 'k',
    requires: 'project',
    run: (d) => d.onLinkIssueBranch(),
  },
  {
    id: 'core.view-issue',
    label: (d) => (d.issueLink ? `View ${issueKey(d)}` : 'View linked issue'),
    group: 'workspace',
    mnemonic: 'v',
    requires: 'issue',
    run: (d) => d.onViewIssue(),
  },
  {
    id: 'core.copy-issue-key',
    label: (d) => (d.issueLink ? `Copy issue key (${issueKey(d)})` : 'Copy issue key'),
    group: 'workspace',
    mnemonic: 'c',
    requires: 'issue',
    run: (d) => d.onCopyIssueKey(),
  },
  {
    id: 'core.open-issue',
    label: (d) =>
      d.issueLink ? `Open ${issueKey(d)} in ${trackerName(d)}` : 'Open issue in tracker',
    group: 'workspace',
    mnemonic: 'o',
    requires: 'issue',
    run: (d) => d.onOpenIssue(),
  },
]

const TOP_ACTIONS: CoreActionSpec[] = [
  {
    id: 'core.open-home',
    label: 'Home',
    group: 'top',
    mnemonic: 'h',
    shortcut: '⌘⇧H',
    run: (d) => d.onHome(),
  },
  {
    id: 'core.toggle-overview',
    label: 'Overview',
    group: 'top',
    mnemonic: 'o',
    shortcut: '⌘⇧E',
    run: (d) => d.onOverview(),
  },
  {
    id: 'core.next-waiting-top',
    label: 'Next waiting session',
    group: 'top',
    mnemonic: 'a',
    shortcut: '⌘⇧A',
    run: (d) => d.onNextWaiting(),
  },
  {
    id: 'core.toggle-sidebar',
    label: 'Toggle sidebar',
    group: 'top',
    mnemonic: 'b',
    shortcut: '⌘B',
    run: (d) => d.onToggleSidebar(),
  },
  {
    id: 'core.open-settings',
    label: 'Settings',
    group: 'top',
    mnemonic: ',',
    shortcut: '⌘,',
    run: (d) => d.onOpenSettings(),
  },
  {
    id: 'core.toggle-log',
    label: 'Toggle log window',
    group: 'top',
    shortcut: '⌘⇧L',
    run: (d) => d.onToggleLog(),
  },
]

function disabledReason(
  requires: CoreActionSpec['requires'],
  deps: CoreActionDeps
): string | undefined {
  if (requires === 'terminal') return deps.hasTerminalFocused ? undefined : NO_TERMINAL
  if (!deps.hasProjectFocused) return NO_PROJECT
  return requires === 'issue' && !deps.issueLink ? NO_ISSUE : undefined
}

function actionOf(spec: CoreActionSpec, deps: CoreActionDeps): QuickAction {
  const { label, requires, run, ...shown } = spec
  return {
    ...shown,
    label: typeof label === 'function' ? label(deps) : label,
    ...(requires === undefined ? {} : { disabledReason: disabledReason(requires, deps) }),
    run: () => run(deps),
  }
}

/** The first nine open sessions, numbered 1–9. */
function sessionActions(deps: CoreActionDeps): QuickAction[] {
  return deps.sessions.slice(0, 9).map((session, i) => ({
    id: `session:${session.id}`,
    label: session.tabTitle,
    group: 'sessions',
    mnemonic: String(i + 1),
    description: session.projectName,
    run: () => deps.onSelectSession(session),
  }))
}

/** The first nine workspaces, on ⌘1–⌘9. */
function switchWorkspaceActions(deps: CoreActionDeps): QuickAction[] {
  return deps.workspaces.slice(0, 9).map((ws, i) => ({
    id: `core.switch-workspace-${ws.id}`,
    label: `Switch to ${ws.name}`,
    group: 'workspace',
    mnemonic: String(i + 1),
    shortcut: `⌘${i + 1}`,
    run: () => deps.onSwitchWorkspace(ws.id),
  }))
}

export function buildCoreActions(deps: CoreActionDeps): QuickAction[] {
  const fromSpecs = (specs: CoreActionSpec[]) => specs.map((spec) => actionOf(spec, deps))
  return [
    ...fromSpecs(TERMINAL_ACTIONS),
    ...sessionActions(deps),
    actionOf(RESUME, deps),
    ...switchWorkspaceActions(deps),
    ...fromSpecs(WORKSPACE_ACTIONS),
    ...fromSpecs(TOP_ACTIONS),
  ]
}
