import { useEffect, useRef } from 'react'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useSessionStore } from '../stores/session.store'
import { useTerminalSession } from './useTerminalSession'
import { useSettingsStore } from '../stores/settings.store'
import { useExtensionRegistry, matchesAccelerator } from '../extensions/registry'
import {
  cycleMostRecentlyAttended,
  jumpToNextAwaitingInput,
  cycleWorkspace,
  cycleTab,
  clearTerminal,
  newTerminalTab,
  splitPane,
  closeFocusedPane,
  switchToWorkspace,
} from '../quick-actions/shortcut-behaviors'

interface Options {
  onOpenSettings?: () => void
  onToggleLog?: () => void
  onOpenCommandPalette?: () => void
  onToggleOverview?: () => void
  onNewScratch?: () => void
  onNewTab?: () => void
  /** Opens the inline description editor for the focused session. */
  onEditSessionNote?: () => void
  /** A menu accelerator (Cmd+Shift+H), not a renderer keydown. Kept here so
   * `core-actions.ts` shares the same callback the "Home" quick action runs. */
  onOpenHome?: () => void
  /** When scratch mode is active, pass SCRATCH_PROJECT_ID here so all terminal shortcuts work. */
  scratchProjectId?: string | null
  /** Called with the core Quick Action's id whenever this hook handles a direct shortcut. */
  onDirectShortcut?: (actionId: string) => void
}

/** What a keydown is handled against: the caller's callbacks, the extensions' shortcuts, the terminals. */
interface ShortcutContext {
  options: Options
  keyboardShortcuts: ReturnType<typeof useExtensionRegistry.getState>['keyboardShortcuts']
  terminals: ReturnType<typeof useTerminalSession>
}

/** Where a key was pressed: an xterm takes Cmd+K and the arrows, a text field keeps them. */
interface KeyTarget {
  isMeta: boolean
  inTextField: boolean
}

/** One core shortcut: when it applies, the CORE_SHORTCUTS action id it reports (none for Cmd+P,
 * which is no action, and for Cmd+1–9, which reports only when there is a workspace to switch
 * to), and what it does. */
interface CoreKey {
  test(e: KeyboardEvent, at: KeyTarget): boolean
  actionId?: string | ((e: KeyboardEvent) => string)
  run(c: ShortcutContext, e: KeyboardEvent): void
}

const effectiveProjectOf = (c: ShortcutContext): string | null =>
  c.options.scratchProjectId ?? useWorkspaceStore.getState().activeProjectId

/** What newTerminalTab and splitPane read: the settings, the cwd and the terminal factory. */
function terminalDeps(c: ShortcutContext) {
  const workspaces = useWorkspaceStore.getState()
  return {
    resolveSettings: useSettingsStore.getState().resolveSettings,
    resolveActiveCwd: workspaces.resolveActiveCwd,
    activeWorkspaceId: workspaces.activeWorkspaceId,
    ...c.terminals,
  }
}

// Checked before the extensions' own shortcuts, so no extension can take them.
const APP_KEYS: CoreKey[] = [
  {
    test: (e, at) => at.isMeta && e.key === ',',
    actionId: 'core.open-settings',
    run: (c) => c.options.onOpenSettings?.(),
  },
  // Cmd+P: open command palette
  { test: (e, at) => at.isMeta && e.key === 'p', run: (c) => c.options.onOpenCommandPalette?.() },
  {
    test: (e, at) => at.isMeta && e.shiftKey && e.key === 'l',
    actionId: 'core.toggle-log',
    run: (c) => c.options.onToggleLog?.(),
  },
  // Cmd+Shift+E: toggle overview tab. Not Cmd+Shift+I — that is the "Open Extension
  // DevTools" menu accelerator, and Electron menu accelerators consume the key before
  // the renderer ever sees it, which made this branch unreachable.
  {
    test: (e, at) => at.isMeta && e.shiftKey && e.key === 'e',
    actionId: 'core.toggle-overview',
    run: (c) => c.options.onToggleOverview?.(),
  },
  {
    test: (e, at) => at.isMeta && e.shiftKey && e.key === 't',
    actionId: 'core.new-scratch',
    run: (c) => c.options.onNewScratch?.(),
  },
]

const WORKSPACE_KEYS: CoreKey[] = [
  // Cmd+1–9: switch to nth workspace, expand it, collapse all others
  {
    test: (e, at) => at.isMeta && e.key >= '1' && e.key <= '9',
    run: (c, e) => {
      const workspaces = useWorkspaceStore.getState()
      const index = parseInt(e.key, 10) - 1
      if (workspaces.workspaces[index]) c.options.onDirectShortcut?.('core.switch-workspace')
      switchToWorkspace(index, workspaces)
    },
  },
  {
    test: (e, at) => at.isMeta && (e.key === '=' || e.key === '+'),
    actionId: 'core.cycle-workspace-next',
    run: () => cycleWorkspace(1, useWorkspaceStore.getState()),
  },
  {
    test: (e, at) => at.isMeta && e.key === '-',
    actionId: 'core.cycle-workspace-prev',
    run: () => cycleWorkspace(-1, useWorkspaceStore.getState()),
  },
]

const TERMINAL_KEYS: CoreKey[] = [
  // Cmd+K: clear terminal screen (skip if typing — Cmd+K kills to line start in text fields)
  {
    test: (e, at) => at.isMeta && e.key === 'k' && !at.inTextField,
    actionId: 'core.clear',
    run: (c) => clearTerminal(effectiveProjectOf(c), useSessionStore.getState()),
  },
  {
    test: (e, at) => at.isMeta && e.key === 't',
    actionId: 'core.new-tab',
    run: (c) =>
      c.options.onNewTab
        ? c.options.onNewTab()
        : newTerminalTab(effectiveProjectOf(c), terminalDeps(c)),
  },
  // Cmd+D splits side by side, Cmd+Shift+D top and bottom. The effective project rather than the
  // active one, so a scratch terminal splits too — it used to do nothing at all there, and say
  // nothing, which reads as the feature having been removed rather than as not applying.
  {
    test: (e, at) => at.isMeta && !e.shiftKey && e.key === 'd',
    actionId: 'core.split-vertical',
    run: (c) => splitPane(effectiveProjectOf(c), 'vertical', terminalDeps(c)),
  },
  {
    test: (e, at) => at.isMeta && e.shiftKey && e.key === 'd',
    actionId: 'core.split-horizontal',
    run: (c) => splitPane(effectiveProjectOf(c), 'horizontal', terminalDeps(c)),
  },
  // Cmd+W: close focused split pane (or active tab if not in split mode)
  {
    test: (e, at) => at.isMeta && e.key === 'w',
    actionId: 'core.close-tab',
    run: (c) => closeFocusedPane(effectiveProjectOf(c), useSessionStore.getState()),
  },
]

const SESSION_KEYS: CoreKey[] = [
  // Cmd+] / Cmd+[: cycle recently attended sessions across project
  // boundaries. lastAttendedAt is what makes "recently used" meaningful;
  // this is its only consumer.
  {
    test: (e, at) => at.isMeta && (e.key === ']' || e.key === '[') && !at.inTextField,
    actionId: (e) => (e.key === ']' ? 'core.cycle-recent-next' : 'core.cycle-recent-prev'),
    run: (c, e) =>
      cycleMostRecentlyAttended(
        effectiveProjectOf(c),
        e.key === ']' ? 1 : -1,
        useSessionStore.getState()
      ),
  },
  {
    test: (e, at) => at.isMeta && e.shiftKey && (e.key === 'a' || e.key === 'A') && !at.inTextField,
    actionId: 'core.next-waiting',
    run: (c) => jumpToNextAwaitingInput(effectiveProjectOf(c), useSessionStore.getState()),
  },
  {
    test: (e, at) =>
      at.isMeta && !e.shiftKey && (e.key === 'i' || e.key === 'I') && !at.inTextField,
    actionId: 'core.edit-note',
    run: (c) => c.options.onEditSessionNote?.(),
  },
  // Cmd+Left / Cmd+Right: previous and next tab (skip if typing — they move within text)
  {
    test: (e, at) => at.isMeta && e.key === 'ArrowLeft' && !at.inTextField,
    actionId: 'core.prev-tab',
    run: (c) => cycleTabIn(effectiveProjectOf(c), -1),
  },
  {
    test: (e, at) => at.isMeta && e.key === 'ArrowRight' && !at.inTextField,
    actionId: 'core.next-tab',
    run: (c) => cycleTabIn(effectiveProjectOf(c), 1),
  },
]

function cycleTabIn(projectId: string | null, delta: number): void {
  if (projectId) cycleTab(projectId, delta, useSessionStore.getState())
}

function keyTarget(e: KeyboardEvent): KeyTarget {
  const inXterm = e.target instanceof HTMLElement && !!e.target.closest('.xterm')
  const inTextField =
    !inXterm &&
    (e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      (e.target instanceof HTMLElement && e.target.isContentEditable))
  return { isMeta: e.metaKey || e.ctrlKey, inTextField }
}

/** Runs the first of `keys` the event matches; false when none does. */
function runCoreKey(
  keys: CoreKey[],
  e: KeyboardEvent,
  { c, at }: { c: ShortcutContext; at: KeyTarget }
): boolean {
  const key = keys.find((k) => k.test(e, at))
  if (!key) return false
  e.preventDefault()
  if (key.actionId !== undefined) {
    c.options.onDirectShortcut?.(typeof key.actionId === 'string' ? key.actionId : key.actionId(e))
  }
  key.run(c, e)
  return true
}

const MODIFIERS = ['CmdOrCtrl', 'Cmd', 'Ctrl', 'Alt', 'Option', 'Shift']

/** Extension-registered shortcuts; a bare-key one does not fire while typing in a field. */
function runExtensionShortcut(e: KeyboardEvent, c: ShortcutContext, at: KeyTarget): boolean {
  for (const shortcut of c.keyboardShortcuts) {
    if (!matchesAccelerator(e, shortcut.accelerator)) continue
    const hasModifier = MODIFIERS.some((m) => shortcut.accelerator.includes(m))
    if (at.inTextField && !hasModifier) continue
    e.preventDefault()
    shortcut.action()
    return true
  }
  return false
}

function handleKeyDown(e: KeyboardEvent, c: ShortcutContext): void {
  const at = keyTarget(e)
  if (runCoreKey(APP_KEYS, e, { c, at })) return
  if (runExtensionShortcut(e, c, at)) return
  for (const keys of [WORKSPACE_KEYS, TERMINAL_KEYS, SESSION_KEYS]) {
    if (runCoreKey(keys, e, { c, at })) return
  }
}

/** The app's keyboard shortcuts, on the window. The store state they act on is read when the key
 * is pressed; the caller's callbacks are always its latest. */
export function useKeyboardShortcuts(options: Options = {}): void {
  const { keyboardShortcuts } = useExtensionRegistry()
  const terminals = useTerminalSession()
  const latest = useRef<ShortcutContext>({ options, keyboardShortcuts, terminals })
  useEffect(() => {
    latest.current = { options, keyboardShortcuts, terminals }
  })

  useEffect(() => {
    const handleWindowKey = (e: KeyboardEvent): void => handleKeyDown(e, latest.current)
    window.addEventListener('keydown', handleWindowKey)
    return () => window.removeEventListener('keydown', handleWindowKey)
  }, [])
}
