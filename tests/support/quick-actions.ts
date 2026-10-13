import type { QuickAction, QuickActionGroup } from '../../src/renderer/quick-actions/types'

// What the Quick Actions specs check the real actions against. Nothing in the
// app reads these: they are the expectations, kept beside the tests.

interface ShortcutEvent {
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
 * accelerators handled in `App.tsx`'s `menu:*` subscriptions. The conflict-guard
 * spec presses each one and core-actions.spec checks `buildCoreActions` shows
 * it, so a new direct shortcut cannot exist without an action showing it (AC 4).
 */
export const CORE_SHORTCUTS: ShortcutSpec[] = [
  {
    actionId: 'core.open-home',
    display: '⌘⇧H',
    match: (e) => meta(e) && e.shiftKey && e.key.toLowerCase() === 'h',
  },
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

/** A top-level action whose letter is also a group's letter. */
function topLevelClashes(actions: QuickAction[], groups: QuickActionGroup[]): string[] {
  const groupLetters = new Set(groups.map((g) => g.mnemonic))
  return actions
    .filter(
      (action) => action.group === 'top' && !!action.mnemonic && groupLetters.has(action.mnemonic)
    )
    .map(
      (action) =>
        `Top-level action "${action.id}" uses mnemonic "${action.mnemonic}", which is also a group letter.`
    )
}

/** Two actions in one group with the same letter. */
function duplicateLetters(actions: QuickAction[]): string[] {
  const byGroup = new Map<string, Map<string, string[]>>()
  for (const action of actions) {
    if (!action.mnemonic) continue
    const byMnemonic = byGroup.get(action.group) ?? new Map<string, string[]>()
    byMnemonic.set(action.mnemonic, [...(byMnemonic.get(action.mnemonic) ?? []), action.id])
    byGroup.set(action.group, byMnemonic)
  }
  const conflicts: string[] = []
  for (const [group, byMnemonic] of byGroup) {
    for (const [mnemonic, ids] of byMnemonic) {
      if (ids.length > 1)
        conflicts.push(
          `Group "${group}" has duplicate mnemonic "${mnemonic}" on: ${ids.join(', ')}.`
        )
    }
  }
  return conflicts
}

/** Every mnemonic clash among `actions` and `groups`, as sentences. */
export function findMnemonicConflicts(
  actions: QuickAction[],
  groups: QuickActionGroup[]
): string[] {
  return [...topLevelClashes(actions, groups), ...duplicateLetters(actions)]
}
